Yes — then the PRD should be written as a **single end-to-end build specification**, not a staged roadmap. The implementation target is: **one repo, one integrated backend/frontend, one real Backpack account, one live NVDA protection flow, and all core automation working before demo.**

# PRD v2.1 — Automated Protection Layer for Tokenized Equities

**Status:** Build-ready  
**Build style:** Single integrated implementation  
**Primary venue:** Backpack Exchange  
**Tokenized equities:** Backpack Securities  
**Derivative venue:** Backpack Equity Perpetuals  
**Network context:** Solana-backed tokenized securities  
**Primary live demo asset:** NVDA  
**Future venue:** Ondo Perps on Solana

Official references:

- Backpack API: https://docs.backpack.exchange/
- Margin: https://support.backpack.exchange/technical-docs/trading/margin
- Futures: https://support.backpack.exchange/technical-docs/trading/futures-specs
- Equity Futures: https://support.backpack.exchange/technical-docs/trading/equity-futures-specs
- Settlement: https://support.backpack.exchange/technical-docs/trading/settlement-and-realization
- Liquidation: https://support.backpack.exchange/technical-docs/trading/liquidation
- Margin System: https://support.backpack.exchange/exchange/trading/margin-system
- Subaccounts: https://support.backpack.exchange/exchange/exchange-account/account-functions/sub-accounts

---

# 1. Product

The application lets a user temporarily hedge tokenized stock exposure without selling the stock upfront.

Example:

```text
User owns:

+0.01 NVDA

Protection:
100%

System creates:

-0.01 NVDA.US_USDC_PERP

Result:

Net NVDA directional exposure ≈ 0
```

The application automatically handles:

```text
portfolio detection
collateral valuation
hedge sizing
margin validation
leverage selection
order execution
position monitoring
PnL tracking
risk monitoring
market-state detection
convergence detection
automatic closing
```

The user only chooses:

```text
Stock
Protection %
Duration
```

---

# 2. Core User Experience

The application should feel like a portfolio protection product, not a derivatives terminal.

Primary interaction:

```text
NVDA
$240.35

Protection
[────────────●────] 100%

Duration
Weekend

Protected Exposure
$240.35

Remaining Market Exposure
~$0

[ ACTIVATE PROTECTION ]
```

The user should not manually choose:

```text
perp quantity
leverage
margin
USDC borrowing
reduce-only
funding configuration
```

---

# 3. Main Demo Flow

The entire application must support this flow end-to-end.

```text
Login / open app
      ↓
Backend reads Backpack account
      ↓
Detect NVDA stock balance
      ↓
Detect matching NVDA perp
      ↓
Calculate portfolio exposure
      ↓
User selects 100% protection
      ↓
Risk engine calculates hedge
      ↓
Risk engine checks Backpack account
      ↓
Leverage selected automatically
      ↓
Protection preview shown
      ↓
User activates
      ↓
Backend opens NVDA short
      ↓
Confirm actual fill
      ↓
Protection dashboard goes ACTIVE
      ↓
Monitor stock + hedge + margin
      ↓
Traditional market reopens
      ↓
Convergence conditions satisfied
      ↓
Backend sends reduce-only close
      ↓
Confirm hedge closed
      ↓
Generate final protection receipt
```

---

# 4. Backpack Account Model

The application must read:

```text
portfolio balances
stock quantities
stock collateral values
Net Equity
Available Equity
Initial Margin
Maintenance Margin
Borrow Liability
Account Leverage
positions
open orders
funding
```

Relevant API endpoints:

```text
GET /api/v1/account
GET /api/v1/capital
GET /api/v1/capital/collateral
GET /api/v1/position
GET /api/v1/orders
GET /api/v1/markets
GET /api/v1/market
GET /api/v1/account/limits/order
GET /api/v1/borrowLend/positions
```

Order execution:

```text
POST /api/v1/order
DELETE /api/v1/order
```

---

# 5. Authentication

Private Backpack API calls require Ed25519 request signing.

Required headers:

```text
X-API-Key
X-Signature
X-Timestamp
X-Window
```

Architecture:

```text
Frontend
   ↓
Our Backend
   ↓
Backpack API
```

The Backpack private key must exist only on the backend.

Never expose it in:

```text
browser
localStorage
frontend environment variables
GitHub
```

---

