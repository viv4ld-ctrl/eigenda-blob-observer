package operator

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

// ABIs for operator discovery contracts

const directoryABI = `[
	{
		"inputs": [{"internalType": "string", "name": "name", "type": "string"}],
		"name": "getAddress",
		"outputs": [{"internalType": "address", "name": "", "type": "address"}],
		"stateMutability": "view",
		"type": "function"
	}
]`

// RegistryCoordinator: get operator list for a quorum
const registryCoordinatorABI = `[
	{
		"inputs": [{"internalType": "uint8", "name": "quorumNumber", "type": "uint8"}],
		"name": "getQuorumBitmapIndicesAtBlockNumber",
		"outputs": [{"internalType": "uint32[]", "name": "", "type": "uint32[]"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "bytes32", "name": "operatorId", "type": "bytes32"}],
		"name": "getOperatorStatus",
		"outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}],
		"stateMutability": "view",
		"type": "function"
	}
]`

// IndexRegistry: get operators in a quorum
const indexRegistryABI = `[
	{
		"inputs": [{"internalType": "uint8", "name": "quorumNumber", "type": "uint8"}],
		"name": "totalOperatorsForQuorum",
		"outputs": [{"internalType": "uint32", "name": "", "type": "uint32"}],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [{"internalType": "uint8", "name": "quorumNumber", "type": "uint8"}, {"internalType": "uint32", "name": "operatorIndex", "type": "uint32"}],
		"name": "getLatestOperatorUpdate",
		"outputs": [{"components": [{"internalType": "uint32", "name": "fromBlockNumber", "type": "uint32"}, {"internalType": "bytes32", "name": "operatorId", "type": "bytes32"}], "internalType": "struct IIndexRegistry.OperatorUpdate", "name": "", "type": "tuple"}],
		"stateMutability": "view",
		"type": "function"
	}
]`

// SocketRegistry: get operator socket (host:port)
const socketRegistryABI = `[
	{
		"inputs": [{"internalType": "bytes32", "name": "operatorId", "type": "bytes32"}],
		"name": "getOperatorSocket",
		"outputs": [{"internalType": "string", "name": "", "type": "string"}],
		"stateMutability": "view",
		"type": "function"
	}
]`

type OperatorInfo struct {
	OperatorID [32]byte
	Socket     string // "host:disperse_port;host:retrieval_port" format
}

type Discovery struct {
	client      *ethclient.Client
	dirAddr     common.Address
	dirABI      abi.ABI
	idxABI      abi.ABI
	socketABI   abi.ABI

	idxRegistryAddr    common.Address
	socketRegistryAddr common.Address

	mu    sync.RWMutex
	cache []OperatorInfo
	cacheTime time.Time
	ttl   time.Duration
}

func NewDiscovery(ethRPCURL string, directoryAddress string) (*Discovery, error) {
	client, err := ethclient.Dial(ethRPCURL)
	if err != nil {
		return nil, fmt.Errorf("connect to eth RPC: %w", err)
	}

	dirABI, err := abi.JSON(strings.NewReader(directoryABI))
	if err != nil {
		return nil, err
	}
	idxABI, err := abi.JSON(strings.NewReader(indexRegistryABI))
	if err != nil {
		return nil, err
	}
	sockABI, err := abi.JSON(strings.NewReader(socketRegistryABI))
	if err != nil {
		return nil, err
	}

	d := &Discovery{
		client:  client,
		dirAddr: common.HexToAddress(directoryAddress),
		dirABI:  dirABI,
		idxABI:  idxABI,
		socketABI: sockABI,
		ttl:     1 * time.Hour,
	}

	// Resolve contract addresses from directory
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	idxAddr, err := d.resolveAddress(ctx, "INDEX_REGISTRY")
	if err != nil {
		return nil, fmt.Errorf("resolve INDEX_REGISTRY: %w", err)
	}
	d.idxRegistryAddr = idxAddr

	sockAddr, err := d.resolveAddress(ctx, "SOCKET_REGISTRY")
	if err != nil {
		return nil, fmt.Errorf("resolve SOCKET_REGISTRY: %w", err)
	}
	d.socketRegistryAddr = sockAddr

	log.Printf("[operator] INDEX_REGISTRY=%s SOCKET_REGISTRY=%s", idxAddr.Hex(), sockAddr.Hex())

	return d, nil
}

