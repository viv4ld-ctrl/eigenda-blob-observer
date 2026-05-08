# EigenDA Mainnet Blob Observer

EigenDA 메인넷에 올라오는 **모든 blob을 실시간 수집**하고, **relay retrieve + operator 전수 chunk 검증**을 수행하여 대시보드로 시각화하는 독립 감시 도구.

## 뭘 검증하나?

| 검증 레벨 | 방식 | 의미 |
|-----------|------|------|
| **Relay Retrieve** | `relay.GetBlob(blob_key)` via gRPC | 중앙화된 CDN이 blob을 서빙할 수 있는지 (거의 전수 검증) |
| **Operator Chunk** | `validator.Retrieval.GetChunks(blob_key)` via gRPC | 86개 operator 전수 scan → 총 chunk >= 1024이면 RECOVERABLE |
| **Attestation** | DataAPI attestation-info | 쿼럼별 서명 참여율 |
| **Dead Operators** | 연속 실패 탐지 | 온체인 등록됐지만 chunk 서빙 못 하는 operator 식별 |

> **Relay 성공 + Operator 실패** = relay가 데이터를 캐싱하고 있을 뿐, 실제 DA 레이어에 문제가 있다는 의미.

## 아키텍처

4개의 독립 goroutine이 동시에 실행:

```
[Collector]          DataAPI 실시간 폴링 → 새 blob 즉시 DB 저장
                     (초당 ~1 blob, 3초 간격 폴링)

[Relay Verifier]     DB에서 미검증 blob 20개씩 → relay gRPC GetBlob
                     (병렬 10개, 수집 속도보다 빨라서 거의 전수 검증)

[Operator Verifier]  DB에서 미검증 blob 1개씩 → 86개 operator 전수 scan
                     (순차, 살아있는 operator 먼저 → 죽은 operator 마지막)
                     chunk 합산 >= 1024 → RECOVERABLE / AT_RISK 판정

[Reverifier]         5분마다 과거 blob 나이별 재검증 (1d/7d/13d/14d/15d)

[Next.js Dashboard]  DB에서 읽어 시각화
    ├── StatusCards (relay/operator 성공률, latency, coverage)
    ├── Blob Recoverability (RECOVERABLE/AT_RISK per blob)
    ├── Unresponsive Operators (dead operator 목록)
    ├── Avg Chunks per Operator (stake 비례 chunk 분포)
    ├── SurvivalCurve (나이별 retrieve 성공률)
    ├── LatencyChart (p50/p95/p99)
    ├── RelaySuccessRate / AttestationChart
    └── ProbeLog (실시간 relay 로그)
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
[collector]  +100 new blobs
[collector]  +7 new blobs
[relay]      OK blob=6f3b597d4747 latency=646ms
[relay]      OK blob=ab8038990bf1 latency=597ms
[recovery]   blob=ac52061d7b84 operators=74/86 chunks=6574/1024 RECOVERABLE
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
| `DATABASE_URL` | `postgres://observer:...@localhost:5432/eigenda_observer` | PostgreSQL |
| `ETH_RPC_URL` | (필수) | Ethereum Mainnet RPC |
| `EIGENDA_DIRECTORY` | `0x64AB2e9A86FA2E183CB6f01B2D4050c1c2dFAad4` | EigenDA Directory 컨트랙트 |
| `OPERATOR_PROBE_ENABLED` | `true` | Operator 검증 활성화 |

## Blob Recoverability 판정

```
86개 operator 전수 scan (살아있는 operator부터 순차 probe)
  → 각 operator가 반환한 chunk 수 합산
  → 합산 >= 1024 (erasure coding 복구 임계값) → RECOVERABLE
  → 합산 < 1024 → AT_RISK
```

EigenDA는 8192개 chunk를 86개 operator에 stake 비례로 분배.
복구에는 1024개만 있으면 충분 (Reed-Solomon erasure coding).

## 컨트랙트 해석

```
EigenDADirectory (0x64AB...)
  ├── getAddress("RELAY_REGISTRY")    → relayKeyToUrl(key)
  ├── getAddress("INDEX_REGISTRY")    → quorum별 operator 목록
  └── getAddress("SOCKET_REGISTRY")   → operator IP:port (v2 retrieval port)
```

하드코딩 없이 Directory에서 동적 해석. 3개 quorum (0, 1, 2) 전체를 조회하고 중복 제거.

## 발견한 것들

메인넷 관찰 결과 (2026-05-08 기준):

- **Blob 처리량**: 초당 ~1개 (단일 제출자 `0x41fa832f...`)
- **Operator**: 86개 (quorum 0: 58, quorum 1: 63, quorum 2: 6, 중복 제거 후 86)
- **Dead operator**: ~9개 (10%) — 온체인 등록됐지만 v2 retrieval 포트 응답 없음
- **Relay**: relay=0 단일 할당 (SPOF 우려)
- **Chunk 분포**: operator당 1개 ~ 929개 (stake 비례)

## 한계

- **DataAPI 의존**: blob 목록을 EigenDA 팀 운영 API에서 가져옴 (v2에서 onchain 기록 없음)
- **Alchemy 무료 tier**: operator discovery 시 rate limit 가능 (캐시로 완화)
- **단일 지역 관측**: 한국에서 probe — 다른 지역에서는 결과가 다를 수 있음

## 나이별 재검증 (Survival Curve)

| 나이 | 샘플 | 목적 |
|------|------|------|
| ~24h | 5개 | 1일 경과 후 가용성 |
| ~7d | 5개 | 1주 경과 |
| ~13d | 5개 | 만료 직전 |
| ~14d | 3개 | 공식 보존 기간 경계 |
| ~15d | 3개 | 만료 후 |

2주 이상 데이터 축적 시 데이터 생존 곡선이 그려짐.

## DB 스키마

- `observed_blobs` — blob 메타데이터 (key, account, size, expiry)
- `retrieval_probes` — relay retrieve 결과 (성공/실패, latency)
- `operator_probes` — operator chunk 검증 (성공/실패, chunks 수, latency)
- `attestation_snapshots` — 쿼럼 서명 참여율

## 기술 스택

- **Prober**: Go (4 goroutine, gRPC, go-ethereum)
- **Dashboard**: Next.js 16 + Recharts + Tailwind CSS
- **DB**: PostgreSQL 16
- **Infra**: Docker Compose
