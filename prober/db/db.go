package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

type ObservedBlob struct {
	BlobKey       string
	AccountID     string
	BlobStatus    string
	BlobSizeBytes int
	RequestedAt   uint64
	ExpiryUnixSec uint64
	CommitmentX   string
	CommitmentY   string
	QuorumNumbers string
}

type ProbeResult struct {
	BlobKey       string
	BlobAgeHours  float64
	RelayKey      int
	Success       bool
	LatencyMs     int
	ErrorMessage  string
	DataSizeBytes int
}

type AttestationSnapshot struct {
	BlobKey               string
	QuorumNumber          int
	TotalSigners          int
	TotalNonSigners       int
	SigningStakePercentage float64
}

type OperatorProbeResult struct {
	BlobKey        string
	BlobAgeHours   float64
	OperatorID     string
	OperatorSocket string
	QuorumID       int
	Success        bool
	LatencyMs      int
	ChunksReturned int
	ErrorMessage   string
}

type AgedBlobKey struct {
	BlobKey     string
	RequestedAt uint64
}

type DB struct {
	conn *sql.DB
}

func New(databaseURL string) (*DB, error) {
	conn, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	conn.SetMaxOpenConns(10)
	conn.SetMaxIdleConns(5)
	conn.SetConnMaxLifetime(5 * time.Minute)

	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}

	return &DB{conn: conn}, nil
}

func (d *DB) RunMigrations(ctx context.Context) error {
	migrations := `
CREATE TABLE IF NOT EXISTS observed_blobs (
    blob_key VARCHAR(128) PRIMARY KEY,
    account_id VARCHAR(64),
    blob_status VARCHAR(32),
    blob_size_bytes INTEGER,
    requested_at BIGINT,
    expiry_unix_sec BIGINT,
    commitment_x TEXT,
    commitment_y TEXT,
    quorum_numbers TEXT,
    first_observed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS retrieval_probes (
    id SERIAL PRIMARY KEY,
    blob_key VARCHAR(128) NOT NULL REFERENCES observed_blobs(blob_key),
    probe_timestamp TIMESTAMP DEFAULT NOW(),
    blob_age_hours FLOAT,
    relay_key INTEGER,
    success BOOLEAN,
    latency_ms INTEGER,
    error_message TEXT,
    data_size_bytes INTEGER
);

CREATE INDEX IF NOT EXISTS idx_retrieval_blob_key ON retrieval_probes(blob_key);
CREATE INDEX IF NOT EXISTS idx_retrieval_age ON retrieval_probes(blob_age_hours);
CREATE INDEX IF NOT EXISTS idx_retrieval_timestamp ON retrieval_probes(probe_timestamp);

CREATE TABLE IF NOT EXISTS attestation_snapshots (
    id SERIAL PRIMARY KEY,
    blob_key VARCHAR(128) NOT NULL REFERENCES observed_blobs(blob_key),
    snapshot_timestamp TIMESTAMP DEFAULT NOW(),
    quorum_number INTEGER,
    total_signers INTEGER,
    total_nonsigners INTEGER,
    signing_stake_percentage FLOAT
);

CREATE INDEX IF NOT EXISTS idx_attestation_blob_key ON attestation_snapshots(blob_key);

CREATE TABLE IF NOT EXISTS operator_probes (
    id SERIAL PRIMARY KEY,
    blob_key VARCHAR(128) NOT NULL REFERENCES observed_blobs(blob_key),
    probe_timestamp TIMESTAMP DEFAULT NOW(),
    blob_age_hours FLOAT,
    operator_id VARCHAR(128),
    operator_socket TEXT,
    quorum_id INTEGER,
    success BOOLEAN,
    latency_ms INTEGER,
    chunks_returned INTEGER,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_operator_probe_blob ON operator_probes(blob_key);
CREATE INDEX IF NOT EXISTS idx_operator_probe_ts ON operator_probes(probe_timestamp);
`
	_, err := d.conn.ExecContext(ctx, migrations)
	return err
}

func (d *DB) UpsertBlob(ctx context.Context, b *ObservedBlob) error {
	_, err := d.conn.ExecContext(ctx, `
		INSERT INTO observed_blobs (blob_key, account_id, blob_status, blob_size_bytes,
			requested_at, expiry_unix_sec, commitment_x, commitment_y, quorum_numbers)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (blob_key) DO NOTHING`,
		b.BlobKey, b.AccountID, b.BlobStatus, b.BlobSizeBytes,
		b.RequestedAt, b.ExpiryUnixSec, b.CommitmentX, b.CommitmentY, b.QuorumNumbers,
	)
	return err
}

