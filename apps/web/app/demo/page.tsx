import type { Metadata } from "next";

import { DemoEntry } from "@/components/demo-entry";

export const metadata: Metadata = {
  title: "Full match room demo — FullTime",
  description: "Watch a FullTime room unfold from pre-match through the final whistle.",
};

export default function DemoPage() {
  return <DemoEntry />;
}
