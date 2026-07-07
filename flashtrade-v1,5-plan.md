## FlashTrade v1 Plan for Gildore Arena

### Summary

Implement FlashTrade as the first live execution rail for non-VIX markets only, using a self-managed backend Solana execution wallet per user and the existing Gildore vault as the
source of funds.

Locked decisions for this version:

- Auth wallet: Privy remains the user auth / visible wallet layer
- Execution wallet: one server-generated Solana wallet per user
- Key custody: execution wallet secret is encrypted at rest in Convex data; the decrypt root lives only in server / Convex env
- Trade owner on FlashTrade: the backend execution wallet
- SDK/runtime: use @solana/kit, not @solana/web3.js, for all new signing/broadcast logic
- Funding semantics: requested spend comes from the user’s configured max_spend, but the effective spend is whatever consume_ticker yields on-chain
- Insufficient balance behavior: if max_spend exceeds vault balance, use the full available balance as long as it still satisfies the minimum tradable size
- No redundant balance precheck RPC: rely on the vault program’s consume_ticker math and constraints
- Concurrency: one open position per user-agent
- Gas sponsorship: defer full USDC gas reimbursement / sponsorship settlement to a later phase; get core integration working first

End-to-end v1 path:

1. user signs in with Privy
2. backend ensures a per-user execution wallet exists
3. user funds agent vault and sets max spend
4. server calls vault consume_ticker to move the allowed amount into execution wallet USDC ATA
5. server calls FlashTrade open-position with that funded amount
6. server signs the FlashTrade transaction with the execution wallet and submits it
7. on close, proceeds settle to the execution wallet
8. server sweeps proceeds back into the same user-agent vault and clears isInPosition

### Implementation Changes

#### 1. Execution wallet subsystem

- Add a Solana execution-wallet domain for backend trading.
- Create one execution wallet per user, reused across all agents.
- Persist in Convex:
  - linked user identity
  - linked Privy wallet metadata if present
  - execution wallet public key
  - encrypted secret blob
  - per-wallet salt / nonce metadata
  - lifecycle flags such as active, disabledAt, rotatedAt

- Keep the decrypt root only in deployment env / Convex env, never in Convex tables.
- Follow the proven pattern from the other backend repo: app-managed envelope encryption, decrypt only inside Node server/worker paths.

#### 2. Vault funding and spend semantics

- Reuse the existing Solana vault program as the source of truth for user funds and agent spend controls.
- Reuse consume_ticker as the canonical funding step into the execution wallet’s USDC ATA.
- Treat consume_ticker as authoritative for:
  - enforcing max spend
  - capping by actual vault balance
  - falling back to full available balance when max_spend is higher than balance
  - rejecting trades below minimum viable funding

- Do not add a separate RPC balance-check gate before consume.
- Persist both:
  - requestedSpendUi
  - effectiveConsumedAmountUi
    so the app can explain when a trade used less than configured max spend.

#### 3. FlashTrade open/close flow

- Use the verified FlashTrade model:
  - transaction A: vault consume_ticker
  - transaction B: FlashTrade open-position

- FlashTrade open-position should be built with:
  - inputTokenSymbol = USDC
  - inputAmountUi = effective consumed amount
  - owner = execution wallet public key
  - computed leverage
  - optional TP/SL inline if supported

- Sign FlashTrade’s returned unsigned transaction with the execution wallet using @solana/kit.
- On close:
  - use FlashTrade close-position
  - settle proceeds to execution wallet in USDC
  - sweep proceeds back into the same user-agent vault
  - call the existing close-trade vault path to clear isInPosition

#### 4. Broadcaster / gas sponsorship compatibility

- For v1, do not block FlashTrade integration on full sponsored-gas economics.
- Keep current broadcaster-fee-payer behavior where already required by the vault flow.
- Design the execution pipeline so a later phase can support:
  - execution wallet signs trade intent
  - admin/broadcaster fee payer sponsors network fees
  - user reimburses equivalent gas cost in USDC from execution/vault funds

- Preserve this in interfaces by recording:
  - fee payer wallet
  - network fee amount
  - reimbursement status

- But mark reimbursement logic, batching, and admin USDC settlement as post-v1 follow-up, not required to ship FlashTrade integration.

#### 5. Bookkeeping and state

