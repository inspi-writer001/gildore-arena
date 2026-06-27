export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-[760px] px-6 py-16 text-[#f7efe7]">
      <h1 className="font-instrument text-[42px] font-normal leading-[0.95] text-[#fff7ea]">
        Privacy Policy
      </h1>
      <div className="mt-8 grid gap-6 font-inter text-[15px] leading-[1.7] text-[rgba(247,239,231,0.78)]">
        <p>
          This Privacy Policy describes how Gildore Arena (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;) handles information when you use the Service.
        </p>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            1. Information We Collect
          </h2>
          <p>
            We collect your wallet address when you connect to the Service.
            We do not collect names, email addresses, or phone numbers unless
            you voluntarily provide them for support purposes.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            2. On-Chain Data
          </h2>
          <p>
            All deposit and withdrawal transactions are recorded on a public
            blockchain. This information is publicly visible and immutable. We
            do not control or have the ability to modify on-chain records.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            3. Usage Data
          </h2>
          <p>
            We may collect anonymised usage data (pages visited, features
            used) to improve the Service. This data is not linked to your
            wallet address or identity.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            4. Third-Party Services
          </h2>
          <p>
            The Service integrates with third-party providers including Privy
            (wallet authentication) and Convex (database). Their respective
            privacy policies apply to data processed through their systems.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            5. Data Retention
          </h2>
          <p>
            We retain operational logs for up to 90 days for debugging and
            security purposes. Anonymised analytics may be retained
            indefinitely.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            6. Your Rights
          </h2>
          <p>
            You may request deletion of any personal data we hold about you
            by contacting us. Note that on-chain data cannot be deleted.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="font-barlow text-[13px] font-semibold uppercase tracking-[0.12em] text-[rgba(247,239,231,0.55)]">
            7. Contact
          </h2>
          <p>
            For privacy enquiries, reach us at{" "}
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
