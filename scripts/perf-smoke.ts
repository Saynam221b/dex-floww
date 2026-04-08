import SqlParserPkg from "node-sql-parser";
import { flattenAstToNodeMap } from "../lib/ast.ts";
import { buildAdjacency, buildGraphModel } from "../lib/graph-core.ts";
import { getLayoutedElements } from "../utils/layout.ts";
import { WORKLOADS, type SqlWorkload } from "../tests/perf/workloads.ts";

const { Parser } = SqlParserPkg;
const parser = new Parser();

const BUDGETS_MS = {
  visualizeP95: 500,
  clickHighlightP95: 16,
  explainFallbackP95: 200,
  pngExportP95: 2000,
} as const;

const WARMUP_RUNS = 2;
const MEASURE_RUNS = 8;

interface PerfResult {
  parseMs: number[];
  graphBuildMs: number[];
  layoutMs: number[];
  clickHighlightMs: number[];
  explainFallbackMs: number[];
  exportMs: number[];
}

interface PerfSummary {
  name: SqlWorkload["name"];
  metrics: {
    parseP95: number;
    graphBuildP95: number;
    layoutP95: number;
    visualizeP95: number;
    clickHighlightP95: number;
    explainFallbackP95: number;
    exportP95: number;
  };
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[idx];
}

function nowMs(): number {
  return performance.now();
}

function toLayoutInputs(graph: ReturnType<typeof buildGraphModel>) {
  const nodes = graph.nodes.map((node) => ({
    id: node.id,
    type: "sqlNode",
    position: { x: 0, y: 0 },
    data: {
      label: node.kind.toUpperCase(),
      sql: node.sql,
      explanation: "",
      nodeType: node.kind,
      operationType: "output",
    },
  }));

  const edges = graph.edges.map((edge, index) => ({
    id: `edge-${index}`,
    source: edge.source,
    target: edge.target,
    data: { reason: edge.reason },
  }));

  return { nodes, edges };
}

function measureHighlightLatency(edges: Array<{ id: string; source: string; target: string }>): number {
  const start = nowMs();
  const { incoming, outgoing, edgeIdsByPair } = buildAdjacency(edges);

  const nodePool = new Set<string>();
  for (const edge of edges) {
    nodePool.add(edge.source);
    nodePool.add(edge.target);
  }

  const candidates = [...nodePool];
  if (candidates.length === 0) {
    return nowMs() - start;
  }

  const runWalk = (seed: string) => {
    const visited = new Set<string>();
    const edgeHits = new Set<string>();
    const stack = [seed];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || visited.has(current)) continue;
      visited.add(current);

      const ins = incoming.get(current) ?? [];
      const outs = outgoing.get(current) ?? [];

      for (const inNode of ins) {
        const edgeId = edgeIdsByPair.get(`${inNode}->${current}`);
        if (edgeId) edgeHits.add(edgeId);
        stack.push(inNode);
      }

      for (const outNode of outs) {
        const edgeId = edgeIdsByPair.get(`${current}->${outNode}`);
        if (edgeId) edgeHits.add(edgeId);
        stack.push(outNode);
      }
    }

    return edgeHits.size;
  };

  for (let i = 0; i < 64; i += 1) {
    runWalk(candidates[i % candidates.length]);
  }

  return nowMs() - start;
}

function measureExplainFallbackLatency(nodeMap: ReturnType<typeof flattenAstToNodeMap>): number {
  const start = nowMs();
  const explanations: Record<string, string> = {};

  for (const [id, value] of Object.entries(nodeMap)) {
    const sql = value.sql.toLowerCase();
    if (/\bjoin\b/.test(sql)) {
      explanations[id] = "Combines sources to enrich rows.";
    } else if (/\bwhere\b|\bhaving\b/.test(sql)) {
      explanations[id] = "Filters rows using predicate logic.";
    } else if (/\bgroup by\b|\border by\b/.test(sql)) {
      explanations[id] = "Organizes rows for aggregate output.";
    } else {
      explanations[id] = "Produces output rows for downstream use.";
    }
  }

  JSON.stringify(explanations);
  return nowMs() - start;
}

function measureExportLatency(payload: unknown): number {
  const start = nowMs();
  const serialized = JSON.stringify(payload);
  Buffer.from(serialized).toString("base64");
  return nowMs() - start;
}

