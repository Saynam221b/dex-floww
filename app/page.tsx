"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import SplashScreen from "@/components/SplashScreen";
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
} from "lucide-react";
import SqlNodeComponent, { type SqlNodeData } from "@/components/SqlNode";
import { getLayoutedElements } from "@/utils/layout";

import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-sql";
import "prismjs/themes/prism-tomorrow.css"; // dark theme
import { toPng, toSvg } from "html-to-image";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type NodeMap = Record<string, string>;
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
/*  Edge colors per node type                                          */
/* ------------------------------------------------------------------ */

const EDGE_COLORS: Record<string, string> = {
  from: "#22d3ee",
  join: "#f472b6",
  where: "#facc15",
  select: "#a78bfa",
  groupby: "#34d399",
  having: "#fb923c",
  orderby: "#818cf8",
  limit: "#c084fc",
  union: "#f97316",
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
    label: "Complex CTE",
    icon: Database,
    sql: `SELECT department, avg_salary, employee_count
FROM employees
JOIN departments ON employees.dept_id = departments.id
WHERE employees.status = 'active'
GROUP BY department
HAVING avg_salary > 75000
ORDER BY employee_count DESC
LIMIT 10;`,
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
];

/* ------------------------------------------------------------------ */
/*  Transformation: nodeMap + explanations → React Flow graph          */
function transformToGraph(
  nodeMap: NodeMap,
  explanations: Explanations,
  onExpandToggle: (nodeId: string, expanded: boolean) => void,
  onHeightReport: (nodeId: string, height: number) => void,
  nodeHeights?: Map<string, number>
): { nodes: Node[]; edges: Edge[] } {
  const entries = Object.entries(nodeMap);

  // Group by layer
  const layers: Record<string, { key: string; sql: string }[]> = {};
  for (const [key, sql] of entries) {
    const type = detectNodeType(key);
    if (!layers[type]) layers[type] = [];
    layers[type].push({ key, sql });
  }

  // Sort layers by LAYER_ORDER
  const sortedLayerTypes = Object.keys(layers).sort(
    (a, b) => (LAYER_ORDER[a] ?? 99) - (LAYER_ORDER[b] ?? 99)
  );

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Track previous layer's IDs for edges
  let prevLayerIds: string[] = [];

  sortedLayerTypes.forEach((layerType) => {
    const items = layers[layerType];
    const currentLayerIds: string[] = [];

    items.forEach((item) => {
      const id = item.key;
      currentLayerIds.push(id);

      const nodeData: SqlNodeData = {
        label: LAYER_LABELS[layerType] ?? layerType.toUpperCase(),
        sql: item.sql,
        explanation: explanations[item.key] || "Processing…",
        nodeType: layerType,
        onExpandToggle,
        onHeightReport,
        nodeId: id,
      };

      nodes.push({
        id,
        type: "sqlNode",
        position: { x: 0, y: 0 },
        data: nodeData as unknown as Record<string, unknown>,
      });
    });

    // Smart edge creation: connect previous layer → current layer
    if (prevLayerIds.length > 0) {
      for (const sourceId of prevLayerIds) {
        for (const targetId of currentLayerIds) {
          const sourceType = detectNodeType(sourceId);
          edges.push({
            id: `edge-${sourceId}-${targetId}`,
            source: sourceId,
            target: targetId,
            type: "smoothstep",
            animated: true,
            style: {
              stroke: EDGE_COLORS[sourceType] ?? "#6366f1",
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
  return getLayoutedElements(nodes, edges, "TB", nodeHeights);
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

const nodeTypes = { sqlNode: SqlNodeComponent };

function FlowApp() {
  const [sql, setSql] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<"idle" | "parsing" | "explaining" | "rendering">("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [showCreatorModal, setShowCreatorModal] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { getNodes } = useReactFlow();

  /* ---- Splash Screen ---- */
  const [showSplash, setShowSplash] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  /* ---- Easter Egg ---- */
  const [showEasterEgg, setShowEasterEgg] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  // Track measured node heights and stash raw data for re-layout
  const nodeHeightsRef = useRef<Map<string, number>>(new Map());
  const rawDataRef = useRef<{ nodeMap: NodeMap; explanations: Explanations } | null>(null);
  const relayoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---- URL Sync ---- */
  const isInitialized = useRef(false);
  useEffect(() => {
    if (isInitialized.current) return;
    const urlParams = new URLSearchParams(window.location.search);
    const q = urlParams.get("q");
    if (q) {
      try {
        const decoded = atob(q);
        setSql(decoded);
        setTimeout(() => handleVisualize(decoded), 100);
      } catch (e) {
        console.error("Failed to decode query from URL", e);
      }
    }
    isInitialized.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- ReactFlow config ---- */
  const proOptions = useMemo(() => ({ hideAttribution: true }), []);

  /* ---- Clear graph ---- */
  const clearGraph = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setHasResult(false);
    setError(null);
    nodeHeightsRef.current = new Map();
    rawDataRef.current = null;
  }, [setNodes, setEdges]);

  /* ---- Debounced relayout using measured heights ---- */
  const triggerRelayout = useCallback(() => {
    if (relayoutTimerRef.current) clearTimeout(relayoutTimerRef.current);
    relayoutTimerRef.current = setTimeout(() => {
      if (!rawDataRef.current) return;
      const { nodeMap, explanations } = rawDataRef.current;
      const { nodes: layoutedNodes, edges: layoutedEdges } = transformToGraph(
        nodeMap,
        explanations,
        handleExpandToggle,
        handleHeightReport,
        nodeHeightsRef.current
      );
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    }, 80);
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

  /* ---- Expansion toggle callback — re-runs dagre ---- */
  const handleExpandToggle = useCallback(
    (nodeId: string, expanded: boolean) => {
      if (!expanded) {
        // When collapsing, remove stored height so default is used
        nodeHeightsRef.current.delete(nodeId);
      }

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
      nodeHeightsRef.current
    );
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [setNodes, setEdges, handleExpandToggle, handleHeightReport]);

  /* ---- Full-Canvas Export (Dagre-aware) ---- */
  const handleDownloadPNG = useCallback(() => {
    if (reactFlowWrapper.current === null) return;
    setExportMenuOpen(false);

    const allNodes = getNodes();
    if (allNodes.length === 0) return;

    const nodeBounds = getNodesBounds(allNodes);
    const padding = 60;
    const imageWidth = nodeBounds.width + padding * 2;
    const imageHeight = nodeBounds.height + padding * 2;
    const viewport = getViewportForBounds(nodeBounds, imageWidth, imageHeight, 0.5, 2, padding);

    const flowViewport = reactFlowWrapper.current.querySelector('.react-flow__viewport') as HTMLElement;
    if (!flowViewport) return;

    toPng(flowViewport, {
      backgroundColor: '#0f172a',
      width: imageWidth,
      height: imageHeight,
      quality: 1,
      pixelRatio: 2,
      style: {
        width: `${imageWidth}px`,
        height: `${imageHeight}px`,
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      },
    }).then((dataUrl) => {
      const a = document.createElement('a');
      a.setAttribute('download', 'sql-flow-visualization.png');
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
    const padding = 60;
    const imageWidth = nodeBounds.width + padding * 2;
    const imageHeight = nodeBounds.height + padding * 2;
    const viewport = getViewportForBounds(nodeBounds, imageWidth, imageHeight, 0.5, 2, padding);

    const flowViewport = reactFlowWrapper.current.querySelector('.react-flow__viewport') as HTMLElement;
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
    }).then((dataUrl) => {
      const a = document.createElement('a');
      a.setAttribute('download', 'sql-flow-visualization.svg');
      a.setAttribute('href', dataUrl);
      a.click();
    });
  }, [getNodes]);

  /* ---- Share Link ---- */
  const handleShare = useCallback(() => {
    if (!sql) return;
    const url = new URL(window.location.href);
    url.searchParams.set("q", btoa(sql));
    window.history.replaceState({}, '', url);
    navigator.clipboard.writeText(url.toString());
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }, [sql]);

  /* ---- Main handler ---- */
  const handleVisualize = useCallback(
    async (overrideSql?: string) => {
      const query = overrideSql ?? sql;
      if (!query.trim()) return;

      // Update URL query automatically
      const url = new URL(window.location.href);
      url.searchParams.set("q", btoa(query));
      window.history.replaceState({}, '', url);

      setLoading(true);
      setStage("parsing");
      setError(null);

      // Clear previous graph
      setNodes([]);
      setEdges([]);
      setHasResult(false);
      nodeHeightsRef.current = new Map();

      try {
        // Stage 1: Parse SQL → AST & NodeMap
        const parseRes = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql: query.trim() }),
        });

        const parseData = await parseRes.json();

        if (!parseRes.ok) {
          setError(parseData.error || "Failed to parse SQL");
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
          handleHeightReport
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
                nodeHeightsRef.current
              );
              setNodes(updatedNodes);
              setEdges(updatedEdges);
            } else {
              setError(explainData.error || "Failed to generate explanations");
            }
          })
          .catch((err) => {
            setError(err.message || "Network error fetching explanations");
          })
          .finally(() => {
            setLoading(false);
            setStage("idle");
          });

      } catch (err) {
        const message = err instanceof Error ? err.message : "Network error";
        setError(message);
        setLoading(false);
        setStage("idle");
      }
    },
    [sql, setNodes, setEdges, handleExpandToggle, handleHeightReport]
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
        {/* ── Top Nav Bar ── */}
        <nav className="flex w-full items-center justify-center sm:justify-end px-4 pt-6 sm:pt-4 md:px-8 md:pt-6">
          <motion.button
            onClick={() => setShowCreatorModal(true)}
            className="flex items-center gap-2 rounded-full border border-indigo-400/50 px-5 py-2.5 text-[11px] sm:text-xs font-bold uppercase tracking-widest text-indigo-100 cursor-pointer backdrop-blur-xl"
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
        {/*  HERO SECTION                                               */}
        {/* ════════════════════════════════════════════════════════════ */}
        <section className="relative flex flex-col items-center px-4 pt-14 pb-8 sm:px-6 lg:px-8 md:pt-20 md:pb-12">
          {/* Subtle radial glow behind hero */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(99,102,241,0.08) 0%, transparent 70%)",
            }}
          />

          {/* Headline */}
          <h1 className="relative text-center text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            <span className="hero-gradient-text">D3xTRverse Flow</span>
          </h1>
          <p className="relative mt-4 max-w-xl text-center text-sm leading-relaxed text-[var(--text-secondary)] sm:text-base md:text-lg">
            Instantly visualize and decode complex SQL pipelines.
          </p>

          {/* Sample query buttons */}
          <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
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
        </section>

        {/* ════════════════════════════════════════════════════════════ */}
        {/*  MAIN CONTENT — Editor + Canvas                             */}
        {/* ════════════════════════════════════════════════════════════ */}
        <section className="flex flex-1 flex-col items-center px-4 pb-6 sm:px-6 lg:px-8">
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
                <div className="mb-4 flex items-center gap-2">
                  <Braces className="h-4 w-4 text-[var(--accent-indigo)]" />
                  <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                    SQL Input
                  </span>
                </div>

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

                {/* Error banner */}
                {error && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400 animate-fade-in-up">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Action buttons */}
                <div className="mt-4 flex gap-3">
                  <button
                    id="visualize-btn"
                    onClick={() => handleVisualize()}
                    disabled={loading || !sql.trim()}
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

                  {hasResult && (
                    <button
                      onClick={clearGraph}
                      className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-secondary)] transition-all duration-200 hover:border-[var(--border-accent)] hover:text-[var(--text-primary)]"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Clear
                    </button>
                  )}
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
                  <div className="relative">
                    <button
                      onClick={() => setExportMenuOpen(!exportMenuOpen)}
                      className="p-2.5 rounded-lg bg-[rgba(18,20,30,0.8)] border border-[rgba(255,255,255,0.1)] text-gray-300 hover:text-white hover:bg-[rgba(255,255,255,0.1)] transition-colors backdrop-blur-md flex items-center gap-1.5"
                      title="Export Options"
                    >
                      <Download size={16} />
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
