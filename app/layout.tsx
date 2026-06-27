import type { Metadata, Viewport } from "next";
import "./globals.css";
import ConvexClientProvider from "@/components/convex-client-provider";
import { Geist, Barlow, Instrument_Serif, Inter } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-instrument",
  display: "swap",
});
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

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
        url: "/gildore-arena-white.jpg",
        type: "image/jpg",
      },
    ],
    apple: [
      {
        url: "/gildore-arena-white.jpg",
        type: "image/jpg",
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
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "font-sans overflow-x-hidden",
        geist.variable,
        barlow.variable,
        instrumentSerif.variable,
        inter.variable,
      )}
    >
      <head>
        <link rel="preconnect" href="https://auth.privy.io" />
        <link rel="preconnect" href="https://explorer-api.walletconnect.com" />
      </head>
      <body className="overflow-x-hidden">
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
