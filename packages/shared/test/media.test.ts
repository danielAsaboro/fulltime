import assert from "node:assert/strict";
import test from "node:test";

import {
  asUserId,
  mediaName,
  MEDIA_CIPHER_MAC_BYTES,
  MEDIA_PLAINTEXT_CHUNK_BYTES,
  sniffMedia,
  validateMediaDescriptor,
  type MediaDescriptor,
} from "../src/index";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test("sniffs supported media from bytes instead of trusting renderer MIME", () => {
  assert.deepEqual(sniffMedia(png(640, 480)), {
    mimeType: "image/png",
    sizeBytes: 33,
    width: 640,
    height: 480,
  });
  assert.deepEqual(sniffMedia(new TextEncoder().encode("hello room\n")), {
    mimeType: "text/plain",
    sizeBytes: 11,
  });
  assert.equal(sniffMedia(new TextEncoder().encode("%PDF-1.7\n")).mimeType, "application/pdf");
  assert.throws(() => sniffMedia(new TextEncoder().encode("<svg><script/></svg>")), /unsupported/);
});

test("rejects malformed dimensions and unsafe names", () => {
  assert.throws(() => sniffMedia(png(20_000, 2)), /dimensions/);
  assert.throws(() => mediaName("../goal.png"), /unsafe/);
  assert.throws(() => mediaName(" goal.png"), /unsafe/);
  assert.equal(mediaName("goal.png"), "goal.png");
});

test("validates a signed-core Hyperblob descriptor as a closed schema", () => {
  const descriptor: MediaDescriptor = {
    version: 1,
    epoch: 0,
    mediaId: "media-123",
    authorId: asUserId("peer-user"),
    coreKey: "a".repeat(64),
    blob: {
      blockOffset: 3,
      blockLength: 1,
      byteOffset: 100,
      byteLength: 33 + MEDIA_CIPHER_MAC_BYTES,
    },
    encryption: {
      algorithm: "xsalsa20-poly1305-chunked-v1",
      noncePrefix: "c".repeat(32),
      plaintextChunkBytes: MEDIA_PLAINTEXT_CHUNK_BYTES,
    },
    plaintextHash: "b".repeat(64),
    hashAlgorithm: "blake2b-256",
    mimeType: "image/png",
    name: "goal.png",
    sizeBytes: 33,
    width: 640,
    height: 480,
  };
  assert.deepEqual(validateMediaDescriptor(descriptor), descriptor);
  assert.throws(() => validateMediaDescriptor({ ...descriptor, coreKey: "c" }), /core key/);
  assert.throws(() => validateMediaDescriptor({ ...descriptor, sizeBytes: 32 }), /bounds/);
  assert.throws(() => validateMediaDescriptor({
    ...descriptor,
    encryption: { ...descriptor.encryption, algorithm: "plaintext" },
  }), /algorithm/);
  assert.throws(() => validateMediaDescriptor({
    ...descriptor,
    blob: { ...descriptor.blob, blockOffset: Number.MAX_SAFE_INTEGER },
  }), /overflow/);
  assert.throws(() => validateMediaDescriptor({ ...descriptor, script: true }), /unsupported field/);
});
