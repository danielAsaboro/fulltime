/**
 * Corpus recorder. Appends the raw feed and normalized state snapshots to
 * `corpus/{net}/{fixtureId}.jsonl`, one JSON record per line. This corpus is the
 * spine of everything downstream: settle-engine tests and deterministic recovery
 * video. Raw records keep both feed time and local receipt time for signed
 * chronology and recovery.
 */

import fs from "node:fs";
import path from "node:path";

import type { CorpusRecord, RawFeedRecord, SnapshotFeedRecord } from "@fulltime/shared";

import type { Logger } from "../logger.js";

export class CorpusRecorder {
  private readonly dir: string;
  private readonly streams = new Map<string, fs.WriteStream>();
  private lineCount = 0;

  constructor(baseDir: string, net: string, private readonly log: Logger) {
    this.dir = path.resolve(process.cwd(), baseDir, net);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private streamFor(fixtureId: string | null): fs.WriteStream {
    const key = fixtureId ?? "_unrouted";
    let stream = this.streams.get(key);
    if (!stream) {
      stream = fs.createWriteStream(path.join(this.dir, `${key}.jsonl`), { flags: "a" });
      this.streams.set(key, stream);
    }
    return stream;
  }

  private write(fixtureId: string | null, record: CorpusRecord): void {
    this.streamFor(fixtureId).write(`${JSON.stringify(record)}\n`);
    this.lineCount += 1;
  }

  recordRaw(record: RawFeedRecord): void {
    this.write(record.fixtureId, record);
  }

  recordSnapshot(record: SnapshotFeedRecord): void {
    this.write(record.fixtureId, record);
  }

  stats(): { files: number; lines: number; dir: string } {
    return { files: this.streams.size, lines: this.lineCount, dir: this.dir };
  }

  async close(): Promise<void> {
    const closing = [...this.streams.values()].map(
      (stream) =>
        new Promise<void>((resolve) => {
          stream.end(resolve);
        }),
    );
    await Promise.all(closing);
    this.streams.clear();
    this.log.info("Corpus recorder closed", { lines: this.lineCount });
  }
}
