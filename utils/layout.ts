import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

/* ------------------------------------------------------------------ */
/*  Default node dimensions — fallbacks when no measured height exists */
/* ------------------------------------------------------------------ */

const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 180; // compact collapsed height
const HORIZONTAL_SPACING = 140; // distance between ranks (LR)
const VERTICAL_SPACING = 70;

/* Padding inside CTE group bounding boxes so children don't touch the border */
const GROUP_PADDING = 40;

/* ------------------------------------------------------------------ */
/*  getLayoutedElements                                                */
/*  Runs dagre on the current nodes + edges and returns new arrays     */
/*  with calculated { x, y } positions for a Left-to-Right DAG.       */
/*                                                                     */
/*  nodeHeights — map of nodeId → measured DOM height in pixels.       */
/*  When provided, dagre uses the real height instead of guessing.     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Semantic Ranking                                                   */
/* ------------------------------------------------------------------ */

const RANK_MAP: Record<string, number> = {
  from: 0,
  join: 1,
  where: 1,
  having: 1,
  groupby: 2,
  select: 3,
  orderby: 4,
  limit: 4,
  union: 4,
  unknown: 5,
};

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "LR",
  nodeHeights?: Map<string, number>
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph({ compound: true });

  g.setDefaultEdgeLabel(() => ({}));

  g.setGraph({
    rankdir: direction,
    nodesep: VERTICAL_SPACING,
    ranksep: HORIZONTAL_SPACING,
    marginx: 40,
    marginy: 40,
    ranker: "network-simplex", // better for lanes
  });

  // 1. IDENTIFY COLLAPSED CTE GROUPS
  const collapsedGroups = new Set<string>();
  for (const node of nodes) {
    if (node.type === "cteGroup" && node.data?.isExpanded === false) {
      collapsedGroups.add(node.id);
    }
  }

  // 2. FILTER NODES: Exclude children of collapsed groups
  const visibleNodes = nodes.filter((node) => {
    if (node.parentId && collapsedGroups.has(node.parentId)) {
      return false; // hide child
    }
    return true;
  });

  // 3. REWIRE EDGES
  const visibleEdges: Edge[] = [];
  const edgeKeySet = new Set<string>();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  for (const edge of edges) {
    let sourceId = edge.source;
    let targetId = edge.target;

    const sourceNode = nodeById.get(sourceId);
    if (sourceNode?.parentId && collapsedGroups.has(sourceNode.parentId)) {
      sourceId = sourceNode.parentId;
    }

    const targetNode = nodeById.get(targetId);
    if (targetNode?.parentId && collapsedGroups.has(targetNode.parentId)) {
      targetId = targetNode.parentId;
    }

    if (sourceId === targetId) continue;

    const key = `${sourceId}->${targetId}`;
    if (!edgeKeySet.has(key)) {
      edgeKeySet.add(key);
      visibleEdges.push({
        ...edge,
        id: `rw-${edge.id}`,
        source: sourceId,
        target: targetId,
      });
    }
  }

  // 4. REGISTER VISIBLE NODES WITH RANKS
  for (const node of visibleNodes) {
    const nodeType = (node.data as { nodeType?: string })?.nodeType || "unknown";

    const rank = RANK_MAP[nodeType] ?? 5;

    if (node.type === "cteGroup") {
      const isExpanded = node.data?.isExpanded !== false;
      if (isExpanded) {
        g.setNode(node.id, {
          width: 0,
          height: 0,
          paddingLeft: GROUP_PADDING,
          paddingRight: GROUP_PADDING,
          paddingTop: GROUP_PADDING + 24,
          paddingBottom: GROUP_PADDING,
        });
      } else {
        g.setNode(node.id, { width: DEFAULT_NODE_WIDTH, height: 80, rank: 0 }); // CTEs start left
      }
    } else {
      const measuredH = nodeHeights?.get(node.id);
      const h = measuredH ?? DEFAULT_NODE_HEIGHT;
      // If it's a child of a CTE, we might want to let dagre handle local ranking
      // But for global consistency, we apply semantic ranking
      g.setNode(node.id, { width: DEFAULT_NODE_WIDTH, height: h, rank });
    }

    if (node.parentId && g.hasNode(node.parentId)) {
      g.setParent(node.id, node.parentId);
    }
  }

  // 5. REGISTER VISIBLE EDGES
  for (const edge of visibleEdges) {
    g.setEdge(edge.source, edge.target);
  }

  // Run the layout algorithm
  let layoutFailed = false;
  try {
    dagre.layout(g);
  } catch (err) {
    console.error("[D3xTRverse] dagre.layout() failed", err);
    layoutFailed = true;
  }

  // 6. MAP POSITIONS BACK
  const dagreNodeMap = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  for (const node of visibleNodes) {
    if (layoutFailed) {
      dagreNodeMap.set(node.id, { x: 0, y: 0, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
    } else {
      const dn = g.node(node.id);
      if (dn) {
        dagreNodeMap.set(node.id, { x: dn.x, y: dn.y, width: dn.width, height: dn.height });
      } else {
        dagreNodeMap.set(node.id, { x: 0, y: 0, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
      }
    }
  }

  const layoutedNodes: Node[] = visibleNodes.map((node) => {
    const dn = dagreNodeMap.get(node.id) ?? { x: 0, y: 0, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };

    if (node.type === "cteGroup") {
      return {
        ...node,
        position: { x: dn.x - dn.width / 2, y: dn.y - dn.height / 2 },
        style: { ...node.style, width: dn.width, height: dn.height },
      };
    }

    if (node.parentId) {
      const parentDn = dagreNodeMap.get(node.parentId);
      if (parentDn) {
        const measuredH = nodeHeights?.get(node.id);
        const h = measuredH ?? DEFAULT_NODE_HEIGHT;
        const parentTopLeftX = parentDn.x - parentDn.width / 2;
        const parentTopLeftY = parentDn.y - parentDn.height / 2;
        const childTopLeftX = dn.x - DEFAULT_NODE_WIDTH / 2;
        const childTopLeftY = dn.y - h / 2;

        return {
          ...node,
          position: {
            x: childTopLeftX - parentTopLeftX,
            y: childTopLeftY - parentTopLeftY,
          },
        };
      }
    }

    const measuredH = nodeHeights?.get(node.id);
    const h = measuredH ?? DEFAULT_NODE_HEIGHT;

    return {
      ...node,
      position: { x: dn.x - DEFAULT_NODE_WIDTH / 2, y: dn.y - h / 2 },
    };
  });

  return { nodes: layoutedNodes, edges: visibleEdges };
}
