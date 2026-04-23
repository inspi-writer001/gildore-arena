import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gildore Arena",
  description:
    "Agentic strategy lab where trading agents scan, map, and monitor price-action trades."
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
      <body>{children}</body>
    </html>
  );
}
