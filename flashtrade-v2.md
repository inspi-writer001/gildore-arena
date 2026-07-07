# FlashTrade Integration v2 Plan for Gildore Arena

## Summary

Revise the FlashTrade integration so the backend Solana execution wallet is owned by the Privy user identity, not by a specific connected wallet address. One
authenticated Privy user gets one reusable Solana execution wallet whether they enter through Solana or Celo/EVM.

Ship a manual devnet test flow in the dashboard that lets you validate the full backend pipeline:

- ensure execution wallet
- confirm vault funding state
- consume ticker into execution-wallet USDC ATA
- build FlashTrade transaction
- sign and broadcast with the execution wallet
- persist execution lifecycle records
- fetch resulting FlashTrade position state if available

Important constraint locked from the docs: FlashTrade devnet is not reliable for real PnL validation because Pyth prices are mainnet-only. So the devnet button
is a pipeline validation tool, not a guaranteed realistic market/PnL simulator.

## Implementation Changes

### 1. Execution wallet ownership and identity model

- Change execution-wallet ownership from userWalletAddress to privyUserId.
- executionWallets should store:
  - privyUserId
  - executionWalletAddress
  - encrypted secret fields
  - last-used timestamps
  - known linked wallets metadata:
    - solanaWalletAddress optional
    - evmWalletAddress optional
    - celoWalletAddress optional

- flashtradeExecutions should also store:
  - privyUserId
  - originating wallet address used for this run
  - originating ecosystem (solana or celo)

- Keep raw wallet addresses as metadata and audit fields only, not as the primary owner key.

### 2. Ensure-wallet trigger behavior

- Ensure the execution wallet for any authenticated Privy session, regardless of active ecosystem.
- Move the ensure trigger to the shared authenticated client flow so it runs for:
  - Solana-authenticated dashboard sessions
  - Celo/EVM-authenticated dashboard sessions

- The ensure action should accept:
  - privyUserId
  - optional current Solana wallet address
  - optional current EVM/Celo wallet address
  - current ecosystem

- On repeated ensures:
  - reuse the existing execution wallet
  - patch linked wallet metadata if a new wallet address is now known
  - never create a second execution wallet for the same Privy user

### 3. FlashTrade backend flow revision

- Update all FlashTrade store lookups to resolve by:
  - privyUserId
  - agentSlug

- resolveExecutionContext should use privyUserId as the primary identity key.
- openFlashTradePosition should:
  - require privyUserId
  - record the source wallet and ecosystem for audit
  - reuse the Privy-user-owned execution wallet

- closeFlashTradePosition and syncFlashTradePosition should resolve the same way.

Keep current behavior otherwise:

- supported FlashTrade v1 markets remain:
  - XAU/USD
  - XAG/USD
  - EUR/USD
  - GBP/USD

- unsupported VIX markets still fail fast
- leverage remains derived from entry and stop distance
- TP remains fixed at 1:3 RR
- settlement remains closed_pending_settlement until vault sweep support exists

### 4. Manual devnet test button

- Add a devnet-only manual FlashTrade test button in the selected-agent panel near the vault control surface, not in the generic public action row.
- Show the button only when all are true:
  - active ecosystem is Solana
  - authenticated user is connected
  - current Solana RPC is devnet
  - selected market is FlashTrade-supported

- Label it explicitly as a test action, for example:
  - Test FlashTrade (Devnet)

- The button should call a dedicated backend action, separate from the eventual production “open live trade” action.
- The test action should:
  - ensure execution wallet for the Privy user
  - verify vault/ticker state
  - run consume-ticker to the execution wallet ATA
  - build and submit the FlashTrade open-position transaction
  - write an execution record flagged as a manual devnet test
  - attempt to fetch resulting position data
  - return structured debug output to the client:
    - execution wallet address
    - ATA address
    - consumed amount
    - consume signature
    - venue signature
    - venue position key if found
    - any FlashTrade error or sync limitation

### 5. Devnet test semantics

- Treat the devnet button as a pipeline smoke test, not a performance/PnL truth source.
- The UI should explain:
  - FlashTrade devnet may not provide real oracle-driven PnL behavior
  - success means the integration path worked, not that the resulting position behaves like mainnet

- For the first test pass, use a fixed supported test market default if needed:
  - recommended default: EUR/USD

- Do not add a mainnet smoke-test button in this phase.

### 6. UI feedback and observability

- Add a small execution status surface for the manual test:
  - wallet ready
  - funded
  - open submitted
  - open
  - failed

- Show the latest manual test result inline:
  - consumed amount
  - consume signature
  - FlashTrade signature
  - detected position key

- Add a clear warning state when:
  - active ecosystem is Celo/EVM
  - the user has a Privy session but no Solana wallet connected for dashboard-side Solana actions

- Keep wallet creation silent; only show visible errors if ensure fails.

## Public Interfaces and Types

- ensureExecutionWallet
  - replace wallet-address ownership args with:
    - privyUserId
    - ecosystem
    - optional linked wallet addresses

- openFlashTradePosition, closeFlashTradePosition, syncFlashTradePosition
  - add privyUserId
  - keep wallet address as audit metadata, not ownership key

- Add a new manual-test backend action:
  - runFlashTradeDevnetTest

- Extend execution records with:
  - privyUserId
  - originWalletAddress
  - originEcosystem
  - isManualTest
  - optional testEnvironment = "devnet"

## Test Plan

- Identity tests:
  - same Privy user via Solana and Celo/EVM reuses one execution wallet
  - linked wallet metadata updates without creating a new execution wallet
  - different Privy users never share execution wallets

- Manual devnet flow tests:
  - button hidden when not on Solana devnet
  - button hidden for unsupported FlashTrade markets
  - ensure wallet runs before test open
  - consume ticker funds the execution wallet ATA
  - FlashTrade tx build/sign/broadcast path succeeds or surfaces structured failure
  - execution record is tagged as manual devnet test
  - no vault state
  - no max spend configured
  - unsupported market
  - insufficient execution-wallet SOL for venue tx fee
  - FlashTrade tx built but no position detected after polling

- Acceptance scenarios:
  - authenticated Privy user enters through Celo and still gets one backend Solana execution wallet
  - authenticated Privy user later switches to Solana and reuses that same wallet
  - user funds vault, sets max spend, presses devnet test button
  - system produces consume signature plus venue signature and stores execution record
  - UI shows test result even if devnet PnL data is stale or incomplete

## Assumptions and Defaults

- Primary execution-wallet owner key is privyUserId.
- One backend Solana execution wallet per Privy user is the intended custody model.
- Manual test button is devnet-only and Solana-only in this phase.
- Devnet testing is for transport/orchestration validation, not trustworthy live PnL validation.
- Settlement back into the Gildore vault remains out of scope for this phase and stays blocked at closed_pending_settlement.
