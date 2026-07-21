"use client";

import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

type BentoCard = {
  id: string;
  title: string;
  description?: string;
  layoutClassName: string;
  frameTone: "dark" | "light" | "warm";
  badgeSrc?: string;
  isCta?: boolean;
  media?: {
    type: "image" | "video";
    src: string;
    alt: string;
    width: number;
    height: number;
    frameClassName?: string;
    objectClassName?: string;
    showChrome?: boolean;
  };
};

const CARDS: BentoCard[] = [
  {
    id: "observe",
    title: "Observe the trail",
    description:
      "Stream the actions the agent takes and see its workspace before you commit capital.",
    layoutClassName: "lg:col-span-5",
    frameTone: "dark",
    badgeSrc: "/bento-steps/1-char.png",
    media: {
      type: "image",
      src: "/bento-steps/step-1-observe.gif",
      alt: "Gildore Arena observe trail walkthrough",
      width: 800,
      height: 466,
      frameClassName: "aspect-[800/466]",
      objectClassName: "object-cover object-center",
      showChrome: true,
    },
  },
  {
    id: "review",
    title: "Review the setup",
    description:
      "Check structure, confluence, and the reason behind the trade instead of trusting a black box.",
    layoutClassName: "lg:col-span-7",
    frameTone: "light",
    badgeSrc: "/bento-steps/2-char.png",
    media: {
      type: "image",
      src: "/bento-steps/step-2.png",
      alt: "Gildore Arena strategy review crop",
      width: 1216,
      height: 474,
      frameClassName: "aspect-[1216/474]",
      objectClassName: "object-cover object-center",
      showChrome: false,
    },
  },
  {
    id: "fund",
    title: "Fund only after conviction",
    description:
      "If the reasoning holds up, fund the agent. Capital follows visible logic, not blind promises.",
    layoutClassName: "lg:col-span-7",
    frameTone: "warm",
    badgeSrc: "/bento-steps/3-char.png",
    media: {
      type: "video",
      src: "/bento-steps/step-3-fund-agent.mp4",
      alt: "Gildore Arena fund agent flow",
      width: 410,
      height: 130,
      frameClassName: "aspect-[410/130]",
      objectClassName: "object-cover object-center",
      showChrome: false,
    },
  },
  {
    id: "conjure",
    title: "Conjure execution",
    description: "Conjure to stream Agents trails",
    layoutClassName: "lg:-mt-14 lg:col-span-5",
    frameTone: "dark",
    badgeSrc: "/bento-steps/4-char.png",
    media: {
      type: "video",
      src: "/bento-steps/step-1-conjure-kairos.mp4",
      alt: "Gildore Arena conjure execution flow",
      width: 376,
      height: 198,
      frameClassName: "aspect-[376/198]",
      objectClassName: "object-cover object-center",
      showChrome: true,
    },
  },
  {
    id: "cta",
    title: "Enter the Arena",
    layoutClassName: "lg:col-span-12",
    frameTone: "light",
    isCta: true,
  },
];

