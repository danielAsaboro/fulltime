import { ReplayView } from "@/components/replay-view";

export default async function RoomReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReplayView roomId={id} />;
}
