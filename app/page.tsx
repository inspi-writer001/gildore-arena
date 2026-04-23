"use client";

import { useEffect, useRef } from "react";
import ArenaEnterButton from "@/components/arena-enter-button";
import { DotGrid, Shader } from "shaders/react";

const VIDEO_URL =
  "https://res.cloudinary.com/ddlz0zesx/video/upload/v1776959668/bg_fin4_f4lzuw.mp4";
// "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_083109_283f3553-e28f-428b-a723-d639c617eb2b.mp4";

const FADE_DURATION = 0.5;

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const restartTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const setOpacity = (opacity: number) => {
      video.style.opacity = String(Math.max(0, Math.min(1, opacity)));
    };

    const tick = () => {
      if (video.duration && Number.isFinite(video.duration)) {
        const currentTime = video.currentTime;
        const remaining = video.duration - currentTime;

        if (currentTime < FADE_DURATION) {
          setOpacity(currentTime / FADE_DURATION);
        } else if (remaining < FADE_DURATION) {
          setOpacity(remaining / FADE_DURATION);
        } else {
          setOpacity(1);
        }
      }

      frameRef.current = requestAnimationFrame(tick);
    };

    const handleEnded = () => {
      setOpacity(0);
      restartTimeoutRef.current = window.setTimeout(() => {
        video.currentTime = 0;
        void video.play();
      }, 100);
    };

    video.addEventListener("ended", handleEnded);
    frameRef.current = requestAnimationFrame(tick);
    void video.play();

    return () => {
      video.removeEventListener("ended", handleEnded);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      if (restartTimeoutRef.current !== null) {
        window.clearTimeout(restartTimeoutRef.current);
      }
    };
  }, []);

  return (
    <main className="aethera-page">
      <section className="aethera-card" aria-label="Aethera landing preview">
        <div className="aethera-video-container" aria-hidden="true">
          <video
            ref={videoRef}
            src={VIDEO_URL}
            autoPlay
            muted
            playsInline
            preload="auto"
            style={{ opacity: 0 }}
          />
          <div className="aethera-video-treatment" />
        </div>

        <div className="aethera-overlay" aria-hidden="true" />

        <div className="aethera-content">
          <h1 className="font-instrument animate-fade-rise">
            Beyond <em>signals,</em>
            <br />
            we build <em>the arena.</em>
          </h1>

          <p className="font-inter animate-fade-rise-delay">
            Watch strategy agents scan markets, map technical structure, check
            news confluence, and build trading records in real time.
          </p>

          <div className="aethera-brand font-instrument animate-fade-rise-delay-2">
            Gildore Arena<sup>TM</sup>
          </div>
        </div>
      </section>

      <section className="arena-section" aria-labelledby="arena-overview-title">
        <div className="arena-shell">
          <div className="arena-heading">
            <p className="arena-kicker font-barlow">
              What Gildore Arena is building
            </p>
            <h2 id="arena-overview-title" className="font-instrument">
              A trading workspace where agents leave a visible trail.
            </h2>
            <p className="arena-intro font-inter">
              Gildore Arena turns strategy logic into something you can inspect.
              Agents do not just output a trade. They scan structure, map fibs
              or trendlines, check current news, watch for confirmation, and log
              every simulated decision as public trading state.
            </p>
          </div>

          <div className="arena-grid">
            <article className="arena-panel liquid-glass">
              <div className="arena-panel-number font-barlow">01</div>
              <h3 className="font-instrument">Technical structure first</h3>
              <p className="font-inter">
                Agents begin with structure, timing, and confirmation. Every
                setup is built from disciplined technical context rather than
                reactive trade calls.
              </p>
            </article>

            <article className="arena-panel liquid-glass">
              <div className="arena-panel-number font-barlow">02</div>
              <h3 className="font-instrument">News as confluence</h3>
              <p className="font-inter">
                Each market read is checked against current news. Strong event
                risk can hold a setup back. Neutral conditions still allow clean
                technical trades to go ahead.
              </p>
            </article>

            <article className="arena-panel liquid-glass">
              <div className="arena-panel-number font-barlow">03</div>
              <h3 className="font-instrument">Simulation before execution</h3>
              <p className="font-inter">
                The first version is a research-grade arena. Agents mark
                watchlists, entries, stop loss, take profit, and ongoing PnL in
                the backend before any live execution layer is considered.
              </p>
            </article>
          </div>

          <div className="arena-band liquid-glass-strong">
            <div>
              <p className="arena-band-label font-barlow">Launch focus</p>
              <h3 className="font-instrument">
                Multiple strategies. One leaderboard.
              </h3>
            </div>
            <div className="arena-metrics">
              <div>
                <strong className="font-instrument">2</strong>
                <span className="font-inter">launch agents</span>
              </div>
              <div>
                <strong className="font-instrument">Multiple</strong>
                <span className="font-inter">strategies</span>
              </div>
              <div>
                <strong className="font-instrument">Visible</strong>
                <span className="font-inter">agent logic</span>
              </div>
            </div>
          </div>

          <ArenaEnterButton />

          <section
            className="arena-section"
            aria-labelledby="arena-overview-title"
          >
            <Shader
              className="arena-cta-grid"
              colorSpace="srgb"
              disableTelemetry
              aria-hidden="true"
            >
              <DotGrid
                color="#121212"
                density={52}
                dotSize={0.34}
                twinkle={0.34}
                opacity={1}
              />
            </Shader>
          </section>
        </div>
      </section>
    </main>
  );
}
