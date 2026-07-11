/** Build a signed static manifest for an HTTPS/CDN deployment. */

import fs from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import {
  createSignedNetworkManifest,
  loadManifestSigningKey,
  manifestVerificationPublicKey,
} from "./network-manifest.js";
import { FixturePlanePublisher } from "./publisher/fixture-publisher.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const outputPath = process.env.FULLTIME_MANIFEST_OUTPUT_PATH;
  if (!outputPath) throw new Error("FULLTIME_MANIFEST_OUTPUT_PATH is required to write a signed manifest");
  if (!config.manifest.signingKeyPath) throw new Error("FULLTIME_MANIFEST_SIGNING_KEY_PATH is required to sign a manifest");
  if (!config.manifest.publicUrl) throw new Error("FULLTIME_MANIFEST_PUBLIC_URL is required so the release can point at this manifest");

  const log = createLogger(config.logLevel);
  const publisher = new FixturePlanePublisher({
    storageDir: path.join(config.fixturePlaneDir, config.net),
    log,
    networking: false,
  });
  try {
    const descriptor = await publisher.open();
    const signingKey = await loadManifestSigningKey(config.manifest.signingKeyPath);
    const manifest = createSignedNetworkManifest({
      fixtureFeedKey: descriptor.key,
      ...(config.manifest.answerAttestor ? { answerAttestor: config.manifest.answerAttestor } : {}),
      ...(config.manifest.anchorObserver ? { anchorObserver: config.manifest.anchorObserver } : {}),
    }, signingKey);
    await writeManifest(outputPath, manifest);
    process.stdout.write(`${JSON.stringify({
      manifestPath: path.resolve(outputPath),
      manifestUrl: config.manifest.publicUrl,
      fixtureFeedKey: descriptor.key,
      manifestVerificationPublicKey: manifestVerificationPublicKey(signingKey),
    })}\n`);
  } finally {
    await publisher.close();
  }
}

async function writeManifest(filename: string, manifest: object): Promise<void> {
  const destination = path.resolve(filename);
  const directory = path.dirname(destination);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(manifest), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.rename(temporary, destination);
    await fs.chmod(destination, 0o644);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
