import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

/* ------------------------------------------------------------------ */
/*  Default node dimensions — fallbacks when no measured height exists */
/* ------------------------------------------------------------------ */

const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 180; // compact collapsed height
const HORIZONTAL_SPACING = 100; // distance between ranks (LR)
const VERTICAL_SPACING = 50;

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

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB",
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

  // 3. REWIRE EDGES: redirect edges pointing to/from hidden children to their CTE parent
  const visibleEdges: Edge[] = [];
  const edgeKeySet = new Set<string>();

  for (const edge of edges) {
    let sourceId = edge.source;
    let targetId = edge.target;

    const sourceNode = nodes.find(n => n.id === sourceId);
    if (sourceNode?.parentId && collapsedGroups.has(sourceNode.parentId)) {
      sourceId = sourceNode.parentId;
    }

    const targetNode = nodes.find(n => n.id === targetId);
    if (targetNode?.parentId && collapsedGroups.has(targetNode.parentId)) {
      targetId = targetNode.parentId;
    }

    // Skip self-loops
    if (sourceId === targetId) continue;

    // Deduplicate identical edges after rewiring
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

  // Register every VISIBLE node
  for (const node of visibleNodes) {
    if (node.type === "cteGroup") {
      const isExpanded = node.data?.isExpanded !== false;
      if (isExpanded) {
        // Expanded: use layout padding so Dagre sizes to fit children
        g.setNode(node.id, {
          width: 0,
          height: 0,
          paddingLeft: GROUP_PADDING,
          paddingRight: GROUP_PADDING,
          paddingTop: GROUP_PADDING + 16,
          paddingBottom: GROUP_PADDING,
        });
      } else {
        // Collapsed: fixed compact size
        g.setNode(node.id, { width: DEFAULT_NODE_WIDTH, height: 80 });
      }
    } else {
      const measuredH = nodeHeights?.get(node.id);
      const h = measuredH ?? DEFAULT_NODE_HEIGHT;
      g.setNode(node.id, { width: DEFAULT_NODE_WIDTH, height: h });
    }

    if (node.parentId && g.hasNode(node.parentId)) {
      g.setParent(node.id, node.parentId);
    }
  }

  // Register every VISIBLE edge
  for (const edge of visibleEdges) {
    g.setEdge(edge.source, edge.target);
  }

  // Run the layout algorithm
  let layoutFailed = false;
  try {
    dagre.layout(g);
  } catch (err) {
    console.error("[D3xTRverse] dagre.layout() failed — using fallback positions", err);
    layoutFailed = true;
  }

  // Build a lookup for dagre-computed positions
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

  // Map dagre positions back onto React Flow nodes
  const layoutedNodes: Node[] = visibleNodes.map((node) => {
    const dn = dagreNodeMap.get(node.id) ?? { x: 0, y: 0, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };

    // ── CTE Group Node ──
    if (node.type === "cteGroup") {
      return {
        ...node,
        position: {
          x: dn.x - dn.width / 2,
          y: dn.y - dn.height / 2,
        },
        style: {
          ...node.style,
          width: dn.width,
          height: dn.height,
        },
      };
    }

    // ── Child Node (has parentId) ──
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

    // ── Regular Node (no parent) ──
    const measuredH = nodeHeights?.get(node.id);
    const h = measuredH ?? DEFAULT_NODE_HEIGHT;

    return {
      ...node,
      position: {
        x: dn.x - DEFAULT_NODE_WIDTH / 2,
        y: dn.y - h / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges: visibleEdges };
}
