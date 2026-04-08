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

    let ast;
    try {
      ast = parser.astify(sql, { database: dbType });
    } catch (parseErr: unknown) {
      // Parser itself choked — surface as syntax error
      const msg = parseErr instanceof Error ? parseErr.message : "Failed to parse SQL.";
      const lineMatch = msg.match(/line\s+(\d+)/i);
      const colMatch = msg.match(/col(?:umn)?\s+(\d+)/i);
      return Response.json(
        {
          error: "Invalid SQL syntax.",
          details: msg,
          line: lineMatch ? parseInt(lineMatch[1], 10) : null,
          column: colMatch ? parseInt(colMatch[1], 10) : null,
        },
        { status: 400 }
      );
    }

    let nodeMap;
    try {
      nodeMap = flattenAstToNodeMap(ast as unknown as AstNode);
    } catch (mapErr: unknown) {
      // AST parsed OK but our mapper couldn't handle the structure
      // (e.g. deeply nested CTEs, recursive CTEs, dialect-specific nodes)
      console.error("[D3xTRverse] AST mapping failed", mapErr);
      return Response.json(
        {
          error: "Unsupported complex syntax in CTE",
          details: mapErr instanceof Error ? mapErr.message : "The AST mapper could not process this query structure.",
          line: null,
          column: null,
        },
        { status: 400 }
      );
    }

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
