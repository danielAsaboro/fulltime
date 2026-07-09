/** Tiny leveled logger. No dependency; structured fields serialize to JSON. */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type Fields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
}

export function createLogger(level: LogLevel = "info"): Logger {
  const threshold = ORDER[level];

  const emit = (lvl: LogLevel, msg: string, fields?: Fields): void => {
    if (ORDER[lvl] < threshold) return;
    const ts = new Date().toISOString();
    const tail = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
    const line = `${ts} ${lvl.toUpperCase().padEnd(5)} ${msg}${tail}`;
    if (lvl === "error") console.error(line);
    else if (lvl === "warn") console.warn(line);
    else console.log(line);
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
