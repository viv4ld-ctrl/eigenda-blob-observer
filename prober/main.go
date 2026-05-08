package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

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
	if err := godotenv.Load(); err != nil {
		_ = godotenv.Load("../.env")
	}

	cfg := config.Load()

	log.Println("starting eigenda blob observer prober")
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

	// DataAPI
	apiClient := dataapi.NewClient(cfg.DataAPIBaseURL)

	// Relay registry
	var reg *registry.RelayRegistry
	if cfg.EthRPCURL != "" && cfg.EigenDADirectory != "" {
		reg, err = registry.NewFromDirectory(cfg.EthRPCURL, cfg.EigenDADirectory)
		if err != nil {
			log.Fatalf("failed to resolve relay registry: %v", err)
		}
		defer reg.Close()
		log.Printf("resolved EigenDARelayRegistry at %s", reg.RegistryAddress().Hex())
	} else {
		log.Println("WARNING: ETH_RPC_URL or EIGENDA_DIRECTORY not set, relay probing disabled")
	}

	// Relay client
	relayClient := relay.NewClient()

	// Operator discovery + client
	var opDiscovery *operator.Discovery
	var opClient *operator.Client
	if cfg.OperatorProbeEnabled && cfg.EthRPCURL != "" && cfg.EigenDADirectory != "" {
		opDiscovery, err = operator.NewDiscovery(cfg.EthRPCURL, cfg.EigenDADirectory)
		if err != nil {
			log.Printf("WARNING: operator discovery failed: %v", err)
		} else {
			defer opDiscovery.Close()
			opClient = operator.NewClient()
			log.Println("operator probing enabled (full scan per blob)")
		}
	}

	// Prober — runs continuously
	p := prober.New(apiClient, database, reg, relayClient, opDiscovery, opClient)

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		log.Printf("received %s, shutting down", sig)
		cancel()
	}()

	p.Run(ctx)
}
