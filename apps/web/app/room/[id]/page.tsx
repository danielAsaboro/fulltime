import { RoomView } from "@/components/room-view";

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ demo?: string | string[] }>;
}) {
  const { id } = await params;
  const demoParam = (await searchParams).demo;
  const isDemo = (Array.isArray(demoParam) ? demoParam[0] : demoParam) === "1";
  return <RoomView roomId={id} demo={isDemo} />;
}
