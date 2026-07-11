/** Strict room-media descriptors and byte sniffing. */

import type { UserId } from "./ids";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 12_000;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MEDIA_PLAINTEXT_CHUNK_BYTES = 64 * 1024;
export const MEDIA_CIPHER_MAC_BYTES = 16;

export type RoomMediaMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "application/pdf"
  | "text/plain";

export interface HyperblobBounds {
  blockOffset: number;
  blockLength: number;
  byteOffset: number;
  byteLength: number;
}

export interface MediaDescriptor {
  version: 1;
  epoch: number;
  mediaId: string;
  authorId: UserId;
  coreKey: string;
  blob: HyperblobBounds;
  encryption: {
    algorithm: "xsalsa20-poly1305-chunked-v1";
    noncePrefix: string;
    plaintextChunkBytes: typeof MEDIA_PLAINTEXT_CHUNK_BYTES;
  };
  plaintextHash: string;
  hashAlgorithm: "blake2b-256";
  mimeType: RoomMediaMime;
  name: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

export interface SniffedMedia {
  mimeType: RoomMediaMime;
  sizeBytes: number;
  width?: number;
  height?: number;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,179}$/;
const HEX_32 = /^[a-f0-9]{64}$/;

export function validateMediaDescriptor(value: unknown): MediaDescriptor {
  const input = plainObject(value, "Media descriptor");
  exactKeys(
    input,
    [
      "version", "epoch", "mediaId", "authorId", "coreKey", "blob", "plaintextHash",
      "encryption", "hashAlgorithm", "mimeType", "name", "sizeBytes",
    ],
    ["width", "height"],
    "Media descriptor",
  );
  if (input.version !== 1) throw new TypeError("Media descriptor version is unsupported");
  const epoch = safeInteger(input.epoch, "Media epoch", 0);
  const mediaId = identifier(input.mediaId, "Media ID");
  const authorId = identifier(input.authorId, "Media author") as UserId;
  const coreKey = hex32(input.coreKey, "Media core key");
  const plaintextHash = hex32(input.plaintextHash, "Media plaintext hash");
  if (input.hashAlgorithm !== "blake2b-256") throw new TypeError("Media hash algorithm is unsupported");
  const mimeType = mediaMime(input.mimeType);
  const name = mediaName(input.name);
  const sizeBytes = safeInteger(input.sizeBytes, "Media size", 1);
  enforceSize(mimeType, sizeBytes);
  const blob = blobBounds(input.blob);
  const encryption = mediaEncryption(input.encryption);
  const expectedBlocks = Math.ceil(sizeBytes / encryption.plaintextChunkBytes);
  const expectedCipherBytes = sizeBytes + expectedBlocks * MEDIA_CIPHER_MAC_BYTES;
  if (blob.blockLength !== expectedBlocks || blob.byteLength !== expectedCipherBytes) {
    throw new TypeError("Encrypted media bounds do not match its plaintext size");
  }
  if (!Number.isSafeInteger(blob.blockOffset + blob.blockLength) ||
      !Number.isSafeInteger(blob.byteOffset + blob.byteLength)) {
    throw new TypeError("Encrypted media bounds overflow");
  }

  const image = mimeType.startsWith("image/");
  if (image && (input.width === undefined || input.height === undefined)) {
    throw new TypeError("Image media requires dimensions");
  }
  if (!image && (input.width !== undefined || input.height !== undefined)) {
    throw new TypeError("Non-image media cannot include dimensions");
  }
  const dimensions = image
    ? validateDimensions(input.width, input.height)
    : null;
  return {
    version: 1,
    epoch,
    mediaId,
    authorId,
    coreKey,
    blob,
    encryption,
    plaintextHash,
    hashAlgorithm: "blake2b-256",
    mimeType,
    name,
    sizeBytes,
    ...(dimensions ? dimensions : {}),
  };
}

function mediaEncryption(value: unknown): MediaDescriptor["encryption"] {
  const input = plainObject(value, "Media encryption");
  exactKeys(
    input,
    ["algorithm", "noncePrefix", "plaintextChunkBytes"],
    [],
    "Media encryption",
  );
  if (input.algorithm !== "xsalsa20-poly1305-chunked-v1") {
    throw new TypeError("Media encryption algorithm is unsupported");
  }
  if (typeof input.noncePrefix !== "string" || !/^[a-f0-9]{32}$/.test(input.noncePrefix)) {
    throw new TypeError("Media nonce prefix is invalid");
  }
  if (input.plaintextChunkBytes !== MEDIA_PLAINTEXT_CHUNK_BYTES) {
    throw new TypeError("Media plaintext chunk size is unsupported");
  }
  return {
    algorithm: "xsalsa20-poly1305-chunked-v1",
    noncePrefix: input.noncePrefix,
    plaintextChunkBytes: MEDIA_PLAINTEXT_CHUNK_BYTES,
  };
}

export function sniffMedia(bytes: Uint8Array): SniffedMedia {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) throw new TypeError("Media bytes are empty");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new TypeError(`Media exceeds ${MAX_FILE_BYTES} bytes`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let result: SniffedMedia | null = null;
  if (isPng(bytes)) result = sniffPng(view, bytes.byteLength);
  else if (isJpeg(bytes)) result = sniffJpeg(bytes);
  else if (isGif(bytes)) result = sniffGif(view, bytes.byteLength);
  else if (isWebp(bytes)) result = sniffWebp(bytes, view);
  else if (isPdf(bytes)) result = { mimeType: "application/pdf", sizeBytes: bytes.byteLength };
  else if (isCanonicalUtf8Text(bytes)) result = { mimeType: "text/plain", sizeBytes: bytes.byteLength };
  if (!result) throw new TypeError("Media format is unsupported or malformed");
  enforceSize(result.mimeType, result.sizeBytes);
  if (result.width !== undefined || result.height !== undefined) {
    validateDimensions(result.width, result.height);
  }
  return result;
}

export function mediaName(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Media name must be text");
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized !== value || normalized.length > 255 ||
      /[\u0000-\u001f\u007f/\\]/.test(normalized) || normalized === "." || normalized === "..") {
    throw new TypeError("Media name is unsafe");
  }
  return normalized;
}

