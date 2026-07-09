import type { Metadata } from "next";

import { ReportView } from "@/components/report-view";

export const metadata: Metadata = {
  title: "Fan Report — FullTime",
  description: "Your match memory: best read, room rank, accuracy, and the proof trail behind it.",
};

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportView roomId={id} />;
}
