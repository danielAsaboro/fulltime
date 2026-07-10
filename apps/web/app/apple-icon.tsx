import { ImageResponse } from "next/og";

// iOS uses a PNG apple-touch-icon for "Add to Home Screen" (SVG isn't honored).
// Generated at build time — the FullTime dot mark on the brand-dark ground.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#242424",
        }}
      >
        <div style={{ width: 104, height: 104, borderRadius: "50%", background: "#f6f3f1" }} />
      </div>
    ),
    { ...size },
  );
}
