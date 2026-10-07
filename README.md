# ProX

Temporary downside protection for tokenized stocks held on Backpack. You hold NVDA on Backpack, pick a protection level and a window, and ProX opens a matching short on the Backpack equity perpetual, watches margin and basis, and closes it reduce-only once the cash market has reopened and prices have converged. A Chainlink CRE workflow acts as the convergence oracle; the hashes of what happened are written to Solana mainnet as Memo transactions.

The product spec is in `docs/prd.md`.

## Layout

| Folder | What it is |
|---|---|
| `packages/core` | Pure logic shared by the backend and the oracle: US equity session engine, basis maths, report codec |
| `backend` | Fastify API, Backpack adapter (REST + WebSocket), protection state machine, risk engine, workers, CRE report ingest, Solana anchoring |
| `cre` | Chainlink CRE project with the `convergence-oracle` workflow |
| `frontend` | Next.js app: home, protect (one-off and scheduled), activity, protection screen, report, details |

## Getting started

Prerequisites: Node 22+, pnpm 11, Bun 1.2+, the CRE CLI (`cre`), a Postgres database, a Backpack account that holds a tokenized stock, and a Solana wallet.

1. Install dependencies.

   ```bash
   pnpm install
   cd cre/convergence-oracle && bun install && cd ../..
   ```

2. Configure the backend. Copy `backend/.env.example` to `backend/.env` and fill it in. Every trading limit is required on purpose; the PRD values are `MAX_TOTAL_NOTIONAL_USD=50`, `MAX_POSITION_NOTIONAL_USD=25`, `MAX_APPLICATION_LEVERAGE=2`, `MMR_WARNING=0.50`, `MMR_RISK=0.65`, `MMR_REDUCE=0.80`, `MMR_EMERGENCY=0.90`, `CONVERGENCE_BPS=50`, `CONVERGENCE_COUNT=3`.
   - `BACKPACK_API_KEY` and `BACKPACK_PRIVATE_KEY`: an ED25519 key pair from Backpack, Settings, API Keys (base64). The backend checks they belong together at boot.
   - `OPERATOR_WALLETS`: the Solana addresses allowed to sign in.
   - `SOLANA_PRIVATE_KEY`: pays for Memo anchors. Leave empty to turn anchoring off.
   - `CRE_INGEST_TOKEN`: any random string; put the same value in `cre/.env` as `CRE_SECRET_PROX_INGEST_TOKEN`.

3. Configure the oracle. Copy `cre/.env.example` to `cre/.env`, run `cre login`, and check `cre/convergence-oracle/config.staging.json` points at the backend (`http://127.0.0.1:4000` locally).

4. Create the schema and start the backend. The schema is applied again at every boot; it is idempotent.

   ```bash
   pnpm --filter @prox/backend migrate
   pnpm dev:backend
   ```

5. Start the frontend and open http://localhost:3000.

   ```bash
   pnpm dev:frontend
   ```

## Tests

```bash
pnpm test          # unit tests for core and backend (no network)
pnpm test:live     # read-only checks against the real Backpack API
```

The live suite needs no key for the public endpoints. Signed endpoints and the single live order test run only when `backend/.env` holds a key and you opt in; see `backend/test/live`.

## How the oracle runs

Until Chainlink grants deploy access (`cre account access`), the backend runs the workflow itself through `cre workflow simulate` every `CRE_SIM_INTERVAL_SEC` seconds while a protection is live (`CRE_REPORT_MODE=simulation`). Those reports carry the simulator's test signatures, are accepted only from this machine with the shared token, and are labelled as such. With deploy access, deploy to the private registry, host the backend on a public URL, set `CRE_REPORT_MODE=don`, `CRE_WORKFLOW_ID` and `ETH_MAINNET_RPC_URL`, and the backend verifies f+1 DON signatures against the Capability Registry before trusting a report.

## Safety rails

- The executor can only sell to open and buy reduce-only to close. Opening orders are IOC limits priced within `MAX_SLIPPAGE_BPS` of the touch.
- `TRADING_ENABLED=false` turns every order route off while leaving the dashboard readable.
- One live protection per stock, caps on position and total notional, an allowlist of stock symbols.
- Every order is written to the database before it is sent, with a deterministic `clientId`; unknown outcomes are reconciled, never resent blindly.
- Risk actions run on Backpack's maintenance margin rate from the backend's own data, never from the oracle.
