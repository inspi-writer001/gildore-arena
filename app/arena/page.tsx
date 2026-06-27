import { Suspense } from "react";
import ArenaDashboard from "@/components/arena-dashboard";
import ArenaSkeleton from "@/components/arena/arena-skeleton";

export default function ArenaPage() {
  return (
    <Suspense fallback={<ArenaSkeleton />}>
      <ArenaDashboard />
    </Suspense>
  );
}
