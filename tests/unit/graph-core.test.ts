import test from "node:test";
import assert from "node:assert/strict";
import { buildGraphModel } from "../../lib/graph-core.ts";

test("buildGraphModel creates deterministic dependency edges", () => {
  const model = buildGraphModel({
    node_from_1: { sql: "FROM users" },
    node_join_1: { sql: "JOIN orders ON users.id = orders.user_id" },
    node_where: { sql: "WHERE orders.total > 50" },
    node_select: { sql: "SELECT users.name, orders.total" },
    node_orderby: { sql: "ORDER BY orders.total DESC" },
  });

  const edgePairs = new Set(model.edges.map((edge) => `${edge.source}->${edge.target}`));
  assert.equal(edgePairs.has("node_from_1->node_join_1"), true);
  assert.equal(edgePairs.has("node_join_1->node_where"), true);
  assert.equal(edgePairs.has("node_where->node_select"), true);
  assert.equal(edgePairs.has("node_select->node_orderby"), true);
  assert.equal(model.edges.length, edgePairs.size);
});

test("buildGraphModel excludes CTE group nodes without SQL", () => {
  const model = buildGraphModel({
    node_cte_sales: { isGroup: true, label: "sales", sql: "CTE: sales" },
    node_select_cte_sales: { sql: "SELECT * FROM sales", parentId: "node_cte_sales" },
  });

  assert.equal(model.nodes.some((node) => node.id === "node_cte_sales"), false);
  assert.equal(model.nodes.some((node) => node.id === "node_select_cte_sales"), true);
});
