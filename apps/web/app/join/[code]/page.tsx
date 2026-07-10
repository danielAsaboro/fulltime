import type { Metadata } from "next";

import { JoinView } from "@/components/join-view";

export const metadata: Metadata = {
  title: "Join a room — FullTime",
  description: "You've been invited to a private FullTime match room.",
};

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const { code } = await params;
  const refParam = (await searchParams).ref;
  const referrerUserId = Array.isArray(refParam) ? refParam[0] : refParam;
  return <JoinView code={code} referrerUserId={referrerUserId} />;
}
