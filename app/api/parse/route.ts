import { Parser } from "node-sql-parser";
import { flattenAstToNodeMap, type AstNode } from "@/lib/ast";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sql, dialect } = body;

    if (!sql || typeof sql !== "string") {
      return Response.json(
        { error: "Missing or invalid `sql` field in request body." },
        { status: 400 }
      );
    }

    // Map dialect names to node-sql-parser database options
    const dialectMap: Record<string, string> = {
      "Standard SQL": "mysql", // node-sql-parser default
      Postgres: "postgresql",
      PostgreSQL: "postgresql",
      MySQL: "mysql",
      BigQuery: "bigquery",
      SQLite: "sqlite",
    };

    const dbType = dialectMap[dialect] || "mysql";
    const parser = new Parser();
    const ast = parser.astify(sql, { database: dbType });
    const nodeMap = flattenAstToNodeMap(ast as unknown as AstNode);

    return Response.json({ ast, nodeMap });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to parse SQL.";

    // Try to extract line/column info from parser error
    const lineMatch = message.match(/line\s+(\d+)/i);
    const colMatch = message.match(/col(?:umn)?\s+(\d+)/i);

    return Response.json(
      {
        error: "Invalid SQL syntax.",
        details: message,
        line: lineMatch ? parseInt(lineMatch[1], 10) : null,
        column: colMatch ? parseInt(colMatch[1], 10) : null,
      },
      { status: 400 }
    );
  }
}
