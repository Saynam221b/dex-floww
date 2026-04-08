import Groq from "groq-sdk";
import { logger } from "@/lib/logger";

const API_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
].filter(Boolean) as string[];

function createClient(apiKey: string) {
  return new Groq({ apiKey });
}

const SYSTEM_PROMPT = `You are a Senior Data Engineer documenting a data pipeline. I will provide a JSON object mapping node IDs to their SQL operations and types. Return a strict JSON response with the exact same node IDs as keys. The value for each key MUST be a 1-sentence explanation of the *business purpose* of that specific operation. 
Rules:
- For 'join' types: Explain *why* these specific datasets are being combined (e.g., 'Merging customer profiles with transaction history.').
- For 'filter' types (WHERE/HAVING): Explain exactly *what* is being excluded and why.
- For 'aggregate' types (GROUP BY): Explain the metric being calculated.
- DO NOT just translate the SQL to English. Focus on the analytical intent. Output ONLY valid JSON.`;

/* ------------------------------------------------------------------ */
/*  Groq call with key rotation & deduplication                        */
/* ------------------------------------------------------------------ */

interface ExplainerPayload {
  [key: string]: { type: string; sql: string };
}

async function callGroqWithFallback(nodeMap: Record<string, string>, userAgent: string): Promise<Record<string, string>> {
  const source = "Explain";
  
  if (API_KEYS.length === 0) {
    throw new Error("No GROQ_API_KEY_* environment variables configured.");
  }

  // 1. Deduplicate SQL snippets to save tokens and prevent redundant AI calls
  const sqlToIds = new Map<string, string[]>();
  const payload: ExplainerPayload = {};
  
  for (const [key, sql] of Object.entries(nodeMap)) {
    const normalized = key.replace(/_u\d+$/, "");
    let type = "output";
    if (normalized.startsWith("node_from")) type = "source";
    else if (normalized.startsWith("node_join")) type = "join";
    else if (normalized.startsWith("node_where") || normalized.startsWith("node_having")) type = "filter";
    else if (normalized.startsWith("node_groupby") || normalized.startsWith("node_orderby")) type = "aggregate";
    
    // Check if we've seen this exact SQL before
    if (sqlToIds.has(sql)) {
      sqlToIds.get(sql)!.push(key);
    } else {
      sqlToIds.set(sql, [key]);
      payload[key] = { type, sql };
    }
  }

  const uniqueCount = Object.keys(payload).length;
  const totalCount = Object.keys(nodeMap).length;
  
  logger.info("Deduplication complete", source, { 
    totalLinks: totalCount, 
    uniqueSnippets: uniqueCount,
    savedRequests: totalCount - uniqueCount
  });

  const userContent = JSON.stringify(payload);
  let lastError: unknown;

  for (let i = 0; i < API_KEYS.length; i++) {
    const client = createClient(API_KEYS[i]);

    try {
      const startTime = performance.now();
      const completion = await client.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
        max_tokens: 1024,
      });
      const duration = performance.now() - startTime;

      const raw = completion.choices?.[0]?.message?.content ?? "";
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(cleaned) as Record<string, string>;

      // 2. Rehydrate deduplicated results
      const finalExplanations: Record<string, string> = {};
      for (const [uniqueId, explanation] of Object.entries(parsed)) {
        const originalSql = payload[uniqueId].sql;
        const allIdsForThisSql = sqlToIds.get(originalSql) || [];
        for (const id of allIdsForThisSql) {
          finalExplanations[id] = explanation;
        }
      }

      logger.info("Groq generation successful", source, { 
        durationMs: duration.toFixed(2),
        keyIndex: i + 1,
        userAgent
      });

      return finalExplanations;
    } catch (err: unknown) {
      lastError = err;
      const status = (err as any)?.status;
      const isRateLimit = status === 429;

      if (isRateLimit && i < API_KEYS.length - 1) {
        logger.warn(`Key ${i + 1} rate-limited. Rotating to key ${i + 2}...`, source, { 
          keyIndex: i + 1,
          nextIndex: i + 2
        });
        continue;
      }

      logger.error("Groq attempt failed", source, err, { keyIndex: i + 1 });
      throw err;
    }
  }

  throw lastError;
}

/* ------------------------------------------------------------------ */
/*  Route handler                                                     */
/* ------------------------------------------------------------------ */

export async function POST(request: Request) {
  const userAgent = request.headers.get("user-agent") || "unknown";
  const source = "Explain";

  try {
    const body = await request.json();
    const { nodeMap } = body;
    
    if (!nodeMap || Object.keys(nodeMap).length === 0) {
      return Response.json(
        { error: "Missing or empty `nodeMap` field in request body." },
        { status: 400 }
      );
    }

    logger.info("Processing explanation request", source, { 
      nodeCount: Object.keys(nodeMap).length,
      userAgent 
    });

    const explanations = await callGroqWithFallback(nodeMap, userAgent);

    return Response.json({ explanations, nodeMap });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate explanations.";
    const status = (err as any)?.status;

    logger.error("Route handler failure", source, err);

    return Response.json(
      { error: "Explanation generation failed.", details: message },
      { status: status === 429 ? 429 : 500 }
    );
  }
}

