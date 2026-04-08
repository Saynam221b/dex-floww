"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import SplashScreen from "@/components/SplashScreen";
import DialectSelector from "@/components/DialectSelector";
import { runParserDiagnostics } from "@/utils/testParser";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
  type Node,
  type Edge,
  BackgroundVariant,
  ConnectionLineType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  Braces,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Zap,
  Database,
  BarChart3,
  Download,
  Maximize2,
  Minimize2,
  Share2,
  ChevronDown,
  Image as ImageIcon,
  Box,
  User,
  Terminal,
  MessageSquare,
  X,
  ExternalLink,
  Home as HomeIcon,
} from "lucide-react";
import SqlNodeComponent, { type SqlNodeData } from "@/components/SqlNode";
import CteGroupNode from "@/components/CteGroupNode";
import { getLayoutedElements } from "@/utils/layout";

import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-sql";
import "prismjs/themes/prism-tomorrow.css"; // dark theme
import { toPng, toSvg } from "html-to-image";
import LZString from "lz-string";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type NodeMapObj = { sql: string; parentId?: string; isGroup?: boolean; label?: string; [key: string]: unknown };
type NodeMap = Record<string, NodeMapObj>;
type Explanations = Record<string, string>;

/* ------------------------------------------------------------------ */
/*  Layer ordering — controls rank placement in DAG                    */
/* ------------------------------------------------------------------ */

const LAYER_ORDER: Record<string, number> = {
  from: 0,
  join: 1,
  where: 2,
  groupby: 3,
  having: 4,
  select: 5,
  orderby: 6,
  limit: 7,
  union: 8,
};

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
};

/* ------------------------------------------------------------------ */
/*  Edge colors per operation type                                     */
/* ------------------------------------------------------------------ */

const EDGE_COLORS: Record<string, string> = {
  source: "#3b82f6",
  join: "#a855f7",
  filter: "#f59e0b",
  aggregate: "#10b981",
  output: "#cbd5e1",
};

/* ------------------------------------------------------------------ */
/*  Detect node type from ID key                                       */
/* ------------------------------------------------------------------ */

