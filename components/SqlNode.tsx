"use client";

import { memo, useState, useEffect, useRef, useCallback } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitMerge,
  Filter,
  Database,
  ChevronDown,
  Sparkles,
  BrainCircuit,
  Lightbulb,
  Sigma,
  TableProperties,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Public data contract                                               */
/* ------------------------------------------------------------------ */

export interface SqlNodeData {
  label: string;
  sql: string;
  explanation: string;
  nodeType: string;
  operationType: string;
  onExpandToggle?: (nodeId: string, expanded: boolean) => void;
  onHeightReport?: (nodeId: string, height: number) => void;
  nodeId?: string;
}

/* ------------------------------------------------------------------ */
/*  Fake "processing" messages                                         */
/* ------------------------------------------------------------------ */

const THINKING_MESSAGES = [
  "Reticulating splines...",
  "Consulting the data wizards...",
  "Translating from Nerd to English...",
  "Synthesizing real-world analogies...",
  "Asking a 5-year-old...",
];

/* ------------------------------------------------------------------ */
/*  Operation type → visual config                                     */
/* ------------------------------------------------------------------ */

const OPERATION_CONFIG: Record<
  string,
  { icon: React.ElementType; accent: string; glow: string; gradientTo: string }
> = {
  source: {
    icon: Database,
    accent: "#3b82f6", // Blue
    glow: "rgba(59,130,246,0.30)",
    gradientTo: "#2563eb",
  },
  join: {
    icon: GitMerge,
    accent: "#a855f7", // Purple
    glow: "rgba(168,85,247,0.30)",
    gradientTo: "#9333ea",
  },
  filter: {
    icon: Filter,
    accent: "#f59e0b", // Yellow/Orange
    glow: "rgba(245,158,11,0.30)",
    gradientTo: "#d97706",
  },
  aggregate: {
    icon: Sigma,
    accent: "#10b981", // Green
    glow: "rgba(16,185,129,0.30)",
    gradientTo: "#059669",
  },
  output: {
    icon: TableProperties,
    accent: "#cbd5e1", // White/Gray
    glow: "rgba(203,213,225,0.30)",
    gradientTo: "#94a3b8",
  },
};

