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
	api         *dataapi.Client
	db          *db.DB
	registry    *registry.RelayRegistry
	relay       *relay.Client
	opDiscovery *operator.Discovery
	opClient    *operator.Client
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

// Run starts three continuous goroutines: collector, verifier, re-verifier.
func (p *Prober) Run(ctx context.Context) {
	// Pre-warm operator cache
	if p.opDiscovery != nil {
		if ops, err := p.opDiscovery.GetOperators(ctx); err != nil {
			log.Printf("[prober] operator cache warm failed: %v", err)
		} else {
			log.Printf("[prober] operator cache warmed: %d unique operators", len(ops))
		}
	}

	var wg sync.WaitGroup

	// Goroutine 1: Continuous blob collector
	wg.Add(1)
	go func() {
		defer wg.Done()
		p.runCollector(ctx)
	}()

	// Goroutine 2: Continuous verifier (relay + operator)
	wg.Add(1)
	go func() {
		defer wg.Done()
		p.runVerifier(ctx)
	}()

	// Goroutine 3: Age-based re-verifier (every 5 minutes)
	wg.Add(1)
	go func() {
		defer wg.Done()
		p.runReverifier(ctx)
	}()

	wg.Wait()
}

// runCollector continuously polls DataAPI for new blobs.
func (p *Prober) runCollector(ctx context.Context) {
	log.Println("[collector] started — polling DataAPI for new blobs")
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		collected := p.collectBlobs(ctx)
		if collected == 0 {
			// No new blobs, wait a bit before polling again
			time.Sleep(3 * time.Second)
		} else {
			// Brief pause to avoid hammering DataAPI
			time.Sleep(1 * time.Second)
		}
	}
}

// runVerifier continuously picks unprobed blobs and verifies them.
func (p *Prober) runVerifier(ctx context.Context) {
	log.Println("[verifier] started — probing unverified blobs")
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		unprobed, err := p.db.GetUnprobedBlobs(ctx, 5)
		if err != nil {
			log.Printf("[verifier] error: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}

		if len(unprobed) == 0 {
			time.Sleep(2 * time.Second)
			continue
		}

		var wg sync.WaitGroup
		for _, blob := range unprobed {
			wg.Add(1)
			go func(bk string, ra uint64) {
				defer wg.Done()
				p.probeBlob(ctx, bk, ra)
				p.fetchAttestation(ctx, bk)

				if p.opDiscovery != nil {
					blobAgeHours := float64(time.Now().UnixNano()-int64(ra)) / float64(time.Hour)
					p.probeAllOperators(ctx, bk, blobAgeHours)
				}
			}(blob.BlobKey, blob.RequestedAt)
		}
		wg.Wait()
	}
}

// runReverifier periodically re-probes old blobs at specific age intervals.
func (p *Prober) runReverifier(ctx context.Context) {
	log.Println("[reverifier] started — checking aged blobs every 5m")
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	// Run once immediately
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

func (p *Prober) collectBlobs(ctx context.Context) int {
	total := 0
	cursor := ""
	maxPages := 5

	for page := 0; page < maxPages; page++ {
		feed, err := p.api.FetchBlobFeed(100, cursor)
		if err != nil {
			if page == 0 {
				log.Printf("[collector] error: %v", err)
			}
			break
		}
		if len(feed.Blobs) == 0 {
			break
		}

		newCount := 0
		for _, blob := range feed.Blobs {
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
		total += newCount

		if len(feed.Blobs) < 100 || feed.Cursor == "" {
			break
		}
		cursor = feed.Cursor
	}

	if total > 0 {
		log.Printf("[collector] +%d blobs", total)
	}
	return total
}

func (p *Prober) ageBasedReverify(ctx context.Context) {
	for _, ag := range ageGroups {
		aged, err := p.db.GetAgedBlobKeys(ctx, ag.hoursAgo, ag.windowHours, ag.limit)
		if err != nil {
			continue
		}
		if len(aged) == 0 {
			continue
		}
		log.Printf("[reverifier] re-verifying %d blobs at age ~%.0fh", len(aged), ag.hoursAgo)
		var wg sync.WaitGroup
		for _, ab := range aged {
			wg.Add(1)
			go func(bk string, ra uint64) {
				defer wg.Done()
				p.probeBlob(ctx, bk, ra)
			}(ab.BlobKey, ab.RequestedAt)
		}
		wg.Wait()
	}
}

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
	log.Printf("[relay] %s blob=%s relay=%d latency=%dms",
		status, blobKey[:16], relayKey, result.LatencyMs)
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
	if p.opDiscovery == nil || p.opClient == nil {
		return
	}

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

		// Enough chunks confirmed — blob is recoverable, stop early
		if totalChunks >= minChunksForRecovery {
			break
		}
	}

	recoverable := "RECOVERABLE"
	if totalChunks < minChunksForRecovery {
		recoverable = "AT_RISK"
	}

	log.Printf("[recovery] blob=%s probed=%d ok=%d fail=%d chunks=%d/%d %s",
		blobKey[:16], okCount+failCount, okCount, failCount,
		totalChunks, minChunksForRecovery, recoverable)
}