# 6. Portfolio Value vs Collateral Value

The application must distinguish these clearly.

## Market Value

Actual economic asset value.

Example from the current test:

```text
NVDA               ~$2.40
USD                ~$1.58

Portfolio Value    ~$3.98
```

## Backpack Collateral Value

Backpack applies asset-specific risk weighting.

Formula documented by Backpack:

```text
Collateral Value
=
Quantity
× Mark Price
× Collateral Weight
```

Therefore:

```text
Portfolio Market Value
≠
Margin Equity
```

Our test already showed:

```text
Portfolio Value       ~$3.98
Available Equity      ~$3.02
```

The UI should expose both.

---

# 7. Protection Mathematics

For each stock:

```text
stockValue =
stockQuantity × stockMarkPrice
```

Target hedge:

```text
hedgeNotional =
stockValue × protectionRatio
```

Perp quantity:

```text
targetPerpQuantity =
hedgeNotional / perpMarkPrice
```

Example:

```text
NVDA quantity          0.01

NVDA price             $240

Stock exposure         $2.40

Protection             100%

Perp price             $240

Required short         0.01
```

---

# 8. Protection Percentage

Supported user presets:

```text
25%
50%
75%
100%
```

Formula:

```text
Net Exposure
=
Stock Exposure × (1 - Protection %)
```

Example:

```text
Stock value            $1,000

Protection             75%

Short                  $750

Remaining exposure     $250
```

---

# 9. Existing Position Adjustment

Before opening any hedge, the backend must inspect existing perp positions.

```text
Additional Hedge
=
Desired Hedge
-
Existing Effective Short
```

Example:

```text
Desired short          $1,000

Already short          $300

New short needed       $700
```

Never blindly add another full short.

---

# 10. Market Eligibility

A stock can be protected only when all conditions pass:

```text
stock balance > 0
AND
stock eligible as collateral
AND
matching perp exists
AND
perp order book open
AND
minimum quantity satisfied
AND
Backpack order limit sufficient
AND
margin health sufficient
```

The list must be generated dynamically.

Do not hardcode NVDA as the only possible asset.

---

# 11. Initial Supported Asset

NVDA will be the primary demo asset because:

```text
we already hold it
we manually tested collateral behavior
NVDA-PERP exists
0.01 minimum quantity is suitable
audience understands NVIDIA
```

The implementation itself must remain generic.

---

# 12. Account Leverage

Backpack has:

```text
market maximum leverage
AND
account leverage limit
```

The actual usable leverage is constrained by both.

The application must read:

```text
GET /api/v1/account
```

and specifically:

```text
leverageLimit
```

The backend may update it using:

```text
PATCH /api/v1/account
```

---

# 13. User Does Not Select Leverage

The user selects:

```text
Protection %
```

The application chooses leverage automatically.

The goal is:

> Use the lowest leverage necessary to make the hedge possible while maintaining a safe margin buffer.

Example:

```text
Stock market value         $1,000

Collateral value           $620

Target hedge               $1,000
```

At 1×:

```text
margin required           ~$1,000
not possible
```

At 2×:

```text
margin required           ~$500
possible
```

The engine chooses:

```text
2×
```

if the post-trade margin state is safe.

---

# 14. Leverage Selection Logic

The backend should evaluate:

```text
1x
2x
3x
5x
```

up to a configured application maximum.

For the hackathon:

```text
MAX_APPLICATION_LEVERAGE = 2
```

or at most 3× if necessary.

Do not automatically use the venue's maximum 10×.

Algorithm:

```text
target hedge quantity
      ↓
check account limits
      ↓
check at current leverage
      ↓
if insufficient:
test next leverage
      ↓
read maximum allowed order quantity
      ↓
calculate post-trade safety
      ↓
choose lowest valid leverage
```

---

# 15. Backpack Order-Limit Validation

Use:

```text
GET /api/v1/account/limits/order
```

before execution.

The response gives the maximum order quantity currently permitted.

If:

```text
desired = 0.01
max allowed = 0.01
```

protection can proceed.

If:

```text
desired = 0.10
max allowed = 0.07
```

then either:

```text
reduce protection
```

or reject.

UI:

```text
Requested Protection       100%

Safe Protection Available   70%
```

---

# 16. Protection Preview

Before execution the frontend must show:

