import { Suspense } from "react";
import ArenaDashboard from "@/components/arena-dashboard";

export default function ArenaPage() {
  return (
    <Suspense fallback={null}>
      <ArenaDashboard />
    </Suspense>
  );
}
