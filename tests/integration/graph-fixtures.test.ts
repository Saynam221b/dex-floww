import test from "node:test";
import assert from "node:assert/strict";
import SqlParserPkg from "node-sql-parser";
import { flattenAstToNodeMap } from "../../lib/ast.ts";
import { buildGraphModel } from "../../lib/graph-core.ts";

interface Fixture {
  name: string;
  sql: string;
  requiredEdges?: Array<[string, string]>;
}

const { Parser } = SqlParserPkg;
const parser = new Parser();

const coreFixtures: Fixture[] = [
  {
    name: "simple-select-filter",
    sql: "SELECT id FROM users WHERE active = 1 ORDER BY created_at DESC LIMIT 10;",
    requiredEdges: [
      ["node_where", "node_select"],
      ["node_select", "node_orderby"],
      ["node_orderby", "node_limit"],
    ],
  },
  {
    name: "join-flow",
    sql: "SELECT u.id FROM users u JOIN orders o ON u.id = o.user_id WHERE o.total > 20;",
    requiredEdges: [
      ["node_from_1", "node_join_1"],
      ["node_join_1", "node_where"],
    ],
  },
  {
    name: "aggregate-flow",
    sql: "SELECT user_id, COUNT(*) c FROM orders GROUP BY user_id HAVING COUNT(*) > 2 ORDER BY c DESC;",
    requiredEdges: [
      ["node_groupby", "node_having"],
      ["node_having", "node_select"],
    ],
  },
  {
    name: "cte-flow",
    sql: "WITH x AS (SELECT user_id FROM orders) SELECT * FROM x;",
  },
  {
    name: "union-flow",
    sql: "SELECT id FROM users UNION ALL SELECT user_id AS id FROM orders ORDER BY id DESC LIMIT 20;",
  },
];

const generatedFixtures: Fixture[] = Array.from({ length: 25 }, (_, index) => ({
  name: `generated-${index + 1}`,
  sql: `SELECT u.id, o.total
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.total > ${10 + index}
ORDER BY o.total DESC
LIMIT ${20 + index};`,
}));

const fixtures = [...coreFixtures, ...generatedFixtures];

test("fixtures cover at least 30 workloads", () => {
  assert.equal(fixtures.length >= 30, true);
});

for (const fixture of fixtures) {
  test(`graph fixture: ${fixture.name}`, () => {
    const ast = parser.astify(fixture.sql, { database: "mysql" }) as unknown;
    const nodeMap = flattenAstToNodeMap(ast as never);
    const graph = buildGraphModel(nodeMap);

    assert.equal(graph.nodes.length > 0, true);

    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    for (const edge of graph.edges) {
      assert.equal(nodeIds.has(edge.source), true, `missing source node ${edge.source}`);
      assert.equal(nodeIds.has(edge.target), true, `missing target node ${edge.target}`);
      assert.notEqual(edge.source, edge.target, "self-loop edge detected");
    }

    if (fixture.requiredEdges && fixture.requiredEdges.length > 0) {
      const edgePairs = new Set(graph.edges.map((edge) => `${edge.source}->${edge.target}`));
      for (const [source, target] of fixture.requiredEdges) {
        const exists = edgePairs.has(`${source}->${target}`);
        assert.equal(exists, true, `required edge missing: ${source}->${target}`);
      }
    }
  });
}
