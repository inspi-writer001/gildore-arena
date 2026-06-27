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
            3. No Warranty
          </h2>
          <p>
            The Service is provided &ldquo;as is&rdquo; without any warranties
            of any kind, express or implied. We do not guarantee uptime,
            accuracy of price data, or execution of any trade.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            4. Changes to Terms
          </h2>
          <p>
            We may update these Terms from time to time. Continued use of the
            Service after changes constitutes acceptance of the revised Terms.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            5. Contact
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
          Last updated: June 2025
        </p>
      </div>
    </main>
  );
}
