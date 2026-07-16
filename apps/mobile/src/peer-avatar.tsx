/**
 * Deterministic peer avatar — soft geometric mark from userId.
 * Same seed → same art as web PeerAvatar (palette + circle geometry).
 * Pure RN Views — no react-native-svg dependency.
 */

import { Text, View, type StyleProp, type ViewStyle } from "react-native";

import { authorInitials, authorPalette, avatarGeometry } from "./author-style";

const COLORS = { ash: "#D0CBC4", blue: "#3457D5" };

type Size = "xs" | "sm" | "md" | "lg";

const SIZE_PX: Record<Size, number> = {
  xs: 20,
  sm: 28,
  md: 34,
  lg: 48,
};

export function PeerAvatar({
  userId,
  displayName,
  size = "md",
  isCurrentUser = false,
  style,
}: {
  userId?: string | null;
  displayName?: string | null;
  size?: Size | number;
  isCurrentUser?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const px = typeof size === "number" ? size : SIZE_PX[size];
  const seed = userId || displayName || "room";
  const palette = authorPalette(isCurrentUser ? `self:${seed}` : seed);
  const geo = avatarGeometry(seed);
  const label = displayName?.trim() || "Peer";
  const s = px / 40;
  const initials = authorInitials(label);

  return (
    <View
      accessibilityLabel={label}
      style={[
        {
          width: px,
          height: px,
          borderRadius: px / 2,
          overflow: "hidden",
          backgroundColor: palette.bg,
          borderWidth: isCurrentUser ? 2 : 1,
          borderColor: isCurrentUser ? COLORS.blue : COLORS.ash,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <View
        style={{
          position: "absolute",
          left: geo.c1x * s - geo.c1r * s,
          top: geo.c1y * s - geo.c1r * s,
          width: geo.c1r * 2 * s,
          height: geo.c1r * 2 * s,
          borderRadius: geo.c1r * s,
          backgroundColor: geo.accent,
          opacity: 0.55,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: geo.c2x * s - geo.c2r * s,
          top: geo.c2y * s - geo.c2r * s,
          width: geo.c2r * 2 * s,
          height: geo.c2r * 2 * s,
          borderRadius: geo.c2r * s,
          backgroundColor: palette.fg,
          opacity: 0.12,
        }}
      />
      {/* Center accent disc stands in for web path mark at small sizes */}
      <View
        style={{
          position: "absolute",
          width: px * 0.42,
          height: px * 0.42,
          borderRadius: px * 0.08,
          backgroundColor: geo.accent,
          opacity: 0.78,
          transform: [{ rotate: `${(hashRotate(seed) % 45) - 10}deg` }],
        }}
      />
      <Text
        style={{
          zIndex: 1,
          fontFamily: "Menlo",
          fontWeight: "700",
          fontSize: Math.max(8, Math.round(px * 0.28)),
          color: palette.fg,
          textShadowColor: "rgba(255,255,255,0.65)",
          textShadowRadius: 4,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}

function hashRotate(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}
