import Groq from "groq-sdk";
import { logger } from "@/lib/logger";
import { consumeRateLimit, pruneRateLimitBuckets } from "@/lib/server/rate-limit";
import { TtlLruCache } from "@/lib/server/ttl-lru-cache";
import { createRequestId, getClientIp, readJson } from "@/lib/server/request";

const API_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,
].filter(Boolean) as string[];

const MODELS = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"];
const CACHE_TTL_MS = 1000 * 60 * 30;
const MAX_SQL_CHARS = 20000;
const MAX_CACHE_ITEMS = 500;
const MAX_CACHE_VALUE_SIZE = 256_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_IP = 24;

const optimizeCache = new TtlLruCache<OptimizeResult>(MAX_CACHE_ITEMS, MAX_CACHE_VALUE_SIZE);
const inFlightOptimize = new Map<string, Promise<OptimizeResult>>();

type Quality = "poor" | "fair" | "good";

interface OptimizeRequestBody {
  sql?: unknown;
  dialect?: unknown;
}

interface OptimizeResult {
  optimizedSql: string;
  summary: string;
  quality: Quality;
  shouldOptimize: boolean;
  riskFlags: string[];
  confidence: number;
  source: "heuristic" | "llm" | "hybrid";
  fallbackReason?: string;
}

const SYSTEM_PROMPT = `You are a senior SQL performance engineer.
Task: Optimize SQL while preserving exact semantics.
Rules:
1) Preserve result correctness.
2) If uncertain, keep original SQL.
3) Output ONLY strict JSON.
4) Keep summary <= 25 words.
5) quality must be "poor" | "fair" | "good".
6) shouldOptimize=true when query quality is poor and likely expensive/error-prone.
7) optimizedSql must be plain SQL string (no markdown fences).
JSON schema:
{
  "optimizedSql": "string",
  "summary": "string",
  "quality": "poor|fair|good",
  "shouldOptimize": true,
  "riskFlags": ["string"],
  "confidence": 0.0
}`;

