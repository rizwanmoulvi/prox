# ProX frontend

The web app for ProX: sign in with a wallet, see the Backpack portfolio, protect a stock, watch a live protection and read its receipt. Next.js 16 with React 19, TanStack Query, shadcn components on Base UI, Sonner, lightweight-charts, loading-dev and the Solana wallet adapter.

Next.js 16 has breaking changes from earlier versions. `AGENTS.md` in this folder says where its bundled docs are; read them before changing framework code.

## Getting started

The backend must be running first; see the README one folder up.

```bash
pnpm dev                 # http://localhost:3000, expects the backend on :4000
```

To use other ports, or to run without pnpm:

```bash
NEXT_PUBLIC_API_URL=http://localhost:4100 npx next dev -p 3200
```

`NEXT_PUBLIC_API_URL` is the only setting; `.env.example` lists it. The backend's `FRONTEND_ORIGIN` has to match the address this app is served from, or the browser blocks the calls.

## Pages

| Route | File | What it shows |
|---|---|---|
| `/` | `app/page.tsx` | The public landing page: the idea as a chart, a worked example, how it works, the safeguards |
| `/app` | `app/app/page.tsx` | Portfolio value, how much is hedged, the stocks, running schedules, the market session and margin |
| `/app/protect` | `app/app/protect/page.tsx` | Four steps (stocks, how much, when, how many days) and a live summary with the Protect button. Weekend is one hedge held until Monday's open; every other choice creates a schedule |
| `/app/plans/[id]` | `app/app/plans/[id]/page.tsx` | A schedule: each day's window in New York and local time, the protection it opened per stock, and Stop |
| `/app/protection/[id]` | `app/app/protection/[id]/page.tsx` | A live protection: the result, its stage, the chart, margin, and the record |
| `/app/protection/[id]/receipt` | `app/app/protection/[id]/receipt/page.tsx` | The finished protection: result, statement, proof |
| `/app/advanced` | `app/app/advanced/page.tsx` | The Backpack account as tables, backend and oracle state, raw JSON on request |

`app/layout.tsx` wraps everything in the providers. `app/app/layout.tsx` adds `components/app-shell.tsx` (brand, section tabs, market session, wallet, sign out) and `components/sign-in-gate.tsx`, so only `/app` needs a wallet. The old paths (`/protect`, `/advanced`, `/protection/...`) redirect, set in `next.config.ts`.

Pieces worth knowing:

| Component | Purpose |
|---|---|
| `components/session-card.tsx` | The US market session and the time until it opens |
| `components/coverage-bar.tsx` | Hedged against exposed |
| `components/margin-meter.tsx` | Maintenance margin against the liquidation line |
| `components/window-track.tsx` | A protection window on a line: now, window end, latest close |
| `components/scenario-table.tsx` | What a price move does with and without the hedge |
| `components/result-equation.tsx` | Stock plus hedge minus costs equals net |
| `components/landing/*` | The hero chart, the worked example and the live session line |
| `lib/hedge.ts` | The sums those share: the outcome of a move, shorts already on Backpack, time until |

## Data

- `lib/api.ts` is the only place that calls the backend. Cookies carry the session, so every call sends credentials.
- Response types are imported from the backend source (`../backend/src/...`) and passed through `Wire<T>`, which turns every `Date` into the ISO string JSON delivers. Rename a field in the backend and the typecheck here fails. Three shapes are still written by hand because the routes build them inline: `Health`, `MarketRow` and `PolicyHealth`.
- `hooks/use-stream.ts` listens to `GET /api/stream` (server-sent events) for PnL, basis, account health and policy changes, and refreshes the affected queries.
- Nothing is mocked. With no backend the app shows "Backend unreachable".

## Design

The look comes from the Umbra wallet (`adilhusain01/umbra`, files `web/src/theme.css` and `web/src/style.css`, unchanged from the original author's last commit).

- **Tokens** are in `app/globals.css`: paper (`--paper`, `--paper-2`, `--paper-3`), ink (`--ink`, `--ink-soft`, `--ink-faint`), hairlines (`--line`, `--line-soft`), one accent (`--gold`, `--gold-deep`, `--gold-wash`) and `--danger`. Tailwind classes exist for each: `bg-paper-2`, `text-ink-soft`, `border-line`, `text-gold-deep`.
- Umbra calls its gold `--accent`. Here it is `--gold`, because shadcn already uses `--accent` for hover surfaces. shadcn's own names (`--background`, `--card`, `--primary` and the rest) point at the Umbra palette.
- **Type** is loaded in `app/layout.tsx`: Bodoni Moda for display (`font-heading`), Mulish for the interface (`font-sans`), Geist Mono for figures (`font-mono`).
- **Shapes**: radii of 6, 10 and 16 pixels; surfaces are outlined with an inset 1.5 pixel line instead of a border or shadow; chips, tabs and round marks are pills; section labels are small, uppercase and letterspaced.
- **Gold is rare.** It marks a portfolio with a live hedge, the net result of a protection, and links. Risk climbs from ink through gold to the oxblood red.
- **Shared pieces** are in `components/umbra.tsx`: `SectionLabel`, `StatTile` and `LineRow`. The restyled primitives are in `components/ui`.
- **Loading** is always `components/loader.tsx`, the Gather spinner from `loading-dev` with an optional caption. Use `<Loader label="..." />` for a page and `<Loader compact />` inside a card. Do not use skeleton boxes.
- There is one theme. Umbra has no dark mode, so neither does this.
- **Layout**: up to 1240 pixels wide. Sections are separated by space and hairlines; a filled surface is kept for the one thing on a page that needs to stand apart, such as the Protect summary.
- **Motion**: pressable things scale to 0.97. Transitions list the properties they change and use `ease-out-strong`. The only entrance animation is the hero chart drawing once.
- **Words**: say what happens in plain terms. A button names its action ("Protect $2.40 of NVDA"), and an empty or failed state says what to do next.

Take colours, radii and type from these tokens. Do not add new hex values in components.

## Checks

```bash
npx tsc --noEmit
npx eslint app components hooks lib
```

After changing `app/globals.css`, restart `next dev` if the page keeps the old colours.
