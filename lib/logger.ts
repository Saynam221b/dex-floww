/**
 * Structured Logging Utility for D3xTRverse Flow
 * designed to be easily readable in Vercel Logs (JSONL format).
 */

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogPayload {
  message: string;
  source: string;
  level: LogLevel;
  timestamp: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    code?: string | number;
  };
}

export const logger = {
  info(message: string, source: string, metadata?: Record<string, unknown>) {
    this._log("info", message, source, metadata);
  },

  warn(message: string, source: string, metadata?: Record<string, unknown>) {
    this._log("warn", message, source, metadata);
  },

  error(message: string, source: string, error?: unknown, metadata?: Record<string, unknown>) {
    const errorPayload = error instanceof Error 
      ? { message: error.message, stack: error.stack }
      : error ? { message: String(error) } : undefined;
      
    this._log("error", message, source, { ...metadata, error: errorPayload } as Record<string, unknown>);
  },

  debug(message: string, source: string, metadata?: Record<string, unknown>) {
    if (process.env.NODE_ENV === "development") {
      this._log("debug", message, source, metadata);
    }
  },

  _log(level: LogLevel, message: string, source: string, metadata?: Record<string, unknown>) {
    const payload: LogPayload = {
      timestamp: new Date().toISOString(),
      level,
      source: `[D3xTRverse ${source}]`,
      message,
      metadata: metadata || {},
    };

    // Include Error specifically if provided in metadata (from error() call)
    if (metadata?.error) {
      payload.error = metadata.error as LogPayload["error"];
      if (payload.metadata) {
        delete (payload.metadata as Record<string, unknown>).error;
      }
    }

    // In Vercel, console.log(object) is automatically treated as structured log if it's JSON
    if (level === "error") {
      console.error(JSON.stringify(payload));
    } else if (level === "warn") {
      console.warn(JSON.stringify(payload));
    } else {
      console.log(JSON.stringify(payload));
    }
  }
};
