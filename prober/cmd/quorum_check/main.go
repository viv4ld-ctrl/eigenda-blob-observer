package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/joho/godotenv"
)

const idxABI = `[{"inputs":[{"internalType":"uint8","name":"quorumNumber","type":"uint8"}],"name":"totalOperatorsForQuorum","outputs":[{"internalType":"uint32","name":"","type":"uint32"}],"stateMutability":"view","type":"function"}]`
const dirABI = `[{"inputs":[{"internalType":"string","name":"name","type":"string"}],"name":"getAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"}]`

func main() {
	_ = godotenv.Load("../../.env")
	_ = godotenv.Load("../.env")
	_ = godotenv.Load(".env")
	client, err := ethclient.Dial(os.Getenv("ETH_RPC_URL"))
	if err != nil {
		panic(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	dABI, _ := abi.JSON(strings.NewReader(dirABI))
	dirAddr := common.HexToAddress("0x64AB2e9A86FA2E183CB6f01B2D4050c1c2dFAad4")
	data, _ := dABI.Pack("getAddress", "INDEX_REGISTRY")
	result, _ := client.CallContract(ctx, ethereum.CallMsg{To: &dirAddr, Data: data}, nil)
	vals, _ := dABI.Unpack("getAddress", result)
	idxAddr := vals[0].(common.Address)
	fmt.Printf("IndexRegistry: %s\n\n", idxAddr.Hex())

	iABI, _ := abi.JSON(strings.NewReader(idxABI))

	for q := uint8(0); q < 10; q++ {
		data, _ := iABI.Pack("totalOperatorsForQuorum", q)
		result, err := client.CallContract(ctx, ethereum.CallMsg{To: &idxAddr, Data: data}, nil)
		if err != nil {
			break
		}
		vals, err := iABI.Unpack("totalOperatorsForQuorum", result)
		if err != nil {
			break
		}
		count := vals[0].(uint32)
		if count > 0 {
			fmt.Printf("Quorum %d: %d operators\n", q, count)
		}
	}
}
