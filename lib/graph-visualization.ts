import type { Node, Edge } from "@xyflow/react";
import { type SqlNodeData } from "@/components/SqlNode";
import { getLayoutedElements } from "@/utils/layout";
import { buildAdjacency, buildGraphModel, type GraphNodeKind, type NodeMapInput } from "@/lib/graph-core";

export type NodeMapObj = {
  sql: string;
  parentId?: string;
  isGroup?: boolean;
  label?: string;
  isExpanded?: boolean;
  [key: string]: unknown;
};
export type NodeMap = Record<string, NodeMapObj>;
export type Explanations = Record<string, string>;

const LAYER_LABELS: Record<string, string> = {
  from: "FROM",
  join: "JOIN",
  where: "WHERE",
  groupby: "GROUP BY",
  having: "HAVING",
  select: "SELECT",
  orderby: "ORDER BY",
  limit: "LIMIT",
  union: "UNION",
  unknown: "STEP",
};

const EDGE_COLORS: Record<string, string> = {
  source: "#3b82f6",
  join: "#a855f7",
  filter: "#f59e0b",
  aggregate: "#10b981",
  output: "#cbd5e1",
};

function detectNodeType(key: string): GraphNodeKind {
  const normalized = key.replace(/_u\d+$/, "");
  if (normalized.startsWith("node_from")) return "from";
  if (normalized.startsWith("node_join")) return "join";
  if (normalized.startsWith("node_where")) return "where";
  if (normalized.startsWith("node_groupby")) return "groupby";
  if (normalized.startsWith("node_having")) return "having";
  if (normalized.startsWith("node_select")) return "select";
  if (normalized.startsWith("node_orderby")) return "orderby";
  if (normalized.startsWith("node_limit")) return "limit";
  if (normalized.startsWith("node_union")) return "union";
  return "unknown";
}

function getOperationType(layerType: string): string {
  if (layerType === "from") return "source";
  if (layerType === "join") return "join";
  if (layerType === "where" || layerType === "having") return "filter";
  if (layerType === "groupby" || layerType === "orderby") return "aggregate";
  return "output";
}

export function getActivePath(
  nodeId: string,
  edges: Edge[]
): { activeNodes: Set<string>; activeEdges: Set<string> } {
  const activeNodes = new Set<string>();
  const activeEdges = new Set<string>();

  const { incoming, outgoing, edgeIdsByPair } = buildAdjacency(edges);

  const walk = (start: string, graph: Map<string, string[]>, direction: "up" | "down") => {
    const stack = [start];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      if (activeNodes.has(current)) continue;

      activeNodes.add(current);
      const neighbors = graph.get(current) ?? [];
      for (const neighbor of neighbors) {
        const edgeKey = direction === "up" ? `${neighbor}->${current}` : `${current}->${neighbor}`;
        const edgeId = edgeIdsByPair.get(edgeKey);
        if (edgeId) {
          activeEdges.add(edgeId);
        }
        stack.push(neighbor);
      }
    }
  };

  walk(nodeId, incoming, "up");
  walk(nodeId, outgoing, "down");

  return { activeNodes, activeEdges };
}

export function transformToGraph(
  nodeMap: NodeMap,
  explanations: Explanations,
  onExpandToggle: (nodeId: string, expanded: boolean) => void,
  onHeightReport: (nodeId: string, height: number) => void,
  onCteExpandToggle: (nodeId: string, expanded: boolean) => void,
  nodeHeights?: Map<string, number>,
  isMobileSafari?: boolean,
  expandedNodeIds?: Set<string>
): { nodes: Node[]; edges: Edge[] } {
  const entries = Object.entries(nodeMap);

  const nodes: Node[] = [];
  const edgeList: Edge[] = [];

  for (const [key, val] of entries) {
    const isObj = typeof val === "object" && val !== null;
    const isGroup = isObj ? val.isGroup : undefined;
    const label = isObj ? val.label : undefined;

    if (isGroup) {
      if (!isMobileSafari) {
        nodes.push({
          id: key,
          type: "cteGroup",
          data: { label, isExpanded: val.isExpanded, onCteExpandToggle, nodeId: key },
          position: { x: 0, y: 0 },
          style: { zIndex: -1 },
        });
      }
      continue;
    }

    const layerType = detectNodeType(key);
    const nodeData: SqlNodeData = {
      label: LAYER_LABELS[layerType] ?? layerType.toUpperCase(),
      sql: val.sql,
      explanation: explanations[key] || "Processing…",
      nodeType: layerType,
      operationType: getOperationType(layerType),
      onExpandToggle,
      onHeightReport,
      nodeId: key,
      expanded: expandedNodeIds?.has(key) ?? false,
    };

    nodes.push({
      id: key,
      type: "sqlNode",
      parentId: isMobileSafari ? undefined : val.parentId,
      extent: val.parentId && !isMobileSafari ? "parent" : undefined,
      position: { x: 0, y: 0 },
      data: nodeData as unknown as Record<string, unknown>,
    });
  }

  const graphModel = buildGraphModel(nodeMap as NodeMapInput);

  for (const graphEdge of graphModel.edges) {
    const sourceKind = detectNodeType(graphEdge.source);
    const sourceOpType = getOperationType(sourceKind);
    
    // Choose color based on reason or source type
    let color = EDGE_COLORS[sourceOpType] ?? "#6366f1";
    let animated = false;
    let strokeWidth = 2;

    if (graphEdge.reason === "projection" && sourceKind === "select") {
       // This is likely a CTE output connection
       color = "#3b82f6"; // source color
       animated = true;
       strokeWidth = 3;
    }

    edgeList.push({
      id: `edge-${graphEdge.source}-${graphEdge.target}`,
      source: graphEdge.source,
      target: graphEdge.target,
      type: "smoothstep",
      animated,
      // @ts-expect-error pathOptions is valid for smoothstep.
      pathOptions: { borderRadius: 24 },
      data: {
        originalColor: color,
        reason: graphEdge.reason,
      },
      style: {
        stroke: color,
        strokeWidth,
        opacity: animated ? 0.8 : 0.55,
      },
    });
  }

  return getLayoutedElements(nodes, edgeList, "LR", nodeHeights);
}

export function createFallbackExplanations(
  nodeMap: NodeMap,
  message: string
): Explanations {
  const fallback: Explanations = {};
  for (const key of Object.keys(nodeMap)) {
    fallback[key] = message;
  }
  return fallback;
}

export function applyExplanationsToExistingNodes(
  currentNodes: Node[],
  explanations: Explanations
): Node[] {
  let changed = false;

  const nextNodes = currentNodes.map((node) => {
    if (node.type !== "sqlNode") return node;

    const data = node.data as unknown as SqlNodeData;
    const nextExplanation = explanations[node.id] ?? data.explanation ?? "Processing…";

    if (data.explanation === nextExplanation) return node;
    changed = true;

    return {
      ...node,
      data: {
        ...(node.data as Record<string, unknown>),
        explanation: nextExplanation,
      },
    };
  });

  return changed ? nextNodes : currentNodes;
}