- Add Convex execution records for the full venue lifecycle.
- Minimum fields:
  - user id / user wallet
  - execution wallet address
  - agent slug
  - market symbol
  - venue = flashtrade
  - requested spend
  - effective consumed spend
  - margin used
  - leverage used
  - entry / stop / target
  - RR ratio = 3
  - vault consume signature
  - FlashTrade open signature
  - FlashTrade close signature
  - vault sweep-back signature
  - FlashTrade position key / market / side
  - status: wallet_ready | funding_pending | funded | open_submitted | open | close_submitted | closed | settlement_pending | settled | failed
  - failure reason / retry count
  - returned amount and realized PnL
  - optional future gas reimbursement fields

- Reuse vault isInPosition as the hard gate for one open position per user-agent.

#### 6. Sizing and risk logic

- Requested spend originates from max_spend.
- Effective spend is whatever the vault program releases.
- Compute stop loss from the current selected setup.
- Compute take profit at exactly 3 \* risk distance.
- Compute leverage from:
  - effective consumed principal
  - entry price
  - stop distance
  - FlashTrade market constraints

- If FlashTrade constraints cannot open the trade with the effective consumed amount, fail clearly.
- Reject unsupported VIX/Deriv markets in this adapter.

#### 7. Runtime placement

- Put all decryption, signing, ATA derivation, and transaction submission in Node-only paths.
- Use the existing worker/server-node model already present in the repo.
- Keep all client/browser code out of execution-wallet secret handling.

### Important Interfaces

- Add backend functions for:
  - ensure/create execution wallet
  - fetch execution wallet funding ATA
  - open FlashTrade position from current agent setup
  - close FlashTrade position
  - sweep settled funds back to vault
  - reconcile execution records against on-chain/FlashTrade state

- Add execution adapter methods:
  - supportsMarket(symbol)
  - openPosition(input)
  - closePosition(input)
  - syncPosition(input)

- openPosition(input) must include:
  - user identity
  - agent slug
  - execution wallet reference
  - requested spend
  - effective funded amount
  - market symbol
  - side
  - entry context
  - stop loss
  - take profit
  - slippage
  - optional TP/SL inline placement

- New code paths must use @solana/kit transaction/message/signing types to stay consistent with the repo’s Solana server stack.

### Test Plan

- Unit tests for execution wallet crypto flow:
  - create wallet
  - encrypt secret
  - persist metadata
  - decrypt secret with env root
  - reject decrypt with wrong env root

- Unit tests for spend semantics:
  - requested spend below balance uses requested spend
  - requested spend above balance falls back to full available balance
  - consume result below minimum tradable threshold fails
  - no separate RPC balance read is required before consume

- Unit tests for sizing:
  - 1:3 TP calculation
  - leverage derivation from effective funded amount
  - failure when FlashTrade constraints cannot satisfy the trade

- Unit tests for orchestration:
  - cannot open without execution wallet
  - cannot open when isInPosition is true
  - cannot open when market is VIX/unsupported
  - consume success + open failure lands in recoverable failed state
  - close success + sweep failure lands in settlement_pending

- Integration scenarios:
  - user auths with Privy and execution wallet is created once
  - user funds vault and sets $10 max spend
  - vault consumes exact configured spend when balance is sufficient
  - vault consumes full available balance when configured spend exceeds balance
  - FlashTrade open-position is signed by execution wallet and confirmed
  - close settles to execution wallet
  - sweep returns funds to same agent vault
  - close-trade clears isInPosition

- Acceptance criteria:
  - no second Privy-managed execution wallet is required
  - no wallet secret is exposed to client
  - FlashTrade integration works without first shipping gas reimbursement logic
  - spend fallback behavior matches on-chain vault program semantics
  - all new Solana execution code uses @solana/kit

- FlashTrade v1 covers only FlashTrade-supported non-VIX markets.
- FlashTrade open-position is the actual entry transaction; there is no separate required “fund venue vault then enter” step for initial entry.
- Convex storage is acceptable for encrypted wallet blobs as long as the decrypt root remains only in env, not in Convex tables.
- One backend execution wallet per user is acceptable, with per-agent trade isolation handled in Convex and in vault ticker state.
- Full admin gas sponsorship with USDC reimbursement is intentionally deferred; v1 only needs interfaces and bookkeeping compatibility for that later feature.
- This is a platform-custodied execution model and should be reflected in user disclosures and operational handling.
