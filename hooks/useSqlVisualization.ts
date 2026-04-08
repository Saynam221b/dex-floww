"use client";

import { useState, useCallback, useRef, useEffect, type RefObject, type MouseEvent as ReactMouseEvent } from "react";
import { useNodesState, useEdgesState, useReactFlow, type Node, type Edge } from "@xyflow/react";
import LZString from "lz-string";
import {
  transformToGraph,
  getActivePath,
  createFallbackExplanations,
  applyExplanationsToExistingNodes,
  type NodeMap,
  type Explanations,
} from "@/lib/graph-visualization";

export type VisualizationStage = "idle" | "parsing" | "explaining" | "rendering";

interface UseSqlVisualizationParams {
  sql: string;
  dialect: string;
  isMobileSafari: boolean;
  reactFlowWrapper: RefObject<HTMLDivElement | null>;
}

export function useSqlVisualization({
  sql,
  dialect,
  isMobileSafari,
  reactFlowWrapper,
}: UseSqlVisualizationParams) {
  const { fitView } = useReactFlow();

  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<VisualizationStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<{ line?: number | null; column?: number | null } | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [toasterVisible, setToasterVisible] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const nodeHeightsRef = useRef<Map<string, number>>(new Map());
  const rawDataRef = useRef<{ nodeMap: NodeMap; explanations: Explanations } | null>(null);
  const relayoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relayoutCountRef = useRef(0);
  const isUrlTriggered = useRef(false);
  const visualizeRequestIdRef = useRef(0);
  const explainAbortRef = useRef<AbortController | null>(null);
  const expandedNodeIdsRef = useRef<Set<string>>(new Set());
  const MAX_AUTO_RELAYOUTS = isMobileSafari ? 1 : 3;

  const triggerRelayout = useCallback(() => {
    if (relayoutTimerRef.current) clearTimeout(relayoutTimerRef.current);
    relayoutTimerRef.current = setTimeout(() => {
      if (!rawDataRef.current) return;
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
        isMobileSafari,
        expandedNodeIdsRef.current
      );
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    }, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [MAX_AUTO_RELAYOUTS, isMobileSafari, setEdges, setNodes]);

  const handleFormat = useCallback(() => {
    relayoutCountRef.current = 0;
    triggerRelayout();
    setTimeout(() => {
      fitView({ duration: 800, padding: 0.2 });
    }, 300);
  }, [triggerRelayout, fitView]);


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

  const handleCteExpandToggle = useCallback(
    (nodeId: string, expanded: boolean) => {
      if (!rawDataRef.current) return;

      const nodeObj = rawDataRef.current.nodeMap[nodeId];
      if (nodeObj && typeof nodeObj === "object") {
        nodeObj.isExpanded = expanded;
      }

      relayoutCountRef.current = 0;
      triggerRelayout();
    },
    [triggerRelayout]
  );

  const handleExpandToggle = useCallback(
    (nodeId: string, expanded: boolean) => {
      if (expanded) {
        expandedNodeIdsRef.current.add(nodeId);
      } else {
        expandedNodeIdsRef.current.delete(nodeId);
      }

      if (!expanded) {
        nodeHeightsRef.current.delete(nodeId);
      }

      relayoutCountRef.current = 0;
      triggerRelayout();
    },
    [triggerRelayout]
  );

  const handleToggleAll = useCallback(
    (expand: boolean) => {
      if (!rawDataRef.current) return;

      if (!expand) {
        nodeHeightsRef.current = new Map();
      }

      const { nodeMap, explanations } = rawDataRef.current;
      const nextExpanded = new Set<string>();
      if (expand) {
        for (const [id, value] of Object.entries(nodeMap)) {
          if (value && typeof value === "object" && !value.isGroup) {
            nextExpanded.add(id);
          }
        }
      }
      expandedNodeIdsRef.current = nextExpanded;

      const { nodes: layoutedNodes, edges: layoutedEdges } = transformToGraph(
        nodeMap,
        explanations,
        handleExpandToggle,
        handleHeightReport,
        handleCteExpandToggle,
        nodeHeightsRef.current,
        isMobileSafari,
        expandedNodeIdsRef.current
      );
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    },
    [handleCteExpandToggle, handleExpandToggle, handleHeightReport, isMobileSafari, setEdges, setNodes]
  );

  const handleNodeClick = useCallback(
    (_event: ReactMouseEvent, node: Node) => {
      const { activeNodes, activeEdges } = getActivePath(node.id, edges);

      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          style: {
            ...n.style,
            opacity: n.type === "cteGroup" || activeNodes.has(n.id) ? 1 : 0.15,
            transition: "opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
          },
        }))
      );

      setEdges((eds) =>
        eds.map((e) => {
          const isActive = activeEdges.has(e.id);
          return {
            ...e,
            data: {
              ...e.data,
              isActive,
            },
          };
        })
      );
    },
    [edges, setEdges, setNodes]
  );

  const handlePaneClick = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        style: {
          ...n.style,
          opacity: 1,
          transition: "opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
        },
      }))
    );

    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        data: {
          ...e.data,
          isActive: false,
        },
      }))
    );
  }, [setEdges, setNodes]);

  const resetVisualization = useCallback(() => {
    explainAbortRef.current?.abort();
    explainAbortRef.current = null;
    setNodes([]);
    setEdges([]);
    setHasResult(false);
    setError(null);
    setErrorDetails(null);
    setToasterVisible(false);
    nodeHeightsRef.current = new Map();
    expandedNodeIdsRef.current = new Set();
    rawDataRef.current = null;
  }, [setEdges, setNodes]);

  const handleVisualize = useCallback(
    async (overrideSql?: string) => {
      const query = overrideSql ?? sql;
      if (!query.trim()) return;
      visualizeRequestIdRef.current += 1;
      const requestId = visualizeRequestIdRef.current;
      explainAbortRef.current?.abort();
      explainAbortRef.current = null;

      if (isUrlTriggered.current) {
        isUrlTriggered.current = false;
      } else {
        try {
          const compressed = LZString.compressToEncodedURIComponent(query);
          if (!isMobileSafari || compressed.length < 2000) {
            window.history.replaceState(null, "", `?q=${compressed}`);
          } else {
            console.warn("[D3xTRverse] URL length excessive for mobile — skipping sync.");
          }
        } catch {
          // URL sync is non-critical.
        }
      }

      setLoading(true);
      setStage("parsing");
      setError(null);
      setErrorDetails(null);
      setToasterVisible(false);

      setNodes([]);
      setEdges([]);
      setHasResult(false);
      nodeHeightsRef.current = new Map();
      expandedNodeIdsRef.current = new Set();
      relayoutCountRef.current = 0;

      try {
        const parseRes = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql: query.trim(), dialect }),
        });

        const parseData = await parseRes.json();
        if (requestId !== visualizeRequestIdRef.current) {
          return;
        }

        if (!parseRes.ok) {
          const errMsg = parseData.details
            ? `${parseData.error} — ${parseData.details}`
            : parseData.error || "Failed to parse SQL";
          setError(errMsg);
          setErrorDetails({ line: parseData.line, column: parseData.column });
          setToasterVisible(true);
          if (parseData.line) {
            console.error(
              `[D3xTRverse Parser] Syntax error at line ${parseData.line}${parseData.column ? `, column ${parseData.column}` : ""}`
            );
          }
          setLoading(false);
          setStage("idle");
          return;
        }

        const nodeMap = parseData?.graph?.nodeMap ?? parseData?.nodeMap;
        if (!nodeMap || typeof nodeMap !== "object") {
          setError("Parser returned invalid graph payload.");
          setToasterVisible(true);
          setLoading(false);
          setStage("idle");
          return;
        }
        const initialExplanations: Explanations = {};
        for (const key of Object.keys(nodeMap)) {
          initialExplanations[key] = "";
        }

        rawDataRef.current = { nodeMap, explanations: initialExplanations };
        const { nodes: graphNodes, edges: graphEdges } = transformToGraph(
          nodeMap,
          initialExplanations,
          handleExpandToggle,
          handleHeightReport,
          handleCteExpandToggle,
          undefined,
          isMobileSafari,
          expandedNodeIdsRef.current
        );

        setStage("rendering");
        setNodes(graphNodes);
        setEdges(graphEdges);
        setHasResult(true);

        setTimeout(() => {
          if (window.innerWidth < 1024 && reactFlowWrapper.current) {
            reactFlowWrapper.current.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 100);

        setStage("explaining");
        setLoading(false);
        const explainController = new AbortController();
        explainAbortRef.current = explainController;

        fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeMap }),
          signal: explainController.signal,
        })
          .then(async (explainRes) => {
            if (requestId !== visualizeRequestIdRef.current) {
              return;
            }
            const explainData = await explainRes.json();
            if (explainRes.ok) {
              rawDataRef.current = { nodeMap, explanations: explainData.explanations };
              setNodes((prevNodes) =>
                applyExplanationsToExistingNodes(prevNodes, explainData.explanations)
              );
            } else {
              setError(explainData.error || "Failed to generate explanations");
              setToasterVisible(true);
              const fallbackExplanations = createFallbackExplanations(
                nodeMap,
                "Explanation unavailable (API Error)."
              );
              rawDataRef.current = { nodeMap, explanations: fallbackExplanations };
              setNodes((prevNodes) =>
                applyExplanationsToExistingNodes(prevNodes, fallbackExplanations)
              );
            }
          })
          .catch((err) => {
            if (requestId !== visualizeRequestIdRef.current) {
              return;
            }
            if (err instanceof DOMException && err.name === "AbortError") {
              return;
            }
            setError(err.message || "Network error fetching explanations");
            setToasterVisible(true);
            const fallbackExplanations = createFallbackExplanations(
              nodeMap,
              "Explanation unavailable (Network Error)."
            );
            rawDataRef.current = { nodeMap, explanations: fallbackExplanations };
            setNodes((prevNodes) =>
              applyExplanationsToExistingNodes(prevNodes, fallbackExplanations)
            );
          })
          .finally(() => {
            if (explainAbortRef.current === explainController) {
              explainAbortRef.current = null;
            }
            if (requestId === visualizeRequestIdRef.current) {
              setStage("idle");
            }
          });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Network error";
        setError(message);
        setToasterVisible(true);
        setLoading(false);
        setStage("idle");
      }
    },
    [dialect, handleCteExpandToggle, handleExpandToggle, handleHeightReport, isMobileSafari, reactFlowWrapper, sql, setEdges, setNodes]
  );

  const markNextVisualizeAsUrlTriggered = useCallback(() => {
    isUrlTriggered.current = true;
  }, []);

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    handleNodeClick,
    handlePaneClick,
    handleVisualize,
    handleFormat,
    handleToggleAll,
    resetVisualization,
    loading,
    stage,
    error,
    errorDetails,
    hasResult,
    toasterVisible,
    setError,
    setErrorDetails,
    setToasterVisible,
    markNextVisualizeAsUrlTriggered,
  };
}
