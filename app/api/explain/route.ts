import Groq from "groq-sdk";
import { logger } from "@/lib/logger";
import { type NodeMapInput } from "@/lib/graph-core";
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
const MAX_SQL_SNIPPET_CHARS = 800;
const MAX_UNIQUE_SNIPPETS_FOR_LLM = 120;
const MAX_LLM_ENRICH_NODES = 50;
const MAX_CACHE_ITEMS = 500;
const MAX_CACHE_VALUE_SIZE = 512_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_IP = 40;

const explainCache = new TtlLruCache<Record<string, string>>(MAX_CACHE_ITEMS, MAX_CACHE_VALUE_SIZE);
const inFlightExplain = new Map<string, Promise<Record<string, string>>>();

type NodeMapValue =
  | string
  | {
      sql?: unknown;
      isGroup?: unknown;
      [key: string]: unknown;
    };

interface ExplainRequestBody {
  nodeMap?: NodeMapInput;
  priorExplanations?: Record<string, string>;
}

interface ExplainerPayloadEntry {
  type: string;
  sql: string;
}

type ExplainerPayload = Record<string, ExplainerPayloadEntry>;

interface BuildPayloadResult {
  payload: ExplainerPayload;
  dedupeMap: Map<string, string[]>;
}

const SYSTEM_PROMPT = `Act as a senior data engineer documenting SQL pipeline steps.
Input: JSON object where each key is a node ID and value contains { type, sql }.
Output: STRICT JSON where keys are the same node IDs and values are one concise sentence.
Rules:
- source: mention what source data is read.
- join: mention why datasets are combined.
- filter: mention what is filtered and why.
- aggregate: mention what metric/grain is produced.
- output: mention final shape or ordering intent.
- Max 15 words per explanation.
- No markdown, no extra keys, no prose outside JSON.`;

function createClient(apiKey: string) {
  return new Groq({ apiKey });
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function detectOperationType(nodeId: string): string {
  const normalized = nodeId.replace(/_u\d+$/, "");
  if (normalized.startsWith("node_from")) return "source";
  if (normalized.startsWith("node_join")) return "join";
  if (normalized.startsWith("node_where") || normalized.startsWith("node_having")) {
    return "filter";
  }
  if (normalized.startsWith("node_groupby") || normalized.startsWith("node_orderby")) {
    return "aggregate";
  }
  return "output";
}

function extractSql(value: NodeMapValue): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  if (value.isGroup) return null;
  return typeof value.sql === "string" ? value.sql : null;
}

function stablePayloadSignature(payload: ExplainerPayload): string {
  const keys = Object.keys(payload).sort();
  return keys
    .map((key) => {
      const entry = payload[key];
      return `${key}::${entry.type}::${entry.sql}`;
    })
    .join("||");
}

function heuristicExplanation(type: string): string {
  if (type === "source") return "Reads source data for downstream transformation.";
  if (type === "join") return "Combines datasets to enrich records for analysis.";
  if (type === "filter") return "Filters records to retain relevant analytical rows.";
  if (type === "aggregate") return "Aggregates data to compute summary metrics.";
  return "Shapes output for downstream reporting or consumption.";
}

function buildPayload(nodeMap: NodeMapInput): BuildPayloadResult {
  const dedupeMap = new Map<string, string[]>();
  const payload: ExplainerPayload = {};

  for (const [nodeId, rawValue] of Object.entries(nodeMap)) {
    const sql = extractSql(rawValue);
    if (!sql) continue;

    const normalizedSql = normalizeSql(sql);
    if (!normalizedSql) continue;

    const compactSql = normalizedSql.slice(0, MAX_SQL_SNIPPET_CHARS);
    const dedupeKey = compactSql.toLowerCase();
    const nodeType = detectOperationType(nodeId);

    const existingIds = dedupeMap.get(dedupeKey);
    if (existingIds) {
      existingIds.push(nodeId);
      continue;
    }

    dedupeMap.set(dedupeKey, [nodeId]);
    payload[nodeId] = { type: nodeType, sql: compactSql };
  }

  return { payload, dedupeMap };
}

function buildHeuristicExplanations(
  payload: ExplainerPayload,
  dedupeMap: Map<string, string[]>
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [uniqueId, entry] of Object.entries(payload)) {
    const dedupeKey = entry.sql.toLowerCase();
    const allIds = dedupeMap.get(dedupeKey) || [uniqueId];
    const text = heuristicExplanation(entry.type);
    for (const id of allIds) {
      result[id] = text;
    }
  }

  return result;
}

function isLowConfidenceHeuristic(entry: ExplainerPayloadEntry): boolean {
  if (entry.sql.length > 120) return true;
  if (entry.type === "join" || entry.type === "aggregate") return true;
  return /\b(join|group by|having|union|with|window|over)\b/i.test(entry.sql);
}

