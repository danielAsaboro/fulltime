import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FullTime — encrypted peer-to-peer match rooms",
    short_name: "FullTime",
    description:
      "Create an invite-only Pear room for a signed fixture and chat directly with your group.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f3f1",
    theme_color: "#f6f3f1",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "maskable" },
    ],
  };
}
