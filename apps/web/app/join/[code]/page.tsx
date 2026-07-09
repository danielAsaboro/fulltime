import type { Metadata } from "next";

import { JoinView } from "@/components/join-view";

export const metadata: Metadata = {
  title: "Join a room — FullTime",
  description: "You've been invited to a private FullTime match room.",
};

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <JoinView code={code} />;
}
