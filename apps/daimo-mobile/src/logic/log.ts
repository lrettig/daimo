interface LogAction {
  type: string;
  startMs: number;
  elapsedMs: number;
  error?: string;
}

/**
 * Logging and telemetry. We'll use this in two ways:
 * - High-level, anonymized data (perf and reliability stats) telemetered.
 * - Detailed debug logs can be sent manually via Send Debug Logs.
 */
export class Log {
  static async promise<T>(type: string, promise: Promise<T>): Promise<T> {
    const startMs = Date.now();
    try {
      const ret = await promise;
      this.log({ type, startMs, elapsedMs: Date.now() - startMs });
      return ret;
    } catch (e: any) {
      const elapsedMs = Date.now() - startMs;
      this.log({ type, startMs, elapsedMs, error: getErrMessage(e) });
      throw e;
    }
  }

  private static log(action: LogAction) {
    // TODO: save in local debug log
    // TODO: roll up per-type stats
    if (action.error) console.error(`[LOG] ${JSON.stringify(action)}`);
    else console.log(`[LOG] ${JSON.stringify(action)}`);
  }
}

/** Always returns a nonempty string, "unknown error" if missing. */
function getErrMessage(e: any): string {
  return typeof e === "string" ? e : e?.message || "unknown error";
}
