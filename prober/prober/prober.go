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

type Prober struct {
	api          *dataapi.Client
	db           *db.DB
	registry     *registry.RelayRegistry
	relay        *relay.Client
	opDiscovery  *operator.Discovery
	opClient     *operator.Client
	opSampleSize int
	lastCursor   string // remember cursor for incremental collection
}

func New(api *dataapi.Client, database *db.DB, reg *registry.RelayRegistry, relayClient *relay.Client,
	opDiscovery *operator.Discovery, opClient *operator.Client, opSampleSize int) *Prober {
	return &Prober{
		api:          api,
		db:           database,
		registry:     reg,
		relay:        relayClient,
		opDiscovery:  opDiscovery,
		opClient:     opClient,
		opSampleSize: opSampleSize,
	}
}

func (p *Prober) RunCycle(ctx context.Context) {
	start := time.Now()
	log.Println("[prober] starting probe cycle")

	// Phase 1: Collect ALL new blobs via cursor pagination
	collected := p.collectBlobs(ctx)

	// Phase 2: Pre-warm operator cache
	if p.opDiscovery != nil {
		if _, err := p.opDiscovery.GetOperators(ctx); err != nil {
			log.Printf("[prober] operator cache warm failed: %v", err)
		}
	}

	// Phase 3: Probe unprobed blobs (relay + operator + attestation)
	p.probeUnprobed(ctx)

	// Phase 4: Age-based re-verification
	p.ageBasedReverify(ctx)

	log.Printf("[prober] cycle complete in %s — collected %d blobs",
		time.Since(start).Round(time.Millisecond), collected)
}

// collectBlobs fetches all new blobs since last cycle via cursor pagination.
func (p *Prober) collectBlobs(ctx context.Context) int {
	total := 0
	cursor := ""
	maxPages := 10 // safety limit: 10 pages × 100 = 1000 blobs max per cycle

	for page := 0; page < maxPages; page++ {
		feed, err := p.api.FetchBlobFeed(100, cursor)
		if err != nil {
			log.Printf("[prober] error fetching blob feed page %d: %v", page, err)
			break
		}

		if len(feed.Blobs) == 0 {
			break
		}

		newCount := 0
		for _, blob := range feed.Blobs {
			observed := &db.ObservedBlob{
				BlobKey:       blob.BlobKey,
				AccountID:     blob.BlobMetadata.BlobHeader.PaymentMetadata.AccountID,
				BlobStatus:    blob.BlobMetadata.BlobStatus,
				BlobSizeBytes: blob.BlobMetadata.BlobSizeBytes,
				RequestedAt:   blob.BlobMetadata.RequestedAt,
				ExpiryUnixSec: blob.BlobMetadata.ExpiryUnixSec,
				CommitmentX:   blob.BlobMetadata.BlobHeader.BlobCommitments.Commitment.X,
				CommitmentY:   blob.BlobMetadata.BlobHeader.BlobCommitments.Commitment.Y,
				QuorumNumbers: blob.BlobMetadata.BlobHeader.QuorumNumbers,
			}
			if err := p.db.UpsertBlob(ctx, observed); err != nil {
				log.Printf("[prober] error upserting blob %s: %v", blob.BlobKey, err)
			} else {
				newCount++
			}
		}
		total += newCount

		// If we got fewer than requested, we've reached the end
		if len(feed.Blobs) < 100 {
			break
		}

		// Use cursor for next page
		if feed.Cursor == "" {
			break
		}
		cursor = feed.Cursor
	}

	log.Printf("[prober] collected %d blobs from DataAPI", total)
	return total
}

