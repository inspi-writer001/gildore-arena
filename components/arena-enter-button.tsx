"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function ArenaEnterButton({
  align = "center",
}: {
  align?: "center" | "start";
}) {
  return (
    <div
      className={`animate-fade-rise-delay-2 arena-cta-wrap mt-1! ${align === "start" ? "!justify-start" : ""}`}
    >
      <Link
        href="/arena"
        className="arena-cta-shell"
        aria-label="Enter the Arena"
      >
        <span className="arena-cta-label font-inter">Enter the Arena</span>
        <span className="arena-cta-arrow">
          <ArrowRight size={16} strokeWidth={2.5} />
        </span>
      </Link>
    </div>
  );
}
