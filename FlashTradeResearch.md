# Flash Trade Integration Research

_Last updated: 2026-06-05_

---

## 1. What Flash Trade Is

Flash Trade is a Solana-based perpetual futures protocol using a **pool-to-peer model** — no orderbook, trades execute against shared liquidity pools. Instant settlement, single transaction, near-zero slippage for typical sizes.

**Relevant pools:**

| Pool Name | Assets |
|---|---|
| `Crypto.1` | USDC, SOL, BTC, ETH, JitoSOL |
| `Virtual.1` / FLP.2 | USDC, XAUT, XAU, XAG, EUR, GBP, CRUDEOIL |
| `FLP.2` (Synthetic) | Crude-Oil, Natural Gas, EUR, GBP, USDJPY, USDCNH, Gold, Silver |
| `Governance.1` | USDC, JUP, PYTH, JTO, RAY |
| `Community.1/2` | USDC, BONK, PENGU, WIF |
| `Remora.1` (RWA) | USDC, TSLAr, NVDAr, SPYr |

**Virtual tokens** (`Custody.is_virtual = true`) give synthetic exposure — the pool holds only USDC/XAUT, PnL is settled in USDC based on Pyth oracle price movement. This is how forex/metals work on Flash Trade.

---

## 2. Market Mapping — Arena → Flash Trade

| Arena Symbol | Flash Trade Symbol | Pool | Notes |
|---|---|---|---|
| XAU/USD | `XAU` | Virtual.1 | Gold, virtual custody |
| XAG/USD | `XAG` | Virtual.1 | Silver, virtual custody |
| EUR/USD | `EUR` | Virtual.1 / FLP.2 | Euro, virtual custody |
| GBP/USD | `GBP` | Virtual.1 / FLP.2 | Sterling, virtual custody |
| USD/JPY | `USDJPY` | FLP.2 | Yen pair, virtual custody |
| Volatility 15 (1s) Index | ❌ | — | Deriv API (see §8) |
| Volatility 10 Index | ❌ | — | Deriv API (see §8) |
| Volatility 25 Index | ❌ | — | Deriv API (see §8) |
| Volatility 75 Index | ❌ | — | Deriv API (see §8) |

All 5 forex/metals tracked markets have confirmed Flash Trade equivalents. VIX synthetics do not — they are Deriv-exclusive and will use the Deriv API (separate integration, separate flow).

---

## 3. Integration Path Decision — REST API, Not SDK

**Decision: Use the Flash Trade REST API (`flashapi.trade`), not the `flash-sdk` npm package.**

Reasons:
- The REST API handles all transaction construction server-side. It returns a base64-encoded unsigned `VersionedTransaction`.
- We just need to: (1) POST trade params, (2) decode + sign with server keypair, (3) submit to Solana RPC.
- The SDK requires Anchor setup, pool config loading, Address Lookup Table (ALT) loading, BN math for native token decimals — significant complexity for no gain in our use case.
- The SDK is only needed for custom instruction composition or composability flows. We don't need either.

**Key REST endpoints used:**

| Action | Endpoint |
|---|---|
| Open position (with TP/SL) | `POST /transaction-builder/open-position` |
| Close position | `POST /transaction-builder/close-position` |
| Check open positions | `GET /positions/owner/{wallet}` |
| Current prices | `GET /prices/{symbol}` |
| Preview (no tx built) | `POST /transaction-builder/open-position` (omit `owner`) |

**Transaction flow (5 steps):**

```
1. BUILD   → POST /transaction-builder/open-position (with owner, TP, SL)
2. DECODE  → Buffer.from(transactionBase64, "base64")
3. SIGN    → VersionedTransaction.deserialize() → tx.sign([keypair])
4. SUBMIT  → connection.sendRawTransaction(tx.serialize())
5. CONFIRM → connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight })
```

**Critical constraint:** The blockhash in the returned transaction expires in ~60 seconds. Steps 2–5 must happen immediately after step 1 with no delays, caches, or user prompts in between.

---

## 4. The Two Gaps — What's Missing Today

### Gap 1 — Agent Decision Is Incomplete

The current pipeline ends at Convex state update. When vision analysis returns `verdict = "valid"`, the system updates `lifecycleState` to `"confirmed"` and stops. No trade fires.

```
cron scan → deriveThirdTouchArenaState → browser session
  → captureStrategyScreenshots → analyzeChartWithVision
    → ChartVisionDecision { verdict: "valid", ... }
      → Convex: lifecycleState = "confirmed"
        → ??? STOPS HERE — no execution layer
```

What needs to happen after `verdict = "valid"`:
1. Log confirmed entry signal in Convex
2. Derive TP and SL prices from the vision decision
3. Fire Flash Trade open-position API → receive `positionKey`
4. Update setup: `lifecycleState = "entered"`, store `positionKey`, `entryPriceActual`, `tpPrice`, `slPrice`

