# CRE evidence: the ProX convergence oracle

ProX protects tokenized US stocks held on Backpack by shorting the matching Backpack perpetual. The Chainlink CRE workflow [`convergence-oracle`](../convergence-oracle/main.ts) decides when the cash market and the perp agree again, so the backend can close the hedge.

**How it runs today.** Through the CRE CLI simulator, `cre workflow simulate`, CLI v1.37.0. It is not deployed to the CRE network yet: our CRE organization shows `Deploy Access: Not enabled`, and access has been requested with `cre account access`.

**Confidential Workflows.** Not used. The workflow reads only Backpack's public API. Its one secret, the token the backend expects with each report, is read with `runtime.getSecret`.

## What the workflow does on each cron tick (every 30 s)

1. Asks the ProX backend which stocks have a live protection (`GET /api/cre/watchlist`). Nodes must agree on the list exactly.
2. For each stock, reads from Backpack the perp mark and index price (`/api/v1/markPrices`) and both sides of the cash-market indicative quote (`/api/v1/stockIndicativeQuote`), plus the session calendar when the quote names no session. Prices are median-aggregated across nodes; the session must be identical.
3. Works out the basis between the perp mark and the cash reference: the mid of the quote, or the perp index when there is no quote.
4. ABI-encodes the observations and has them signed as a CRE report (`runtime.report`, ECDSA over keccak256).
5. Sends the signed report to the backend (`sendReport`). The backend checks it and stores it once. While a hedge is waiting to close, it also compares the report's prices with its own live Backpack feed and counts the report toward the close.

The backend closes a hedge with a reduce-only buy after 3 counted reports in a row with a basis of 50 bps or less. A report does not count if it is older than 2 minutes, arrives inside the cooldown after the reopen, comes less than 20 s after the last counted one, or has prices more than 25 bps away from the backend's own Backpack feed. Without the demo reopen it also needs the cash market in its regular session with a live quote. Once the backend runs in DON mode, simulator reports never count. The open, the convergence evidence and the receipt are hashed into Solana mainnet Memo transactions.

## 1. Fresh CLI runs: 2026-10-07, 14:45 to 14:47 UTC

A live two-stock protection was running: NVDA and SPCX, 0.01 each, shorted together at 2x at 14:45 and bought back at 14:47, the end of a two-minute window. During it, the workflow ran with `cre workflow simulate` on each 30-second slot. Each run while the hedges were open read the live watchlist from the production backend and live prices from Backpack, signed a report and delivered it, and the backend logged every one as accepted.

The production server has no CRE CLI or CRE API key yet, so these runs were made from a developer machine and reached the backend through an SSH tunnel to its local port: the same address the backend's own simulator runner uses (`config.staging.json`).

| Transcript | Started (UTC) | NVDA basis | SPCX basis | Session | Accepted by the backend (UTC) |
|---|---|---|---|---|---|
| [run 1](runs/2026-10-07T144531Z-run-1.txt) | 14:45:31 | 11.35 bps | 2.08 bps | REGULAR | 14:45:39, `0xd86f4f5c…` |
| [run 2](runs/2026-10-07T144601Z-run-2.txt) | 14:46:01 | 11.35 bps | 0.00 bps | REGULAR | 14:46:08, `0x790c9622…` |
| [run with engine logs](runs/2026-10-07T144629Z-engine-logs.txt) | 14:46:29 | 10.72 bps | 1.48 bps | REGULAR | 14:46:35, `0x44bba8f6…` |
| [run 3](runs/2026-10-07T144631Z-run-3.txt) | 14:46:31 | 10.09 bps | 1.48 bps | REGULAR | 14:46:36, `0x72f0ded6…` |
| [run 4](runs/2026-10-07T144701Z-run-4.txt) | 14:47:01 | | | | No report: the hedges had just closed, so the workflow found no live protection |