func (d *Discovery) resolveAddress(ctx context.Context, name string) (common.Address, error) {
	data, err := d.dirABI.Pack("getAddress", name)
	if err != nil {
		return common.Address{}, err
	}
	result, err := d.client.CallContract(ctx, ethereum.CallMsg{To: &d.dirAddr, Data: data}, nil)
	if err != nil {
		return common.Address{}, err
	}
	values, err := d.dirABI.Unpack("getAddress", result)
	if err != nil || len(values) == 0 {
		return common.Address{}, fmt.Errorf("unpack failed for %s", name)
	}
	addr, ok := values[0].(common.Address)
	if !ok {
		return common.Address{}, fmt.Errorf("unexpected type for %s address", name)
	}
	return addr, nil
}

// GetOperators returns the deduplicated operator set across all active quorums.
// Results are cached for 1 hour.
func (d *Discovery) GetOperators(ctx context.Context) ([]OperatorInfo, error) {
	d.mu.RLock()
	if len(d.cache) > 0 && time.Since(d.cacheTime) < d.ttl {
		result := d.cache
		d.mu.RUnlock()
		return result, nil
	}
	d.mu.RUnlock()

	// Fetch operators from all quorums and deduplicate by operator ID
	seen := make(map[[32]byte]bool)
	var allOperators []OperatorInfo

	for q := uint8(0); q < 10; q++ {
		operators, err := d.fetchOperators(ctx, q)
		if err != nil {
			break // quorum doesn't exist, stop
		}
		if len(operators) == 0 {
			continue
		}
		for _, op := range operators {
			if !seen[op.OperatorID] {
				seen[op.OperatorID] = true
				allOperators = append(allOperators, op)
			}
		}
	}

	if len(allOperators) == 0 {
		return nil, fmt.Errorf("no operators found across any quorum")
	}

	log.Printf("[operator] total unique operators across all quorums: %d", len(allOperators))

	d.mu.Lock()
	d.cache = allOperators
	d.cacheTime = time.Now()
	d.mu.Unlock()

	return allOperators, nil
}

// SampleOperators returns a random subset of operators.
func (d *Discovery) SampleOperators(ctx context.Context, count int) ([]OperatorInfo, error) {
	all, err := d.GetOperators(ctx)
	if err != nil {
		return nil, err
	}
	if len(all) <= count {
		return all, nil
	}

	perm := rand.Perm(len(all))
	sample := make([]OperatorInfo, count)
	for i := 0; i < count; i++ {
		sample[i] = all[perm[i]]
	}
	return sample, nil
}

func (d *Discovery) fetchOperators(ctx context.Context, quorumNumber uint8) ([]OperatorInfo, error) {
	// 1. Get total operator count for this quorum
	data, err := d.idxABI.Pack("totalOperatorsForQuorum", quorumNumber)
	if err != nil {
		return nil, fmt.Errorf("pack totalOperatorsForQuorum: %w", err)
	}

	result, err := d.client.CallContract(ctx, ethereum.CallMsg{To: &d.idxRegistryAddr, Data: data}, nil)
	if err != nil {
		return nil, fmt.Errorf("call totalOperatorsForQuorum: %w", err)
	}

	values, err := d.idxABI.Unpack("totalOperatorsForQuorum", result)
	if err != nil || len(values) == 0 {
		return nil, fmt.Errorf("unpack totalOperatorsForQuorum: %w", err)
	}

	totalOps, ok := values[0].(uint32)
	if !ok {
		return nil, fmt.Errorf("unexpected type for total operators")
	}
	log.Printf("[operator] quorum %d has %d operators", quorumNumber, totalOps)

	// 2. Get operator IDs via getLatestOperatorUpdate for each index
	var operators []OperatorInfo
	for i := uint32(0); i < totalOps; i++ {
		opInfo, err := d.getOperatorAtIndex(ctx, quorumNumber, i)
		if err != nil {
			log.Printf("[operator] skip index %d: %v", i, err)
			continue
		}
		if opInfo.Socket != "" {
			operators = append(operators, *opInfo)
		}
	}

	log.Printf("[operator] discovered %d operators with sockets for quorum %d", len(operators), quorumNumber)
	return operators, nil
}