### Gap 2 — No Flash Trade Execution Layer

Nothing in the current codebase touches Flash Trade. Needs to be built from scratch: market config, signing utility, execution action, position monitor.

---

## 5. Agent Entry Rules

### Standard Entry
When vision returns `verdict = "valid"` + `nextState = "confirmed"`, the agent enters at **spot (current oracle price)** immediately.

### Missed Entry — 3-Candle Grace Window
If the agent missed its primary confirmation candle (price moved through the entry zone in the trade direction without the agent catching it), it can still enter **if price has not moved more than 3 candles away from the confirmation point**.

Rules for the grace window:
- `lifecycleState` must be `"missed_entry"` (not `"watching"` or `"staged"`)
- Count candles elapsed since the confirmation candle on the execution timeframe (15m)
- If elapsed candles ≤ 3 → treat as valid late entry, enter at current spot
- If elapsed candles > 3 → skip, stay in `"missed_entry"` state, wait for `"secondary_retrace"`
- The trendline must still be intact (not broken) for the grace window to apply

This prevents chasing entries that have already run significantly from the ideal zone while still allowing the agent to catch a setup it was slow to process.

### Entry Price
Always market order at current oracle price. No limit orders for primary entries — the agent enters at spot to guarantee fill.

---

## 6. TP and SL Derivation from Vision Decision

The `ChartVisionDecision` object returned by vision analysis already contains the data needed:

| Trade Parameter | Source Field | Notes |
|---|---|---|
| Direction (LONG/SHORT) | `direction` | Already computed by vision |
| TP price | `correctedZone.low` (for longs) / `correctedZone.high` (for shorts) | Conservative target — the near edge of the projected zone |
| SL price | `invalidationZone.high` (for longs) / `invalidationZone.low` (for shorts) | The level that invalidates the trendline structure |
| Entry collateral | Config constant (`FLASH_TRADE_COLLATERAL_USDC`) | Fixed per trade, e.g. $50 USDC |
| Leverage | Config per market (`FLASH_TRADE_LEVERAGE_BY_MARKET`) | e.g. 5x forex, 3x metals |

TP and SL are passed in the `open-position` request directly (Flash Trade attaches them atomically as trigger orders — no separate round-trip, no race condition).

Minimum collateral for TP/SL: `>$10 after entry fees`. Use `$12+` as a safe floor to account for 4–8 BPS entry fee deduction.

---

## 7. Proposed Architecture (4 Layers)

### Layer 1 — Market Config (`lib/flash-trade-markets.ts`)

Static mapping from arena symbol to Flash Trade params. VIX symbols map to `null` (no Flash Trade execution).

```typescript
type FlashTradeMarketConfig = {
  symbol: string;          // Flash Trade token symbol
  pool: string;            // Pool name e.g. "Virtual.1"
  collateralSymbol: string; // "USDC" for all virtual markets
  leverage: number;         // Fixed leverage for this market
};

const FLASH_TRADE_MARKETS: Record<string, FlashTradeMarketConfig | null> = {
  "XAU/USD":                    { symbol: "XAU",    pool: "Virtual.1", collateralSymbol: "USDC", leverage: 3 },
  "XAG/USD":                    { symbol: "XAG",    pool: "Virtual.1", collateralSymbol: "USDC", leverage: 3 },
  "EUR/USD":                    { symbol: "EUR",    pool: "Virtual.1", collateralSymbol: "USDC", leverage: 5 },
  "GBP/USD":                    { symbol: "GBP",    pool: "Virtual.1", collateralSymbol: "USDC", leverage: 5 },
  "USD/JPY":                    { symbol: "USDJPY", pool: "FLP.2",     collateralSymbol: "USDC", leverage: 5 },
  "Volatility 10 Index":        null, // Deriv API
  "Volatility 15 (1s) Index":   null, // Deriv API
  "Volatility 25 Index":        null, // Deriv API
  "Volatility 75 Index":        null, // Deriv API
};
```

### Layer 2 — Execution Action (`convex/flash-trade.ts`)

A Convex **action** (not mutation — it calls external APIs). Called when `verdict = "valid"`.

Responsibilities:
1. Resolve market config from arena symbol — bail out if `null` (VIX path)
2. Derive TP and SL from the `ChartVisionDecision`
3. `POST /transaction-builder/open-position` with all params including `takeProfit` and `stopLoss`
4. Check `data.err` — if present and blocking, abort and log
5. Decode `transactionBase64`, sign with `Keypair.fromSecretKey(FLASH_TRADE_WALLET_SECRET)`, submit, confirm
6. On success: call a Convex mutation to persist `positionKey`, `entryPriceActual`, `tpPrice`, `slPrice`, set `lifecycleState = "entered"`
7. On failure: log error, leave state as `"confirmed"` for retry

