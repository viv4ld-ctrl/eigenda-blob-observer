package prober

import (
	"context"
	"encoding/hex"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/eigenda-blob-observer/prober/dataapi"
	"github.com/eigenda-blob-observer/prober/db"
	"github.com/eigenda-blob-observer/prober/operator"
	"github.com/eigenda-blob-observer/prober/registry"
	"github.com/eigenda-blob-observer/prober/relay"
)

type ageGroup struct {
	hoursAgo    float64
	windowHours float64
	limit       int
}

var ageGroups = []ageGroup{
	{hoursAgo: 24, windowHours: 2, limit: 5},
	{hoursAgo: 168, windowHours: 4, limit: 5},
	{hoursAgo: 312, windowHours: 4, limit: 5},
	{hoursAgo: 336, windowHours: 4, limit: 3},
	{hoursAgo: 360, windowHours: 4, limit: 3},
}

const minChunksForRecovery = 1024

type Prober struct {
	api                *dataapi.Client
	db                 *db.DB
	registry           *registry.RelayRegistry
	relay              *relay.Client
	opDiscovery        *operator.Discovery
	opClient           *operator.Client
	lastSeenTimestamp   uint64
}

func New(api *dataapi.Client, database *db.DB, reg *registry.RelayRegistry, relayClient *relay.Client,
	opDiscovery *operator.Discovery, opClient *operator.Client) *Prober {
	return &Prober{
		api:         api,
		db:          database,
		registry:    reg,
		relay:       relayClient,
		opDiscovery: opDiscovery,
		opClient:    opClient,
	}
}

// Run starts 4 continuous goroutines.
func (p *Prober) Run(ctx context.Context) {
	if p.opDiscovery != nil {
		if ops, err := p.opDiscovery.GetOperators(ctx); err != nil {
			log.Printf("[prober] operator cache warm failed: %v", err)
		} else {
			log.Printf("[prober] operator cache warmed: %d unique operators", len(ops))
		}
	}

	var wg sync.WaitGroup

	wg.Add(1)
	go func() { defer wg.Done(); p.runCollector(ctx) }()

	wg.Add(1)
	go func() { defer wg.Done(); p.runRelayVerifier(ctx) }()

	wg.Add(1)
	go func() { defer wg.Done(); p.runOperatorVerifier(ctx) }()

	wg.Add(1)
	go func() { defer wg.Done(); p.runReverifier(ctx) }()

	wg.Wait()
}

// --- Goroutine 1: Collector ---

func (p *Prober) runCollector(ctx context.Context) {
	log.Println("[collector] started")
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		n := p.collectBlobs(ctx)
		if n == 0 {
			time.Sleep(3 * time.Second)
		} else {
			time.Sleep(1 * time.Second)
		}
	}
}

func (p *Prober) collectBlobs(ctx context.Context) int {
	feed, err := p.api.FetchBlobFeed(100, "")
	if err != nil {
		log.Printf("[collector] error: %v", err)
		return 0
	}
	if len(feed.Blobs) == 0 {
		return 0
	}

	newCount := 0
	for _, blob := range feed.Blobs {
		// Stop when we hit a blob we've already seen (feed is newest-first)
		if blob.BlobMetadata.RequestedAt <= p.lastSeenTimestamp {
			break
		}
		err := p.db.UpsertBlob(ctx, &db.ObservedBlob{
			BlobKey:       blob.BlobKey,
			AccountID:     blob.BlobMetadata.BlobHeader.PaymentMetadata.AccountID,
			BlobStatus:    blob.BlobMetadata.BlobStatus,
			BlobSizeBytes: blob.BlobMetadata.BlobSizeBytes,
			RequestedAt:   blob.BlobMetadata.RequestedAt,
			ExpiryUnixSec: blob.BlobMetadata.ExpiryUnixSec,
			CommitmentX:   blob.BlobMetadata.BlobHeader.BlobCommitments.Commitment.X,
			CommitmentY:   blob.BlobMetadata.BlobHeader.BlobCommitments.Commitment.Y,
			QuorumNumbers: blob.BlobMetadata.BlobHeader.QuorumNumbers,
		})
		if err == nil {
			newCount++
		}
	}

	// Remember the newest blob's timestamp
	if feed.Blobs[0].BlobMetadata.RequestedAt > p.lastSeenTimestamp {
		p.lastSeenTimestamp = feed.Blobs[0].BlobMetadata.RequestedAt
	}

	if newCount > 0 {
		log.Printf("[collector] +%d new blobs", newCount)
	}
	return newCount
}

// --- Goroutine 2: Relay Verifier (fast, near-full coverage) ---

func (p *Prober) runRelayVerifier(ctx context.Context) {
	log.Println("[relay-verifier] started")
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		unprobed, err := p.db.GetUnprobedBlobs(ctx, 20)
		if err != nil || len(unprobed) == 0 {
			time.Sleep(2 * time.Second)
			continue
		}

		var wg sync.WaitGroup
		sem := make(chan struct{}, 10)
		for _, blob := range unprobed {
			wg.Add(1)
			go func(bk string, ra uint64) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				p.probeBlob(ctx, bk, ra)
				p.fetchAttestation(ctx, bk)
			}(blob.BlobKey, blob.RequestedAt)
		}
		wg.Wait()
	}
}

// --- Goroutine 3: Operator Verifier (slow, sequential scan, early exit) ---