function runSingleWorkload(workload: SqlWorkload): PerfResult {
  const result: PerfResult = {
    parseMs: [],
    graphBuildMs: [],
    layoutMs: [],
    clickHighlightMs: [],
    explainFallbackMs: [],
    exportMs: [],
  };

  for (let run = 0; run < WARMUP_RUNS + MEASURE_RUNS; run += 1) {
    const parseStart = nowMs();
    const ast = parser.astify(workload.sql, { database: workload.dialect }) as unknown;
    const parseDuration = nowMs() - parseStart;

    const graphStart = nowMs();
    const nodeMap = flattenAstToNodeMap(ast as never);
    const graph = buildGraphModel(nodeMap);
    const graphDuration = nowMs() - graphStart;

    const { nodes, edges } = toLayoutInputs(graph);

    const layoutStart = nowMs();
    const layouted = getLayoutedElements(nodes as never, edges as never, "LR");
    const layoutDuration = nowMs() - layoutStart;

    const clickDuration = measureHighlightLatency(edges);
    const explainDuration = measureExplainFallbackLatency(nodeMap);
    const exportDuration = measureExportLatency(layouted);

    if (run >= WARMUP_RUNS) {
      result.parseMs.push(parseDuration);
      result.graphBuildMs.push(graphDuration);
      result.layoutMs.push(layoutDuration);
      result.clickHighlightMs.push(clickDuration);
      result.explainFallbackMs.push(explainDuration);
      result.exportMs.push(exportDuration);
    }
  }

  return result;
}

export function runPerfSmoke(): { summaries: PerfSummary[]; passed: boolean; failures: string[] } {
  const summaries: PerfSummary[] = [];

  for (const workload of WORKLOADS) {
    const result = runSingleWorkload(workload);
    const parseP95 = p95(result.parseMs);
    const graphBuildP95 = p95(result.graphBuildMs);
    const layoutP95 = p95(result.layoutMs);
    const visualizeP95 = parseP95 + graphBuildP95 + layoutP95;

    summaries.push({
      name: workload.name,
      metrics: {
        parseP95,
        graphBuildP95,
        layoutP95,
        visualizeP95,
        clickHighlightP95: p95(result.clickHighlightMs),
        explainFallbackP95: p95(result.explainFallbackMs),
        exportP95: p95(result.exportMs),
      },
    });
  }

  const failures: string[] = [];
  for (const summary of summaries) {
    if (summary.metrics.visualizeP95 > BUDGETS_MS.visualizeP95) {
      failures.push(
        `${summary.name}: visualize P95 ${summary.metrics.visualizeP95.toFixed(2)}ms > ${BUDGETS_MS.visualizeP95}ms`
      );
    }
    if (summary.metrics.clickHighlightP95 > BUDGETS_MS.clickHighlightP95) {
      failures.push(
        `${summary.name}: click-highlight P95 ${summary.metrics.clickHighlightP95.toFixed(2)}ms > ${BUDGETS_MS.clickHighlightP95}ms`
      );
    }
    if (summary.metrics.explainFallbackP95 > BUDGETS_MS.explainFallbackP95) {
      failures.push(
        `${summary.name}: explain fallback P95 ${summary.metrics.explainFallbackP95.toFixed(2)}ms > ${BUDGETS_MS.explainFallbackP95}ms`
      );
    }
    if (summary.metrics.exportP95 > BUDGETS_MS.pngExportP95) {
      failures.push(
        `${summary.name}: export P95 ${summary.metrics.exportP95.toFixed(2)}ms > ${BUDGETS_MS.pngExportP95}ms`
      );
    }
  }

  return {
    summaries,
    passed: failures.length === 0,
    failures,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = runPerfSmoke();
  console.log("\nPerf Smoke Summary");
  console.table(
    report.summaries.map((entry) => ({
      workload: entry.name,
      parseP95: entry.metrics.parseP95.toFixed(2),
      graphBuildP95: entry.metrics.graphBuildP95.toFixed(2),
      layoutP95: entry.metrics.layoutP95.toFixed(2),
      visualizeP95: entry.metrics.visualizeP95.toFixed(2),
      clickHighlightP95: entry.metrics.clickHighlightP95.toFixed(2),
      explainFallbackP95: entry.metrics.explainFallbackP95.toFixed(2),
      exportP95: entry.metrics.exportP95.toFixed(2),
    }))
  );

  if (!report.passed) {
    console.error("\nPerf budgets failed:\n" + report.failures.join("\n"));
    process.exitCode = 1;
  }
}
