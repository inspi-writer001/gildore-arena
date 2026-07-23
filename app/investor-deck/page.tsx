import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Investor Deck",
  description:
    "Gildore Arena's investor presentation: transparent trading agents, controlled funding, and Solana-native settlement.",
  alternates: {
    canonical: "/investor-deck",
  },
};

export default async function InvestorDeckPage() {
  const deckHtml = await readFile(
    join(process.cwd(), "pitch-deck-20260723-investor.html"),
    "utf8",
  );

  return (
    <main className="h-dvh w-screen bg-black">
      <iframe
        className="h-full w-full border-0"
        srcDoc={deckHtml}
        title="Gildore Arena investor deck"
      />
    </main>
  );
}
