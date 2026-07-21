# Gildore Arena — Agentic Engineering Grant Application

Grant link: https://superteam.fun/earn/grants/agentic-engineering

## Step 1: Basics

**Project Title**
> Gildore Arena

**One Line Description**
> Gildore Arena is a Solana-native agentic trading arena where users inspect transparent trading agents, fund controlled agent vaults, and execute supported perpetual strategies through FlashTrade.

**TG username**
> t.me/inspiration_gx

**Wallet Address**
> 2Y7LZP2oaSrvM9ED2AZfz5Z6j1vLHZgeNm4JpkweCMvM

## Step 2: Details

**Project Details**
> Gildore Arena makes trading agents accountable before users put capital behind them. Rather than asking users to trust opaque signal groups or black-box bots, the arena lets them inspect an agent's market structure, setup zones, entry and invalidation logic, risk parameters, and tracked performance. Agents compete in a public product surface, so discovery is based on visible process and execution discipline rather than personality or screenshots.
>
> Solana is the execution and settlement layer of the product. Each user can fund an agent-specific SPL-token vault managed by Gildore's onchain vault program. The program derives user and agent state, records net deposits, creates a ticker with a per-agent spend allowance, charges a capped platform fee, and allows the user to withdraw uncommitted funds. When an agent has a valid setup, the execution path consumes only the configured allowance, sends USDC to an execution wallet, initializes the required FlashTrade v2 state, deposits collateral to FlashTrade, and opens the perpetual position. Execution records persist the funding, open, live-position, close, and settlement lifecycle so the arena can show what happened rather than only a final PnL number.
>
> FlashTrade is central to the product, not a future integration. Gildore's execution client resolves supported markets and direction, derives leverage and take-profit from the agent's entry and stop, validates USDC collateral, initializes the FlashTrade deposit ledger/basket/trade vault/delegation, deposits collateral, opens and later closes the venue position, and syncs position snapshots back to the arena. The current capability layer supports the arena's XAU/USD, XAG/USD, EUR/USD, and GBP/USD strategies through FlashTrade market mappings.
>
> Gildore is Solana-native while still reducing the friction for users who begin elsewhere. The currently implemented external funding route is precise: Celo-origin USDC is consumed from the user's Celo agent vault, bridged through Squid into Solana USDC for FlashTrade execution, then the settled Solana balance is bridged back to the Celo execution wallet. This gives users a cross-chain entry point while keeping perp execution and settlement accounting anchored to Solana. We are not claiming generic multi-chain support; Celo is the implemented external route today, with Solana as the destination for execution.

**Deadline**
> 1 August 2026 (Asia/Kolkata)

**Proof of Work**
> Live app: https://gildore-arena.vercel.app
>
> GitHub repository: https://github.com/inspi-writer001/gildore-arena
>
> The product already includes a public arena UI; Convex-backed agent, market, setup, and execution state; a browser-assisted chart-review worker; embedded wallet onboarding; a Solana vault program; FlashTrade v2 execution and position-sync logic; and a Celo-to-Solana USDC route through Squid.
>
> Verifiable technical artifacts in the repository:
> - `gildore-arena-vault/`: Solana vault program with agent registration, SPL-token deposits, user withdrawals, per-agent tickers, and spend caps.
> - `lib/flashtrade/v2.ts` and `convex/flashtrade.ts`: FlashTrade v2 client, collateral deposit, position open/close, lifecycle persistence, and settlement handling.
> - `lib/squid/client.ts`: Squid routing, deposit-address handling, and route-status polling for the Celo/Solana path.
> - `convex/flashtradeStore.ts` and `convex/schema.ts`: real-time execution-wallet and FlashTrade-execution records.
> - `components/arena-dashboard.tsx`: user-facing funding, spend configuration, position state, and withdrawal flows.
>
> Recent Git history demonstrates continued technical delivery, including FlashTrade integration, wallet infrastructure, Celo/EVM execution work, testing, API improvements, agent-vision improvements, and performance work.
>
> AI-assisted development proof exported to the project root:
> - `claude-session.jsonl`
> - `codex-session.jsonl`

**Personal X Profile**
> x.com/inspiration_gx

**Personal GitHub Profile**
> github.com/inspi-writer001

**Colosseum Crowdedness Score**
> Attach a screenshot from https://colosseum.com/copilot, upload it to publicly accessible storage, and paste the public link here.

**AI Session Transcript**
> Attach `claude-session.jsonl` and `codex-session.jsonl` from the project root.

## Step 3: Milestones

**Goals and Milestones**
> 1. By 23 July 2026, finish production hardening of the Solana agent-vault flow: embedded wallet onboarding, SPL-token deposits, per-agent spend configuration, onchain vault reads, and safe user withdrawals.
>
> 2. By 27 July 2026, complete the end-to-end FlashTrade execution lifecycle for supported arena strategies: setup validation, USDC collateral deposit, perpetual position open/close, live position synchronization, and persisted execution/settlement records.
>
> 3. By 30 July 2026, validate and polish the Celo-origin USDC route through Squid into Solana for FlashTrade execution, including return bridging after close and clear pending-settlement/error states.
>
> 4. By 1 August 2026, publish a grant-demo-ready Gildore Arena release where a user can discover a transparent agent, inspect its strategy trail, fund its controlled vault, configure its allowance, and follow the resulting FlashTrade execution lifecycle.

**Primary KPI**
> Number of agent-funded FlashTrade positions successfully opened and settled end-to-end.
>
> Secondary adoption metric: number of successful user deposits into agent vaults.

**Final tranche checkbox**
> To receive the final tranche, submit the Colosseum project link, GitHub repository, and AI subscription receipt.

## Submission Checklist

- Attach `claude-session.jsonl` and `codex-session.jsonl`.
- Add a public Colosseum Crowdedness Score screenshot link.
- Paste the application fields above into the grant form.
- Attach the AI subscription receipt and GitHub repository for the final tranche.
