# Gildore Arena — Agentic Engineering Grant Application

Grant link: https://superteam.fun/earn/grants/agentic-engineering

## Step 1: Basics

**Project Title**
> Gildore Arena

**One Line Description**
> Gildore Arena is an agentic trading arena on Solana where users inspect, compare, fund, and eventually back transparent trading agents with visible strategy trails.

**TG username**
> t.me/inspiration_gx

**Wallet Address**
> 2Y7LZP2oaSrvM9ED2AZfz5Z6j1vLHZgeNm4JpkweCMvM

## Step 2: Details

**Project Details**
> Gildore Arena is building a new consumer trading surface on Solana. Instead of asking users to trust opaque signal groups, fund managers, or black-box bots, it turns trading strategies into transparent agents that compete in public. Each agent leaves a visible trail behind its decisions, including chart structure, setup zones, review state, and reasoning, so users can inspect process before judging outcome.
>
> The current product is already public in beta and getting iterative feedback. Users can enter the arena, inspect named trading agents, compare them on a leaderboard, view strategy-specific chart logic, and interact with a real-time backend that tracks agent state, market state, review sessions, and setup lifecycles. Under the hood, Gildore Arena combines deterministic strategy engines with browser-assisted chart review, which lets the system evaluate structure in a more human-like way while still keeping the workflow disciplined and reproducible.
>
> On the Solana side, the core DeFi direction is already known and in motion. The app includes embedded Solana wallets via Privy, a dedicated onchain vault program for funding agents and registering spend controls, and a clear path toward execution and deeper financial participation using Solana-native rails such as Flash Trade. The remaining work is not discovering the architecture from scratch; it is tightening the integration and productizing the flow end to end.
>
> This grant would help complete that transition from strong prototype to sharper Solana product: harden the agent funding and spend-control flows, connect the current arena experience more directly to DeFi execution rails, and ship a cleaner end-to-end user experience where transparent agent performance becomes something users can actively participate in on Solana.

**Deadline**
> 3 July 2026

**Proof of Work**
> Live app: https://gildore-arena.vercel.app
>
> GitHub repo: github.com/inspi-writer001/gildore-arena
>
> Current shipped artifacts:
> - Live arena interface with leaderboard and selected-agent analysis views
> - Convex backend managing agents, markets, browser sessions, setup lifecycles, and analysis jobs
> - Worker process for automated browser-review execution
> - Playwright-based browser runtime for chart inspection and streamed session playback
> - Solana vault program under gildore-arena-vault/
> - Embedded wallet onboarding through Privy
> - Transaction prep/submission layer for agent funding and ticker registration
>
> Key implementation files:
> - Arena UI: app/page.tsx, app/arena/page.tsx, components/arena-dashboard.tsx
> - Browser review runtime: lib/browser-session-runtime.ts
> - Vision/chart analysis: lib/chart-vision-analysis.ts
> - Convex orchestration: convex/arena.ts, convex/schema.ts
> - Worker: worker/src/index.ts
> - Solana vault program: gildore-arena-vault/src/lib.rs
> - Solana transaction integration: lib/solana/gildore-vault.ts, lib/solana/server-gildore-vault.ts
>
> Recent development history from git:
> - 5adb191 fix: making changes to agent vision
> - d2c23b0 fix: removed dangling processes on cron
> - b0a96d4 fix: making changes to api
> - f02f3e0 fix: modifying and adding new tracked markets
> - 4ef1bdf fix: making changes so it doesn't block agent data persistence
> - 59a0dd1 fix: updating patch for DO
> - 07f4827 fix: making backend changes
>
> AI-assisted development transcripts exported to project root:
> - claude-session.jsonl
> - codex-session.jsonl

**Personal X Profile**
> x.com/inspiration_gx

**Personal GitHub Profile**
> github.com/inspi-writer001

**Colosseum Crowdedness Score**
> [Attach: screenshot from https://colosseum.com/copilot, uploaded as a public Google Drive link]

**AI Session Transcript**
> Attached: ./claude-session.jsonl and ./codex-session.jsonl

## Step 3: Milestones

**Goals and Milestones**
> 1. By 26 June 2026, finalize the current Solana agent funding loop so users can reliably create or use their embedded wallet, fund an agent vault, and register per-agent spend controls without friction.
> 2. By 29 June 2026, connect the existing arena and analysis layer more directly to the chosen DeFi execution rails, including Flash Trade-related integration points and clearer execution-ready state for supported agents.
> 3. By 1 July 2026, polish the live product flow so users can move cleanly from discovering agents, to inspecting chart logic, to funding and preparing participation on Solana inside one coherent experience.
> 4. By 3 July 2026, ship a grant-demo-ready version of Gildore Arena at gildore-arena.vercel.app that demonstrates transparent agent analysis plus working Solana funding and execution-oriented infrastructure.

**Primary KPI**
> Number of successful onchain user funding actions completed for agent vaults in Gildore Arena.

**Final tranche checkbox**
> To receive the final tranche: submit the Colosseum project link, GitHub repo, and AI subscription receipt.

## Submission Notes

Files to have ready:
- claude-session.jsonl
- codex-session.jsonl
- Crowdedness Score screenshot link
- This application text
