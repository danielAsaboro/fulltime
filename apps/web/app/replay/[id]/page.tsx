import type { Metadata } from "next";

import { ReplayView } from "@/components/replay-view";

export const metadata: Metadata = {
  title: "Replay — FullTime",
  description: "A recorded World Cup match replayed through the real room for two fans on different delays.",
};

export default async function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReplayView fixtureId={id} />;
}
