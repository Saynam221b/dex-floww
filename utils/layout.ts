import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

/* ------------------------------------------------------------------ */
/*  Default node dimensions — fallbacks when no measured height exists */
/* ------------------------------------------------------------------ */

const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 180; // compact collapsed height
const HORIZONTAL_SPACING = 150; // distance between ranks (LR)
const VERTICAL_SPACING = 60;

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

  // Register every node — use measured height if available, else default.
  // CTE group (compound) nodes use a small placeholder size; dagre will
  // expand them automatically to enclose their children.
  for (const node of nodes) {
    if (node.type === "cteGroup") {
      // Register compound parent with internal padding so children
      // don't collide with the group border.
      g.setNode(node.id, {
        width: 0,
        height: 0,
        paddingLeft: GROUP_PADDING,
        paddingRight: GROUP_PADDING,
        paddingTop: GROUP_PADDING + 16, // extra top padding for the CTE label badge
        paddingBottom: GROUP_PADDING,
      });
    } else {
      const measuredH = nodeHeights?.get(node.id);
      const h = measuredH ?? DEFAULT_NODE_HEIGHT;
      g.setNode(node.id, { width: DEFAULT_NODE_WIDTH, height: h });
    }

    if (node.parentId) {
      g.setParent(node.id, node.parentId);
    }
  }

  // Register every edge
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  // Run the layout algorithm
  dagre.layout(g);

  // Build a lookup for dagre-computed positions of parent (group) nodes
  // so we can convert children to parent-relative coordinates.
  const dagreNodeMap = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  for (const node of nodes) {
    const dn = g.node(node.id);
    dagreNodeMap.set(node.id, {
      x: dn.x,
      y: dn.y,
      width: dn.width,
      height: dn.height,
    });
  }

  // Map dagre positions back onto React Flow nodes
  const layoutedNodes: Node[] = nodes.map((node) => {
    const dn = dagreNodeMap.get(node.id)!;

    // ── CTE Group Node ──
    // Apply dagre-computed width/height so the bounding box renders correctly.
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
    // React Flow requires child positions RELATIVE to the parent's top-left.
    // dagre returns center-based absolute coordinates for both parent and child.
    if (node.parentId) {
      const parentDn = dagreNodeMap.get(node.parentId);
      if (parentDn) {
        const measuredH = nodeHeights?.get(node.id);
        const h = measuredH ?? DEFAULT_NODE_HEIGHT;

        // Parent top-left (absolute)
        const parentTopLeftX = parentDn.x - parentDn.width / 2;
        const parentTopLeftY = parentDn.y - parentDn.height / 2;

        // Child top-left (absolute)
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

  return { nodes: layoutedNodes, edges };
}
