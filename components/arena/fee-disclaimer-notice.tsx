"use client";

import { useState } from "react";

const FEE_DISCLAIMER_DISMISSED_KEY = "gildore:fee-disclaimer-dismissed:v1";

export function useFeeDisclaimerVisible() {
  return useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(FEE_DISCLAIMER_DISMISSED_KEY) !== "1";
  });
}

export function FeeDisclaimerNotice({
  isCelo = false,
  className,
  textClassName,
  linkClassName,
  buttonClassName,
}: {
  isCelo?: boolean;
  className?: string;
  textClassName?: string;
  linkClassName?: string;
  buttonClassName?: string;
}) {
  const [isVisible, setIsVisible] = useFeeDisclaimerVisible();

  if (!isVisible) return null;

  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-3">
        <p className={textClassName}>
          Final received amounts may be lower than displayed after gas, bridge,
          execution, slippage, and applicable platform fees.{" "}
          {isCelo
            ? "Celo-origin funds may be bridged across networks before execution and back again for settlement."
            : "Execution and settlement routes may still introduce external costs."}{" "}
          <a href="/terms" target="_top" className={linkClassName}>
            Terms apply
          </a>
          .
        </p>
        <button
          type="button"
          aria-label="Dismiss fee notice"
          className={buttonClassName}
          onClick={() => {
            window.localStorage.setItem(FEE_DISCLAIMER_DISMISSED_KEY, "1");
            setIsVisible(false);
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