Each transcript shows the workflow compiling, the cron trigger firing, the workflow's own log lines (stocks observed, prices, basis, session, "Report delivered to the ProX backend"), the simulation result with the signed report and the four signatures from the simulator's nodes, and exit code 0. The engine-logs run also shows every capability call: the HTTP reads from the backend and Backpack, the consensus steps, the report, and the backend answering the report with HTTP 201. The ingest token in that run's request headers is replaced with `[redacted]`.

The CLI prints its own log times in local time (GMT+8) with a `Z` suffix, so `22:45:37Z` in a transcript is 14:45:37 UTC. The `date -u` line at the top of each transcript is UTC.

The backend's side of these minutes, with the full report hashes, is in [`backend-log-2026-10-07.txt`](backend-log-2026-10-07.txt). Solana mainnet anchors of the two hedges: NVDA opened [`5icuhL7m…DmCLbq`](https://explorer.solana.com/tx/5icuhL7myVWC2VbBuzRphNyRMG7CskwdgDwHxeE3zNjAdkjUQSq18n2shQPhELCvx8KjMQ6qE2VJsvtD33DmCLbq), SPCX opened [`45fS7ria…wAqTkN`](https://explorer.solana.com/tx/45fS7rianaohFB3sSTNKCJWejLsWgZrrBCzfZbQC6WafCBmWVfoEnVwhQBBX9kBU8q5CFmPCRMyR5PzjvEwAqTkN), NVDA receipt [`33wkawcF…DWPxHs`](https://explorer.solana.com/tx/33wkawcFPCX5o8fBLKkziBLMsfHwta8Biy3qVn4czbTnvZ7MwvtGezJdCGvunqgL91envcV8WX11CqKDqLDWPxHs), SPCX receipt [`4BM3H4vA…8XEuhb`](https://explorer.solana.com/tx/4BM3H4vAFd1HDpFgMhEjuRuoe3SBgqekTgyDsZK3MLei7Eb3iqUAqEta4gsW3qtKUuja6QVcGRQeRfe4yr8XEuhb).

## 2. Earlier runs, as stored by the production backend

Before the fresh runs, between 2026-10-06 22:48 and 2026-10-07 12:24 UTC, the backend accepted **38 reports** produced by `cre workflow simulate`. Each carries the simulator's placeholder workflow ID (`0x1111…1111`) and owner (`0xaaaa…aaaa`) and four signatures from the simulator's local nodes, so the backend stores them with mode `SIMULATION`, not as DON-verified reports.

Two NVDA hedges were closed by these reports. Both used the demo reopen, which starts the wait for convergence without waiting for the real market open. The prices in the reports are live.

"Report observed" is the cron slot the simulator stamps on the run (the next :00 or :30 mark). "Received" is when the backend got the report.

### Protection `94ffcb8c`, 2026-10-07 (UTC)

| Time | Event |
|---|---|
| 06:50:31 | Short 0.01 NVDA.US_USDC_PERP filled at 240.05 |
| 06:50:39 | Demo reopen: waiting for convergence, 30 s cooldown |
| 06:50:58 | Report observed 06:51:00, basis 10.01 bps: not counted, inside the cooldown |
| 06:51:25 | Report observed 06:51:30, basis 8.75 bps: count 1 |
| 06:51:55 | Report observed 06:52:00, basis 7.29 bps: count 2 |
| 06:52:26 | Report observed 06:52:30, basis 8.96 bps: count 3, closing |
| 06:52:27 | Bought back 0.01 at 239.99. Realized +$0.0006 before $0.0024 in fees |

Reports: `0x6c5eb8e2…a618c`, `0x645310f4…d6859`, `0xf7f3a08c…fe668`, `0xcb6f7af5…22b51`.

Solana mainnet anchors:

- Opened: [`5kVjErXj…a41YFu`](https://explorer.solana.com/tx/5kVjErXj7SrRg3vcv538yQrZRFrZoNASAXXK3rAK1jKXghqXkuZ2UdoMAWdhsLXqGVHUj4S53MwKBUobKXa41YFu)
- Converged: [`2NwWEV9o…LupJSeE4`](https://explorer.solana.com/tx/2NwWEV9oEufdH94AJxjjFnraN3km6cxMEpvVsucjdYQyyub8uxKru1qac7EjdAoKrnGvykpB9QzWzS6RLupJSeE4). Its memo is a hash of the three counted reports (their IDs, basis and times) and the threshold.
- Receipt: [`3iEBVzvq…2ct79H`](https://explorer.solana.com/tx/3iEBVzvq4g459cfzJMXop1TEwpF4Eq81qsZgMsdD41RXKwZcedBRUQHMuf1d3T7XPPCeatioanemkQkXFb2ct79H)

One of those reports as stored (`0xcb6f7af5…22b51`, prices in units of 1e-8 USD):

```json
{
  "observedAtMs": "1791355950000",
  "observations": [{
    "stockSymbol": "NVDA.US", "perpSymbol": "NVDA.US_USDC_PERP", "session": "OVERNIGHT",
    "perpMarkE8": "23999000000", "perpIndexE8": "23976500000",
    "stockBidE8": "23969000000", "stockAskE8": "23986000000",
    "referenceE8": "23977500000", "referenceSource": "INDICATIVE_QUOTE",
    "basisCentiBps": 896, "quoteTimestampMs": "1791355945267"
  }]
}
```

### Protection `3cc4226d`, 2026-10-07 (UTC)

| Time | Event |
|---|---|
| 00:05:43 | Short 0.01 NVDA.US_USDC_PERP filled at 240.16 |
| 00:06:00 | Demo reopen: waiting for convergence, 30 s cooldown |
| 00:06:11 | Report observed 00:06:30, basis 7.08 bps: not counted, inside the cooldown |
| 00:06:41 | Report observed 00:07:00, basis 8.33 bps: count 1 |
| 00:07:10 | Report observed 00:07:30, basis 6.03 bps: count 2 |
| 00:07:39 | Report observed 00:08:00, basis 2.28 bps: count 3, closing |
| 00:07:40 | Bought back 0.01 at 240.28. Realized −$0.0012 before $0.0024 in fees |

Receipt anchor: [`2D2kWQz1…NhDGkv`](https://explorer.solana.com/tx/2D2kWQz1FceT9kWEYzjMg48TYKj3PVkZTvv9drdAZWJyyBVU9utqZ1Ek14Vx5Au1jP5rK9x91Z1h49Ju45NhDGkv)

### The oracle refusing to count

Protection `ae13ed45` (custom hours, no demo reopen) received 11 reports between 07:56 and 08:02 UTC. Eight came before counting could start. The last three were refused as `MARKET_CLOSED`: the real session had moved from overnight to pre-market, and without the demo reopen a close needs the regular session. The hedge closed at its window end instead.

## 3. Execution log

[`backend-log-2026-10-07.txt`](backend-log-2026-10-07.txt) has two parts:

- 14:45 to 14:47 UTC, the production backend during the fresh runs above: the group opening at 2x, the four reports accepted with both stocks in each, and the Solana anchors.
- 12:22 to 12:25 UTC, the backend on the developer machine running the simulator itself every 30 s for protection `18c2f8e1`. The workflow delivered each report over HTTP itself ("CRE report accepted"), and the runner then confirmed the run ("CRE simulation run", `ok: true`).

## Reproduce

```bash
cd cre/convergence-oracle && bun install && cd ..
cp .env.example .env   # then set CRE_SECRET_PROX_INGEST_TOKEN to the backend's CRE_INGEST_TOKEN
cre login
cre workflow simulate convergence-oracle --non-interactive --trigger-index 0 --target staging-settings
```

The staging target points the workflow at a ProX backend on `127.0.0.1:4000` (`config.staging.json`). With no protection live, the run ends with `"skipped": "no live protection to observe"`.