func (d *Discovery) getOperatorAtIndex(ctx context.Context, quorumNumber uint8, index uint32) (*OperatorInfo, error) {
	// Get operator ID from IndexRegistry
	data, err := d.idxABI.Pack("getLatestOperatorUpdate", quorumNumber, index)
	if err != nil {
		return nil, err
	}

	result, err := d.client.CallContract(ctx, ethereum.CallMsg{To: &d.idxRegistryAddr, Data: data}, nil)
	if err != nil {
		return nil, err
	}

	// The result is a tuple (uint32 fromBlockNumber, bytes32 operatorId)
	// We need to manually unpack since it's a struct
	values, err := d.idxABI.Unpack("getLatestOperatorUpdate", result)
	if err != nil {
		return nil, err
	}

	// values[0] is a struct with fromBlockNumber and operatorId
	update, ok := values[0].(struct {
		FromBlockNumber uint32   `json:"fromBlockNumber"`
		OperatorId      [32]byte `json:"operatorId"`
	})
	if !ok {
		return nil, fmt.Errorf("unexpected type for operator update at index %d", index)
	}

	// Zero operator ID means the slot is empty (operator deregistered)
	emptyID := [32]byte{}
	if update.OperatorId == emptyID {
		return &OperatorInfo{}, nil
	}

	// Get socket from SocketRegistry
	socket, err := d.getOperatorSocket(ctx, update.OperatorId)
	if err != nil {
		return nil, fmt.Errorf("get socket for operator %x: %w", update.OperatorId[:8], err)
	}

	return &OperatorInfo{
		OperatorID: update.OperatorId,
		Socket:     socket,
	}, nil
}

func (d *Discovery) getOperatorSocket(ctx context.Context, operatorID [32]byte) (string, error) {
	data, err := d.socketABI.Pack("getOperatorSocket", operatorID)
	if err != nil {
		return "", err
	}

	result, err := d.client.CallContract(ctx, ethereum.CallMsg{To: &d.socketRegistryAddr, Data: data}, nil)
	if err != nil {
		return "", err
	}

	values, err := d.socketABI.Unpack("getOperatorSocket", result)
	if err != nil || len(values) == 0 {
		return "", fmt.Errorf("unpack failed")
	}

	socket, ok := values[0].(string)
	if !ok {
		return "", fmt.Errorf("unexpected type")
	}
	return socket, nil
}

func (d *Discovery) Close() {
	d.client.Close()
}

// parseSocket extracts host and port at the given index from operator socket string.
// Format: "host:port0;port1;port2;port3"
// Indices: [0]=DISPERSAL, [1]=RETRIEVAL, [2]=V2_DISPERSAL, [3]=V2_RETRIEVAL
func parseSocket(socket string, portIndex int) string {
	colonIdx := strings.Index(socket, ":")
	if colonIdx < 0 {
		return socket
	}
	host := socket[:colonIdx]
	ports := strings.Split(socket[colonIdx+1:], ";")
	if portIndex < len(ports) {
		return host + ":" + ports[portIndex]
	}
	return socket
}

// ParseRetrievalSocket returns host:v1_retrieval_port (index 1).
func ParseRetrievalSocket(socket string) string {
	return parseSocket(socket, 1)
}

// ParseV2RetrievalSocket returns host:v2_retrieval_port (index 3).
// This port exposes validator.Retrieval.GetChunks for v2 blob chunk retrieval.
func ParseV2RetrievalSocket(socket string) string {
	return parseSocket(socket, 3)
}
