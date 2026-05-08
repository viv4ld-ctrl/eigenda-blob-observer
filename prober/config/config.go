package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	DatabaseURL         string
	EthRPCURL           string
	DataAPIBaseURL      string
	ProbeInterval       time.Duration
	EigenDADirectory    string
	OperatorProbeEnabled bool
	OperatorSampleSize   int // number of operators to probe per blob
}

func Load() *Config {
	interval, err := time.ParseDuration(getEnv("PROBE_INTERVAL", "5m"))
	if err != nil {
		interval = 5 * time.Minute
	}

	sampleSize, _ := strconv.Atoi(getEnv("OPERATOR_SAMPLE_SIZE", "3"))

	return &Config{
		DatabaseURL:          getEnv("DATABASE_URL", "postgres://observer:observer_pass@localhost:5432/eigenda_observer?sslmode=disable"),
		EthRPCURL:            getEnv("ETH_RPC_URL", ""),
		DataAPIBaseURL:       getEnv("DATAAPI_BASE_URL", "https://dataapi.eigenda.xyz/api/v2"),
		ProbeInterval:        interval,
		EigenDADirectory:     getEnv("EIGENDA_DIRECTORY", "0x64AB2e9A86FA2E183CB6f01B2D4050c1c2dFAad4"),
		OperatorProbeEnabled: getEnv("OPERATOR_PROBE_ENABLED", "true") == "true",
		OperatorSampleSize:   sampleSize,
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
