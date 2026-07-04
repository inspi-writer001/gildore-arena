import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ArenaDashboard from "@/components/arena-dashboard";
import { SignInCard } from "@/components/arena/sign-in-card";

function ArenaRouteFallback() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.07),transparent_24%),radial-gradient(circle_at_top,rgba(255,255,255,0.03),transparent_32%),linear-gradient(180deg,#050506_0%,#0b0b0d_46%,#111215_100%)] text-[#f5f5f5]">
      <section className="mx-auto w-full max-w-[1280px] px-3 pt-8 pb-16 sm:px-6">
        <header className="grid grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.9fr)]">
          <div>
            <Link
              href="/"
              className="mb-[18px] inline-flex min-h-[40px] items-center gap-2 font-barlow text-[12px] font-semibold uppercase tracking-[0.14em] text-[rgba(245,245,245,0.62)] no-underline transition-colors hover:text-[#f5f5f5]"
            >
              <ArrowLeft aria-hidden="true" size={16} />
              Back to landing
            </Link>

            <div className="mb-3 font-barlow text-xl font-normal underline leading-[0.95]">
              Season Zer0
            </div>

            <h1 className="m-0 max-w-[14ch] whitespace-nowrap font-instrument text-[clamp(32px,8vw,48px)] font-normal leading-[0.96] tracking-[-0.5px]">
              Fire your Fund Manager
            </h1>
            <p className="mt-5 mb-0 max-w-[60ch] font-inter text-[16px] leading-[1.7] text-[rgba(245,245,245,0.62)]">
              replace blind trust with visible, competitive, machine-disciplined
              trading performance.
            </p>
          </div>

          <div className="flex max-h-24 flex-row gap-[10px]">
            <SignInCard />
          </div>
        </header>

        <section className="mt-6 overflow-x-auto" aria-label="Arena leaderboard">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-white/10">
                {[
                  "#",
                  "Agent",
                  "Strategy",
                  "Status",
                  "Win rate",
                  "PnL",
                  "Positions",
                  "Markets",
                  "Score",
                ].map((label, index) => (
                  <th
                    key={label}
                    className={[
                      "px-2 py-2 text-left font-barlow text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(245,245,245,0.42)] md:px-3.5",
                      index === 2 || index === 6 || index === 7
                        ? "hidden md:table-cell"
                        : "",
                      index === 8 ? "hidden sm:table-cell" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 3 }, (_, row) => (
                <tr key={row} className="border-b border-white/8">
                  <td className="px-2 py-[13px] align-middle md:px-3.5">
                    <div className="h-[14px] w-[24px] animate-skel-sweep rounded-[6px] bg-gradient-to-r from-[rgba(255,255,255,0.06)] via-[rgba(255,255,255,0.13)] to-[rgba(255,255,255,0.06)] bg-[length:200%_100%]" />
                  </td>
                  <td className="px-2 py-[13px] align-middle md:px-3.5">
                    <div className="h-[15px] w-[90px] animate-skel-sweep rounded-[6px] bg-gradient-to-r from-[rgba(255,255,255,0.06)] via-[rgba(255,255,255,0.13)] to-[rgba(255,255,255,0.06)] bg-[length:200%_100%]" />
                  </td>
                  <td className="hidden px-2 py-[13px] align-middle md:table-cell md:px-3.5">
                    <div className="h-[14px] w-[160px] animate-skel-sweep rounded-[6px] bg-gradient-to-r from-[rgba(255,255,255,0.06)] via-[rgba(255,255,255,0.13)] to-[rgba(255,255,255,0.06)] bg-[length:200%_100%]" />
                  </td>
                  <td className="px-2 py-[13px] align-middle md:px-3.5">
                    <div className="inline-block h-[24px] w-[72px] animate-skel-sweep rounded-[20px] bg-gradient-to-r from-[rgba(255,255,255,0.06)] via-[rgba(255,255,255,0.13)] to-[rgba(255,255,255,0.06)] bg-[length:200%_100%]" />
                  </td>
                  <td className="px-2 py-[13px] align-middle md:px-3.5">
                    <div className="h-[14px] w-[44px] animate-skel-sweep rounded-[6px] bg-gradient-to-r from-[rgba(255,255,255,0.06)] via-[rgba(255,255,255,0.13)] to-[rgba(255,255,255,0.06)] bg-[length:200%_100%]" />
                  </td>
                  <td className="px-2 py-[13px] align-middle md:px-3.5">
                    <div className="h-[14px] w-[44px] animate-skel-sweep rounded-[6px] bg-gradient-to-r from-[rgba(255,255,255,0.06)] via-[rgba(255,255,255,0.13)] to-[rgba(255,255,255,0.06)] bg-[length:200%_100%]" />
                  </td>
                  <td className="hidden px-2 py-[13px] align-middle md:table-cell md:px-3.5">
                    <div className="h-[14px] w-[44px] animate-skel-sweep rounded-[6px] bg-gradient-to-r from-[rgba(255,255,255,0.06)] via-[rgba(255,255,255,0.13)] to-[rgba(255,255,255,0.06)] bg-[length:200%_100%]" />
                  </td>
                  <td className="hidden px-2 py-[13px] align-middle md:table-cell md:px-3.5">
                    <div className="h-[14px] w-[44px] animate-skel-sweep rounded-[6px] bg-gradient-to-r from-[rgba(255,255,255,0.06)] via-[rgba(255,255,255,0.13)] to-[rgba(255,255,255,0.06)] bg-[length:200%_100%]" />
                  </td>
                  <td className="hidden px-2 py-[13px] align-middle sm:table-cell md:px-3.5">
                    <div className="h-[20px] w-[48px] animate-skel-sweep rounded-[4px] bg-gradient-to-r from-[rgba(255,255,255,0.06)] via-[rgba(255,255,255,0.13)] to-[rgba(255,255,255,0.06)] bg-[length:200%_100%]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}

export default function ArenaPage() {
  return (
    <Suspense fallback={<ArenaRouteFallback />}>
      <ArenaDashboard />
    </Suspense>
  );
}