func (d *DB) InsertProbeResult(ctx context.Context, p *ProbeResult) error {
	_, err := d.conn.ExecContext(ctx, `
		INSERT INTO retrieval_probes (blob_key, blob_age_hours, relay_key, success,
			latency_ms, error_message, data_size_bytes)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		p.BlobKey, p.BlobAgeHours, p.RelayKey, p.Success,
		p.LatencyMs, p.ErrorMessage, p.DataSizeBytes,
	)
	return err
}

func (d *DB) InsertAttestation(ctx context.Context, a *AttestationSnapshot) error {
	_, err := d.conn.ExecContext(ctx, `
		INSERT INTO attestation_snapshots (blob_key, quorum_number, total_signers,
			total_nonsigners, signing_stake_percentage)
		VALUES ($1, $2, $3, $4, $5)`,
		a.BlobKey, a.QuorumNumber, a.TotalSigners,
		a.TotalNonSigners, a.SigningStakePercentage,
	)
	return err
}

// GetUnprobedBlobs returns blob keys that have no retrieval_probes yet.
func (d *DB) GetUnprobedBlobs(ctx context.Context, limit int) ([]AgedBlobKey, error) {
	rows, err := d.conn.QueryContext(ctx, `
		SELECT ob.blob_key, ob.requested_at FROM observed_blobs ob
		LEFT JOIN retrieval_probes rp ON ob.blob_key = rp.blob_key
		WHERE rp.blob_key IS NULL
		ORDER BY ob.requested_at DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []AgedBlobKey
	for rows.Next() {
		var bk AgedBlobKey
		if err := rows.Scan(&bk.BlobKey, &bk.RequestedAt); err != nil {
			return nil, err
		}
		results = append(results, bk)
	}
	return results, rows.Err()
}

// GetUnprobedOperatorBlobs returns blob keys that have no operator_probes yet.
func (d *DB) GetUnprobedOperatorBlobs(ctx context.Context, limit int) ([]AgedBlobKey, error) {
	rows, err := d.conn.QueryContext(ctx, `
		SELECT ob.blob_key, ob.requested_at FROM observed_blobs ob
		LEFT JOIN operator_probes op ON ob.blob_key = op.blob_key
		WHERE op.blob_key IS NULL
		ORDER BY ob.requested_at DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []AgedBlobKey
	for rows.Next() {
		var bk AgedBlobKey
		if err := rows.Scan(&bk.BlobKey, &bk.RequestedAt); err != nil {
			return nil, err
		}
		results = append(results, bk)
	}
	return results, rows.Err()
}

// GetAgedBlobKeys returns blob keys that were requested approximately `hoursAgo` hours ago.
// windowHours defines the +/- window around the target age.
func (d *DB) GetAgedBlobKeys(ctx context.Context, hoursAgo float64, windowHours float64, limit int) ([]AgedBlobKey, error) {
	// requested_at is nanosecond unix timestamp
	nowNano := time.Now().UnixNano()
	targetNano := nowNano - int64(hoursAgo*float64(time.Hour))
	windowNano := int64(windowHours * float64(time.Hour))

	rows, err := d.conn.QueryContext(ctx, `
		SELECT blob_key, requested_at FROM observed_blobs
		WHERE requested_at BETWEEN $1 AND $2
		ORDER BY RANDOM()
		LIMIT $3`,
		targetNano-windowNano, targetNano+windowNano, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []AgedBlobKey
	for rows.Next() {
		var bk AgedBlobKey
		if err := rows.Scan(&bk.BlobKey, &bk.RequestedAt); err != nil {
			return nil, err
		}
		results = append(results, bk)
	}
	return results, rows.Err()
}

func (d *DB) InsertOperatorProbe(ctx context.Context, p *OperatorProbeResult) error {
	_, err := d.conn.ExecContext(ctx, `
		INSERT INTO operator_probes (blob_key, blob_age_hours, operator_id, operator_socket,
			quorum_id, success, latency_ms, chunks_returned, error_message)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		p.BlobKey, p.BlobAgeHours, p.OperatorID, p.OperatorSocket,
		p.QuorumID, p.Success, p.LatencyMs, p.ChunksReturned, p.ErrorMessage,
	)
	return err
}

func (d *DB) Close() error {
	return d.conn.Close()
}
