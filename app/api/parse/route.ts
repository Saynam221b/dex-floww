import { Parser } from "node-sql-parser";
import { flattenAstToNodeMap, type AstNode } from "@/lib/ast";
import { buildGraphModel } from "@/lib/graph-core";
import { logger } from "@/lib/logger";
import { badRequest, createRequestId, readJson } from "@/lib/server/request";

interface ParseRequestBody {
  sql?: unknown;
  dialect?: unknown;
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const userAgent = request.headers.get("user-agent") || "unknown";
  const source = "Parse";

  try {
    const body = await readJson<ParseRequestBody>(request);
    const sql = typeof body?.sql === "string" ? body.sql : "";
    const dialect = typeof body?.dialect === "string" ? body.dialect : "Standard SQL";

    if (!sql) {
      logger.warn("Missing or invalid sql field", source, { userAgent });
      return badRequest(requestId, "Missing or invalid `sql` field in request body.");
    }

    // Map dialect names to node-sql-parser database options
    const dialectMap: Record<string, string> = {
      "Standard SQL": "mysql",
      Postgres: "postgresql",
      PostgreSQL: "postgresql",
      MySQL: "mysql",
      BigQuery: "bigquery",
      SQLite: "sqlite",
    };

    const dbType = dialectMap[dialect] || "mysql";
    
    logger.info("Incoming SQL request", source, { 
      charCount: sql.length, 
      dialect: dbType,
      userAgent 
    });
    
    const parser = new Parser();

    const parseStart = performance.now();
    let ast;
    try {
      ast = parser.astify(sql, { database: dbType });
    } catch (parseErr: unknown) {
      const msg = parseErr instanceof Error ? parseErr.message : "Failed to parse SQL.";
      logger.error("SQL syntax error", source, parseErr, { sql: sql.slice(0, 500) });
      
      const lineMatch = msg.match(/line\s+(\d+)/i);
      const colMatch = msg.match(/col(?:umn)?\s+(\d+)/i);
      return Response.json(
        {
          requestId,
          error: "Invalid SQL syntax.",
          details: msg,
          line: lineMatch ? parseInt(lineMatch[1], 10) : null,
          column: colMatch ? parseInt(colMatch[1], 10) : null,
        },
        { status: 400 }
      );
    }

    const parseDuration = performance.now() - parseStart;
    let nodeMap;
    let graph;
    try {
      const startTime = performance.now();
      nodeMap = flattenAstToNodeMap(ast as unknown as AstNode);
      graph = buildGraphModel(nodeMap);
      const duration = performance.now() - startTime;
      
      logger.info("AST mapping complete", source, { 
        nodeCount: Object.keys(nodeMap).length,
        edgeCount: graph.edges.length,
        durationMs: duration.toFixed(2),
        isComplex: Object.keys(nodeMap).length > 50
      });
    } catch (mapErr: unknown) {
      logger.error("AST mapping failed", source, mapErr, { 
        sqlPreview: sql.slice(0, 100) + "...",
        astPreview: JSON.stringify(ast).slice(0, 500)
      });
      
      return Response.json(
        {
          requestId,
          error: "Unsupported complex syntax in query",
          details: mapErr instanceof Error ? mapErr.message : "The AST mapper could not process this query structure.",
          line: null,
          column: null,
        },
        { status: 400 }
      );
    }

    const params = new URL(request.url).searchParams;
    const verbose = params.get("verbose") === "1";

    return Response.json({
      requestId,
      graph: {
        nodeMap,
        nodes: graph.nodes,
        edges: graph.edges,
      },
      warnings: [],
      metrics: {
        parseMs: Number(parseDuration.toFixed(2)),
        graphMs: Number((performance.now() - parseStart - parseDuration).toFixed(2)),
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
      },
      ...(verbose ? { ast, nodeMap } : {}),
    });
  } catch (err: unknown) {
    logger.error("Unexpected error in parse route", source, err);
    const message = err instanceof Error ? err.message : "Internal server error.";

    return Response.json(
      { requestId, error: "Internal server error.", details: message },
      { status: 500 }
    );
  }
}
