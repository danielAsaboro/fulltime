import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { address, getAddressEncoder } from "@solana/kit";
import { Surfnet } from "@solana/surfpool";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const workspace = path.resolve(repo, "..");
const program = address("8VNZ5VseAcFaYhAZxetgE5N8eiD17ZZNchGhoatYUUXw");
const txlineProgram = address("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const mintAddress = address("ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh");
const rootsAddress = address("EdJuEftTBNwXRWJpvYCziVxKT87qMDVu9V6HC7PwGffB");
const archive = path.join(workspace, "resources/fixtures/world-cup-2026/18213979-norway-vs-england");
const runtimePath = path.join(repo, ".local-development/slip-play-runtime.json");
const walletPath = path.join(repo, ".local-development/slip-play-wallet.json");

const surfnet = Surfnet.startWithConfig({ offline: true, blockProductionMode: "transaction" });
surfnet.deploy({ programId: program, soPath: path.join(repo, "vendor/slip.so") });

const mint = new Uint8Array(82);
const mintView = new DataView(mint.buffer);
mintView.setUint32(0, 1, true);
mint.set(getAddressEncoder().encode(address(surfnet.payer)), 4);
mint[44] = 6;
mint[45] = 1;
surfnet.setAccount(mintAddress, 2_000_000, mint, tokenProgram);

const rootResponse = JSON.parse(fs.readFileSync(path.join(archive, "daily-scores-roots.20645.devnet.json"), "utf8"));
if (rootResponse.result?.value?.owner !== txlineProgram) throw new Error("Archived daily-root owner does not match TxLINE");
surfnet.setAccount(
  rootsAddress,
  rootResponse.result.value.lamports,
  Buffer.from(rootResponse.result.value.data[0], "base64"),
  txlineProgram,
);

fs.mkdirSync(path.dirname(walletPath), { recursive: true, mode: 0o700 });
let playWallet;
try {
  playWallet = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  if (typeof playWallet.publicKey !== "string" || !Array.isArray(playWallet.secretKey) || playWallet.secretKey.length !== 64) throw new Error("invalid stored wallet");
} catch {
  playWallet = Surfnet.newKeypair();
  fs.writeFileSync(walletPath, JSON.stringify(playWallet), { mode: 0o600 });
}
surfnet.fundSol(playWallet.publicKey, 5_000_000_000);
surfnet.fundToken(playWallet.publicKey, mintAddress, 1_000_000_000);

const fundingToken = crypto.randomBytes(32).toString("hex");
const fundingServer = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/fund" || request.headers.authorization !== `Bearer ${fundingToken}`) {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > 16_384) request.destroy(new Error("Funding request too large"));
    else chunks.push(chunk);
  });
  request.once("end", () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const publicKey = address(body.publicKey);
      surfnet.fundSol(publicKey, 1_000_000_000);
      surfnet.fundToken(publicKey, mintAddress, 1_000_000_000);
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ publicKey, solLamports: 1_000_000_000, tokenUnits: 1_000_000_000 }));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
});
await new Promise((resolve, reject) => {
  fundingServer.once("error", reject);
  fundingServer.listen(0, "127.0.0.1", resolve);
});
const fundingAddress = fundingServer.address();
if (!fundingAddress || typeof fundingAddress === "string") throw new Error("Slip funding service did not bind a TCP port");

fs.mkdirSync(path.dirname(runtimePath), { recursive: true, mode: 0o700 });
const runtime = {
  kind: "fulltime-slip-play",
  pid: process.pid,
  rpcUrl: surfnet.rpcUrl,
  websocketUrl: surfnet.wsUrl,
  playWallet,
  program,
  mint: mintAddress,
  rootsAddress,
  rootSlot: rootResponse.result.context?.slot ?? 476185731,
  fundingUrl: `http://127.0.0.1:${fundingAddress.port}/fund`,
  fundingToken,
};
fs.writeFileSync(runtimePath, JSON.stringify(runtime), { mode: 0o600 });
console.log(JSON.stringify(runtime));

const stop = () => {
  fundingServer.close();
  surfnet.stop();
  fs.rmSync(runtimePath, { force: true });
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
setInterval(() => surfnet.drainEvents(), 100);
