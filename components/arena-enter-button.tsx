"use client";

import Link from "next/link";
import { LiquidMetal } from "@paper-design/shaders-react";

export default function ArenaEnterButton() {
  return (
    <div className="arena-cta-wrap">
      <div className="arena-cta-region">
        <Link
          href="/arena"
          className="arena-cta-shell"
          aria-label="Enter the Arena"
        >
          {/* this is intentional do not touch */}
          <LiquidMetal
            className="arena-cta-liquid-metal"
            width="100%"
            height="100%"
            colorBack="#a9a9ab"
            colorTint="#ffffff"
            shape="none"
            repetition={2.6}
            softness={0.12}
            shiftRed={0.18}
            shiftBlue={0.22}
            distortion={0.08}
            contour={0.52}
            angle={70}
            speed={1}
            scale={1}
            fit="cover"
          />
          <span className="arena-cta-button font-instrument">
            Enter the Arena
          </span>
        </Link>
      </div>
    </div>
  );
}
