export default function TermsPage() {
  return (
    <main className="mx-auto max-w-[760px] px-6 py-16 text-[#f7efe7]">
      <h1 className="font-instrument text-[42px] font-normal leading-[0.95] text-[#fff7ea]">
        Terms of Service
      </h1>
      <div className="mt-8 grid gap-6 font-inter text-[15px] leading-[1.7] text-[rgba(247,239,231,0.78)]">
        <p>
          By accessing or using Gildore Arena (&ldquo;the Service&rdquo;), you
          agree to be bound by these Terms of Service. If you do not agree,
          please do not use the Service.
        </p>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            1. Use of the Service
          </h2>
          <p>
            Gildore Arena is a trading simulation and agent-funding platform.
            You must be at least 18 years old to use the Service. You are
            responsible for all activity conducted under your wallet address.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            2. Financial Risk
          </h2>
          <p>
            Depositing digital assets involves significant financial risk.
            Past performance of trading agents is not indicative of future
            results. You may lose some or all funds deposited.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            3. Fees, Network Costs, and Bridging
          </h2>
          <p>
            The Service may rely on third-party wallets, bridges, relayers,
            executors, exchanges, and settlement infrastructure to move assets
            across networks or complete an execution flow. When assets are
            moved, executed, bridged, settled, recovered, or withdrawn through
            the Service, the final amount you receive may be less than the
            original, gross, estimated, or displayed amount.
          </p>
          <p>
            Deductions, costs, or value differences may include blockchain gas
            fees, transaction fees, bridge fees, relayer or messaging fees,
            venue or execution fees, swap or conversion costs, slippage, price
            impact, spread, third-party charges, and any applicable platform
            fees. These amounts may vary by network, token, route, liquidity,
            market volatility, and third-party provider behaviour.
          </p>
          <p>
            By using the Service, you authorise Gildore Arena and its
            integration partners to route assets and incur or deduct such
            amounts as reasonably necessary to complete funding, execution,
            bridging, settlement, recovery, and withdrawal.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            4. Third-Party Infrastructure
          </h2>
          <p>
            Parts of the Service depend on third-party infrastructure. Route
            changes, delays, failed transfers, partial fills, stale quotes,
            settlement mismatches, or higher-than-expected costs may occur
            outside our control. We do not guarantee a specific bridge path,
            execution venue, settlement amount, or settlement time.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            5. No Warranty
          </h2>
          <p>
            The Service is provided &ldquo;as is&rdquo; without any warranties
            of any kind, express or implied. We do not guarantee uptime,
            accuracy of price data, execution of any trade, exact settlement
            amount, successful cross-network delivery, or that quoted or
            displayed values will match final delivered amounts.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            6. Changes to Terms
          </h2>
          <p>
            We may update these Terms from time to time. Continued use of the
            Service after changes constitutes acceptance of the revised Terms.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            7. Contact
          </h2>
          <p>
            For questions about these Terms, contact us at{" "}
            <a
              href="https://t.me/gildorearena"
              target="_top"
              rel="noopener noreferrer"
              className="text-[rgba(247,239,231,0.72)] underline underline-offset-2 hover:text-[#fff7ea]"
            >
              t.me/gildorearena
            </a>
            .
          </p>
        </section>

        <p className="text-[rgba(247,239,231,0.38)] text-[13px]">
          Last updated: July 2026
        </p>
      </div>
    </main>
  );
}
