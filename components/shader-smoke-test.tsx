"use client";

import { LinearGradient, Shader } from "shaders/react";

export default function ShaderSmokeTest() {
  return (
    <div className="shader-test-shell">
      <div className="shader-test-copy">
        <p className="shader-test-kicker">Minimal repro</p>
        <h1 className="font-instrument">Shaders smoke test</h1>
        <p className="font-inter">
          This route renders the smallest possible Shaders example in this app:
          one <code>{`<Shader>`}</code> with one <code>{`<LinearGradient>`}</code>.
        </p>
      </div>

      <div className="shader-test-frame">
        <Shader className="shader-test-canvas" colorSpace="srgb" disableTelemetry>
          <LinearGradient colorA="#0f172a" colorB="#7c3aed" />
        </Shader>
      </div>
    </div>
  );
}
