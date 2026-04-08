import Groq from "groq-sdk";

const API_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
].filter(Boolean) as string[];

function createClient(apiKey: string) {
  return new Groq({ apiKey });
}

const SYSTEM_PROMPT =
  "You are an expert teacher. Take the provided SQL operation and explain it using a simple, real-world everyday analogy (like sorting toys, ordering pizza, or finding a book in a library). Break it down step-by-step so a non-technical person or a 5-year-old could understand it. Output plain text, maximum 3-4 short sentences.";

/* ------------------------------------------------------------------ */
/*  Groq call with key rotation                                       */
/* ------------------------------------------------------------------ */

async function callGroqELI5(snippet: string): Promise<string> {
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

      return completion.choices?.[0]?.message?.content?.trim() ?? "";
    } catch (err: unknown) {
      lastError = err;

      const status = (err as { status?: number })?.status;
      const statusCode = (err as { error?: { code?: number } })?.error?.code;
      const isRateLimit = status === 429 || statusCode === 429;

      if (isRateLimit && i < API_KEYS.length - 1) {
        console.warn(
          `[Groq ELI5] Key ${i + 1} rate-limited (429). Rotating to key ${i + 2}…`
        );
        continue;
      }

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
    const { snippet } = body;

    if (!snippet || typeof snippet !== "string") {
      return Response.json(
        { error: "Missing or invalid `snippet` string in request body." },
        { status: 400 }
      );
    }

    const explanation = await callGroqELI5(snippet);

    return Response.json({ explanation });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to generate ELI5 explanation.";
    const status = (err as { status?: number })?.status;

    console.error("[/api/explain-eli5] Error:", message);

    return Response.json(
      { error: "ELI5 generation failed.", details: message },
      { status: status === 429 ? 429 : 500 }
    );
  }
}
