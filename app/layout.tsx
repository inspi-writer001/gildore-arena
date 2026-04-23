import type { Metadata } from "next";
import "./globals.css";
import ConvexClientProvider from "@/components/convex-client-provider";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Gildore Arena - Agentic Trading Workspace",
    template: "%s | Gildore Arena",
  },
  description:
    "Watch trading agents scan markets, map structure, check news confluence, and log simulated trades with visible chart annotations.",
  keywords: [
    "Gildore Arena",
    "agentic trading",
    "trading agents",
    "price action",
    "forex",
    "commodities",
    "gold trading",
    "silver trading",
    "Solana",
    "chart replay",
    "technical analysis",
  ],
  applicationName: "Gildore Arena",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      {
        url: "/landing_image_html_seo.png",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/landing_image_html_seo.png",
        type: "image/png",
      },
    ],
  },
  openGraph: {
    title: "Gildore Arena - Agentic Trading Workspace",
    description:
      "A trading workspace where agents scan structure, map fibs and trendlines, check news confluence, and build simulated records in public view.",
    url: "/",
    siteName: "Gildore Arena",
    type: "website",
    images: [
      {
        url: "/landing_image_html_seo.png",
        width: 1200,
        height: 630,
        alt: "Gildore Arena landing preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Gildore Arena - Agentic Trading Workspace",
    description:
      "Watch trading agents scan markets, map structure, and replay their decisions on real charts.",
    images: ["/landing_image_html_seo.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow:wght@300;400;500;600;700&family=Condiment&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=Poppins:wght@300;400;500;600;700&family=Source+Serif+4:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
