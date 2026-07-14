import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  type Address,
  type Instruction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

type RpcError = { code: number; message: string };

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json() as { result?: T; error?: RpcError };
  if (!response.ok || body.error) throw new Error(`Solana ${method} failed${body.error ? ` (${body.error.code}): ${body.error.message}` : ` with HTTP ${response.status}`}`);
  return body.result as T;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function send(rpcUrl: string, signer: Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>, instructions: readonly Instruction[]): Promise<string> {
  const latest = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(rpcUrl, "getLatestBlockhash", [{ commitment: "confirmed" }]);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(signer.address, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: latest.value.blockhash as never, lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight) }, value),
    (value) => appendTransactionMessageInstructions(instructions, value),
  );
  const decoded = getTransactionDecoder().decode(getTransactionEncoder().encode(compileTransaction(message)));
  const signed = await signTransaction([signer.keyPair], decoded);
  const signature = await rpc<string>(rpcUrl, "sendTransaction", [bytesToBase64(new Uint8Array(getTransactionEncoder().encode(signed))), { encoding: "base64", skipPreflight: false, maxRetries: 3, preflightCommitment: "confirmed" }]);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const statuses = await rpc<{ value: Array<{ err: unknown; confirmationStatus?: string } | null> }>(rpcUrl, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
    const status = statuses.value[0];
    if (status?.err) throw new Error(`Funding transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Funding transaction ${signature} did not confirm within 90 seconds`);
}

export async function fundDeviceWallet(input: {
  rpcUrl: string;
  mint: Address;
  fundingSecretKey: number[];
  recipient: Address;
  targetLamports?: bigint;
  targetTokenUnits?: bigint;
}): Promise<{ publicKey: string; solLamports: number; tokenUnits: number; signature?: string }> {
  const targetLamports = input.targetLamports ?? BigInt(100_000_000);
  const targetTokenUnits = input.targetTokenUnits ?? BigInt(100_000_000);
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(input.fundingSecretKey), true);
  const [sourceAta] = await findAssociatedTokenPda({ owner: signer.address, mint: input.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [destinationAta] = await findAssociatedTokenPda({ owner: input.recipient, mint: input.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const lamports = BigInt(await rpc<{ value: number }>(input.rpcUrl, "getBalance", [input.recipient, { commitment: "confirmed" }]).then((value) => value.value));
  const tokenUnits = await rpc<{ value?: { amount: string } }>(input.rpcUrl, "getTokenAccountBalance", [destinationAta, { commitment: "confirmed" }])
    .then((value) => BigInt(value.value?.amount ?? "0"))
    .catch((cause) => cause instanceof Error && /account .* not found|could not find account|Invalid param/i.test(cause.message) ? BigInt(0) : Promise.reject(cause));
  const instructions: Instruction[] = [];
  if (lamports < targetLamports) instructions.push(getTransferSolInstruction({ source: signer, destination: input.recipient, amount: targetLamports - lamports }));
  if (tokenUnits < targetTokenUnits) {
    instructions.push(getCreateAssociatedTokenIdempotentInstruction({ payer: signer, ata: destinationAta, owner: input.recipient, mint: input.mint }));
    instructions.push(getTransferCheckedInstruction({ source: sourceAta, mint: input.mint, destination: destinationAta, authority: signer, amount: targetTokenUnits - tokenUnits, decimals: 6 }));
  }
  const signature = instructions.length ? await send(input.rpcUrl, signer, instructions) : undefined;
  return { publicKey: input.recipient, solLamports: Number(targetLamports), tokenUnits: Number(targetTokenUnits), ...(signature ? { signature } : {}) };
}
