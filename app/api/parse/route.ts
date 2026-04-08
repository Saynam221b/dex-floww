import { Parser } from "node-sql-parser";
import { flattenAstToNodeMap, type AstNode } from "@/lib/ast";

const parser = new Parser();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sql } = body;

    if (!sql || typeof sql !== "string") {
      return Response.json(
        { error: "Missing or invalid `sql` field in request body." },
        { status: 400 }
      );
    }

    const ast = parser.astify(sql);
    const nodeMap = flattenAstToNodeMap(ast as unknown as AstNode);

    return Response.json({ ast, nodeMap });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to parse SQL.";

    return Response.json(
      {
        error: "Invalid SQL syntax.",
        details: message,
      },
      { status: 400 }
    );
  }
}
