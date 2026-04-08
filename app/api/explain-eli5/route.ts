import Groq from "groq-sdk";
import { logger } from "@/lib/logger";
import { consumeRateLimit, pruneRateLimitBuckets } from "@/lib/server/rate-limit";
import { createRequestId, getClientIp, readJson } from "@/lib/server/request";
import { TtlLruCache } from "@/lib/server/ttl-lru-cache";

const API_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,
].filter(Boolean) as string[];

const CACHE_TTL_MS = 1000 * 60 * 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_IP = 40;
const MAX_SNIPPET_CHARS = 800;
const MAX_CACHE_ITEMS = 500;
const MAX_CACHE_VALUE_SIZE = 32_000;

const eli5Cache = new TtlLruCache<string>(MAX_CACHE_ITEMS, MAX_CACHE_VALUE_SIZE);
const inFlight = new Map<string, Promise<string>>();

interface Eli5RequestBody {
  snippet?: unknown;
}

const SYSTEM_PROMPT =
  "Explain the SQL operation like a 5-year-old using a simple real-world analogy. Max 3 short sentences. Plain text only.";

function createClient(apiKey: string) {
  return new Groq({ apiKey });
}

function normalizeSnippet(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET_CHARS);
}

function heuristicEli5(snippet: string): string {
  const lower = snippet.toLowerCase();

  if (/\bjoin\b/.test(lower)) {
    return "Think of mixing two toy boxes so matching toys can play together by their name tags.";
  }
  if (/\bgroup by\b|\bcount\(|\bsum\(|\bavg\(/.test(lower)) {
    return "Imagine sorting candies into bowls by color, then counting how many are in each bowl.";
  }
  if (/\bwhere\b|\bhaving\b/.test(lower)) {
    return "It is like keeping only the toys that match your rule and putting the rest away.";
  }
  if (/\border by\b/.test(lower)) {
    return "It is like lining up books from shortest to tallest so they are easy to find.";
  }

  return "It tells the computer where to look, what to keep, and how to show the final answer.";
}

async function callGroqELI5(snippet: string, userAgent: string): Promise<string> {
  const source = "ELI5";

  if (API_KEYS.length === 0) {
    throw new Error("No GROQ_API_KEY_* environment variables configured.");
  }

  let lastError: unknown;

  for (let i = 0; i < API_KEYS.length; i++) {
    const client = createClient(API_KEYS[i]);

    try {
      const completion = await client.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: snippet },
        ],
        temperature: 0,
        max_tokens: 120,
      });

      const content = completion.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("Empty ELI5 response from model.");
      }

      logger.info("ELI5 generation successful", source, {
        keyIndex: i + 1,
        userAgent,
      });

      return content;
    } catch (err: unknown) {
      lastError = err;

      const status = (err as { status?: number })?.status;
      const isRateLimit = status === 429;

      if (isRateLimit && i < API_KEYS.length - 1) {
        logger.warn("ELI5 key rate-limited, rotating key", source, {
          keyIndex: i + 1,
          nextIndex: i + 2,
        });
        continue;
      }

      logger.error("ELI5 attempt failed", source, err, { keyIndex: i + 1 });
      throw err;
    }
  }

  throw lastError;
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const userAgent = request.headers.get("user-agent") || "unknown";
  const source = "ELI5";

  try {
    const clientIp = await getClientIp();
    const rate = consumeRateLimit(`eli5:${clientIp}`, RATE_LIMIT_PER_IP, RATE_LIMIT_WINDOW_MS);
    pruneRateLimitBuckets();

    if (!rate.allowed) {
      return Response.json(
        {
          requestId,
          error: "Rate limit exceeded.",
          details: "Too many ELI5 requests. Please retry later.",
          retryAfterMs: Math.max(0, rate.resetAt - Date.now()),
        },
        { status: 429 }
      );
    }

    const body = await readJson<Eli5RequestBody>(request);
    const rawSnippet = typeof body?.snippet === "string" ? body.snippet : "";
    const snippet = normalizeSnippet(rawSnippet);

    if (!snippet) {
      return Response.json(
        { requestId, error: "Missing or invalid `snippet` string in request body." },
        { status: 400 }
      );
    }

    const cacheKey = `eli5::${snippet.toLowerCase()}`;
    const cached = eli5Cache.get(cacheKey);
    if (cached) {
      return Response.json({ requestId, explanation: cached, source: "heuristic", cached: true });
    }

    logger.info("Processing ELI5 request", source, { requestId, userAgent });

    const heuristic = heuristicEli5(snippet);
    if (API_KEYS.length === 0) {
      eli5Cache.set(cacheKey, heuristic, CACHE_TTL_MS, heuristic.length);
      return Response.json({ requestId, explanation: heuristic, source: "heuristic", cached: false });
    }

    let promise = inFlight.get(cacheKey);
    if (!promise) {
      promise = callGroqELI5(snippet, userAgent);
      inFlight.set(cacheKey, promise);
    }

    let explanation = heuristic;
    let sourceType: "heuristic" | "llm" | "hybrid" = "heuristic";

    try {
      const llmText = await promise;
      if (llmText) {
        explanation = llmText;
        sourceType = "hybrid";
      }
    } catch (err: unknown) {
      logger.warn("ELI5 LLM failed; returning deterministic fallback", source, {
        requestId,
        details: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inFlight.delete(cacheKey);
    }

    eli5Cache.set(cacheKey, explanation, CACHE_TTL_MS, explanation.length);
    return Response.json({ requestId, explanation, source: sourceType, cached: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate ELI5 explanation.";
    const status = (err as { status?: number })?.status;

    logger.error("ELI5 route handler failure", source, err, { requestId });

    return Response.json(
      { requestId, error: "ELI5 generation failed.", details: message },
      { status: status === 429 ? 429 : 500 }
    );
  }
}
