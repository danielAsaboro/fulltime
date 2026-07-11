/**
 * The data seam — the only surface components import for data. The Pear transport
 * remains behind this line so native protocol details do not leak into components.
 */

export * from "./types";
export * from "./room-feed";
export * from "./hooks";
export { DataProvider, useData } from "./provider";
export { isDesktopPeerBridgeAvailable } from "./live/peer-bridge";
