"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

const TOKEN_CA_URL =
  "https://bags.fm/HmDAoa5tN3CQJRGtPdfkPYyriTNUEBXJqAfGJvCVBAGS";
const X_URL = "https://x.com/gildore_arena";
const TELEGRAM_URL = "https://t.me/gildore_arena";

export function ArenaFooter() {
  return (
    <footer className="arena-shell pb-8 pt-4">
      <div className="grid gap-8 px-1 py-5 sm:px-2 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:gap-10 lg:py-7">
        <div className="grid gap-6">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 font-barlow text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgba(45,21,7,0.56)]">
            <Link href="/terms" className="transition hover:text-[#2d1507]">
              Terms
            </Link>
            <Link href="/privacy" className="transition hover:text-[#2d1507]">
              Privacy
            </Link>
            <a
              href={X_URL}
              target="_top"
              rel="noopener noreferrer"
              className="transition hover:text-[#2d1507]"
            >
              X / Updates
            </a>
            <a
              href={TELEGRAM_URL}
              target="_top"
              rel="noopener noreferrer"
              className="transition hover:text-[#2d1507]"
            >
              Telegram
            </a>
          </div>

          <div className="grid gap-3">
            <h2 className="m-0 max-w-[12ch] font-barlow text-[clamp(38px,8vw,82px)] font-semibold uppercase leading-[0.88] tracking-[-0.08em] text-[#13100d] [text-shadow:1px_0_0_#13100d,-1px_0_0_#13100d,0_1px_0_#13100d,0_-1px_0_#13100d] sm:[text-shadow:2px_0_0_#13100d,-2px_0_0_#13100d,0_2px_0_#13100d,0_-2px_0_#13100d]">
              Gildore Arena.
            </h2>
            <p className="m-0 max-w-[34ch] font-inter text-[14px] leading-[1.7] text-[#7a5830]">
              You could say it's now safe to Fire your Fund Manager
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:justify-items-end">
          <div className="grid gap-1 font-inter text-[13px] leading-[1.55] text-[#5f4731] lg:text-right">
            <span className="font-barlow text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgba(45,21,7,0.56)]">
              Token CA
            </span>
            <a
              href={TOKEN_CA_URL}
              target="_top"
              rel="noopener noreferrer"
              className="break-all underline underline-offset-2 transition hover:text-[#2d1507]"
            >
              HmDAoa5tN3CQJRGtPdfkPYyriTNUEBXJqAfGJvCVBAGS
            </a>
          </div>

          <a
            href="/arena"
            target="_top"
            className="flex w-full max-w-[280px] items-center justify-between bg-[#11100e] px-4 py-4 font-barlow text-[12px] font-semibold uppercase tracking-[0.14em] text-[#f6f0e3] transition hover:bg-[#1a1713]"
          >
            <span>Enter the Arena</span>
            <span aria-hidden="true">
              <ArrowRight size={16} strokeWidth={2.5} />
            </span>
          </a>
        </div>
      </div>
    </footer>
  );
}
