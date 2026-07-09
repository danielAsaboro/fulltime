import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FullTime — spoiler-safe World Cup rooms",
    short_name: "FullTime",
    description:
      "Watch the World Cup together on your own clock. Make calls that settle from verified data and leave with a Fan Report nobody can fake.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f3f1",
    theme_color: "#f6f3f1",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
