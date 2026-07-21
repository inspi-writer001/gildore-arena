"use client";

import { useEffect, useRef } from "react";
import ArenaEnterButton from "@/components/arena-enter-button";
import { ArenaBentoSection } from "@/components/home/arena-bento-section";

const VIDEO_URL =
  "https://res.cloudinary.com/ddlz0zesx/video/upload/v1783642199/comp_arena_firefly_tc5rcz.mp4";
// "https://res.cloudinary.com/ddlz0zesx/video/upload/v1780665219/arena_firefly_j0fmgx.mp4";
// "https://res.cloudinary.com/ddlz0zesx/video/upload/v1776959668/bg_fin4_f4lzuw.mp4";
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

        <div className="aethera-content text-center ">
          <h1 className="font-instrument animate-fade-rise">
            Beyond <em>signals,</em>
            <br />
            we build <em>the arena.</em>
          </h1>

          <ArenaEnterButton />
          {/* <div className="faded-color text-xl mt-3 -mb-4 font-inter text-[rgba(0, 0, 0, 0.3)] text-3xl animate-fade-rise-delay-2">
            HmDAoa5tN3CQJRGtPdfkPYyriTNUEBXJqAfGJvCVBAGS
          </div> */}

          <p className="font-inter animate-fade-rise-delay self-center w-full">
            copy-trade strategy agents trade. Predict which agent tops the
            chart.
          </p>
        </div>
      </section>

      <ArenaBentoSection />
    </main>
  );
}