function detectNodeType(key: string): string {
  // Strip UNION sub-query suffix like _u1, _u2 for type detection
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


/* ------------------------------------------------------------------ */
/*  Sample SQL queries for quick-start buttons                         */
/* ------------------------------------------------------------------ */

const SAMPLE_QUERIES: { label: string; icon: typeof Zap; sql: string }[] = [
  {
    label: "Simple JOIN",
    icon: Zap,
    sql: `SELECT users.name, orders.total
FROM users
JOIN orders ON users.id = orders.user_id
WHERE orders.total > 50
ORDER BY orders.total DESC;`,
  },
  {
    label: "Multi-CTE Analytics",
    icon: Database,
    sql: `WITH MonthlySales AS (
    SELECT DATE_FORMAT(order_date, '%Y-%m') AS month, SUM(total) AS revenue
    FROM orders
    WHERE order_date >= '2025-01-01'
    GROUP BY DATE_FORMAT(order_date, '%Y-%m')
),
TopCustomers AS (
    SELECT customer_id, SUM(total) AS lifetime_value
    FROM orders
    GROUP BY customer_id
    HAVING SUM(total) > 5000
)
SELECT ms.month, ms.revenue, COUNT(tc.customer_id) AS vip_customers
FROM MonthlySales ms
JOIN TopCustomers tc ON tc.lifetime_value > ms.revenue
GROUP BY ms.month, ms.revenue
ORDER BY ms.month DESC
LIMIT 12;`,
  },
  {
    label: "E-commerce Aggregation",
    icon: BarChart3,
    sql: `SELECT c.name, COUNT(o.id) AS order_count, SUM(o.total) AS revenue
FROM customers c
JOIN orders o ON c.id = o.customer_id
JOIN order_items oi ON o.id = oi.order_id
WHERE o.created_at >= '2024-01-01'
GROUP BY c.name
HAVING SUM(o.total) > 1000
ORDER BY revenue DESC
LIMIT 20;`,
  },
  {
    label: "Retention Funnel CTE",
    icon: Zap,
    sql: `WITH Signups AS (
    SELECT user_id, DATE(created_at) AS signup_date
    FROM users
    WHERE created_at >= '2025-01-01'
),
FirstPurchase AS (
    SELECT s.user_id, s.signup_date, MIN(o.order_date) AS first_order_date
    FROM Signups s
    JOIN orders o ON s.user_id = o.user_id
    GROUP BY s.user_id, s.signup_date
),
RetentionCohort AS (
    SELECT signup_date, COUNT(DISTINCT fp.user_id) AS converted_users,
        AVG(DATEDIFF(fp.first_order_date, fp.signup_date)) AS avg_days_to_convert
    FROM FirstPurchase fp
    GROUP BY signup_date
    HAVING COUNT(DISTINCT fp.user_id) > 5
)
SELECT rc.signup_date, rc.converted_users, rc.avg_days_to_convert, COUNT(s.user_id) AS total_signups
FROM RetentionCohort rc
JOIN Signups s ON rc.signup_date = s.signup_date
GROUP BY rc.signup_date, rc.converted_users, rc.avg_days_to_convert
ORDER BY rc.signup_date DESC
LIMIT 30;`,
  },
];

/* ------------------------------------------------------------------ */
/*  Transformation: nodeMap + explanations → React Flow graph          */
function getActivePath(nodeId: string, edges: Edge[]): { activeNodes: Set<string>; activeEdges: Set<string> } {
  const activeNodes = new Set<string>();
  const activeEdges = new Set<string>();

  const visitedAncestors = new Set<string>();
  const visitedDescendants = new Set<string>();

  const traverseUp = (id: string) => {
    if (visitedAncestors.has(id)) return;
    visitedAncestors.add(id);
    activeNodes.add(id);
    edges.forEach((e) => {
      if (e.target === id) {
        activeEdges.add(e.id);
        traverseUp(e.source);
      }
    });
  };

  const traverseDown = (id: string) => {
    if (visitedDescendants.has(id)) return;
    visitedDescendants.add(id);
    activeNodes.add(id);
    edges.forEach((e) => {
      if (e.source === id) {
        activeEdges.add(e.id);
        traverseDown(e.target);
      }
    });
  };

  traverseUp(nodeId);
  traverseDown(nodeId);

  return { activeNodes, activeEdges };
}

function transformToGraph(
  nodeMap: NodeMap,
  explanations: Explanations,
  onExpandToggle: (nodeId: string, expanded: boolean) => void,
  onHeightReport: (nodeId: string, height: number) => void,
  onCteExpandToggle: (nodeId: string, expanded: boolean) => void,
  nodeHeights?: Map<string, number>,
  isMobileSafari?: boolean
): { nodes: Node[]; edges: Edge[] } {
  const entries = Object.entries(nodeMap);

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Group by layer
  const layers: Record<string, { key: string; sql: string; parentId?: string }[]> = {};
  
  for (const [key, val] of entries) {
    const isObj = typeof val === "object" && val !== null;
    const sql = isObj ? val.sql : val;
    const parentId = isObj ? val.parentId : undefined;
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

    const type = detectNodeType(key);
    if (!layers[type]) layers[type] = [];
    layers[type].push({ key, sql, parentId });
  }

  // Sort layers by LAYER_ORDER
  const sortedLayerTypes = Object.keys(layers).sort(
    (a, b) => (LAYER_ORDER[a] ?? 99) - (LAYER_ORDER[b] ?? 99)
  );

  // Track previous layer's IDs for edges
  let prevLayerIds: string[] = [];

  sortedLayerTypes.forEach((layerType) => {
    const items = layers[layerType];
    const currentLayerIds: string[] = [];

    items.forEach((item) => {
      const id = item.key;
      currentLayerIds.push(id);

      const parentNode = item.parentId ? nodeMap[item.parentId] : null;
      const parentLabel = (typeof parentNode === "object" && parentNode !== null) ? (parentNode as any).label : null;

      const nodeData: SqlNodeData = {
        label: isMobileSafari && parentLabel 
          ? `[${parentLabel}] ${LAYER_LABELS[layerType] ?? layerType.toUpperCase()}`
          : (LAYER_LABELS[layerType] ?? layerType.toUpperCase()),
        sql: item.sql,
        explanation: explanations[item.key] || "Processing…",
        nodeType: layerType,
        operationType: getOperationType(layerType),
        onExpandToggle,
        onHeightReport,
        nodeId: id,
      };

      nodes.push({
        id,
        type: "sqlNode",
        parentId: isMobileSafari ? undefined : item.parentId,
        extent: (item.parentId && !isMobileSafari) ? "parent" : undefined,
        position: { x: 0, y: 0 },
        data: nodeData as unknown as Record<string, unknown>,
      });
    });

    // Smart edge creation: connect previous layer → current layer
    if (prevLayerIds.length > 0) {
      for (const sourceId of prevLayerIds) {
        for (const targetId of currentLayerIds) {
          const sourceType = detectNodeType(sourceId);
          const sourceOpType = getOperationType(sourceType);
          edges.push({
            id: `edge-${sourceId}-${targetId}`,
            source: sourceId,
            target: targetId,
            type: "smoothstep",
            animated: false,
            // @ts-ignore - pathOptions is valid for smoothstep but not typed in generic Edge
            pathOptions: { borderRadius: 24 },
            data: {
              originalColor: EDGE_COLORS[sourceOpType] ?? "#6366f1",
            },
            style: {
              stroke: EDGE_COLORS[sourceOpType] ?? "#6366f1",
              strokeWidth: 2,
              opacity: 0.55,
            },
          });
        }
      }
    }

    prevLayerIds = currentLayerIds;
  });

  // Run dagre layout with measured node heights
  return getLayoutedElements(nodes, edges, "LR", nodeHeights);
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

const nodeTypes = { sqlNode: SqlNodeComponent, cteGroup: CteGroupNode };

function FlowApp() {
  const [sql, setSql] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<"idle" | "parsing" | "explaining" | "rendering">("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<{ line?: number | null; column?: number | null } | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [showCreatorModal, setShowCreatorModal] = useState(false);
  const [dialect, setDialect] = useState("Standard SQL");
  const [toasterVisible, setToasterVisible] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { getNodes } = useReactFlow();

  /* ---- Device Detection & Stability ---- */
  const [isMobileSafari, setIsMobileSafari] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    if (isIOS && isSafari) {
      setIsMobileSafari(true);
      console.log("[D3xTRverse] Mobile Safari detected. Activating stability guards.");
    }
  }, []);

  /* ---- Splash Screen ---- */
  const [showSplash, setShowSplash] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  /* ---- Easter Egg ---- */
  const [showEasterEgg, setShowEasterEgg] = useState(false);

  /* ---- Chaos-to-Clarity Hero ---- */
  const [chaosCleared, setChaosCleared] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  /* ---- Interactive Path Highlighting ---- */
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const { activeNodes, activeEdges } = getActivePath(node.id, edges);

      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          style: {
            ...n.style,
            opacity: n.type === "cteGroup" || activeNodes.has(n.id) ? 1 : 0.3,
          },
        }))
      );

      setEdges((eds) =>
        eds.map((e) => {
          const isActive = activeEdges.has(e.id);
          const originalColor = (e.data?.originalColor as string) || "#6366f1";
          return {
            ...e,
            animated: isActive,
            style: {
              ...e.style,
              stroke: isActive ? "#22d3ee" : originalColor,
              opacity: isActive ? 1 : 0.2,
              strokeWidth: isActive ? 3 : 2,
              filter: isActive ? "drop-shadow(0 0 8px rgba(34,211,238,0.8))" : "none",
            },
          };
        })
      );
    },
    [edges, setNodes, setEdges]
  );

  const handlePaneClick = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        style: {
          ...n.style,
          opacity: 1,
        },
      }))
    );

    setEdges((eds) =>
      eds.map((e) => {
        const originalColor = (e.data?.originalColor as string) || "#6366f1";
        return {
          ...e,
          animated: false, // restore to static background
          style: {
            ...e.style,
            stroke: originalColor,
            opacity: 0.55,
            strokeWidth: 2,
            filter: "none",
          },
        };
      })
    );
  }, [setNodes, setEdges]);

  // Track measured node heights and stash raw data for re-layout
  const nodeHeightsRef = useRef<Map<string, number>>(new Map());
  const rawDataRef = useRef<{ nodeMap: NodeMap; explanations: Explanations } | null>(null);
  const relayoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---- URL Sync — lz-string compression (runs ONCE on mount) ---- */
  const hasLoadedUrl = useRef(false);
  // When true, handleVisualize will NOT re-inject the ?q= param.
  // This breaks the iOS Safari crash loop: load → strip → re-inject → reload.
  const isUrlTriggered = useRef(false);
  useEffect(() => {
    if (hasLoadedUrl.current) return;
    hasLoadedUrl.current = true;

    const urlParams = new URLSearchParams(window.location.search);
    const q = urlParams.get("q");
    if (!q) return;

    try {
      // Try lz-string first, fallback to legacy base64
      const decoded = LZString.decompressFromEncodedURIComponent(q) || atob(q);
      if (!decoded) return;

      // Immediately strip the ?q= param to prevent iOS Safari crash loops
      // on subsequent re-renders. Use native API — never Next.js router.
      window.history.replaceState(null, '', window.location.pathname);

      setSql(decoded);
      setChaosCleared(true);

      // Flag so handleVisualize skips URL re-injection
      isUrlTriggered.current = true;

      // Defer visualization to next tick so state is settled
      setTimeout(() => handleVisualize(decoded), 100);
    } catch (e) {
      console.error("Failed to decode query from URL", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- ReactFlow config ---- */
  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

  /* ---- Clear graph ---- */
  const clearGraph = useCallback(() => {
    setSql("");
    setNodes([]);
    setEdges([]);
    setHasResult(false);
    setError(null);
    setErrorDetails(null);
    setToasterVisible(false);
    nodeHeightsRef.current = new Map();
    rawDataRef.current = null;
    
    // Clear URL if possible
    const url = new URL(window.location.href);
    url.searchParams.delete("q");
    window.history.replaceState({}, '', url);
  }, [setNodes, setEdges]);

  /* ---- Debounced relayout using measured heights ---- */
  // Cap automatic relayout passes to prevent infinite ResizeObserver loops
  // on iOS Safari. Manual expand/collapse resets the counter.
  const relayoutCountRef = useRef(0);
  const MAX_AUTO_RELAYOUTS = isMobileSafari ? 1 : 3;

  const triggerRelayout = useCallback(() => {
    if (relayoutTimerRef.current) clearTimeout(relayoutTimerRef.current);
    relayoutTimerRef.current = setTimeout(() => {
      if (!rawDataRef.current) return;
      // Guard: prevent infinite relayout from ResizeObserver churn
      if (relayoutCountRef.current >= MAX_AUTO_RELAYOUTS) return;
      relayoutCountRef.current += 1;

      const { nodeMap, explanations } = rawDataRef.current;
      const { nodes: layoutedNodes, edges: layoutedEdges } = transformToGraph(
        nodeMap,
        explanations,
        handleExpandToggle,
        handleHeightReport,
        handleCteExpandToggle,
        nodeHeightsRef.current,
        isMobileSafari
      );
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    }, 200); // 200ms debounce — absorbs iOS reflow jitter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setNodes, setEdges]);

  /* ---- Height report callback from nodes ---- */
  const handleHeightReport = useCallback(
    (nodeId: string, height: number) => {
      const prev = nodeHeightsRef.current.get(nodeId);
      if (prev !== height) {
        nodeHeightsRef.current.set(nodeId, height);
        triggerRelayout();
      }
    },
    [triggerRelayout]
  );

  /* ---- CTE Expansion toggle callback ---- */
  const handleCteExpandToggle = useCallback(
    (nodeId: string, expanded: boolean) => {
      if (!rawDataRef.current) return;
      
      const nodeObj = rawDataRef.current.nodeMap[nodeId];
      if (nodeObj && typeof nodeObj === 'object') {
        nodeObj.isExpanded = expanded;
      }
      
      // Manual action — reset the auto-relayout cap
      relayoutCountRef.current = 0;

      triggerRelayout();
    },
    [triggerRelayout]
  );

  /* ---- Expansion toggle callback — re-runs dagre ---- */
  const handleExpandToggle = useCallback(
    (nodeId: string, expanded: boolean) => {
      if (!expanded) {
        // When collapsing, remove stored height so default is used
        nodeHeightsRef.current.delete(nodeId);
      }

      // Manual action — reset the auto-relayout cap
      relayoutCountRef.current = 0;

      // Re-layout using stashed raw data
      triggerRelayout();
    },
    [triggerRelayout]
  );

  /* ---- Expand / Collapse All ---- */
  const handleToggleAll = useCallback((expand: boolean) => {
    if (!rawDataRef.current) return;

    if (!expand) {
      nodeHeightsRef.current = new Map();
    }

    const { nodeMap, explanations } = rawDataRef.current;
    const { nodes: layoutedNodes, edges: layoutedEdges } = transformToGraph(
      nodeMap,
      explanations,
      handleExpandToggle,
      handleHeightReport,
      handleCteExpandToggle,
      nodeHeightsRef.current,
      isMobileSafari
    );
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [setNodes, setEdges, handleExpandToggle, handleHeightReport]);

  /* ---- Full-Canvas Export (High-Quality) ---- */
  const handleDownloadPNG = useCallback(() => {
    if (reactFlowWrapper.current === null) return;
    setExportMenuOpen(false);

    const allNodes = getNodes();
    if (allNodes.length === 0) return;

    const nodeBounds = getNodesBounds(allNodes);
    const padding = 100;
    const imageWidth = nodeBounds.width + padding * 2;
    const imageHeight = nodeBounds.height + padding * 2;

    // Use zoom 1 so nodes render at their true pixel size
    const viewport = getViewportForBounds(
      nodeBounds,
      imageWidth,
      imageHeight,
      1,   // minZoom — keep 1:1 scale for clarity
      1,   // maxZoom — prevent upscaling artifacts
      padding
    );

    const flowViewport = reactFlowWrapper.current.querySelector(
      '.react-flow__viewport'
    ) as HTMLElement;
    if (!flowViewport) return;

    const exportOptions = {
      backgroundColor: '#0f172a',
      width: imageWidth,
      height: imageHeight,
      pixelRatio: 3, // 3x for retina-quality output
      quality: 1,
      style: {
        width: `${imageWidth}px`,
        height: `${imageHeight}px`,
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      },
      filter: (node: Element) => {
        // Exclude minimap, controls, and attribution from export
        const cls = node.classList;
        if (!cls) return true;
        return (
          !cls.contains('react-flow__minimap') &&
          !cls.contains('react-flow__controls') &&
          !cls.contains('react-flow__attribution') &&
          !cls.contains('react-flow__panel')
        );
      },
    };

    // Double-pass: first call warms up font/image loading, second produces clean output
    toPng(flowViewport, exportOptions)
      .then(() => toPng(flowViewport, exportOptions))
      .then((dataUrl) => {
        const a = document.createElement('a');
        a.setAttribute('download', 'dex-flow-visualization.png');
        a.setAttribute('href', dataUrl);
        a.click();
      });
  }, [getNodes]);

  const handleDownloadSVG = useCallback(() => {
    if (reactFlowWrapper.current === null) return;
    setExportMenuOpen(false);

    const allNodes = getNodes();
    if (allNodes.length === 0) return;

    const nodeBounds = getNodesBounds(allNodes);
    const padding = 100;
    const imageWidth = nodeBounds.width + padding * 2;
    const imageHeight = nodeBounds.height + padding * 2;
    const viewport = getViewportForBounds(
      nodeBounds,
      imageWidth,
      imageHeight,
      1,
      1,
      padding
    );

    const flowViewport = reactFlowWrapper.current.querySelector(
      '.react-flow__viewport'
    ) as HTMLElement;
    if (!flowViewport) return;

    toSvg(flowViewport, {
      backgroundColor: '#0f172a',
      width: imageWidth,
      height: imageHeight,
      style: {
        width: `${imageWidth}px`,
        height: `${imageHeight}px`,
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      },
      filter: (node: Element) => {
        const cls = node.classList;
        if (!cls) return true;
        return (
          !cls.contains('react-flow__minimap') &&
          !cls.contains('react-flow__controls') &&
          !cls.contains('react-flow__attribution') &&
          !cls.contains('react-flow__panel')
        );
      },
    }).then((dataUrl) => {
      const a = document.createElement('a');
      a.setAttribute('download', 'dex-flow-visualization.svg');
      a.setAttribute('href', dataUrl);
      a.click();
    });
  }, [getNodes]);

  /* ---- Share Link ---- */
  const handleShare = useCallback(async () => {
    if (!sql) return;
    const compressed = LZString.compressToEncodedURIComponent(sql);
    const url = new URL(window.location.href);
    url.searchParams.set("q", compressed);
    const shareUrl = url.toString();

    const fallbackCopy = () => {
      navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    };

    if (navigator.share) {
      try {
        await navigator.share({
          title: "D3xTRverse Flow",
          text: "Check out this SQL Lineage Graph:",
          url: shareUrl,
        });
        // Success case, do not copy automatically afterwards
      } catch (err) {
        // Fallback or user canceled
        if (err instanceof Error && err.name !== "AbortError") {
          fallbackCopy();
        }
      }
    } else {
      fallbackCopy();
    }
  }, [sql]);

  /* ---- Main handler ---- */
  const handleVisualize = useCallback(
    async (overrideSql?: string) => {
      const query = overrideSql ?? sql;
      if (!query.trim()) return;

      // Update URL for sharing using NATIVE browser API only.
      // Never use Next.js router.push/replace — it triggers a full
      // re-render cycle that causes infinite loops on iOS Safari.
      // SKIP when triggered by URL load — the param was already stripped
      // and re-injecting it causes the Safari crash loop.
      if (isUrlTriggered.current) {
        isUrlTriggered.current = false;
      } else {
        try {
          // Guard: Mobile Safari crashes on extremely long URL states.
          // Limit to ~2000 chars (safe threshold for most browsers).
          const compressed = LZString.compressToEncodedURIComponent(query);
          if (!isMobileSafari || compressed.length < 2000) {
            window.history.replaceState(null, '', `?q=${compressed}`);
          } else {
             console.warn("[D3xTRverse] URL length excessive for mobile — skipping sync.");
          }
        } catch {
          // Silently fail — URL sharing is non-critical
        }
      }

      setLoading(true);
      setStage("parsing");
      setError(null);
      setErrorDetails(null);
      setToasterVisible(false);

      // Clear previous graph
      setNodes([]);
      setEdges([]);
      setHasResult(false);
      nodeHeightsRef.current = new Map();
      relayoutCountRef.current = 0; // Fresh visualization — allow relayout passes

      try {
        // Stage 1: Parse SQL → AST & NodeMap
        const parseRes = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql: query.trim(), dialect }),
        });

        const parseData = await parseRes.json();

        if (!parseRes.ok) {
          const errMsg = parseData.details
            ? `${parseData.error} — ${parseData.details}`
            : (parseData.error || "Failed to parse SQL");
          setError(errMsg);
          setErrorDetails({ line: parseData.line, column: parseData.column });
          setToasterVisible(true);
          if (parseData.line) {
            console.error(`[D3xTRverse Parser] Syntax error at line ${parseData.line}${parseData.column ? `, column ${parseData.column}` : ""}`);
          }
          setLoading(false);
          setStage("idle");
          return;
        }

        const { nodeMap } = parseData;

        // Render immediately with empty explanations
        const initialExplanations: Explanations = {};
        for (const k of Object.keys(nodeMap)) {
          initialExplanations[k] = ""; // Empty implies loading in UI
        }

        rawDataRef.current = { nodeMap, explanations: initialExplanations };
        const { nodes: graphNodes, edges: graphEdges } = transformToGraph(
          nodeMap,
          initialExplanations,
          handleExpandToggle,
          handleHeightReport,
          handleCteExpandToggle,
          undefined,
          isMobileSafari
        );

        setStage("rendering");
        setNodes(graphNodes);
        setEdges(graphEdges);
        setHasResult(true);

        // Auto-scroll to canvas on mobile/smaller screens to ensure visibility
        setTimeout(() => {
          if (window.innerWidth < 1024 && reactFlowWrapper.current) {
            reactFlowWrapper.current.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 100);

        // Stage 2: Explain AST via Groq Asynchronously
        setStage("explaining");

        fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeMap }),
        })
          .then(async (explainRes) => {
            const explainData = await explainRes.json();
            if (explainRes.ok) {
              rawDataRef.current = { nodeMap, explanations: explainData.explanations };
              const { nodes: updatedNodes, edges: updatedEdges } = transformToGraph(
                nodeMap,
                explainData.explanations,
                handleExpandToggle,
                handleHeightReport,
                handleCteExpandToggle,
                nodeHeightsRef.current,
                isMobileSafari
              );
              setNodes(updatedNodes);
              setEdges(updatedEdges);
            } else {
              setError(explainData.error || "Failed to generate explanations");
              setToasterVisible(true);
              const fallbackExplanations: Explanations = {};
              for (const k of Object.keys(nodeMap)) {
                fallbackExplanations[k] = "Explanation unavailable (API Error).";
              }
              rawDataRef.current = { nodeMap, explanations: fallbackExplanations };
              const { nodes: updatedNodes, edges: updatedEdges } = transformToGraph(
                nodeMap,
                fallbackExplanations,
                handleExpandToggle,
                handleHeightReport,
                handleCteExpandToggle,
                nodeHeightsRef.current,
                isMobileSafari
              );
              setNodes(updatedNodes);
              setEdges(updatedEdges);
            }
          })
          .catch((err) => {
            setError(err.message || "Network error fetching explanations");
            setToasterVisible(true);
            const fallbackExplanations: Explanations = {};
            for (const k of Object.keys(nodeMap)) {
              fallbackExplanations[k] = "Explanation unavailable (Network Error).";
            }
            rawDataRef.current = { nodeMap, explanations: fallbackExplanations };
            const { nodes: updatedNodes, edges: updatedEdges } = transformToGraph(
              nodeMap,
              fallbackExplanations,
              handleExpandToggle,
              handleHeightReport,
              handleCteExpandToggle,
              nodeHeightsRef.current,
              isMobileSafari
            );
            setNodes(updatedNodes);
            setEdges(updatedEdges);
          })
          .finally(() => {
            setLoading(false);
            setStage("idle");
          });

      } catch (err) {
        const message = err instanceof Error ? err.message : "Network error";
        setError(message);
        setToasterVisible(true);
        setLoading(false);
        setStage("idle");
      }
    },
    [sql, dialect, setNodes, setEdges, handleExpandToggle, handleHeightReport]
  );

  /* ---- Sample button handler ---- */
  const handleSample = useCallback(
    (sampleSql: string) => {
      setSql(sampleSql);
      // Auto-trigger visualization
      handleVisualize(sampleSql);
    },
    [handleVisualize]
  );

  /* ---- Status label ---- */
  const stageLabel =
    stage === "parsing"
      ? "Parsing SQL…"
      : stage === "explaining"
        ? "Generating explanations…"
        : stage === "rendering"
          ? "Building graph…"
          : "";

  return (
    <>
      {/* ── Splash Screen Overlay ── */}
      <AnimatePresence>{showSplash && <SplashScreen />}</AnimatePresence>

      {/* ── Main App — fades in after splash exits ── */}
      <motion.main
        className="relative z-10 flex flex-1 flex-col min-h-screen"
        initial={{ opacity: 0 }}
        animate={{ opacity: showSplash ? 0 : 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        <nav className="flex w-full items-center justify-between px-4 pt-6 sm:pt-4 md:px-8 md:pt-6 relative z-[70]">
          {/* Left: Go Home (visible when workspace is shown) */}
          <AnimatePresence>
            {chaosCleared && (
              <motion.button
                key="go-home"
                onClick={() => setChaosCleared(false)}
                className="flex items-center gap-2 rounded-full border border-indigo-400/50 px-5 py-2.5 text-[11px] sm:text-xs font-bold uppercase tracking-widest text-indigo-100 cursor-pointer backdrop-blur-xl"
                style={{
                  background: "rgba(18,20,30,0.85)",
                  boxShadow: "0 0 20px rgba(99,102,241,0.25)",
                }}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ scale: 1.05, boxShadow: "0 0 30px rgba(99,102,241,0.45)" }}
                whileTap={{ scale: 0.96 }}
              >
                <HomeIcon className="h-4 w-4 text-indigo-300" />
                <span>Go Home</span>
              </motion.button>
            )}
          </AnimatePresence>

          {/* Right: Meet the Creator */}
          <motion.button
            onClick={() => setShowCreatorModal(true)}
            className="flex items-center gap-2 rounded-full border border-indigo-400/50 px-5 py-2.5 text-[11px] sm:text-xs font-bold uppercase tracking-widest text-indigo-100 cursor-pointer backdrop-blur-xl ml-auto"
            style={{
              background: "rgba(18,20,30,0.85)",
              boxShadow: "0 0 20px rgba(99,102,241,0.25)",
            }}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 2.8, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ scale: 1.05, boxShadow: "0 0 30px rgba(99,102,241,0.45)" }}
            whileTap={{ scale: 0.96 }}
          >
            <User className="h-4 w-4 text-indigo-300" />
            <span>Meet the Creator</span>
          </motion.button>
        </nav>

        {/* ── Creator Modal Overlay ── */}
        <AnimatePresence>
          {showCreatorModal && (
            <motion.div
              className="fixed inset-0 z-[100] flex items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              {/* Backdrop */}
              <motion.div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => setShowCreatorModal(false)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />

              {/* Card */}
              <motion.div
                className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-indigo-400/40"
                style={{
                  background: "rgba(18,20,30,0.95)",
                  backdropFilter: "blur(24px)",
                  boxShadow: "0 0 80px rgba(99,102,241,0.3), 0 8px 32px rgba(0,0,0,0.6)",
                }}
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              >
                {/* Decorative orbs */}
                <div className="pointer-events-none absolute -top-10 -left-10 h-32 w-32 rounded-full bg-indigo-600/20 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-10 -right-10 h-28 w-28 rounded-full bg-violet-600/15 blur-3xl" />

                {/* Close button */}
                <button
                  onClick={() => setShowCreatorModal(false)}
                  className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-indigo-300 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>

                {/* Terminal header */}
                <motion.div
                  className="flex items-center gap-2.5 px-5 pt-5 pb-2"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1, duration: 0.35 }}
                >
                  <Terminal className="h-4 w-4 text-indigo-400" />
                  <span className="font-mono text-[11px] tracking-wider text-indigo-300/80">
                    ~/saynam<span className="animate-pulse text-indigo-400">_</span>
                  </span>
                </motion.div>

                {/* Title */}
                <motion.h3
                  className="px-5 pb-1 text-lg font-extrabold tracking-tight text-white"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15, duration: 0.35 }}
                >
                  Built by <span className="hero-gradient-text">Saynam</span>
                </motion.h3>

                {/* Body */}
                <motion.p
                  className="px-5 pb-4 text-[13px] leading-relaxed text-gray-400"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2, duration: 0.35 }}
                >
                  From chaotic SQL strings to clear, actionable DAGs. I build tools that make data engineers{" "}
                  <span className="font-semibold text-white">unstoppable</span>.
                </motion.p>

                {/* Separator */}
                <div className="mx-5 h-px bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent" />

                {/* CTA */}
                <motion.div
                  className="p-4"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25, duration: 0.35 }}
                >
                  <motion.a
                    href="https://saynam-portfolio-19qy.vercel.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group/cta relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl px-4 py-3 text-xs font-bold uppercase tracking-widest text-white"
                    style={{
                      background: "linear-gradient(135deg, #6366f1, #8b5cf6, #a855f7)",
                      boxShadow: "0 0 18px rgba(99,102,241,0.35), 0 2px 12px rgba(0,0,0,0.3)",
                    }}
                    whileHover={{
                      scale: 1.04,
                      boxShadow: "0 0 40px rgba(129,140,248,0.7), 0 4px 24px rgba(0,0,0,0.4)",
                    }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_3s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                    <ExternalLink size={14} className="relative z-10" />
                    <span className="relative z-10">Visit Portfolio</span>
                  </motion.a>
                </motion.div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ════════════════════════════════════════════════════════════ */}
        {/*  CHAOS-TO-CLARITY HERO                                      */}
        {/* ════════════════════════════════════════════════════════════ */}
        <AnimatePresence>
          {!chaosCleared && (
            <motion.section
              className="chaos-hero fixed inset-0 z-[60]"
              key="chaos-hero"
              exit={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            >
              {/* Background layers */}
              <div className="chaos-noise" />
              <div className="chaos-grid" />
              <div className="chaos-scanline" />

              {/* Red ambient glow */}
              <div className="pointer-events-none absolute top-1/4 left-1/3 h-[400px] w-[400px] rounded-full bg-red-500/5 blur-[80px]" />
              <div className="pointer-events-none absolute bottom-1/4 right-1/4 h-[350px] w-[350px] rounded-full bg-indigo-500/4 blur-[70px]" />

              {/* Error Box 1 */}
              <motion.div
                className="chaos-error-box"
                style={{ top: "12%", left: "8%" }}
                initial={{ opacity: 0 }}
                animate={chaosCleared
                  ? { opacity: 0, scale: 0, x: -400, y: -300, rotate: -60 }
                  : { opacity: 1, y: [0, -8, 0], rotate: [0, -1, 0] }}
                transition={chaosCleared
                  ? { duration: 0.6, ease: "easeIn" }
                  : { y: { duration: 3, repeat: Infinity, ease: "easeInOut" }, rotate: { duration: 4, repeat: Infinity, ease: "easeInOut" }, opacity: { delay: 2.8, duration: 0.5 } }}
              >
                Syntax Error: Unexpected token
              </motion.div>

              {/* Error Box 2 */}
              <motion.div
                className="chaos-error-box"
                style={{ top: "68%", right: "6%" }}
                initial={{ opacity: 0 }}
                animate={chaosCleared
                  ? { opacity: 0, scale: 0, x: 400, y: 300, rotate: 45 }
                  : { opacity: 1, y: [0, 10, 0], rotate: [0, 2, 0] }}
                transition={chaosCleared
                  ? { duration: 0.5, ease: "easeIn", delay: 0.1 }
                  : { y: { duration: 3.5, repeat: Infinity, ease: "easeInOut" }, rotate: { duration: 5, repeat: Infinity, ease: "easeInOut" }, opacity: { delay: 3.1, duration: 0.5 } }}
              >
                ERROR 1064: near &quot;SELEC&quot;
              </motion.div>

              {/* Error Box 3 */}
              <motion.div
                className="chaos-error-box"
                style={{ bottom: "18%", left: "15%" }}
                initial={{ opacity: 0 }}
                animate={chaosCleared
                  ? { opacity: 0, scale: 0, x: -300, y: 400, rotate: -30 }
                  : { opacity: 1, y: [0, -6, 0], rotate: [0, 1.5, 0] }}
                transition={chaosCleared
                  ? { duration: 0.6, ease: "easeIn", delay: 0.15 }
                  : { y: { duration: 4, repeat: Infinity, ease: "easeInOut" }, rotate: { duration: 3.5, repeat: Infinity, ease: "easeInOut" }, opacity: { delay: 3.3, duration: 0.5 } }}
              >
                Missing FROM clause
              </motion.div>

              {/* Error Box 4 */}
              <motion.div
                className="chaos-error-box"
                style={{ top: "38%", right: "12%" }}
                initial={{ opacity: 0 }}
                animate={chaosCleared
                  ? { opacity: 0, scale: 0, x: 500, y: -200, rotate: 70 }
                  : { opacity: 1, y: [0, 7, 0], rotate: [0, -1, 0] }}
                transition={chaosCleared
                  ? { duration: 0.5, ease: "easeIn", delay: 0.05 }
                  : { y: { duration: 2.8, repeat: Infinity, ease: "easeInOut" }, rotate: { duration: 3, repeat: Infinity, ease: "easeInOut" }, opacity: { delay: 3.5, duration: 0.5 } }}
              >
                Column &apos;user_id&apos; is ambiguous
              </motion.div>

              {/* SQL Scrap 1 */}
              <motion.div
                className="chaos-sql-scrap"
                style={{ top: "22%", right: "18%", transform: "rotate(3deg)" }}
                initial={{ opacity: 0 }}
                animate={chaosCleared
                  ? { opacity: 0, scale: 0, x: 300, y: -400, rotate: 40 }
                  : { opacity: 1, y: [0, -12, 0], rotate: [3, 5, 3] }}
                transition={chaosCleared
                  ? { duration: 0.5, ease: "easeIn", delay: 0.08 }
                  : { y: { duration: 4.5, repeat: Infinity, ease: "easeInOut" }, rotate: { duration: 6, repeat: Infinity, ease: "easeInOut" }, opacity: { delay: 2.9, duration: 0.5 } }}
              >
                {`SELECT * FROM (\n  SELECT * FROM (\n    SELECT *\n    FROM ???\n  )\n)`}
              </motion.div>

              {/* SQL Scrap 2 */}
              <motion.div
                className="chaos-sql-scrap"
                style={{ bottom: "25%", right: "22%", transform: "rotate(-2deg)" }}
                initial={{ opacity: 0 }}
                animate={chaosCleared
                  ? { opacity: 0, scale: 0, x: 200, y: 500, rotate: -50 }
                  : { opacity: 1, y: [0, 8, 0], rotate: [-2, -4, -2] }}
                transition={chaosCleared
                  ? { duration: 0.55, ease: "easeIn", delay: 0.12 }
                  : { y: { duration: 3.2, repeat: Infinity, ease: "easeInOut" }, rotate: { duration: 5, repeat: Infinity, ease: "easeInOut" }, opacity: { delay: 3.2, duration: 0.5 } }}
              >
                {`JOIN t1 ON t1.id =\n  t2.id = t3.id --??\nWHERE 1 = 1\n  AND ??? > 0`}
              </motion.div>

              {/* SQL Scrap 3 */}
              <motion.div
                className="chaos-sql-scrap"
                style={{ top: "55%", left: "5%", transform: "rotate(-4deg)" }}
                initial={{ opacity: 0 }}
                animate={chaosCleared
                  ? { opacity: 0, scale: 0, x: -500, y: 200, rotate: -80 }
                  : { opacity: 1, y: [0, -10, 0], rotate: [-4, -2, -4] }}
                transition={chaosCleared
                  ? { duration: 0.6, ease: "easeIn", delay: 0.2 }
                  : { y: { duration: 3.8, repeat: Infinity, ease: "easeInOut" }, rotate: { duration: 4.5, repeat: Infinity, ease: "easeInOut" }, opacity: { delay: 3.4, duration: 0.5 } }}
              >
                {`UNION ALL\n  SELECT col1,, col2\n  FROM tbl\n  GROUP BY ???`}
              </motion.div>

              {/* SQL Scrap 4 */}
              <motion.div
                className="chaos-sql-scrap"
                style={{ top: "8%", left: "40%", transform: "rotate(5deg)" }}
                initial={{ opacity: 0 }}
                animate={chaosCleared
                  ? { opacity: 0, scale: 0, y: -500, rotate: 90 }
                  : { opacity: 1, y: [0, 6, 0], rotate: [5, 3, 5] }}
                transition={chaosCleared
                  ? { duration: 0.45, ease: "easeIn", delay: 0.1 }
                  : { y: { duration: 3, repeat: Infinity, ease: "easeInOut" }, rotate: { duration: 4, repeat: Infinity, ease: "easeInOut" }, opacity: { delay: 3, duration: 0.5 } }}
              >
                {`WITH cte AS (\n  SELECT ???\n  FROM deleted_tbl\n) -- TODO: fix`}
              </motion.div>

              {/* Broken SVG Line 1 */}
              <motion.div
                className="chaos-broken-line"
                style={{ top: "30%", left: "25%" }}
                initial={{ opacity: 0 }}
                animate={chaosCleared
                  ? { opacity: 0, scale: 0, x: -300, rotate: -90 }
                  : { opacity: 0.3, y: [0, -5, 0] }}
                transition={chaosCleared
                  ? { duration: 0.4, ease: "easeIn" }
                  : { y: { duration: 3, repeat: Infinity, ease: "easeInOut" }, opacity: { delay: 3.1, duration: 0.5 } }}
              >
                <svg width="140" height="80" viewBox="0 0 140 80" fill="none">
                  <path d="M0 40 Q30 10, 60 45 T90 20 L140 60" stroke="rgba(239,68,68,0.35)" strokeWidth="1.5" strokeDasharray="4 6" fill="none" />
                  <path d="M20 70 Q50 30, 80 55 T120 15" stroke="rgba(99,102,241,0.2)" strokeWidth="1" strokeDasharray="3 5" fill="none" />
                </svg>
              </motion.div>

              {/* Broken SVG Line 2 */}
              <motion.div
                className="chaos-broken-line"
                style={{ bottom: "35%", right: "30%" }}
                initial={{ opacity: 0 }}
                animate={chaosCleared
                  ? { opacity: 0, scale: 0, x: 200, rotate: 60 }
                  : { opacity: 0.25, y: [0, 8, 0], rotate: [0, 2, 0] }}
                transition={chaosCleared
                  ? { duration: 0.5, ease: "easeIn", delay: 0.1 }
                  : { y: { duration: 4, repeat: Infinity, ease: "easeInOut" }, rotate: { duration: 5, repeat: Infinity, ease: "easeInOut" }, opacity: { delay: 3.3, duration: 0.5 } }}
              >
                <svg width="160" height="90" viewBox="0 0 160 90" fill="none">
                  <path d="M0 50 C40 10, 60 80, 100 30 L130 70 L160 20" stroke="rgba(239,68,68,0.25)" strokeWidth="1.5" strokeDasharray="5 7" fill="none" />
                  <circle cx="100" cy="30" r="3" fill="rgba(239,68,68,0.4)" />
                  <circle cx="50" cy="55" r="2" fill="rgba(99,102,241,0.3)" />
                </svg>
              </motion.div>

              {/* Broken SVG Line 3 */}
              <motion.div
                className="chaos-broken-line"
                style={{ top: "75%", left: "35%" }}
                initial={{ opacity: 0 }}
                animate={chaosCleared
                  ? { opacity: 0, scale: 0, y: 400, rotate: -45 }
                  : { opacity: 0.2, y: [0, -7, 0] }}
                transition={chaosCleared
                  ? { duration: 0.55, ease: "easeIn", delay: 0.15 }
                  : { y: { duration: 3.5, repeat: Infinity, ease: "easeInOut" }, opacity: { delay: 3.5, duration: 0.5 } }}
              >
                <svg width="120" height="60" viewBox="0 0 120 60" fill="none">
                  <path d="M0 30 L30 10 L50 50 L80 5 L120 40" stroke="rgba(245,158,11,0.2)" strokeWidth="1" strokeDasharray="3 4" fill="none" />
                  <path d="M10 55 Q40 20, 70 45 T110 10" stroke="rgba(239,68,68,0.2)" strokeWidth="1" strokeDasharray="4 5" fill="none" />
                </svg>
              </motion.div>

              {/* Broken SVG Line 4 */}
              <motion.div
                className="chaos-broken-line"
                style={{ top: "45%", right: "5%" }}
                initial={{ opacity: 0 }}
                animate={chaosCleared
                  ? { opacity: 0, scale: 0, x: 500, rotate: 30 }
                  : { opacity: 0.2, y: [0, 5, 0], rotate: [0, -1, 0] }}
                transition={chaosCleared
                  ? { duration: 0.5, ease: "easeIn", delay: 0.18 }
                  : { y: { duration: 4.2, repeat: Infinity, ease: "easeInOut" }, rotate: { duration: 3.5, repeat: Infinity, ease: "easeInOut" }, opacity: { delay: 3.6, duration: 0.5 } }}
              >
                <svg width="100" height="100" viewBox="0 0 100 100" fill="none">
                  <path d="M10 90 Q30 50, 50 70 T90 10" stroke="rgba(99,102,241,0.25)" strokeWidth="1.5" strokeDasharray="4 6" fill="none" />
                  <path d="M5 20 L45 80 L95 30" stroke="rgba(239,68,68,0.2)" strokeWidth="1" strokeDasharray="3 5" fill="none" />
                </svg>
              </motion.div>

              {/* ── Hero Center Content ── */}
              <div className="relative z-10 flex flex-col items-center px-4">
                {/* Glitch branding */}
                <motion.div
                  className="mb-6 flex items-center gap-3"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: showSplash ? 0 : 1, y: showSplash ? 20 : 0 }}
                  transition={{ delay: 2.6, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-xl"
                    style={{
                      background: "linear-gradient(135deg, #ef4444, #6366f1)",
                      boxShadow: "0 0 30px rgba(239,68,68,0.3), 0 4px 16px rgba(0,0,0,0.5)",
                    }}
                  >
                    <Braces className="h-7 w-7 text-white" strokeWidth={2.5} />
                  </div>
                  <span className="glitch-text text-sm font-bold tracking-[0.2em] text-[var(--text-muted)] uppercase" data-text="D3xTRverse">
                    D3xTRverse
                  </span>
                </motion.div>

                {/* Headline */}
                <motion.h1
                  className="chaos-headline"
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: showSplash ? 0 : 1, y: showSplash ? 30 : 0 }}
                  transition={{ delay: 2.8, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                >
                  SQL is a Mess.{" "}
                  <br className="hidden sm:block" />
                  <em>We Bring the Flow.</em>
                </motion.h1>

                {/* Subtext */}
                <motion.p
                  className="chaos-subtext"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: showSplash ? 0 : 1, y: showSplash ? 20 : 0 }}
                  transition={{ delay: 3.0, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                >
                  Tangled subqueries. Cryptic errors. Lineage nightmares. One click to clarity.
                </motion.p>

                {/* CTA */}
                <motion.button
                  className="fix-chaos-btn mt-10"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: showSplash ? 0 : 1, y: showSplash ? 20 : 0 }}
                  transition={{ delay: 3.3, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  onClick={() => setChaosCleared(true)}
                >
                  <Zap className="h-5 w-5" />
                  Fix the Chaos
                </motion.button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>


        {/* ════════════════════════════════════════════════════════════ */}
        {/*  WORKSPACE — Editor + Canvas (always rendered, under overlay) */}
        {/* ════════════════════════════════════════════════════════════ */}
        <section
          id="workspace"
          className={`workspace-section flex-1 flex-col items-center px-4 pt-12 pb-6 sm:px-6 lg:px-8 ${chaosCleared ? "flex" : "hidden"}`}
        >
          {/* ── Ambient background elements ── */}
          <div className="ws-glow ws-glow--indigo" />
          <div className="ws-glow ws-glow--violet" />
          <div className="ws-glow ws-glow--cyan" />

          {/* Flowing data streams */}
          <div className="ws-data-stream" style={{ top: "15%" }} />
          <div className="ws-data-stream" style={{ top: "45%" }} />
          <div className="ws-data-stream" style={{ top: "75%" }} />

          {/* Corner accent markers */}
          <div className="ws-corner-accent ws-corner-accent--tl" />
          <div className="ws-corner-accent ws-corner-accent--tr" />
          <div className="ws-corner-accent ws-corner-accent--bl" />
          <div className="ws-corner-accent ws-corner-accent--br" />

          {/* Floating micro-particles */}
          <div className="ws-particles">
            <div className="ws-particle" style={{ left: "5%" }} />
            <div className="ws-particle" />
            <div className="ws-particle" />
            <div className="ws-particle" />
            <div className="ws-particle" />
            <div className="ws-particle" />
            <div className="ws-particle" />
            <div className="ws-particle" />
          </div>

          {/* Workspace title bar */}
          <motion.div
            className="mb-6 flex items-center gap-3"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{
                background: "linear-gradient(135deg, var(--accent-indigo), var(--accent-violet))",
                boxShadow: "0 0 24px rgba(99,102,241,0.3)",
              }}
            >
              <Braces className="h-5 w-5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-white">
                D3xTR<span className="hero-gradient-text">verse</span> Flow
              </h2>
              <p className="text-[11px] text-[var(--text-muted)] tracking-wide">Paste SQL · Visualize · Trace Lineage</p>
            </div>
          </motion.div>

          {/* Sample query buttons */}
          <div className="mb-8 flex flex-wrap items-center justify-center gap-3 max-w-4xl">
            {SAMPLE_QUERIES.map((sample) => {
              const SIcon = sample.icon;
              return (
                <button
                  key={sample.label}
                  onClick={() => handleSample(sample.sql)}
                  disabled={loading}
                  className="sample-btn group flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed sm:text-[11px]"
                  style={{
                    borderColor: "rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.02)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <SIcon size={14} className="opacity-50 transition-opacity duration-200 group-hover:opacity-100" />
                  {sample.label}
                </button>
              );
            })}
          </div>
          {/* Responsive wrapper: stack on mobile, side-by-side on desktop */}
          <div className="flex w-full max-w-7xl flex-col gap-6 md:flex-row md:gap-8 flex-1">
            {/* ── Left: SQL Editor Panel ── */}
            <div className="w-full md:w-[380px] lg:w-[420px] flex-shrink-0">
              <div className="editor-panel sticky top-6 rounded-2xl border p-5"
                style={{
                  borderColor: "rgba(255,255,255,0.06)",
                  background: "rgba(18,20,30,0.7)",
                  backdropFilter: "blur(16px)",
                }}
              >
                {/* Editor header */}
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Braces className="h-4 w-4 text-[var(--accent-indigo)]" />
                    <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                      SQL Input
                    </span>
                  </div>
                  <DialectSelector
                    value={dialect}
                    onChange={setDialect}
                    disabled={loading}
                  />
                </div>

                {isMobileSafari && (
                  <div className="mb-4 flex w-full items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-200/80">
                    <Terminal className="h-4 w-4 shrink-0 mt-0.5" />
                    <span className="text-xs leading-relaxed">
                      For the best experience analyzing complex graphs, we recommend using a desktop computer.
                    </span>
                  </div>
                )}

                <div className="relative group">
                  <div className="overflow-y-auto max-h-[40vh] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] focus-within:border-[var(--border-accent)] transition-all duration-300">
                    <Editor
                      value={sql}
                      onValueChange={(code) => {
                        setSql(code);
                        if (hasResult) clearGraph();
                      }}
                      highlight={(code) => Prism.highlight(code, Prism.languages.sql, 'sql')}
                      padding={16}
                      style={{
                        fontFamily: "var(--font-mono), monospace",
                        fontSize: 14,
                        lineHeight: 1.6,
                        minHeight: 220,
                        backgroundColor: "transparent",
                      }}
                      textareaClassName="focus:outline-none"
                    />
                  </div>
                  {/* Character count */}
                  <span className="absolute bottom-3 right-4 text-xs text-[var(--text-muted)] tabular-nums">
                    {sql.length}
                  </span>
                </div>

                {/* Error Toaster — inline status bar */}
                <AnimatePresence>
                  {toasterVisible && error && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      exit={{ opacity: 0, y: -4, height: 0 }}
                      transition={{ duration: 0.25 }}
                      className="error-toaster mt-3 overflow-hidden rounded-xl border border-red-500/30 bg-gradient-to-r from-red-500/8 via-red-500/5 to-transparent"
                    >
                      <div className="flex items-start gap-2.5 px-4 py-3">
                        <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500/15 shrink-0">
                          <AlertTriangle className="h-3 w-3 text-red-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-red-300 break-words leading-relaxed">{error}</p>
                          {errorDetails?.line && (
                            <p className="mt-1 flex items-center gap-1.5 text-xs text-red-400/70 font-mono">
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400/60 animate-pulse" />
                              Line {errorDetails.line}
                              {errorDetails.column ? `, Col ${errorDetails.column}` : ""}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => { setToasterVisible(false); setError(null); setErrorDetails(null); }}
                          className="mt-0.5 shrink-0 rounded-md p-1 text-red-400/60 transition-colors hover:bg-red-500/10 hover:text-red-300"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Action buttons */}
                <div className="mt-4 flex gap-3">
                  <button
                    id="visualize-btn"
                    onClick={() => handleVisualize()}
                    disabled={loading || !sql.trim()}
                    aria-label="Visualize"
                    className="flex flex-1 items-center justify-center gap-2.5 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{
                      background:
                        loading || !sql.trim()
                          ? "var(--bg-elevated)"
                          : "linear-gradient(135deg, var(--accent-indigo), var(--accent-violet))",
                      boxShadow:
                        loading || !sql.trim()
                          ? "none"
                          : "0 0 20px var(--glow-indigo)",
                    }}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {stageLabel}
                      </>
                    ) : (
                      <>
                        <Braces className="h-4 w-4" />
                        Visualize
                      </>
                    )}
                  </button>

                  <button
                    onClick={clearGraph}
                    disabled={!hasResult && !sql.trim() && !error}
                    aria-label="Clear"
                    className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-secondary)] transition-all duration-200 hover:border-[var(--border-accent)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Clear
                  </button>
                </div>
              </div>
            </div>

            {/* ── Right: React Flow Canvas ── */}
            <div className="w-full flex-1 flex flex-col relative" id="flow-canvas-container">


              {hasResult && (
                <div className="absolute top-4 right-4 z-10 flex gap-2">
                  <button
                    onClick={() => handleToggleAll(true)}
                    className="p-2.5 rounded-lg bg-[rgba(18,20,30,0.8)] border border-[rgba(255,255,255,0.1)] text-gray-300 hover:text-white hover:bg-[rgba(255,255,255,0.1)] transition-colors backdrop-blur-md"
                    title="Expand All"
                  >
                    <Maximize2 size={16} />
                  </button>
                  <button
                    onClick={() => handleToggleAll(false)}
                    className="p-2.5 rounded-lg bg-[rgba(18,20,30,0.8)] border border-[rgba(255,255,255,0.1)] text-gray-300 hover:text-white hover:bg-[rgba(255,255,255,0.1)] transition-colors backdrop-blur-md"
                    title="Collapse All"
                  >
                    <Minimize2 size={16} />
                  </button>
                  <div className="w-px h-6 bg-[rgba(255,255,255,0.1)] self-center mx-1" />
                  <button
                    onClick={handleShare}
                    className="p-2.5 rounded-lg bg-[rgba(18,20,30,0.8)] border border-[rgba(255,255,255,0.1)] text-gray-300 hover:text-white hover:bg-[rgba(255,255,255,0.1)] transition-colors backdrop-blur-md flex items-center gap-2"
                    title="Share URL"
                  >
                    <Share2 size={16} />
                    {copiedLink && <span className="text-[10px] font-bold tracking-wider absolute -bottom-6 left-1/2 -translate-x-1/2 text-emerald-400">COPIED</span>}
                  </button>
                  {/* Download PNG — prominent primary action */}
                  <button
                    onClick={handleDownloadPNG}
                    aria-label="Download PNG"
                    className="px-3 py-2.5 rounded-lg border flex items-center gap-2 text-xs font-semibold uppercase tracking-wider transition-all duration-200 backdrop-blur-md"
                    style={{
                      borderColor: "rgba(99,102,241,0.4)",
                      background: "rgba(99,102,241,0.12)",
                      color: "#a5b4fc",
                      boxShadow: "0 0 16px rgba(99,102,241,0.15)",
                    }}
                    title="Download PNG"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(99,102,241,0.22)";
                      e.currentTarget.style.boxShadow = "0 0 24px rgba(99,102,241,0.3)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(99,102,241,0.12)";
                      e.currentTarget.style.boxShadow = "0 0 16px rgba(99,102,241,0.15)";
                    }}
                  >
                    <Download size={14} />
                    <span className="hidden sm:inline">PNG</span>
                  </button>

                  <div className="relative">
                    <button
                      onClick={() => setExportMenuOpen(!exportMenuOpen)}
                      className="p-2.5 rounded-lg bg-[rgba(18,20,30,0.8)] border border-[rgba(255,255,255,0.1)] text-gray-300 hover:text-white hover:bg-[rgba(255,255,255,0.1)] transition-colors backdrop-blur-md flex items-center gap-1.5"
                      title="More Export Options"
                    >
                      <ChevronDown size={14} className="opacity-70" />
                    </button>

                    {exportMenuOpen && (
                      <div className="absolute right-0 mt-2 w-48 rounded-xl border border-[rgba(255,255,255,0.1)] bg-[#1a1c28] p-1.5 shadow-2xl backdrop-blur-xl z-50">
                        <button
                          onClick={handleDownloadPNG}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-white text-left"
                        >
                          <ImageIcon size={14} /> High-Res PNG
                        </button>
                        <button
                          onClick={handleDownloadSVG}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-white text-left"
                        >
                          <Box size={14} /> Vector SVG
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {hasResult ? (
                <div
                  ref={reactFlowWrapper}
                  className="w-full h-[65vh] min-h-[500px] md:h-auto md:flex-1 relative border rounded-2xl overflow-hidden flex flex-col"
                  style={{
                    borderColor: "var(--border-accent)",
                    background: "var(--bg-secondary)",
                  }}
                >
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeClick={handleNodeClick}
                    onPaneClick={handlePaneClick}
                    nodeTypes={nodeTypes}
                    proOptions={proOptions}
                    connectionLineType={ConnectionLineType.SmoothStep}
                    fitView
                    fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                    minZoom={0.1}
                    maxZoom={2}
                    panOnScroll={true}
                    preventScrolling={false} // Allow natural page scrolling over canvas on mobile
                    zoomOnScroll={false}
                    zoomOnPinch={true}
                    zoomOnDoubleClick={false}
                  >
                    <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#333" />
                    <Controls className="dark:bg-gray-800 dark:border-gray-700 dark:fill-white" />
                    <MiniMap className="hidden md:block dark:bg-gray-900" nodeColor="#4f46e5" />
                  </ReactFlow>
                </div>
              ) : (
                <div
                  id="canvas-placeholder"
                  className="flex w-full h-[65vh] min-h-[500px] md:h-auto md:flex-1 items-center justify-center rounded-2xl border-2 border-dashed transition-colors duration-300"
                  style={{
                    borderColor: "var(--border-subtle)",
                    background: "var(--bg-secondary)",
                  }}
                >
                  <div className="text-center">
                    <Braces
                      className="mx-auto mb-3 h-10 w-10"
                      style={{ color: "var(--text-muted)" }}
                      strokeWidth={1}
                    />
                    <p className="text-sm text-[var(--text-muted)]">
                      Your query visualization will appear here
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-muted)] opacity-60">
                      Try a sample above or paste your own SQL
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════ */}
        {/*  FOOTER                                                      */}
        {/* ════════════════════════════════════════════════════════════ */}
        <footer className="mt-auto border-t py-5 text-center flex flex-col items-center gap-2"
          style={{ borderColor: "rgba(255,255,255,0.05)" }}
        >
          <p className="text-xs tracking-wider text-[var(--text-muted)]">
            Built by{" "}
            <a
              href="https://saynam-portfolio-19qy.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-[var(--accent-indigo)] transition-all duration-300 hover:text-[#a5b4fc] hover:underline hover:drop-shadow-[0_0_12px_rgba(165,180,252,1)]"
            >
              Saynam
            </a>{" "}
            <span className="mx-1 opacity-30">|</span>{" "}
            <span className="hero-gradient-text text-[11px] font-bold">D3xTRverse</span>
          </p>
          <a
            href="https://github.com/Saynam221b/dex-floww"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[var(--text-muted)] transition-all duration-300 hover:text-[var(--accent-indigo)] hover:drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            View on GitHub
          </a>
          <button
            onClick={runParserDiagnostics}
            className="text-[10px] text-[var(--text-muted)] opacity-20 hover:opacity-100 transition-opacity bg-transparent border-none cursor-pointer"
          >
            Run Diagnostics
          </button>
        </footer>



        {/* ════════════════════════════════════════════════════════════ */}
        {/*  EASTER EGG: Floating Chat Button & Modal                    */}
        {/* ════════════════════════════════════════════════════════════ */}
        <button
          onClick={() => setShowEasterEgg(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-indigo-400/50 bg-[#12141e]/80 shadow-[0_0_20px_rgba(99,102,241,0.4)] backdrop-blur-xl transition-all duration-300 hover:scale-110 hover:border-indigo-300 hover:shadow-[0_0_30px_rgba(99,102,241,0.6)] group"
        >
          <div className="absolute inset-0 rounded-full bg-indigo-500/20 animate-ping opacity-30" />
          <MessageSquare className="h-6 w-6 text-indigo-300 transition-colors group-hover:text-white relative z-10" />
        </button>

        <AnimatePresence>
          {showEasterEgg && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[rgba(255,100,100,0.3)] bg-[#12141e] shadow-[0_0_40px_rgba(255,50,50,0.15)]"
              >
                {/* Terminal header */}
                <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.05)] bg-black/40 px-4 py-3">
                  <div className="flex gap-2">
                    <div className="h-3 w-3 rounded-full bg-red-500/80" />
                    <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
                    <div className="h-3 w-3 rounded-full bg-green-500/80" />
                  </div>
                  <button
                    onClick={() => setShowEasterEgg(false)}
                    className="text-gray-500 hover:text-white transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Content */}
                <div className="p-6">
                  <div className="mb-4 flex items-center gap-3">
                    <AlertTriangle className="h-6 w-6 text-red-500 animate-pulse" />
                    <h3 className="text-lg font-bold text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.5)] uppercase tracking-wide">
                      System Overload 💀
                    </h3>
                  </div>

                  <p className="mb-4 text-sm leading-relaxed text-gray-300">
                    Look bestie, I&apos;d <em>love</em> to have a deep, philosophical debate about your questionable <code className="bg-black/30 px-1 py-0.5 rounded text-indigo-300 text-xs font-mono">LEFT JOIN</code> logic 🤓, but AI Chat tokens cost actual money 💸 and this is just a portfolio project!
                  </p>

                  <p className="mb-6 text-xs text-gray-400 italic">
                    If you want to fund my API addiction so we can chat, hit up <a href="https://youtube.com/@D3xTRverse" target="_blank" rel="noreferrer" className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">D3xTRverse on YouTube 📺</a>. (Smash that subscribe like a poorly written DROP TABLE command 💥)
                  </p>

                  <button
                    onClick={() => setShowEasterEgg(false)}
                    className="w-full rounded-xl bg-gradient-to-r from-red-900/50 to-orange-900/50 border border-red-500/30 px-4 py-3 font-semibold text-red-200 transition-all hover:from-red-900/70 hover:to-orange-900/70 hover:text-white hover:border-red-400/50"
                  >
                    Fair Enough, I am broke too 😭
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.main>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Wrapper: ReactFlowProvider needed for useReactFlow() hook          */
/* ------------------------------------------------------------------ */
import { ReactFlowProvider } from "@xyflow/react";

export default function Home() {
  return (
    <ReactFlowProvider>
      <FlowApp />
    </ReactFlowProvider>
  );
}
