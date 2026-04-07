import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

/* ------------------------------------------------------------------ */
/*  Default node dimensions — must match rendered SqlNode size         */
/* ------------------------------------------------------------------ */

const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 180; // compact collapsed height
const EXPANDED_NODE_HEIGHT = 320; // height when AI explanation is visible
const HORIZONTAL_SPACING = 80;
const VERTICAL_SPACING = 100;

/* ------------------------------------------------------------------ */
/*  getLayoutedElements                                                */
/*  Runs dagre on the current nodes + edges and returns new arrays     */
/*  with calculated { x, y } positions for a top-to-bottom DAG.       */
/*                                                                     */
/*  expandedNodeIds — set of node IDs currently showing AI insight.    */
/*  dagre uses the taller height for these so neighbours shift away.   */
/* ------------------------------------------------------------------ */

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB",
  expandedNodeIds?: Set<string>
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

  // Register every node with dagre — expanded nodes get a taller height
  for (const node of nodes) {
    const isExpanded = expandedNodeIds?.has(node.id) ?? false;
    g.setNode(node.id, {
      width: DEFAULT_NODE_WIDTH,
      height: isExpanded ? EXPANDED_NODE_HEIGHT : DEFAULT_NODE_HEIGHT,
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
    const isExpanded = expandedNodeIds?.has(node.id) ?? false;
    const h = isExpanded ? EXPANDED_NODE_HEIGHT : DEFAULT_NODE_HEIGHT;

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
