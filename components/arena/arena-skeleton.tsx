const skelRow =
  "bg-[linear-gradient(90deg,rgba(255,255,255,0.04)_25%,rgba(255,255,255,0.09)_50%,rgba(255,255,255,0.04)_75%)] bg-[length:200%_100%] animate-[skel-sweep_1.4s_ease-in-out_infinite] rounded-md";

function Cell({ w = "w-full" }: { w?: string }) {
  return (
    <td className="px-3 py-3.5">
      <div className={`h-[14px] ${w} ${skelRow}`} />
    </td>
  );
}

function Row({ i }: { i: number }) {
  return (
    <tr style={{ animationDelay: `${i * 80}ms` }} className="border-b border-white/5">
      <Cell w="w-6" />
      <Cell w="w-28" />
      <Cell w="w-20" />
      <Cell w="w-16" />
      <Cell w="w-14" />
    </tr>
  );
}

export default function ArenaSkeleton() {
  return (
    <div className="min-h-screen bg-[#0a0804]">
      <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-white/5 px-4">
        <div className={`h-5 w-28 ${skelRow}`} />
        <div className={`h-8 w-20 rounded-full ${skelRow}`} />
      </div>
      <div className="mx-auto max-w-[1280px] px-4 py-6">
        <div className="overflow-hidden rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)]">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {["#", "Agent", "Strategy", "Win", "Score"].map((col) => (
                  <th key={col} className="px-3 py-3 text-left font-medium text-white/30">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 7 }, (_, i) => (
                <Row key={i} i={i} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
