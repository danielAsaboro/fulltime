/**
 * FullTime worker entry.
 *
 * Phase 0 scaffold: loads config, brings up the logger, reports what it targets,
 * and names any credentials still needed to connect live. The TxLINE spine wires
 * in here in Phase 1 — see HANDOFF.md:
 *
 *   auth chain (guest → subscribe → activate)
 *     → scores + odds SSE ingest
 *     → message-id-ordered fixture state machines
 *     → tempo-paced call scheduler + pure settle engine
 *     → corpus recorder (corpus/{net}/{fixtureId}.jsonl)
 */

import { describeConfig, loadConfig, missingLiveCredentials } from "./config.js";
import { createLogger } from "./logger.js";

function main(): void {
  const config = loadConfig();
  const log = createLogger(config.logLevel);

  log.info("FullTime worker starting", describeConfig(config));

  const missing = missingLiveCredentials(config);
  if (missing.length > 0) {
    log.warn("Live credentials not set — worker cannot connect to TxLINE yet", { missing });
  }

  log.warn("TxLINE spine not yet implemented (Phase 0 scaffold). See HANDOFF.md → Phase 1.");
}

main();
