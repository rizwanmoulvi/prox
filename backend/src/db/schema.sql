-- ProX schema. Applied by `pnpm --filter @prox/backend migrate`; every statement is safe to run again.

CREATE TABLE IF NOT EXISTS protection_policy (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status                    TEXT NOT NULL,
  risk_state                TEXT NOT NULL DEFAULT 'SAFE',
  mode                      TEXT NOT NULL,
  requested_protection_bps  INTEGER NOT NULL,
  actual_protection_bps     INTEGER NOT NULL DEFAULT 0,
  start_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- When convergence checks may begin, before the cooldown is added.
  reopen_at                 TIMESTAMPTZ NOT NULL,
  max_end_at                TIMESTAMPTZ NOT NULL,
  cooldown_sec              INTEGER NOT NULL,
  demo_override             BOOLEAN NOT NULL DEFAULT false,
  close_reason              TEXT,
  failure_reason            TEXT,
  owner_wallet              TEXT NOT NULL,
  receipt                   JSONB,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hedge_leg (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id              UUID NOT NULL REFERENCES protection_policy(id),
  stock_symbol           TEXT NOT NULL,
  perp_symbol            TEXT NOT NULL,
  stock_quantity         NUMERIC NOT NULL,
  stock_mark_price       NUMERIC NOT NULL,
  stock_market_value     NUMERIC NOT NULL,
  collateral_weight      NUMERIC NOT NULL,
  collateral_value       NUMERIC NOT NULL,
  target_protection_bps  INTEGER NOT NULL,
  target_notional        NUMERIC NOT NULL,
  target_quantity        NUMERIC NOT NULL,
  -- Short quantity this policy opened and still holds.
  actual_quantity        NUMERIC NOT NULL DEFAULT 0,
  -- Short quantity this policy opened in total, before any reduce or close.
  opened_quantity        NUMERIC NOT NULL DEFAULT 0,
  -- Short already in the account when the policy was created; it is never ours to close.
  existing_short_quantity NUMERIC NOT NULL DEFAULT 0,
  account_leverage       INTEGER NOT NULL,
  entry_price            NUMERIC,
  exit_price             NUMERIC,
  exit_stock_price       NUMERIC,
  current_stock_price    NUMERIC,
  current_perp_price     NUMERIC,
  pnl                    NUMERIC NOT NULL DEFAULT 0,
  realized_pnl           NUMERIC NOT NULL DEFAULT 0,
  funding                NUMERIC NOT NULL DEFAULT 0,
  fees                   NUMERIC NOT NULL DEFAULT 0,
  borrow_cost            NUMERIC NOT NULL DEFAULT 0,
  opening_imr            NUMERIC,
  opening_mmr            NUMERIC,
  current_mmr            NUMERIC,
  open_client_id         BIGINT,
  close_client_id        BIGINT,
  basis_bps              NUMERIC,
  convergence_count      INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL,
  opened_at              TIMESTAMPTZ,
  closed_at              TIMESTAMPTZ
);

-- One live policy per stock.
CREATE UNIQUE INDEX IF NOT EXISTS hedge_leg_one_live_per_stock
  ON hedge_leg (stock_symbol) WHERE status NOT IN ('CLOSED', 'FAILED');

CREATE TABLE IF NOT EXISTS policy_event (
  id          BIGSERIAL PRIMARY KEY,
  policy_id   UUID NOT NULL REFERENCES protection_policy(id),
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  detail      JSONB
);
CREATE INDEX IF NOT EXISTS policy_event_policy ON policy_event (policy_id, id);

-- One row per order we decide to send, written before it is sent (PRD section 19).
CREATE TABLE IF NOT EXISTS order_record (
  id                 BIGSERIAL PRIMARY KEY,
  policy_id          UUID NOT NULL REFERENCES protection_policy(id),
  logical_id         TEXT NOT NULL UNIQUE,
  client_id          BIGINT NOT NULL UNIQUE,
  purpose            TEXT NOT NULL,
  symbol             TEXT NOT NULL,
  side               TEXT NOT NULL,
  reduce_only        BOOLEAN NOT NULL,
  quantity           NUMERIC NOT NULL,
  price              NUMERIC,
  status             TEXT NOT NULL,
  backpack_order_id  TEXT,
  executed_quantity  NUMERIC NOT NULL DEFAULT 0,
  avg_price          NUMERIC,
  fee                NUMERIC NOT NULL DEFAULT 0,
  fee_symbol         TEXT,
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_record_policy ON order_record (policy_id, id);

-- Signed reports received from the CRE convergence oracle.
CREATE TABLE IF NOT EXISTS attestation (
  id                BIGSERIAL PRIMARY KEY,
  report_hash       TEXT NOT NULL UNIQUE,
  mode              TEXT NOT NULL,
  raw_report        TEXT NOT NULL,
  context           TEXT NOT NULL,
  signatures        JSONB NOT NULL,
  valid_signatures  INTEGER NOT NULL DEFAULT 0,
  workflow_id       TEXT,
  workflow_owner    TEXT,
  observed_at       TIMESTAMPTZ NOT NULL,
  payload           JSONB NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS convergence_check (
  id              BIGSERIAL PRIMARY KEY,
  policy_id       UUID NOT NULL REFERENCES protection_policy(id),
  attestation_id  BIGINT NOT NULL REFERENCES attestation(id),
  observed_at     TIMESTAMPTZ NOT NULL,
  basis_bps       NUMERIC NOT NULL,
  session         TEXT NOT NULL,
  passed          BOOLEAN NOT NULL,
  counted         BOOLEAN NOT NULL,
  reject_reason   TEXT,
  count_after     INTEGER NOT NULL,
  UNIQUE (policy_id, attestation_id)
);
CREATE INDEX IF NOT EXISTS convergence_check_policy ON convergence_check (policy_id, id);

-- Hashes written to Solana mainnet as Memo transactions.
CREATE TABLE IF NOT EXISTS anchor (
  id          BIGSERIAL PRIMARY KEY,
  policy_id   UUID NOT NULL REFERENCES protection_policy(id),
  kind        TEXT NOT NULL,
  digest      TEXT NOT NULL,
  memo        TEXT NOT NULL,
  status      TEXT NOT NULL,
  signature   TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (policy_id, kind)
);

-- Price and PnL history for the live protection chart.
CREATE TABLE IF NOT EXISTS pnl_point (
  id              BIGSERIAL PRIMARY KEY,
  policy_id       UUID NOT NULL REFERENCES protection_policy(id),
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  stock_price     NUMERIC NOT NULL,
  perp_price      NUMERIC NOT NULL,
  underlying_pnl  NUMERIC NOT NULL,
  hedge_pnl       NUMERIC NOT NULL,
  costs           NUMERIC NOT NULL,
  net             NUMERIC NOT NULL
);
CREATE INDEX IF NOT EXISTS pnl_point_policy ON pnl_point (policy_id, id);

-- Scheduled, recurring protection: a plan covers several stocks over a span of days.
ALTER TABLE protection_policy ADD COLUMN IF NOT EXISTS plan_run_id UUID;
ALTER TABLE protection_policy ADD COLUMN IF NOT EXISTS close_rule TEXT NOT NULL DEFAULT 'CONVERGENCE';

CREATE TABLE IF NOT EXISTS protection_plan (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_wallet    TEXT NOT NULL,
  status          TEXT NOT NULL,
  window_kind     TEXT NOT NULL,
  custom_start    TEXT,
  custom_end      TEXT,
  protection_bps  INTEGER NOT NULL,
  stock_symbols   TEXT[] NOT NULL,
  start_date      TEXT NOT NULL,
  days            INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_run (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       UUID NOT NULL REFERENCES protection_plan(id),
  run_date      TEXT NOT NULL,
  window_start  TIMESTAMPTZ,
  window_end    TIMESTAMPTZ,
  close_rule    TEXT NOT NULL,
  status        TEXT NOT NULL,
  note          TEXT,
  results       JSONB,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, run_date)
);
CREATE INDEX IF NOT EXISTS plan_run_due ON plan_run (status, window_start);
