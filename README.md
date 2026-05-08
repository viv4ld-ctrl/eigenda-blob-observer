# EigenDA Mainnet Blob Observer

EigenDA 메인넷에 올라오는 **모든 blob을 실시간 수집**하고, **relay retrieve + operator 직접 chunk 검증**을 수행하여 대시보드로 시각화하는 독립 감시 도구.

## 뭘 검증하나?

| 검증 레벨 | 방식 | 의미 |
|-----------|------|------|
| **Relay Retrieve** | `relay.GetBlob(blob_key)` via gRPC | 중앙화된 CDN이 blob을 서빙할 수 있는지 |
| **Operator Chunk** | `validator.Retrieval.GetChunks(blob_key)` via gRPC | 개별 검증자가 실제로 erasure-coded chunk를 보유하고 있는지 |
| **Attestation** | DataAPI attestation-info | 쿼럼별 서명 참여율 |

> **Relay 성공 + Operator 실패** = relay가 데이터를 캐싱하고 있을 뿐, 실제 DA 레이어에 문제가 있다는 의미. 이것이 이 도구의 핵심 차별점.

## 아키텍처

```
[Go Prober]
    │
    ├── Phase 1: 수집 ─── DataAPI cursor 페이지네이션으로 전수 수집
    │     └── 매 사이클 ~300개 blob 메타데이터 → DB 저장 (1-2초)
    │
    ├── Phase 2: 검증 ─── DB에서 미검증 blob 20개씩 꺼내서 처리
    │     ├── Relay (gRPC GetBlob) ──── 전체 blob retrieve
    │     ├── Operator (gRPC GetChunks) ──── 직접 chunk 보유 검증
    │     │     └── 58개 operator 중 랜덤 3개 샘플링/blob
    │     └── Attestation ──── 쿼럼 서명 참여율
    │
    ├── Phase 3: 재검증 ─── 과거 blob 나이별 re-probe
    │
    ├── L1 Contract ──── EigenDADirectory → RelayRegistry, SocketRegistry
    │
    └── PostgreSQL ──── 결과 저장

[Next.js Dashboard] ──── DB에서 읽어 시각화
    ├── StatusCards (성공률, latency, 상태)
    ├── SurvivalCurve (나이별 retrieve 성공률)
    ├── LatencyChart (p50/p95/p99)
    ├── RelaySuccessRate (relay별 비교)
    ├── OperatorProbeChart (operator별 chunk 검증)
    ├── AttestationChart (쿼럼 서명 참여율)
    └── ProbeLog (실시간 로그)
```

## 빠른 시작

### 1. 사전 요구사항

- Go 1.22+
- Node.js 20+
- Docker (PostgreSQL용)
- Alchemy API key (Ethereum Mainnet, 무료 tier OK)

### 2. 환경 설정

```bash
cp .env.example .env
# .env 파일에서 ETH_RPC_URL에 Alchemy key 입력
# ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
```

### 3. PostgreSQL 시작

```bash
docker compose up postgres -d
```

### 4. Prober 실행

```bash
cd prober
go run .
```

정상 동작 시 로그:
```
[prober]   collected 1000 blobs from DataAPI          ← 전수 수집
[prober]   probing 20 unprobed blobs (relay + operator)
[relay]    OK blob=acf883fe... relay=0 latency=2103ms  ← relay 검증
[operator] OK op=29ef6b67... chunks=909 latency=2877ms ← operator chunk 검증
[operator] OK op=3278d7a1... chunks=1 latency=479ms
```

### 5. Dashboard 실행

```bash
cd dashboard
npm install
npm run dev
# http://localhost:3000
```

## 설정 옵션

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `DATABASE_URL` | `postgres://observer:observer_pass@localhost:5432/eigenda_observer` | PostgreSQL 연결 |
| `ETH_RPC_URL` | (필수) | Ethereum Mainnet RPC (Alchemy 등) |
| `EIGENDA_DIRECTORY` | `0x64AB2e9A86FA2E183CB6f01B2D4050c1c2dFAad4` | EigenDA Directory 컨트랙트 |
| `PROBE_INTERVAL` | `5m` | 프로브 사이클 간격 |
| `OPERATOR_PROBE_ENABLED` | `true` | Operator chunk 검증 활성화 |
| `OPERATOR_SAMPLE_SIZE` | `3` | blob당 샘플링할 operator 수 |

## 컨트랙트 해석 흐름

```
EigenDADirectory (0x64AB...)
  ├── getAddress("RELAY_REGISTRY")    → RelayRegistry   → relayKeyToUrl(key)
  ├── getAddress("INDEX_REGISTRY")    → IndexRegistry    → operator 목록
  └── getAddress("SOCKET_REGISTRY")   → SocketRegistry   → operator IP:port
```

하드코딩 없이 Directory에서 동적으로 해석. EigenDA가 컨트랙트를 업그레이드해도 코드 수정 불필요.

## 수집/검증 분리 구조

```
수집: 매 5분마다 cursor 페이지네이션으로 새 blob 전수 수집 → DB
      (페이지당 100개, 최대 1000개/사이클)

검증: DB에서 "아직 probe 안 한 blob" 20개씩 꺼내서 검증
      → 다음 사이클에 또 20개 → 천천히 전부 소화

= 메인넷 모든 blob 메타데이터 보존 + 검증은 부하 없이 점진적 처리
```

## 나이별 재검증 (Survival Curve)

매 사이클마다 과거 blob도 다시 retrieve 시도:

| 나이 | 샘플 수 | 목적 |
|------|---------|------|
| ~24h | 5개 | 1일 경과 후 가용성 |
| ~7d | 5개 | 1주 경과 |
| ~13d | 5개 | 만료 직전 |
| ~14d | 3개 | 공식 보존 기간 경계 |
| ~15d | 3개 | 만료 후 |

2주 이상 데이터가 쌓이면 **데이터 생존 곡선**이 그려짐.

## DB 스키마

- `observed_blobs` — blob 메타데이터 (key, account, size, expiry 등)
- `retrieval_probes` — relay retrieve 결과 (성공/실패, latency, data size)
- `operator_probes` — operator chunk 검증 결과 (성공/실패, chunks 수, latency)
- `attestation_snapshots` — 쿼럼 서명 참여율

## 기술 스택

- **Prober**: Go (goroutine 병렬 처리, gRPC, go-ethereum)
- **Dashboard**: Next.js 16 + Recharts + Tailwind CSS
- **DB**: PostgreSQL 16
- **인프라**: Docker Compose