func (p *Prober) runOperatorVerifier(ctx context.Context) {
	if p.opDiscovery == nil || p.opClient == nil {
		log.Println("[operator-verifier] disabled (no operator discovery)")
		return
	}
	log.Println("[operator-verifier] started")
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		unprobed, err := p.db.GetUnprobedOperatorBlobs(ctx, 1)
		if err != nil || len(unprobed) == 0 {
			time.Sleep(2 * time.Second)
			continue
		}

		blob := unprobed[0]
		blobAgeHours := float64(time.Now().UnixNano()-int64(blob.RequestedAt)) / float64(time.Hour)
		p.probeAllOperators(ctx, blob.BlobKey, blobAgeHours)
	}
}

// --- Goroutine 4: Re-verifier ---

func (p *Prober) runReverifier(ctx context.Context) {
	log.Println("[reverifier] started")
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	p.ageBasedReverify(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.ageBasedReverify(ctx)
		}
	}
}

func (p *Prober) ageBasedReverify(ctx context.Context) {
	for _, ag := range ageGroups {
		aged, err := p.db.GetAgedBlobKeys(ctx, ag.hoursAgo, ag.windowHours, ag.limit)
		if err != nil || len(aged) == 0 {
			continue
		}
		log.Printf("[reverifier] %d blobs at ~%.0fh", len(aged), ag.hoursAgo)
		for _, ab := range aged {
			p.probeBlob(ctx, ab.BlobKey, ab.RequestedAt)
		}
	}
}

// --- Shared probe functions ---

func (p *Prober) probeBlob(ctx context.Context, blobKey string, requestedAt uint64) {
	if p.registry == nil {
		return
	}
	blobAgeHours := float64(time.Now().UnixNano()-int64(requestedAt)) / float64(time.Hour)

	cert, err := p.api.FetchCertificate(blobKey)
	if err != nil {
		if strings.Contains(err.Error(), "HTTP 500") && strings.Contains(err.Error(), "certificate not found") {
			return
		}
		p.db.InsertProbeResult(ctx, &db.ProbeResult{
			BlobKey: blobKey, BlobAgeHours: blobAgeHours,
			RelayKey: -1, Success: false, ErrorMessage: err.Error(),
		})
		return
	}
	if len(cert.BlobCertificate.RelayKeys) == 0 {
		return
	}
	for _, relayKey := range cert.BlobCertificate.RelayKeys {
		p.probeRelay(ctx, blobKey, blobAgeHours, relayKey)
	}
}

func (p *Prober) probeRelay(ctx context.Context, blobKey string, blobAgeHours float64, relayKey uint32) {
	relayURL, err := p.registry.GetRelayURL(ctx, relayKey)
	if err != nil {
		p.db.InsertProbeResult(ctx, &db.ProbeResult{
			BlobKey: blobKey, BlobAgeHours: blobAgeHours,
			RelayKey: int(relayKey), Success: false,
			ErrorMessage: fmt.Sprintf("registry lookup: %v", err),
		})
		return
	}
	result := p.relay.GetBlob(ctx, relayURL, blobKey)
	p.db.InsertProbeResult(ctx, &db.ProbeResult{
		BlobKey: blobKey, BlobAgeHours: blobAgeHours,
		RelayKey: int(relayKey), Success: result.Success,
		LatencyMs: result.LatencyMs, ErrorMessage: result.Error,
		DataSizeBytes: result.DataSizeBytes,
	})
	status := "OK"
	if !result.Success {
		status = "FAIL"
	}
	log.Printf("[relay] %s blob=%s latency=%dms", status, blobKey[:12], result.LatencyMs)
}

func (p *Prober) fetchAttestation(ctx context.Context, blobKey string) {
	att, err := p.api.FetchAttestationInfo(blobKey)
	if err != nil {
		return
	}
	nonSignerCount := len(att.AttestationInfo.Attestation.NonSignerPubKeys)
	for qStr, signingPct := range att.AttestationInfo.Attestation.QuorumResults {
		qNum, _ := strconv.Atoi(qStr)
		p.db.InsertAttestation(ctx, &db.AttestationSnapshot{
			BlobKey: blobKey, QuorumNumber: qNum,
			TotalNonSigners: nonSignerCount, SigningStakePercentage: float64(signingPct),
		})
	}
}

func (p *Prober) probeAllOperators(ctx context.Context, blobKey string, blobAgeHours float64) {
	allOperators, err := p.opDiscovery.GetOperators(ctx)
	if err != nil {
		return
	}

	totalChunks := 0
	okCount := 0
	failCount := 0

	for _, op := range allOperators {
		r := p.opClient.ProbeChunks(ctx, op.Socket, blobKey, 0)
		opIDHex := hex.EncodeToString(op.OperatorID[:8])

		p.db.InsertOperatorProbe(ctx, &db.OperatorProbeResult{
			BlobKey: blobKey, BlobAgeHours: blobAgeHours,
			OperatorID: opIDHex, OperatorSocket: op.Socket,
			QuorumID: 0, Success: r.Success,
			LatencyMs: r.LatencyMs, ChunksReturned: r.ChunksReturned,
			ErrorMessage: r.Error,
		})

		if r.Success {
			okCount++
			totalChunks += r.ChunksReturned
		} else {
			failCount++
		}

		if totalChunks >= minChunksForRecovery {
			break
		}
	}

	tag := "RECOVERABLE"
	if totalChunks < minChunksForRecovery {
		tag = "AT_RISK"
	}
	log.Printf("[recovery] blob=%s probed=%d ok=%d chunks=%d/%d %s",
		blobKey[:12], okCount+failCount, okCount, totalChunks, minChunksForRecovery, tag)
}