function BentoMediaFrame({
  tone,
  media,
}: {
  tone: BentoCard["frameTone"];
  media?: BentoCard["media"];
}) {
  const toneClassName =
    tone === "light"
      ? "border-[rgba(55,36,22,0.14)] bg-[linear-gradient(180deg,#fff8ee_0%,#f2e3c9_100%)]"
      : tone === "warm"
        ? "border-[rgba(124,70,29,0.18)] bg-[linear-gradient(180deg,#f4d19d_0%,#cb954b_100%)]"
        : "border-[rgba(255,236,205,0.12)] bg-[linear-gradient(180deg,#0b0b0e_0%,#18181c_100%)]";

  const chromeClassName =
    tone === "dark"
      ? "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)]"
      : "border-[rgba(55,36,22,0.12)] bg-[rgba(255,255,255,0.52)]";

  const textClassName =
    tone === "dark"
      ? "text-[rgba(247,239,231,0.62)]"
      : "text-[rgba(45,21,7,0.58)]";

  if (media) {
    const chromeBar = (
      <div className="flex h-[52px] items-center justify-end border-b border-inherit px-4 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.01))]">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-2 rounded-full",
              tone === "dark" ? "bg-[#c8914a]" : "bg-[#7a5830]/45",
            )}
          />
          <span
            className={cn(
              "size-2 rounded-full",
              tone === "dark" ? "bg-white/20" : "bg-[#7a5830]/25",
            )}
          />
          <span
            className={cn(
              "size-2 rounded-full",
              tone === "dark" ? "bg-white/10" : "bg-[#7a5830]/15",
            )}
          />
        </div>
      </div>
    );

    return (
      <div
        className={cn(
          "overflow-hidden rounded-[22px] border shadow-[0_18px_40px_rgba(45,21,7,0.08)]",
          toneClassName,
        )}
      >
        {media.showChrome !== false ? chromeBar : null}

        <div
          className={cn(
            "relative w-full overflow-hidden",
            media.frameClassName ?? "aspect-[16/9]",
          )}
        >
          {media.type === "image" ? (
            <Image
              src={media.src}
              alt={media.alt}
              fill
              sizes="(max-width: 1024px) 100vw, 40vw"
              className={cn(
                "absolute inset-0 h-full w-full",
                media.objectClassName ?? "object-contain object-center",
              )}
            />
          ) : (
            <video
              src={media.src}
              aria-label={media.alt}
              autoPlay
              muted
              loop
              playsInline
              className={cn(
                "absolute inset-0 h-full w-full",
                media.objectClassName ?? "object-contain object-center",
              )}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative min-h-[180px] overflow-hidden rounded-[22px] border p-4 shadow-[0_18px_40px_rgba(45,21,7,0.08)]",
        toneClassName,
        tone === "dark"
          ? "bg-[radial-gradient(circle_at_top,rgba(200,145,74,0.14),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]"
          : tone === "warm"
            ? "bg-[radial-gradient(circle_at_20%_20%,rgba(255,248,232,0.62),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0))]"
            : "bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.28),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.02))]",
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <span
          className={cn(
            "inline-flex h-8 items-center rounded-full border px-3 font-barlow text-[11px] font-semibold",
            textClassName,
            chromeClassName,
          )}
        >
          {tone === "warm"
            ? "Fund this agent"
            : tone === "light"
              ? "Strategy context"
              : "Arena dashboard"}
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-2 rounded-full",
              tone === "dark" ? "bg-[#c8914a]" : "bg-[#7a5830]/45",
            )}
          />
          <span
            className={cn(
              "size-2 rounded-full",
              tone === "dark" ? "bg-white/20" : "bg-[#7a5830]/25",
            )}
          />
          <span
            className={cn(
              "size-2 rounded-full",
              tone === "dark" ? "bg-white/10" : "bg-[#7a5830]/15",
            )}
          />
        </div>
      </div>

      <div className="grid gap-3">
        <div
          className={cn(
            "h-4 w-[58%] rounded-full",
            tone === "dark" ? "bg-white/[0.08]" : "bg-[rgba(45,21,7,0.1)]",
          )}
        />
        <div
          className={cn(
            "h-4 w-[72%] rounded-full",
            tone === "dark" ? "bg-white/[0.06]" : "bg-[rgba(45,21,7,0.08)]",
          )}
        />
        <div
          className={cn(
            "grid grid-cols-3 gap-2",
            tone === "dark"
              ? "text-[rgba(247,239,231,0.68)]"
              : "text-[rgba(45,21,7,0.66)]",
          )}
        >
          <div className={cn("rounded-[14px] border p-3", chromeClassName)}>
            <div className="font-barlow text-[10px] uppercase tracking-[0.14em] opacity-55">
              Status
            </div>
            <div className="mt-2 font-instrument text-[18px] leading-none">
              Ready
            </div>
          </div>
          <div className={cn("rounded-[14px] border p-3", chromeClassName)}>
            <div className="font-barlow text-[10px] uppercase tracking-[0.14em] opacity-55">
              PnL
            </div>
            <div className="mt-2 font-instrument text-[18px] leading-none">
              +0.0%
            </div>
          </div>
          <div className={cn("rounded-[14px] border p-3", chromeClassName)}>
            <div className="font-barlow text-[10px] uppercase tracking-[0.14em] opacity-55">
              Route
            </div>
            <div className="mt-2 font-instrument text-[18px] leading-none">
              Live
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ArenaBentoSection() {
  return (
    <section className="arena-section" aria-label="How Gildore Arena works">
      <div className="arena-shell">
        <div className="grid auto-rows-[minmax(220px,auto)] grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-12">
          {CARDS.map((card) => (
            <article
              key={card.id}
              className={cn(
                card.isCta
                  ? "relative self-start"
                  : "relative self-start rounded-[28px] border border-[rgba(45,21,7,0.08)] bg-[rgba(255,251,245,0.92)] p-4 shadow-[0_24px_60px_rgba(45,21,7,0.08)] backdrop-blur-[16px] sm:p-5",
                card.layoutClassName,
              )}
            >
              {card.badgeSrc && !card.isCta ? (
                <div className="pointer-events-none absolute right-3 top-3 z-10 sm:right-4 sm:top-4">
                  <div className="relative h-14 w-14 drop-shadow-[0_10px_18px_rgba(45,21,7,0.12)] sm:h-16 sm:w-16">
                    <Image
                      src={card.badgeSrc}
                      alt=""
                      fill
                      sizes="64px"
                      className="object-contain object-center"
                    />
                  </div>
                </div>
              ) : null}
              <div className="grid gap-4">
                {!card.isCta ? (
                  <div className="grid gap-2 pr-14 sm:pr-16">
                    <h3 className="max-w-[12ch] font-instrument text-[clamp(26px,3vw,40px)] leading-[0.95] tracking-[-0.03em] text-[#2d1507]">
                      {card.title}
                    </h3>
                    {card.description ? (
                      <p className="max-w-[36ch] font-inter text-[14px] leading-[1.7] text-[#7a5830]">
                        {card.description}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {card.isCta ? (
                  <Link
                    href="/arena"
                    aria-label="Enter the Arena"
                    className="block overflow-hidden rounded-[24px] border border-[rgba(45,21,7,0.08)] bg-[linear-gradient(180deg,#fffef8_0%,#f4ecd7_100%)] shadow-[0_18px_40px_rgba(45,21,7,0.08)] transition-transform duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d1507]/30"
                  >
                    <div className="relative grid gap-6 overflow-hidden px-4 py-6 sm:px-6 sm:py-8">
                      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(circle,rgba(70,94,162,0.22)_1px,transparent_1px)] [background-size:6px_6px]" />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(180deg,transparent,rgba(92,124,201,0.08))]" />

                      <div className="relative z-[1] grid gap-3 pr-20 sm:pr-28 md:pr-36 lg:pr-56">
                        <span className="font-barlow text-[10px] font-semibold uppercase tracking-[0.16em] text-[rgba(45,21,7,0.62)]">
                          / make the call
                        </span>
                        <h4 className="m-0 font-barlow text-[clamp(42px,9vw,104px)] font-semibold uppercase leading-[0.88] tracking-[-0.08em] text-[#1e1a16] [text-shadow:1px_0_0_#1e1a16,-1px_0_0_#1e1a16,0_1px_0_#1e1a16,0_-1px_0_#1e1a16] sm:[text-shadow:2px_0_0_#1e1a16,-2px_0_0_#1e1a16,0_2px_0_#1e1a16,0_-2px_0_#1e1a16]">
                          Enter the Arena
                        </h4>
                      </div>

                      <div className="pointer-events-none absolute -bottom-10 right-0 z-[1] h-40 w-40 drop-shadow-[0_18px_28px_rgba(45,21,7,0.2)] sm:-bottom-14 sm:right-1 sm:h-48 sm:w-48 md:-bottom-16 md:right-2 md:h-56 md:w-56 lg:-bottom-20 lg:right-4 lg:h-64 lg:w-64">
                        <Image
                          src="/bento-steps/cursor-char.png"
                          alt=""
                          fill
                          sizes="256px"
                          className="object-contain object-center"
                        />
                      </div>
                    </div>
                  </Link>
                ) : (
                  <BentoMediaFrame tone={card.frameTone} media={card.media} />
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
