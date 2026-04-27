"use client";

import { LinearGradient, Shader } from "shaders/react";

export default function ShaderSmokeTest() {
  return (
    <div className="grid gap-6 w-[min(960px,100%)] mx-auto">
      <div className="grid gap-[10px]">
        <p className="m-0 text-[rgba(255,255,255,0.54)] text-[12px] font-semibold tracking-[0.16em] uppercase">
          Minimal repro
        </p>
        <h1 className="font-instrument m-0 text-[clamp(36px,6vw,64px)] font-normal leading-[0.95] tracking-[-0.8px]">
          Shaders smoke test
        </h1>
        <p className="font-inter max-w-[760px] m-0 text-[rgba(255,255,255,0.72)] text-[16px] leading-[1.7]">
          This route renders the smallest possible Shaders example in this app:
          one <code className="font-barlow text-white">{`<Shader>`}</code> with one{" "}
          <code className="font-barlow text-white">{`<LinearGradient>`}</code>.
        </p>
      </div>

      <div className="overflow-hidden border border-[rgba(255,255,255,0.12)] rounded-[16px] bg-[rgba(255,255,255,0.03)]">
        <Shader className="w-full h-[420px]" colorSpace="srgb" disableTelemetry>
          <LinearGradient colorA="#0f172a" colorB="#7c3aed" />
        </Shader>
      </div>
    </div>
  );
}