**Environment variables needed:**
- `FLASH_TRADE_API_URL` — e.g. `https://flashapi.trade`
- `FLASH_TRADE_WALLET_SECRET` — base58-encoded Solana keypair secret key
- `FLASH_TRADE_WALLET_PUBKEY` — corresponding public key
- `SOLANA_RPC_URL` — mainnet RPC endpoint (use a paid node like Helius or Quicknode for reliability)

### Layer 3 — Position Monitor Cron

A lightweight Convex cron (every 5 minutes) that:
1. Queries all setups with `lifecycleState = "entered"` and a stored `positionKey`
2. `GET /positions/owner/{wallet}` from Flash Trade API
3. For each tracked setup: if the position is absent from the response, it was closed (TP/SL keeper executed)
4. Fetches final PnL from the last known data, marks setup `lifecycleState = "completed"`, stores `realizedPnlUsd`

No WebSocket needed server-side — REST poll every 5 minutes is sufficient. The Flash Trade WebSocket is for client-side dashboards.

### Layer 4 — Convex Schema Additions

New fields on the `setups` table (all optional to avoid migration pain):

```typescript
flashPositionKey: v.optional(v.string()),     // position account pubkey (base58)
entryPriceActual: v.optional(v.number()),     // oracle price at time of entry
tpPriceSet: v.optional(v.number()),           // take-profit level placed
slPriceSet: v.optional(v.number()),           // stop-loss level placed
collateralUsdc: v.optional(v.number()),       // USDC collateral deposited
leverageUsed: v.optional(v.number()),         // actual leverage at entry
realizedPnlUsd: v.optional(v.number()),       // final PnL (positive or negative)
flashEnteredAt: v.optional(v.number()),       // ms timestamp of entry
flashClosedAt: v.optional(v.number()),        // ms timestamp of close
```

---

## 8. VIX Synthetics — Deriv API Path

Volatility indices (V10, V15 1s, V25, V75) are Deriv-exclusive synthetic markets. They will use the Deriv API for trade execution — a **separate integration** from Flash Trade.

This is deferred until the Flash Trade layer is complete. Key notes for when it's picked up:
- Deriv uses a WebSocket-based API (`wss://ws.binaryws.com/websockets/v3`)
- Authentication via OAuth2 or API token
- Trade type: `buy` / `sell` contracts (CFD-style)
- These markets have `marketSyncStatus = "no_data"` for Pyth (no price feed), confirmed by Flash Trade gap
- Agent signal from Kairos still applies — the decision flow is identical, only the execution layer differs

---

## 9. Open Questions (Resolved During Implementation)

| # | Question | Status |
|---|---|---|
| 1 | Execution mode: auto-execute or signal + manual confirm? | Pending |
| 2 | Collateral per trade: fixed $X or confidence-scaled? | Pending |
| 3 | Leverage per market: accept the defaults in Layer 1 config or adjust? | Pending |
| 4 | Solana wallet: funded with USDC and ready? | Pending |
| 5 | Solana RPC endpoint: public or paid node? | Pending (recommend paid for production) |
| 6 | Referral/stake discount: does the wallet have FLASH stake for fee discount? | Pending |

---

## 10. Important Flash Trade API Quirks

- **`youRecieveUsdUi` is intentionally misspelled** in the API response (matches the Rust backend). Do not correct it in TypeScript types.
- **TP/SL require >$10 collateral after entry fees.** Use $12+ as the safe minimum.
- **One position per market per side per wallet.** If the wallet already has a long XAU position and the agent fires again, it merges (averages entry, increases size). Guard against duplicate entries.
- **Blockhash expires in ~60 seconds.** Build → sign → submit must be atomic. Never cache a transaction.
- **Devnet Pyth prices are stale/zero.** Test with small amounts on mainnet or use preview-only mode for logic testing.
- **Longs use target token as collateral** (e.g., SOL/SOL). For virtual markets this is USDC-settled — no auto-swap needed.
- **The API is public — no auth headers required.** Only the signing keypair is secret.

---

## 11. Next Steps (Implementation Order)

1. **Finalize open questions** (§9) — execution mode, collateral amount, leverage, wallet readiness
2. **Layer 1**: Write `lib/flash-trade-markets.ts` — market config + signing utility
3. **Layer 2**: Write `convex/flash-trade.ts` — execution action, called from `runArenaScanCycle` when `verdict = "valid"`
4. **Schema**: Add new fields to `convex/schema.ts` setups table
5. **Entry rule**: Update `chart-vision-analysis.ts` and cron logic to implement the 3-candle grace window for `missed_entry` → late spot entry
6. **Layer 3**: Add position monitor cron to `convex/arena.ts`
7. **Deriv API** (separate, deferred): VIX synthetics execution layer after Flash Trade is stable
