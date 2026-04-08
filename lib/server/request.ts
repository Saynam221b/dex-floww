import { headers } from "next/headers";

export function createRequestId(): string {
  return crypto.randomUUID();
}

export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return h.get("x-real-ip") || "unknown";
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function badRequest(requestId: string, error: string, details?: string, extra?: Record<string, unknown>) {
  return Response.json(
    {
      requestId,
      error,
      ...(details ? { details } : {}),
      ...(extra ?? {}),
    },
    { status: 400 }
  );
}