function createClient(apiKey: string) {
  return new Groq({ apiKey });
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function isSimpleQuery(sql: string): boolean {
  const normalized = normalizeSql(sql).toLowerCase();
  const hasComplexKeywords =
    /\b(join|with|union|group by|having|window|over|subquery|exists|distinct)\b/.test(normalized);
  return normalized.length < 80 && !hasComplexKeywords;
}

function heuristicAssess(sql: string): OptimizeResult {
  const normalized = normalizeSql(sql);
  const lower = normalized.toLowerCase();

  const riskFlags: string[] = [];
  if (/\bselect\s+\*/i.test(lower)) riskFlags.push("SELECT * can increase IO and break column pruning.");
  if ((lower.match(/\bjoin\b/g)?.length ?? 0) >= 3) riskFlags.push("Multiple joins may need index validation and join order checks.");
  if (/\border by\b/i.test(lower) && !/\blimit\b/i.test(lower)) riskFlags.push("ORDER BY without LIMIT can force large sorts.");
  if (/\bwith\b/i.test(lower)) riskFlags.push("Complex CTE chain may benefit from materialization review.");

  const quality: Quality = riskFlags.length >= 3 ? "poor" : riskFlags.length > 0 ? "fair" : "good";

  return {
    optimizedSql: sql,
    summary:
      quality === "good"
        ? "Query shape looks reasonable; no deterministic rewrite needed."
        : "Potential inefficiencies detected. Validate with EXPLAIN before production use.",
    quality,
    shouldOptimize: quality === "poor",
    riskFlags: riskFlags.slice(0, 5),
    confidence: quality === "good" ? 0.9 : 0.7,
    source: "heuristic",
  };
}

function parseOptimizationResponse(raw: string, fallbackSql: string): Omit<OptimizeResult, "source" | "fallbackReason"> {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const parsed = JSON.parse(cleaned) as Partial<OptimizeResult>;

  const quality: Quality =
    parsed.quality === "poor" || parsed.quality === "fair" || parsed.quality === "good"
      ? parsed.quality
      : "fair";

  const optimizedSql =
    typeof parsed.optimizedSql === "string" && parsed.optimizedSql.trim()
      ? parsed.optimizedSql.trim()
      : fallbackSql;

  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : "No major optimization opportunities were confidently identified.";

  const riskFlags = Array.isArray(parsed.riskFlags)
    ? parsed.riskFlags.filter((flag): flag is string => typeof flag === "string").slice(0, 5)
    : [];

  const confidence =
    typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.65;

  const shouldOptimize =
    typeof parsed.shouldOptimize === "boolean" ? parsed.shouldOptimize : quality === "poor";

  return {
    optimizedSql,
    summary,
    quality,
    shouldOptimize,
    riskFlags,
    confidence,
  };
}

async function callGroqOptimize(
  sql: string,
  dialect: string,
  userAgent: string
): Promise<OptimizeResult> {
  const source = "Optimize";
  if (API_KEYS.length === 0) {
    throw new Error("No GROQ_API_KEY_* environment variables configured.");
  }

  const userContent = JSON.stringify({ dialect, sql });
  let lastError: unknown;

  for (let i = 0; i < API_KEYS.length; i++) {
    const client = createClient(API_KEYS[i]);

    for (const model of MODELS) {
      try {
        const startTime = performance.now();
        const completion = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          temperature: 0,
          max_tokens: 520,
        });
        const duration = performance.now() - startTime;
        const raw = completion.choices?.[0]?.message?.content ?? "";
        const result = parseOptimizationResponse(raw, sql);

        logger.info("Groq optimization successful", source, {
          durationMs: duration.toFixed(2),
          keyIndex: i + 1,
          model,
          userAgent,
          quality: result.quality,
          shouldOptimize: result.shouldOptimize,
        });

        return {
          ...result,
          source: "llm",
        };
      } catch (err: unknown) {
        lastError = err;
        const status = (err as { status?: number })?.status;
        const message = err instanceof Error ? err.message : String(err);

        if (/model/i.test(message) && /not found|does not exist|unavailable/i.test(message)) {
          logger.warn("Model unavailable, trying fallback model", source, {
            keyIndex: i + 1,
            model,
          });
          continue;
        }

        if (status === 429) {
          logger.warn("Key rate-limited, rotating key", source, { keyIndex: i + 1, model });
          break;
        }

        logger.error("Groq optimization attempt failed", source, err, {
          keyIndex: i + 1,
          model,
        });
        throw err;
      }
    }
  }

  throw lastError;
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const userAgent = request.headers.get("user-agent") || "unknown";
  const source = "Optimize";

  try {
    const clientIp = await getClientIp();
    const rate = consumeRateLimit(`optimize:${clientIp}`, RATE_LIMIT_PER_IP, RATE_LIMIT_WINDOW_MS);
    pruneRateLimitBuckets();

    if (!rate.allowed) {
      return Response.json(
        {
          requestId,
          error: "Rate limit exceeded.",
          details: "Too many optimize requests. Please retry later.",
          retryAfterMs: Math.max(0, rate.resetAt - Date.now()),
        },
        { status: 429 }
      );
    }

    const body = await readJson<OptimizeRequestBody>(request);
    const sql = typeof body?.sql === "string" ? body.sql.trim() : "";
    const dialect = typeof body?.dialect === "string" ? body.dialect : "Standard SQL";

    if (!sql) {
      return Response.json(
        { requestId, error: "Missing or invalid `sql` field in request body." },
        { status: 400 }
      );
    }

    if (sql.length > MAX_SQL_CHARS) {
      return Response.json(
        {
          requestId,
          error: "SQL input too large.",
          details: `Maximum allowed length is ${MAX_SQL_CHARS} characters.`,
        },
        { status: 413 }
      );
    }

    const normalized = normalizeSql(sql);
    const cacheKey = `${dialect}::${normalized}`;

    const cached = optimizeCache.get(cacheKey);
    if (cached) {
      return Response.json({ requestId, ...cached, cached: true });
    }

    const heuristicResult = heuristicAssess(sql);
    if (isSimpleQuery(sql) || API_KEYS.length === 0) {
      optimizeCache.set(cacheKey, heuristicResult, CACHE_TTL_MS, JSON.stringify(heuristicResult).length);
      return Response.json({ requestId, ...heuristicResult, cached: false, skippedLLM: true });
    }

    logger.info("Processing optimization request", source, {
      requestId,
      dialect,
      charCount: sql.length,
      userAgent,
    });

    let optimizePromise = inFlightOptimize.get(cacheKey);
    if (!optimizePromise) {
      optimizePromise = callGroqOptimize(sql, dialect, userAgent);
      inFlightOptimize.set(cacheKey, optimizePromise);
    }

    let llmResult: OptimizeResult;
    try {
      llmResult = await optimizePromise;
    } catch (err) {
      logger.warn("LLM optimization unavailable; returning deterministic fallback", source, {
        requestId,
        details: err instanceof Error ? err.message : String(err),
      });
      llmResult = {
        ...heuristicResult,
        quality: heuristicResult.quality === "good" ? "fair" : heuristicResult.quality,
        shouldOptimize: heuristicResult.quality !== "good",
        confidence: 0.62,
        fallbackReason: "LLM unavailable or failed. Returned deterministic analysis.",
      };
    } finally {
      inFlightOptimize.delete(cacheKey);
    }

    const merged: OptimizeResult = {
      ...llmResult,
      riskFlags: llmResult.riskFlags.length > 0 ? llmResult.riskFlags : heuristicResult.riskFlags,
      source: llmResult.source === "llm" ? "hybrid" : llmResult.source,
    };

    optimizeCache.set(cacheKey, merged, CACHE_TTL_MS, JSON.stringify(merged).length);

    return Response.json({ requestId, ...merged, cached: false, skippedLLM: false });
  } catch (err: unknown) {
    logger.error("Optimizer route failure", source, err, { requestId });
    const message = err instanceof Error ? err.message : "Failed to optimize query.";
    const status = (err as { status?: number })?.status;
    return Response.json(
      { requestId, error: "Query optimization failed.", details: message },
      { status: status === 429 ? 429 : 500 }
    );
  }
}
