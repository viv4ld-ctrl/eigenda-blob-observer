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