```text
NVDA

Current Stock Value        $240.35

Protection                 100%

Target Short               $240.35

Short Quantity             0.01 NVDA

Execution Leverage         2×

Net Exposure After Hedge   ~$0

Collateral Value           $XXX

Available Equity           $XXX

Current MMR                XX%

Estimated Risk             SAFE
```

Costs:

```text
Trading Fee
Funding
Borrow Interest
```

Funding and borrow interest must be marked variable.

---

# 17. Order Execution

For MVP, because the position is very small:

```text
Market order
```

is acceptable.

Opening:

```json
{
  "symbol": "NVDA.US_USDC_PERP",
  "side": "Ask",
  "orderType": "Market",
  "quantity": "0.01",
  "reduceOnly": false,
  "clientId": 123456789
}
```

Production may use:

```text
Limit + IOC
```

to bound slippage.

---

# 18. Closing

Close must always use:

```text
reduceOnly = true
```

Example:

```json
{
  "symbol": "NVDA.US_USDC_PERP",
  "side": "Bid",
  "orderType": "Market",
  "quantity": "0.01",
  "reduceOnly": true
}
```

This prevents an accidental long position.

---

# 19. Idempotent Orders

Every logical action gets a deterministic numeric `clientId`.

Store:

```text
logicalOperationId
Backpack clientId
Backpack orderId
```

Example logical identifier:

```text
POLICY123_NVDA_OPEN_1
```

Convert it deterministically to an integer accepted by Backpack.

If the API times out:

```text
DO NOT SEND AGAIN IMMEDIATELY
```

First query:

```text
open orders
position
order history
```

and reconcile.

---

# 20. Partial Fill Handling

Example:

```text
Desired hedge          0.10 NVDA

Filled                 0.06 NVDA
```

Then:

```text
Actual Protection      60%
```

State:

```text
PARTIAL
```

The UI must never claim full protection before the actual fill exists.

---

# 21. Real-Time Monitoring

Use Backpack WebSocket:

```text
wss://ws.backpack.exchange/
```

Subscribe to:

```text
markPrice.<symbol>
bookTicker.<symbol>

account.positionUpdate
account.orderUpdate
account.balanceUpdate
```

Architecture:

```text
Backpack WS
    ↓
Backend state
    ↓
Risk engine
    ↓
Frontend live updates
```

REST reconciliation still runs periodically.

---

# 22. PnL Settlement

Backpack settles futures PnL roughly every 10 seconds.

If the short profits:

```text
perp profit
    ↓
USDC credited
```

If the short loses:

```text
perp loss
    ↓
USDC debited
```

The position remains open.

The application must therefore calculate economic hedge performance independently from raw balance movement.

---

# 23. No Manual USDC Requirement

Backpack's documented settlement priority:

```text
1. available USDC / USDC lends
2. borrow USDC
3. convert non-USDC collateral if required
```

Therefore the application should not require the user to manually borrow USDC before protection.

This is one of the main UX advantages.

---

# 24. Economic Protection Dashboard

The main dashboard should show:

```text
NVDA UNDERLYING

Current Value             $218
Underlying PnL            -$22


NVDA HEDGE

Perp PnL                  +$21.80


COSTS

Funding                   -$0.10
Fees                      -$0.05


──────────────────────────────

NET PROTECTED MOVE        -$0.35
```

The application should focus on:

```text
underlying move
+
hedge move
=
net result
```

---

# 25. Margin Health

Primary health inputs:

```text
netEquity
netEquityAvailable
imf
mmf
marginFraction
borrowLiability
```

Estimated liquidation price is secondary.

Backpack is cross-margined, therefore liquidation depends on the complete account state.

---

# 26. Internal Risk States

Application risk thresholds:

```text
MMR < 50%
SAFE

50–65%
WATCH

65–80%
RISK

80–90%
REDUCE

>90%
EMERGENCY
```

These are internal strategy thresholds.

---

# 27. Risk Actions

### SAFE

Do nothing.

### WATCH

Increase monitoring frequency.

### RISK

Show warning.

### REDUCE

Partially close hedge.

Example:

```text
100% protection
↓
75% protection
```

### EMERGENCY

Reduce-only close remaining hedge.

---

# 28. Important Hedge Risk Detail

Economic delta-neutrality does not mean margin risk disappears.

Example:

