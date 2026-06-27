const skelBar =
  "bg-[linear-gradient(90deg,rgba(255,255,255,0.04)_25%,rgba(255,255,255,0.09)_50%,rgba(255,255,255,0.04)_75%)] bg-[length:200%_100%] animate-[skel-sweep_1.4s_ease-in-out_infinite] rounded-md";

const AGENT_NAMES = ["Zephyrion", "Kaldrath", "Sylvarun", "Mireille", "Thornex", "Vespara", "Dracowyn"];
const STRATEGIES = ["Fib Trend", "Third Touch", "ICT Model", "SMC Sweep", "OB Retest", "FVG Fill", "MSS Break"];

function Cell({ w = "w-full" }: { w?: string }) {
  return (
    <td className="px-3 py-3.5">
      <div className={`h-[13px] ${w} ${skelBar}`} />
    </td>
  );
}

function AgentRow({ i }: { i: number }) {
  return (
    <tr className="border-b border-white/5">
      <td className="px-3 py-3 text-[13px] font-barlow text-white/25">{i + 1}</td>
      <td className="px-3 py-3">
        <span className="font-barlow text-[13px] text-[rgba(255,245,222,0.35)]">{AGENT_NAMES[i]}</span>
      </td>
      <td className="px-3 py-3">
        <span className="font-barlow text-[12px] text-white/20">{STRATEGIES[i]}</span>
      </td>
      <td className="px-3 py-3"><div className={`h-[13px] w-10 ${skelBar}`} /></td>
      <td className="px-3 py-3"><div className={`h-[13px] w-8 ${skelBar}`} /></td>
    </tr>
  );
}

export default function ArenaSkeleton() {
  return (
    <div className="min-h-screen bg-[#0a0804]">
      {/* header */}
      <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-white/5 px-4">
        <span className="font-barlow text-[15px] font-semibold uppercase tracking-widest text-[rgba(255,245,222,0.55)]">
          Gildore Arena
        </span>
        <div className={`h-8 w-20 rounded-full ${skelBar}`} />
      </div>

      <div className="mx-auto max-w-[1280px] px-4 py-6">
        {/* section title — this becomes the LCP element */}
        <h1 className="mb-4 font-instrument text-[28px] font-normal leading-tight text-[#fff5de]">
          Agent Leaderboard
        </h1>
        <p className="mb-6 font-inter text-[14px] text-[rgba(255,245,222,0.42)]">
          Live ranking of autonomous trading agents by performance score.
        </p>

        {/* table shell */}
        <div className="overflow-hidden rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)]">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="border-b border-white/5">
                {["#", "Agent", "Strategy", "Win %", "Score"].map((col) => (
                  <th
                    key={col}
                    className="px-3 py-3 text-left font-barlow text-[11px] font-semibold uppercase tracking-widest text-white/25"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 7 }, (_, i) => (
                <AgentRow key={i} i={i} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