const DEFAULT_CONFIG = {
  icon: Database,
  accent: "#94a3b8",
  glow: "rgba(148,163,184,0.20)",
  gradientTo: "#64748b",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

function SqlNodeComponent({ data, id }: NodeProps) {
  const d = data as unknown as SqlNodeData;
  const config = OPERATION_CONFIG[d.operationType] ?? DEFAULT_CONFIG;
  const icon = config.icon;
  const Icon = icon;
  const isCte = d.label.startsWith("[");
  const updateNodeInternals = useUpdateNodeInternals();

  const [expanded, setExpanded] = useState(false);

  /* ── ELI5 state ── */
  const [eli5Text, setEli5Text] = useState<string | null>(null);
  const [isDeepThinking, setIsDeepThinking] = useState(false);
  const [thinkingMsg, setThinkingMsg] = useState(THINKING_MESSAGES[0]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const lastReportedHeight = useRef(0);

  /* Measure actual DOM height and report to parent for dagre layout */
  const onHeightReportRef = useRef(d.onHeightReport);
  onHeightReportRef.current = d.onHeightReport;
  const nodeIdRef = useRef(id);
  nodeIdRef.current = id;

  useEffect(() => {
    const el = nodeRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = Math.ceil(entry.contentRect.height) + 30; // +padding/border
        // Only report if height changed meaningfully (>15px threshold)
        // Higher threshold prevents iOS sub-pixel jitter from triggering loops
        if (Math.abs(h - lastReportedHeight.current) > 15) {
          lastReportedHeight.current = h;
          updateNodeInternals(nodeIdRef.current);
          onHeightReportRef.current?.(nodeIdRef.current, h);
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
    // Intentionally stable deps — refs handle the mutable values.
  }, [updateNodeInternals]);

  /* Cycle through fake messages while thinking */
  useEffect(() => {
    if (isDeepThinking) {
      intervalRef.current = setInterval(() => {
        setThinkingMsg(
          THINKING_MESSAGES[Math.floor(Math.random() * THINKING_MESSAGES.length)]
        );
      }, 800);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isDeepThinking]);

  const handleELI5 = useCallback(async () => {
    setIsDeepThinking(true);
    setEli5Text(null);
    try {
      const res = await fetch("/api/explain-eli5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snippet: d.sql }),
      });
      const json = await res.json();
      setEli5Text(json.explanation ?? "Could not simplify this one.");
    } catch {
      setEli5Text("Oops — something went wrong. Try again!");
    } finally {
      setIsDeepThinking(false);
    }
  }, [d.sql]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (!next) {
      // Reset ELI5 state when collapsing
      setEli5Text(null);
      setIsDeepThinking(false);
    }
    if (d.onExpandToggle) {
      d.onExpandToggle(id, next);
    }
  };

  return (
    <div
      ref={nodeRef}
      className="sql-node transition-opacity duration-300"
      style={{
        zIndex: expanded ? 50 : 1,
        minWidth: 290,
        maxWidth: 360,
        borderRadius: 16,
        border: isCte ? `1.5px dashed ${config.accent}88` : `1.5px solid ${config.accent}44`,
        background: isCte ? "rgba(20, 24, 48, 0.95)" : "rgba(14, 16, 24, 0.92)",
        backdropFilter: "blur(20px) saturate(1.5)",
        WebkitBackdropFilter: "blur(20px) saturate(1.5)",
        boxShadow: isCte 
          ? `0 0 32px ${config.glow}, 0 0 0 1px ${config.accent}20`
          : `
            0 0 28px ${config.glow},
            0 0 0 1px rgba(255,255,255,0.03),
            inset 0 1px 0 rgba(255,255,255,0.05)
          `,
        padding: "14px 16px 12px",
        color: "#e8eaf0",
        fontFamily: "var(--font-sans), system-ui, sans-serif",
      }}
    >
      {/* Target handle — Left */}
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 10,
          height: 10,
          background: `linear-gradient(135deg, ${config.accent}, ${config.gradientTo})`,
          border: "2px solid rgba(14,16,24,0.95)",
          left: -5,
          top: "50%",
          transform: "translateY(-50%)",
        }}
      />

      {/* ── Header row: icon + label ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 34,
            height: 34,
            borderRadius: 10,
            background: `linear-gradient(135deg, ${config.accent}20, ${config.accent}08)`,
            border: `1px solid ${config.accent}35`,
            flexShrink: 0,
          }}
        >
          <Icon size={16} color={config.accent} strokeWidth={2} />
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: config.accent,
          }}
        >
          {d.label}
        </span>
      </div>

      {/* ── SQL snippet ── */}
      <div
        style={{
          fontFamily: "var(--font-mono), monospace",
          fontSize: 11.5,
          lineHeight: 1.5,
          color: "#c4c8d8",
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.05)",
          marginBottom: 8,
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
          maxHeight: 72,
          overflow: "hidden",
        }}
      >
        {d.sql}
      </div>

      {/* ── Reveal AI Insight toggle ── */}
      <button
        className="nodrag cursor-pointer pointer-events-auto"
        onClick={(e) => {
          e.stopPropagation();
          handleToggle();
        }}
        style={{
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          width: "100%",
          padding: "7px 0",
          border: "none",
          borderRadius: 8,
          background: expanded
            ? `linear-gradient(135deg, ${config.accent}18, ${config.accent}0a)`
            : "rgba(255,255,255,0.025)",
          cursor: "pointer",
          color: expanded ? config.accent : "#6b7091",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          transition: "all 0.25s ease",
          outline: "none",
        }}
      >
        <Sparkles size={11} />
        {expanded ? "Hide Insight" : "Reveal AI Insight"}
        <ChevronDown
          size={13}
          style={{
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />
      </button>

      {/* ── AI Explanation — Premium Insights Panel ── */}
      <div
        className="ai-panel-wrapper nodrag"
        style={{
          overflow: "hidden",
          transition:
            "max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease, margin-top 0.35s ease",
          maxHeight: expanded ? 800 : 0,
          opacity: expanded ? 1 : 0,
          marginTop: expanded ? 10 : 0,
        }}
      >
        <div
          className="ai-insight-panel"
          style={{
            position: "relative",
            padding: "16px 16px 14px",
            borderRadius: 12,
            background: "rgba(8, 10, 18, 0.85)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: `1px solid ${config.accent}30`,
            boxShadow: `
              inset 0 1px 0 rgba(255,255,255,0.03),
              inset 0 0 20px rgba(0,0,0,0.3),
              0 0 15px ${config.accent}10
            `,
          }}
        >
          {/* Panel header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 10,
              paddingBottom: 8,
              borderBottom: `1px solid ${config.accent}18`,
            }}
          >
            <BrainCircuit size={12} color={config.accent} strokeWidth={2} />
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: config.accent,
                opacity: 0.9,
              }}
            >
              AI Explanation
            </span>
            <div
              style={{
                marginLeft: "auto",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: config.accent,
                boxShadow: `0 0 8px ${config.accent}`,
                animation: "pulse-dot 2s ease-in-out infinite",
              }}
            />
          </div>

          {/* Explanation text */}
          {d.explanation ? (
            <p
              style={{
                fontSize: 12.5,
                lineHeight: 1.7,
                color: "#c8cce0",
                margin: 0,
                letterSpacing: "0.01em",
              }}
            >
              {d.explanation}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              <div style={{ height: 8, width: "100%", background: "rgba(255,255,255,0.08)", borderRadius: 4, animation: "pulse-bg 1.5s infinite" }} />
              <div style={{ height: 8, width: "90%", background: "rgba(255,255,255,0.08)", borderRadius: 4, animation: "pulse-bg 1.5s infinite", animationDelay: "0.2s" }} />
              <div style={{ height: 8, width: "70%", background: "rgba(255,255,255,0.08)", borderRadius: 4, animation: "pulse-bg 1.5s infinite", animationDelay: "0.4s" }} />
            </div>
          )}

          {/* ─────────────────────────────────────────────────────── */}
          {/*  ELI5 Section                                          */}
          {/* ─────────────────────────────────────────────────────── */}
          {d.explanation && (
            <div style={{ marginTop: 12 }}>
              {/* Divider */}
              <div
                style={{
                  height: 1,
                  background: `linear-gradient(90deg, transparent, ${config.accent}25, transparent)`,
                  marginBottom: 10,
                }}
              />

              <AnimatePresence mode="wait">
                {/* ── State 1: Button visible (no ELI5 yet, not thinking) ── */}
                {!isDeepThinking && !eli5Text && (
                  <motion.div
                    key="eli5-btn"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                  >
                    <button
                      className="nodrag cursor-pointer pointer-events-auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleELI5();
                      }}
                      style={{
                        pointerEvents: "auto",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        width: "100%",
                        padding: "6px 12px",
                        border: "1px solid rgba(139, 92, 246, 0.25)",
                        borderRadius: 8,
                        background:
                          "linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(99, 102, 241, 0.04))",
                        cursor: "pointer",
                        color: "#b4a0f4",
                        fontSize: 9.5,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        transition: "all 0.25s ease",
                        outline: "none",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "rgba(139, 92, 246, 0.5)";
                        e.currentTarget.style.background =
                          "linear-gradient(135deg, rgba(139, 92, 246, 0.14), rgba(99, 102, 241, 0.08))";
                        e.currentTarget.style.boxShadow =
                          "0 0 16px rgba(139, 92, 246, 0.15)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "rgba(139, 92, 246, 0.25)";
                        e.currentTarget.style.background =
                          "linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(99, 102, 241, 0.04))";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      <Lightbulb size={11} />
                      Simplify with Example
                    </button>
                  </motion.div>
                )}

                {/* ── State 2: Deep thinking / loading ── */}
                {isDeepThinking && (
                  <motion.div
                    key="eli5-loader"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.25 }}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      background:
                        "linear-gradient(135deg, rgba(99, 102, 241, 0.06), rgba(139, 92, 246, 0.04))",
                      border: "1px solid rgba(99, 102, 241, 0.15)",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    {/* Animated scan line */}
                    <motion.div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 1,
                        background:
                          "linear-gradient(90deg, transparent, rgba(139, 92, 246, 0.6), transparent)",
                      }}
                      animate={{ top: ["0%", "100%", "0%"] }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "linear",
                      }}
                    />

                    {/* Pulsing glow behind text */}
                    <motion.div
                      style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: 8,
                        background:
                          "radial-gradient(ellipse at center, rgba(139, 92, 246, 0.08) 0%, transparent 70%)",
                      }}
                      animate={{ opacity: [0.3, 0.8, 0.3] }}
                      transition={{
                        duration: 1.5,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    />

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        position: "relative",
                        zIndex: 1,
                      }}
                    >
                      {/* Spinning dots */}
                      <motion.div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          border: "2px solid rgba(139, 92, 246, 0.2)",
                          borderTopColor: "#a78bfa",
                          flexShrink: 0,
                        }}
                        animate={{ rotate: 360 }}
                        transition={{
                          duration: 0.8,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                      />

                      <motion.span
                        key={thinkingMsg}
                        initial={{ opacity: 0, x: 6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -6 }}
                        transition={{ duration: 0.2 }}
                        style={{
                          fontSize: 10,
                          color: "#b4a0f4",
                          fontFamily: "var(--font-mono), monospace",
                          letterSpacing: "0.03em",
                          fontWeight: 500,
                        }}
                      >
                        {thinkingMsg}
                      </motion.span>
                    </div>
                  </motion.div>
                )}

                {/* ── State 3: ELI5 result ── */}
                {!isDeepThinking && eli5Text && (
                  <motion.div
                    key="eli5-result"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    style={{
                      padding: "11px 13px",
                      borderRadius: 10,
                      background:
                        "linear-gradient(135deg, rgba(99, 102, 241, 0.07), rgba(139, 92, 246, 0.05))",
                      border: "1px solid rgba(139, 92, 246, 0.2)",
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.02), 0 0 12px rgba(139, 92, 246, 0.06)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        marginBottom: 7,
                      }}
                    >
                      <Lightbulb size={10} color="#c4b5fd" />
                      <span
                        style={{
                          fontSize: 8.5,
                          fontWeight: 700,
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                          color: "#c4b5fd",
                        }}
                      >
                        ELI5 Analogy
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: 12,
                        lineHeight: 1.7,
                        color: "#d4d0f0",
                        margin: 0,
                        letterSpacing: "0.01em",
                      }}
                    >
                      {eli5Text}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Source handle — Right */}
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 10,
          height: 10,
          background: `linear-gradient(135deg, ${config.accent}, ${config.gradientTo})`,
          border: "2px solid rgba(14,16,24,0.95)",
          right: -5,
          top: "50%",
          transform: "translateY(-50%)",
        }}
      />
    </div>
  );
}

export default memo(SqlNodeComponent);
