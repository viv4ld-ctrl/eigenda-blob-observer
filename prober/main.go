package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"github.com/eigenda-blob-observer/prober/config"
	"github.com/eigenda-blob-observer/prober/dataapi"
	"github.com/eigenda-blob-observer/prober/db"
	"github.com/eigenda-blob-observer/prober/operator"
	"github.com/eigenda-blob-observer/prober/prober"
	"github.com/eigenda-blob-observer/prober/registry"
	"github.com/eigenda-blob-observer/prober/relay"
)

func main() {
	// Load .env from current dir or parent dir
	if err := godotenv.Load(); err != nil {
		_ = godotenv.Load("../.env")
	}

	cfg := config.Load()

	log.Println("starting eigenda blob observer prober")
	log.Printf("probe interval: %s", cfg.ProbeInterval)
	log.Printf("dataapi: %s", cfg.DataAPIBaseURL)

	// DB
	database, err := db.New(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer database.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := database.RunMigrations(ctx); err != nil {
		log.Fatalf("failed to run migrations: %v", err)
	}
	log.Println("database migrations complete")

	// DataAPI client
	apiClient := dataapi.NewClient(cfg.DataAPIBaseURL)

	// Relay registry (resolved dynamically from EigenDADirectory)
	var reg *registry.RelayRegistry
	if cfg.EthRPCURL != "" && cfg.EigenDADirectory != "" {
		reg, err = registry.NewFromDirectory(cfg.EthRPCURL, cfg.EigenDADirectory)
		if err != nil {
			log.Fatalf("failed to resolve relay registry from directory: %v", err)
		}
		defer reg.Close()
		log.Printf("resolved EigenDARelayRegistry at %s from directory %s",
			reg.RegistryAddress().Hex(), cfg.EigenDADirectory)
	} else {
		log.Println("WARNING: ETH_RPC_URL or EIGENDA_DIRECTORY not set, relay probing disabled")
	}

	// Relay gRPC client
	relayClient := relay.NewClient()

	// Operator discovery + client
	var opDiscovery *operator.Discovery
	var opClient *operator.Client
	if cfg.OperatorProbeEnabled && cfg.EthRPCURL != "" && cfg.EigenDADirectory != "" {
		opDiscovery, err = operator.NewDiscovery(cfg.EthRPCURL, cfg.EigenDADirectory)
		if err != nil {
			log.Printf("WARNING: failed to init operator discovery: %v", err)
		} else {
			defer opDiscovery.Close()
			opClient = operator.NewClient()
			log.Printf("operator probing enabled (sample size: %d)", cfg.OperatorSampleSize)
		}
	}

	// Prober
	p := prober.New(apiClient, database, reg, relayClient, opDiscovery, opClient, cfg.OperatorSampleSize)

	// Run first cycle immediately
	p.RunCycle(ctx)

	// Scheduler
	ticker := time.NewTicker(cfg.ProbeInterval)
	defer ticker.Stop()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	log.Printf("scheduler started, next probe in %s", cfg.ProbeInterval)

	for {
		select {
		case <-ticker.C:
			p.RunCycle(ctx)
		case sig := <-sigCh:
			log.Printf("received signal %s, shutting down", sig)
			cancel()
			return
		}
	}
}
