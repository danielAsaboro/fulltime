import { loadAttestorConfig } from "./config.js";
import { AnswerAttestorService } from "./service.js";

const service = new AnswerAttestorService(loadAttestorConfig());

try {
  await service.open();
  process.stdout.write(`${JSON.stringify({ event: "answer-attestor.ready", ...service.descriptor })}\n`);
  await waitForShutdown();
} catch (error) {
  process.stderr.write(`[answer-attestor] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await service.close();
}

function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => resolve();
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}
