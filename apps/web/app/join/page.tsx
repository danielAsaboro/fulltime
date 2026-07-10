import type { Metadata } from "next";

import { JoinCodeForm } from "@/components/join-code-form";

export const metadata: Metadata = {
  title: "Join with a code — FullTime",
  description: "Enter a FullTime room invite code.",
};

export default function JoinCodePage() {
  return <JoinCodeForm />;
}