```text
Stock rises +20%
Perp loses -20%
```

Economically:

```text
net ≈ flat
```

but Backpack may:

```text
apply stock haircut
realize perp losses in USDC
create borrow liability
```

Therefore risk monitoring remains mandatory.

---

# 29. Market Session Engine

States:

```text
PREMARKET
REGULAR
POSTMARKET
OVERNIGHT
WEEKEND
HOLIDAY
```

Production should use a U.S. market calendar.

For hackathon, support:

```text
real current session
+
demo override
```

---

# 30. Protection Modes

User can choose:

```text
Tonight
Weekend
Custom
```

Future:

```text
Every Close
```

---

# 31. Convergence Engine

The hedge should not close automatically at exactly market open.

Flow:

```text
cash market opens
      ↓
wait cooldown
      ↓
read reference prices
      ↓
calculate normalized basis
      ↓
require repeated convergence
      ↓
close hedge
```

---

# 32. Convergence Formula

```text
basisBps =
abs(perpPrice - referencePrice)
/
referencePrice
× 10,000
```

Demo default:

```text
threshold = 50 bps
```

Require:

```text
3 consecutive checks
```

---

# 33. Demo Convergence

Because the hackathon may occur outside the ideal market-time window, provide:

```text
DEMO REOPEN
```

control.

It should simulate:

```text
market-state transition
```

but not fake actual Backpack trade/PnL data.

Example:

```text
Market reopened

Basis
0.80%

↓
0.52%

↓
0.41%

↓
0.28%

3 successful checks

CONVERGED
```

Then submit the real reduce-only close.

---

# 34. Protection State Machine

```text
DRAFT
 ↓
VALIDATING
 ↓
READY
 ↓
OPENING
 ↓
ACTIVE
 ↓
WAIT_REOPEN
 ↓
WAIT_CONVERGENCE
 ↓
CLOSING
 ↓
CLOSED
```

Exceptional states:

```text
PARTIAL
FAILED
RISK
REDUCING
EMERGENCY
EXPIRED
```

---

# 35. Backend Architecture

```text
Frontend
   │
   ▼
Fastify API
   │
   ├──────── Portfolio Service
   │
   ├──────── Protection Engine
   │
   ├──────── Risk Engine
   │
   ├──────── Market Session Engine
   │
   ├──────── Convergence Engine
   │
   ├──────── Execution Engine
   │
   └──────── Reconciliation Engine
                 │
                 ▼
         Backpack Adapter
           │          │
          REST        WS
           │          │
           └────┬─────┘
                ▼
             Backpack
```

---

# 36. Repo Structure

```text
app/

├── frontend/
│   ├── app/
│   ├── components/
│   ├── hooks/
│   └── lib/
│
└── backend/
    └── src/

        backpack/
          auth.ts
          client.ts
          account.ts
          capital.ts
          collateral.ts
          markets.ts
          positions.ts
          orders.ts
          websocket.ts

        portfolio/
          portfolio.service.ts

        protection/
          protection.service.ts
          protection.math.ts
          protection.preview.ts

        risk/
          risk.service.ts
          leverage-selector.ts
          risk-rules.ts

        execution/
          hedge.executor.ts
          reconciler.ts

        market/
          market-session.service.ts

        convergence/
          convergence.service.ts

        workers/
          monitor.worker.ts
          reconcile.worker.ts

        db/

        api/
```

---

# 37. Database Models

## ProtectionPolicy

```text
id
status

mode

requestedProtectionBps
actualProtectionBps

startAt
maxEndAt

createdAt
updatedAt
```

## HedgeLeg

```text
id
policyId

stockSymbol
perpSymbol

stockQuantity

stockMarkPrice
stockMarketValue

collateralWeight
collateralValue

targetProtectionBps

targetNotional
targetQuantity

actualQuantity

accountLeverage

entryPrice
exitPrice

pnl
funding
fees
borrowCost

openingIMR
openingMMR
currentMMR

openClientId
closeClientId

basisBps
convergenceCount

status

openedAt
closedAt
```

---

# 38. Backend API

```text
GET /api/portfolio
```

Returns:

```text
stock balances
market values
collateral values
account health
```

```text
GET /api/protection/markets
```

Returns eligible stock/perp pairs.

```text
POST /api/protection/preview
```

Calculates:

```text
target hedge
safe hedge
leverage
margin
risk
```

```text
POST /api/protection
```

Executes live protection.

```text
GET /api/protection/:id
```

Returns policy state.

```text
GET /api/protection/:id/health
```

Returns live risk state.

```text
POST /api/protection/:id/close
```

Manual reduce-only close.

---

# 39. Frontend Pages

## `/`

Portfolio dashboard.

## `/protect`

Create protection policy.

## `/protection/:id`

Live protection screen.

## `/protection/:id/receipt`

Completed hedge report.

## `/advanced`

Optional account/margin details.

---

# 40. Main Dashboard

```text
Portfolio

$240.35


Protection Status

ACTIVE


Protected
$240.35

Exposed
$0


NVDA

0.01 shares
$240.35

Protection
100%
```

---

# 41. Active Protection Screen

```text
PROTECTED VALUE

$240.12


NVDA

Underlying        $235.20
Underlying PnL      -$5.15

Hedge PnL           +$5.05

Fees/Funding        -$0.08

Net Move            -$0.18
```

---

# 42. Health Card

```text
Protection Health

SAFE


Portfolio Value       $X
Net Equity            $X
Available Equity      $X

Initial Margin        XX%
Maintenance Margin    XX%

Borrow Liability      $X

Execution Leverage     2x
```

---

# 43. Final Receipt

```text
Protection Completed

Asset
NVDA

Protection
100%

Duration
8h 41m

Starting Stock Value
$240.35

Ending Stock Value
$227.50

Underlying PnL
-$12.85

Hedge PnL
+$12.69

Funding
-$0.07

Fees
-$0.04

Net Protected Value
$240.08

Tracking Difference
-$0.27
```

---

# 44. Tech Stack

Frontend:

```text
Next.js
React
TypeScript
Tailwind
shadcn/ui
Recharts / Lightweight Charts
```

Backend:

```text
Node.js
TypeScript
Fastify
```

Database:

```text
PostgreSQL
Supabase
```

Hosting:

```text
Vercel
Railway / EC2
```

---

# 45. Environment Variables

```text
BACKPACK_API_KEY=
BACKPACK_PRIVATE_KEY=

DATABASE_URL=

TRADING_ENABLED=true

DEMO_MODE=true

MAX_TOTAL_NOTIONAL_USD=50

MAX_POSITION_NOTIONAL_USD=25

MAX_APPLICATION_LEVERAGE=2

ALLOWED_SYMBOLS=NVDA.US,AAPL.US

MMR_WARNING=0.50
MMR_RISK=0.65
MMR_REDUCE=0.80
MMR_EMERGENCY=0.90

CONVERGENCE_BPS=50
CONVERGENCE_COUNT=3
```

---

# 46. Hackathon Safety

Live trading restricted to:

```text
our Backpack account only
```

Maximum:

```text
$50 total
```

Prefer:

```text
$2–$20
```

per trade.

No public live execution.

The frontend may be public, but order endpoints must be restricted.

---

# 47. One-Go Build Requirement

There are **no separate implementation stages** in the project plan.

The build is considered incomplete until all of these work together:

```text
Backpack authentication

portfolio reading

stock discovery

collateral reading

perp discovery

protection calculation

leverage calculation

safe-order validation

live order creation

fill verification

WebSocket updates

PnL dashboard

margin monitoring

risk rules

market-state engine

convergence logic

automatic closing

manual emergency close

final receipt
```

The implementation should be developed as one coherent end-to-end application.

---

# 48. Definition of Done

The entire build is complete when this works:

```text
1. App opens.

2. Backend authenticates with Backpack.

3. User's 0.01 NVDA is detected.

4. NVDA market value is shown.

5. Backpack collateral value is shown.

6. NVDA-PERP is detected.

7. User chooses 100% protection.

8. Application calculates 0.01 short.

9. Application validates margin/order limits.

10. Application automatically selects safe leverage.

11. Preview says SAFE.

12. User clicks Activate.

13. Real short opens.

14. Fill is confirmed.

15. Dashboard shows stock + hedge together.

16. Backpack WS updates position/PnL.

17. Risk engine monitors MMR.

18. Demo/current market state transitions to reopen.

19. Convergence engine detects normalization.

20. Reduce-only close is submitted.

21. Position is verified closed.

22. Final receipt is generated.
```.