// probeUnprobed picks unprobed blobs from DB and probes them.
func (p *Prober) probeUnprobed(ctx context.Context) {
	// Relay probe: up to 20 unprobed blobs
	unprobed, err := p.db.GetUnprobedBlobs(ctx, 20)
	if err != nil {
		log.Printf("[prober] error getting unprobed blobs: %v", err)
		return
	}
	if len(unprobed) == 0 {
		return
	}
	log.Printf("[prober] probing %d unprobed blobs (relay + operator)", len(unprobed))

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

			if p.opDiscovery != nil {
				blobAgeHours := float64(time.Now().UnixNano()-int64(ra)) / float64(time.Hour)
				p.probeOperators(ctx, bk, blobAgeHours)
			}
		}(blob.BlobKey, blob.RequestedAt)
	}
	wg.Wait()
}

// ageBasedReverify re-probes old blobs at specific age intervals.
func (p *Prober) ageBasedReverify(ctx context.Context) {
	var wg sync.WaitGroup
	sem := make(chan struct{}, 10)

	for _, ag := range ageGroups {
		aged, err := p.db.GetAgedBlobKeys(ctx, ag.hoursAgo, ag.windowHours, ag.limit)
		if err != nil {
			log.Printf("[prober] error getting aged blobs (%.0fh): %v", ag.hoursAgo, err)
			continue
		}
		if len(aged) > 0 {
			log.Printf("[prober] re-verifying %d blobs at age ~%.0fh", len(aged), ag.hoursAgo)
			for _, ab := range aged {
				wg.Add(1)
				go func(bk string, ra uint64) {
					defer wg.Done()
					sem <- struct{}{}
					defer func() { <-sem }()
					p.probeBlob(ctx, bk, ra)
				}(ab.BlobKey, ab.RequestedAt)
			}
		}
	}
	wg.Wait()
}

func (p *Prober) probeBlob(ctx context.Context, blobKey string, requestedAt uint64) {
	if p.registry == nil {
		return
	}

	blobAgeHours := float64(time.Now().UnixNano()-int64(requestedAt)) / float64(time.Hour)

	cert, err := p.api.FetchCertificate(blobKey)
	if err != nil {
		if strings.Contains(err.Error(), "HTTP 500") && strings.Contains(err.Error(), "certificate not found") {
			return // too fresh, skip silently
		}
		log.Printf("[prober] error fetching certificate for %s: %v", blobKey[:16], err)
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
	log.Printf("[relay] %s blob=%s relay=%d age=%.1fh latency=%dms %s",
		status, blobKey[:16], relayKey, blobAgeHours, result.LatencyMs, result.Error)
}

func (p *Prober) fetchAttestation(ctx context.Context, blobKey string) {
	att, err := p.api.FetchAttestationInfo(blobKey)
	if err != nil {
		if !strings.Contains(err.Error(), "HTTP 500") {
			log.Printf("[prober] attestation fetch failed for %s: %v", blobKey[:16], err)
		}
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

func (p *Prober) probeOperators(ctx context.Context, blobKey string, blobAgeHours float64) {
	if p.opDiscovery == nil || p.opClient == nil {
		return
	}

	operators, err := p.opDiscovery.SampleOperators(ctx, p.opSampleSize)
	if err != nil {
		log.Printf("[prober] operator discovery error: %v", err)
		return
	}

	var wg sync.WaitGroup
	for _, op := range operators {
		wg.Add(1)
		go func(o operator.OperatorInfo) {
			defer wg.Done()
			result := p.opClient.ProbeChunks(ctx, o.Socket, blobKey, 0)
			opIDHex := hex.EncodeToString(o.OperatorID[:8])

			p.db.InsertOperatorProbe(ctx, &db.OperatorProbeResult{
				BlobKey: blobKey, BlobAgeHours: blobAgeHours,
				OperatorID: opIDHex, OperatorSocket: o.Socket,
				QuorumID: 0, Success: result.Success,
				LatencyMs: result.LatencyMs, ChunksReturned: result.ChunksReturned,
				ErrorMessage: result.Error,
			})

			status := "OK"
			if !result.Success {
				status = "FAIL"
			}
			log.Printf("[operator] %s op=%s chunks=%d latency=%dms %s",
				status, opIDHex, result.ChunksReturned, result.LatencyMs, result.Error)
		}(op)
	}
	wg.Wait()
}
