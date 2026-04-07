import Groq from "groq-sdk";
import { flattenAstToNodeMap, type AstNode } from "@/lib/ast";

const API_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
].filter(Boolean) as string[];

function createClient(apiKey: string) {
  return new Groq({ apiKey });
}

const SYSTEM_PROMPT =
  "You are an expert data engineer. I will give you a JSON object mapping node IDs to SQL operations. Return a strict JSON response with the exact same keys, but replace the SQL strings with a 1-sentence, plain-English explanation of what that specific operation is doing. Output ONLY valid JSON, no markdown formatting or backticks.";

/* ------------------------------------------------------------------ */
/*  Groq call with key rotation                                       */
/* ------------------------------------------------------------------ */

async function callGroqWithFallback(nodeMap: Record<string, string>): Promise<Record<string, string>> {
  if (API_KEYS.length === 0) {
    throw new Error("No GROQ_API_KEY_* environment variables configured.");
  }

  const userContent = JSON.stringify(nodeMap);
  let lastError: unknown;

  for (let i = 0; i < API_KEYS.length; i++) {
    const client = createClient(API_KEYS[i]);

    try {
      const completion = await client.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
        max_tokens: 1024,
      });

      const raw = completion.choices?.[0]?.message?.content ?? "";

      // Strip any accidental markdown fences
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const parsed = JSON.parse(cleaned);
      return parsed as Record<string, string>;
    } catch (err: unknown) {
      lastError = err;

      // Only rotate on 429 rate limit errors
      const status = (err as { status?: number })?.status;
      const statusCode = (err as { error?: { code?: number } })?.error?.code;
      const isRateLimit = status === 429 || statusCode === 429;

      if (isRateLimit && i < API_KEYS.length - 1) {
        console.warn(`[Groq] Key ${i + 1} rate-limited (429). Rotating to key ${i + 2}…`);
        continue;
      }

      // If not a 429 or we're on the last key, throw
      throw err;
    }
  }

  throw lastError;
}

/* ------------------------------------------------------------------ */
/*  Route handler                                                     */
/* ------------------------------------------------------------------ */

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { nodeMap } = body;

    if (!nodeMap || Object.keys(nodeMap).length === 0) {
      return Response.json(
        { error: "Missing or empty `nodeMap` field in request body." },
        { status: 400 }
      );
    }

    const explanations = await callGroqWithFallback(nodeMap);

    return Response.json({ explanations, nodeMap });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate explanations.";
    const status = (err as { status?: number })?.status;

    console.error("[/api/explain] Error:", message);

    return Response.json(
      { error: "Explanation generation failed.", details: message },
      { status: status === 429 ? 429 : 500 }
    );
  }
}