function parseExplainResponse(raw: string): Record<string, string> {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" && value.trim()) {
      result[key] = value.trim();
    }
  }
  return result;
}

async function callGroqExplain(
  payload: ExplainerPayload,
  userAgent: string
): Promise<Record<string, string>> {
  const source = "Explain";
  if (API_KEYS.length === 0) {
    throw new Error("No GROQ_API_KEY_* environment variables configured.");
  }

  const userContent = JSON.stringify(payload);
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
          max_tokens: 700,
        });
        const duration = performance.now() - startTime;
        const raw = completion.choices?.[0]?.message?.content ?? "";
        const parsed = parseExplainResponse(raw);

        logger.info("Groq generation successful", source, {
          durationMs: duration.toFixed(2),
          keyIndex: i + 1,
          model,
          userAgent,
          uniqueSnippets: Object.keys(payload).length,
        });

        return parsed;
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
          logger.warn("Key rate-limited, rotating key", source, {
            keyIndex: i + 1,
            model,
          });
          break;
        }

        logger.error("Groq attempt failed", source, err, {
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
  const source = "Explain";

  try {
    const clientIp = await getClientIp();
    const rate = consumeRateLimit(`explain:${clientIp}`, RATE_LIMIT_PER_IP, RATE_LIMIT_WINDOW_MS);
    pruneRateLimitBuckets();

    if (!rate.allowed) {
      return Response.json(
        {
          requestId,
          error: "Rate limit exceeded.",
          details: "Too many explain requests. Please retry later.",
          retryAfterMs: Math.max(0, rate.resetAt - Date.now()),
        },
        { status: 429 }
      );
    }

    const body = await readJson<ExplainRequestBody>(request);
    const nodeMap = body?.nodeMap;

    if (!nodeMap || typeof nodeMap !== "object" || Object.keys(nodeMap).length === 0) {
      return Response.json(
        { requestId, error: "Missing or empty `nodeMap` field in request body." },
        { status: 400 }
      );
    }

    const { payload, dedupeMap } = buildPayload(nodeMap);
    const uniqueCount = Object.keys(payload).length;
    if (uniqueCount === 0) {
      return Response.json({ requestId, explanations: {}, source: "heuristic", cached: false });
    }

    logger.info("Processing explanation request", source, {
      requestId,
      nodeCount: Object.keys(nodeMap).length,
      uniqueCount,
      userAgent,
    });

    const cacheKey = stablePayloadSignature(payload);
    const cached = explainCache.get(cacheKey);
    if (cached) {
      return Response.json({ requestId, explanations: cached, source: "hybrid", cached: true });
    }

    const baseExplanations = buildHeuristicExplanations(payload, dedupeMap);

    const lowConfidenceIds = Object.entries(payload)
      .filter(([, entry]) => isLowConfidenceHeuristic(entry))
      .map(([id]) => id)
      .slice(0, MAX_LLM_ENRICH_NODES);

    if (
      lowConfidenceIds.length === 0 ||
      uniqueCount > MAX_UNIQUE_SNIPPETS_FOR_LLM ||
      API_KEYS.length === 0
    ) {
      const sizeHint = JSON.stringify(baseExplanations).length;
      explainCache.set(cacheKey, baseExplanations, CACHE_TTL_MS, sizeHint);
      return Response.json({
        requestId,
        explanations: baseExplanations,
        source: "heuristic",
        cached: false,
      });
    }

    const llmPayload: ExplainerPayload = {};
    for (const id of lowConfidenceIds) {
      const entry = payload[id];
      if (entry) llmPayload[id] = entry;
    }

    let explainPromise = inFlightExplain.get(cacheKey);
    if (!explainPromise) {
      explainPromise = callGroqExplain(llmPayload, userAgent);
      inFlightExplain.set(cacheKey, explainPromise);
    }

    let llmExplanations: Record<string, string> = {};
    try {
      llmExplanations = await explainPromise;
    } catch (err) {
      logger.warn("LLM enrich failed; returning heuristic explanations", source, {
        requestId,
        details: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inFlightExplain.delete(cacheKey);
    }

    const merged = { ...baseExplanations };
    let llmApplied = 0;
    for (const [id, text] of Object.entries(llmExplanations)) {
      if (!text.trim()) continue;
      merged[id] = text.trim();
      llmApplied += 1;
    }

    const responseSource = llmApplied > 0 ? "hybrid" : "heuristic";
    const sizeHint = JSON.stringify(merged).length;
    explainCache.set(cacheKey, merged, CACHE_TTL_MS, sizeHint);

    return Response.json({
      requestId,
      explanations: merged,
      source: responseSource,
      llmApplied,
      cached: false,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate explanations.";
    const status = (err as { status?: number })?.status;

    logger.error("Route handler failure", source, err, { requestId });

    return Response.json(
      { requestId, error: "Explanation generation failed.", details: message },
      { status: status === 429 ? 429 : 500 }
    );
  }
}
