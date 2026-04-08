import test from "node:test";
import assert from "node:assert/strict";
import SqlParserPkg from "node-sql-parser";
import { flattenAstToNodeMap } from "../../lib/ast.ts";
import { buildAdjacency, buildGraphModel } from "../../lib/graph-core.ts";

test("parse -> graph -> highlight path deterministic flow", () => {
  const sql = `
    WITH recent_orders AS (
      SELECT user_id, total
      FROM orders
      WHERE created_at >= '2025-01-01'
    )
    SELECT user_id, SUM(total) AS revenue
    FROM recent_orders
    GROUP BY user_id
    HAVING SUM(total) > 100
    ORDER BY revenue DESC
    LIMIT 20;
  `;

  const { Parser } = SqlParserPkg;
  const parser = new Parser();
  const ast = parser.astify(sql, { database: "mysql" }) as unknown;
  const nodeMap = flattenAstToNodeMap(ast as never);
  const graph = buildGraphModel(nodeMap);

  assert.equal(graph.nodes.length > 0, true);
  assert.equal(graph.edges.length > 0, true);

  const { incoming, outgoing } = buildAdjacency(
    graph.edges.map((edge, index) => ({
      id: `edge-${index}`,
      source: edge.source,
      target: edge.target,
    }))
  );

  const seed = graph.nodes.at(-1)?.id;
  assert.equal(Boolean(seed), true);

  const visited = new Set<string>();
  const stack = seed ? [seed] : [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    for (const up of incoming.get(current) ?? []) stack.push(up);
    for (const down of outgoing.get(current) ?? []) stack.push(down);
  }

  assert.equal(visited.size > 0, true);
});
