# ProX convergence oracle

A Chainlink CRE workflow. On each tick it reads, for every stock that has a live protection, the Backpack perp mark price and the cash-market indicative quote, works out the basis and the US session, signs the observations as a CRE report and POSTs it to the ProX backend. The backend counts consecutive observations inside the basis threshold and closes the hedge when enough line up.

Everything the workflow reads is public. The Backpack API key never comes near it.

## What one run does

1. `GET {backendUrl}/api/cre/watchlist` for the stock and perp pairs to observe. No pairs, no report.
2. For each pair, from Backpack: the perp mark and index price, and the stock indicative quote for a seller and a buyer of one share.
3. Nodes agree by median on the prices and must agree exactly on the session.
4. The reference price is the middle of the stock bid and ask when the quoter is quoting. Otherwise it falls back to the perp index and the observation is marked `PERP_INDEX`; the backend does not count those outside demo mode.
5. Basis is `|perp mark - reference| / reference`, in hundredths of a basis point, with integer maths from `packages/core`.
6. The report is ABI-encoded (`packages/core/src/report-codec.ts`), signed, and sent to `POST {backendUrl}/api/cre/reports` with the ingest token.

## Getting started

```bash
bun install
```

Copy `../.env.example` to `../.env` and set `CRE_SECRET_PROX_INGEST_TOKEN` to the same value as `CRE_INGEST_TOKEN` in `backend/.env`. Run `cre login` once. On a server without a browser, create an API key at app.chain.link (Account Settings) and set `CRE_API_KEY` in the environment instead.

Simulate one run from the `cre` folder, with the backend running:

```bash
cre workflow simulate convergence-oracle --non-interactive --trigger-index 0 --target staging-settings
```

In `simulation` mode the backend runs this same command itself every `CRE_SIM_INTERVAL_SEC` seconds while a protection is live, so you rarely need to.

## Files

| File | Purpose |
|---|---|
| `main.ts` | The workflow |
| `main.test.ts` | Tests, run with `bun test` |
| `config.staging.json`, `config.production.json` | Cron schedule, backend URL, Backpack API URL |
| `workflow.yaml` | CRE targets and the paths above |
| `../project.yaml` | Project settings. The workflow makes no chain calls; the RPC entry is there because the simulator insists on one |
| `../secrets.yaml` | Maps the secret name to its environment variable. Names only |

`backendUrl` in the config must be the address the backend is listening on. If the backend moves off port 4000, change it here.

## Limits

- Until Chainlink grants deploy access, reports come from the local simulator with test signatures. The backend accepts them only from this machine with the shared token and labels them `SIMULATION`.
- The CRE runtime compiles to WASM: no floats, no `Intl`, and exported helpers must be `const` functions.