function sniffPng(view: DataView, sizeBytes: number): SniffedMedia {
  if (view.byteLength < 24 || view.getUint32(12) !== 0x49484452) throw new TypeError("PNG header is malformed");
  return {
    mimeType: "image/png",
    sizeBytes,
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

function sniffGif(view: DataView, sizeBytes: number): SniffedMedia {
  if (view.byteLength < 10) throw new TypeError("GIF header is malformed");
  return {
    mimeType: "image/gif",
    sizeBytes,
    width: view.getUint16(6, true),
    height: view.getUint16(8, true),
  };
}

function sniffJpeg(bytes: Uint8Array): SniffedMedia {
  let offset = 2;
  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) throw new TypeError("JPEG marker stream is malformed");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.byteLength) break;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.byteLength) throw new TypeError("JPEG segment is malformed");
    if (isJpegFrameMarker(marker)) {
      if (length < 7) throw new TypeError("JPEG frame is malformed");
      return {
        mimeType: "image/jpeg",
        sizeBytes: bytes.byteLength,
        height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
        width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
      };
    }
    offset += length;
  }
  throw new TypeError("JPEG dimensions are unavailable");
}

function sniffWebp(bytes: Uint8Array, view: DataView): SniffedMedia {
  if (bytes.byteLength < 30) throw new TypeError("WebP header is malformed");
  const chunk = ascii(bytes, 12, 16);
  if (chunk === "VP8X") {
    return {
      mimeType: "image/webp",
      sizeBytes: bytes.byteLength,
      width: 1 + uint24le(bytes, 24),
      height: 1 + uint24le(bytes, 27),
    };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) throw new TypeError("Lossless WebP header is malformed");
    const bits = view.getUint32(21, true);
    return {
      mimeType: "image/webp",
      sizeBytes: bytes.byteLength,
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >>> 14) & 0x3fff),
    };
  }
  if (chunk === "VP8 ") {
    const start = 20;
    if (bytes.byteLength < start + 10 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) {
      throw new TypeError("Lossy WebP header is malformed");
    }
    return {
      mimeType: "image/webp",
      sizeBytes: bytes.byteLength,
      width: ((bytes[start + 7]! << 8) | bytes[start + 6]!) & 0x3fff,
      height: ((bytes[start + 9]! << 8) | bytes[start + 8]!) & 0x3fff,
    };
  }
  throw new TypeError("WebP chunk is unsupported");
}

function blobBounds(value: unknown): HyperblobBounds {
  const input = plainObject(value, "Hyperblob bounds");
  exactKeys(input, ["blockOffset", "blockLength", "byteOffset", "byteLength"], [], "Hyperblob bounds");
  return {
    blockOffset: safeInteger(input.blockOffset, "Blob block offset", 0),
    blockLength: safeInteger(input.blockLength, "Blob block length", 1),
    byteOffset: safeInteger(input.byteOffset, "Blob byte offset", 0),
    byteLength: safeInteger(input.byteLength, "Blob byte length", 1),
  };
}

function validateDimensions(widthValue: unknown, heightValue: unknown): { width: number; height: number } {
  const width = safeInteger(widthValue, "Image width", 1);
  const height = safeInteger(heightValue, "Image height", 1);
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new TypeError("Image dimensions exceed the room media limit");
  }
  return { width, height };
}

function enforceSize(mime: RoomMediaMime, size: number): void {
  const limit = mime === "text/plain" ? MAX_TEXT_BYTES : mime.startsWith("image/") ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
  if (size > limit) throw new TypeError(`${mime} exceeds ${limit} bytes`);
}

function mediaMime(value: unknown): RoomMediaMime {
  if (["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "text/plain"].includes(String(value))) {
    return value as RoomMediaMime;
  }
  throw new TypeError("Media MIME type is unsupported");
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    .every((value, index) => bytes[index] === value);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isGif(bytes: Uint8Array): boolean {
  const signature = ascii(bytes, 0, 6);
  return signature === "GIF87a" || signature === "GIF89a";
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 16 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 8 && ascii(bytes, 0, 5) === "%PDF-";
}

function isCanonicalUtf8Text(bytes: Uint8Array): boolean {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/\u0000/.test(decoded)) return false;
    const trimmed = decoded.trimStart().toLowerCase();
    if (trimmed.startsWith("<html") || trimmed.startsWith("<!doctype") || trimmed.startsWith("<svg")) return false;
    return new TextEncoder().encode(decoded).every((value, index) => value === bytes[index]);
  } catch {
    return false;
  }
}

function isJpegFrameMarker(marker: number): boolean {
  return (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (end > bytes.byteLength) return "";
  let result = "";
  for (let index = start; index < end; index++) result += String.fromCharCode(bytes[index]!);
  return result;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function hex32(value: unknown, label: string): string {
  if (typeof value !== "string" || !HEX_32.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function safeInteger(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new TypeError(`${label} is invalid`);
  return Number(value);
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  for (const key of required) if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing ${key}`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label} contains unsupported field ${key}`);
}
