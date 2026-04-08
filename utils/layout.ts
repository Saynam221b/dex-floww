import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

/* ------------------------------------------------------------------ */
/*  Default node dimensions — fallbacks when no measured height exists */
/* ------------------------------------------------------------------ */

const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 180; // compact collapsed height
const HORIZONTAL_SPACING = 80;
const VERTICAL_SPACING = 60;

/* ------------------------------------------------------------------ */
/*  getLayoutedElements                                                */
/*  Runs dagre on the current nodes + edges and returns new arrays     */
/*  with calculated { x, y } positions for a top-to-bottom DAG.       */
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
  const g = new dagre.graphlib.Graph();

  g.setDefaultEdgeLabel(() => ({}));

  g.setGraph({
    rankdir: direction,
    nodesep: HORIZONTAL_SPACING,
    ranksep: VERTICAL_SPACING,
    marginx: 40,
    marginy: 40,
  });

  // Register every node — use measured height if available, else default
  for (const node of nodes) {
    const measuredH = nodeHeights?.get(node.id);
    const h = measuredH ?? DEFAULT_NODE_HEIGHT;
    g.setNode(node.id, {
      width: DEFAULT_NODE_WIDTH,
      height: h,
    });
  }

  // Register every edge
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  // Run the layout algorithm
  dagre.layout(g);

  // Map dagre positions back onto React Flow nodes
  const layoutedNodes: Node[] = nodes.map((node) => {
    const dagreNode = g.node(node.id);
    const measuredH = nodeHeights?.get(node.id);
    const h = measuredH ?? DEFAULT_NODE_HEIGHT;

    // dagre returns center coordinates — React Flow uses top-left origin
    return {
      ...node,
      position: {
        x: dagreNode.x - DEFAULT_NODE_WIDTH / 2,
        y: dagreNode.y - h / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
