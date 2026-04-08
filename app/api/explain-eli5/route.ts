import Groq from "groq-sdk";
import { logger } from "@/lib/logger";

const API_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,
].filter(Boolean) as string[];

function createClient(apiKey: string) {
  return new Groq({ apiKey });
}

const SYSTEM_PROMPT =
  "Expert teacher: Explain the SQL operation using a simple real-world analogy (e.g., sorting toys, ordering pizza) for a 5-year-old. Max 3 short sentences. Plain text only. Be ultra-concise.";

/* ------------------------------------------------------------------ */
/*  Groq call with key rotation                                       */
/* ------------------------------------------------------------------ */

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
        temperature: 0.5,
        max_tokens: 256,
      });

      logger.info("ELI5 generation successful", source, { 
        keyIndex: i + 1,
        userAgent
      });

      return completion.choices?.[0]?.message?.content?.trim() ?? "";
    } catch (err: unknown) {
      lastError = err;

      const status = (err as { status?: number })?.status;
      const isRateLimit = status === 429;

      if (isRateLimit && i < API_KEYS.length - 1) {
        logger.warn(`Key ${i + 1} rate-limited. Rotating to key ${i + 2}...`, source, { 
          keyIndex: i + 1,
          nextIndex: i + 2
        });
        continue;
      }

      logger.error("ELI5 attempt failed", source, err, { keyIndex: i + 1 });
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
  const source = "ELI5";

  try {
    const body = await request.json();
    const { snippet } = body;

    if (!snippet || typeof snippet !== "string") {
      return Response.json(
        { error: "Missing or invalid `snippet` string in request body." },
        { status: 400 }
      );
    }

    logger.info("Processing ELI5 request", source, { userAgent });
    const explanation = await callGroqELI5(snippet, userAgent);

    return Response.json({ explanation });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate ELI5 explanation.";
    const status = (err as { status?: number })?.status;

    logger.error("ELI5 route handler failure", source, err);

    return Response.json(
      { error: "ELI5 generation failed.", details: message },
      { status: status === 429 ? 429 : 500 }
    );
  }
}

