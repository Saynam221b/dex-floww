"use client";

import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Table2,
  GitMerge,
  Filter,
  Columns3,
  ArrowDownUp,
  Group,
  SlidersHorizontal,
  Hash,
  Database,
  ChevronDown,
  Sparkles,
  BrainCircuit,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Public data contract                                               */
/* ------------------------------------------------------------------ */

export interface SqlNodeData {
  label: string;
  sql: string;
  explanation: string;
  nodeType: string;
  onExpandToggle?: (nodeId: string, expanded: boolean) => void;
  nodeId?: string;
}

/* ------------------------------------------------------------------ */
/*  Node type → visual config                                          */
/* ------------------------------------------------------------------ */

const TYPE_CONFIG: Record<
  string,
  { icon: typeof Table2; accent: string; glow: string; gradientTo: string }
> = {
  from: {
    icon: Table2,
    accent: "#22d3ee",
    glow: "rgba(34,211,238,0.30)",
    gradientTo: "#06b6d4",
  },
  join: {
    icon: GitMerge,
    accent: "#f472b6",
    glow: "rgba(244,114,182,0.30)",
    gradientTo: "#ec4899",
  },
  where: {
    icon: Filter,
    accent: "#facc15",
    glow: "rgba(250,204,21,0.30)",
    gradientTo: "#eab308",
  },
  select: {
    icon: Columns3,
    accent: "#a78bfa",
    glow: "rgba(167,139,250,0.35)",
    gradientTo: "#8b5cf6",
  },
  groupby: {
    icon: Group,
    accent: "#34d399",
    glow: "rgba(52,211,153,0.30)",
    gradientTo: "#10b981",
  },
  having: {
    icon: SlidersHorizontal,
    accent: "#fb923c",
    glow: "rgba(251,146,60,0.30)",
    gradientTo: "#f97316",
  },
  orderby: {
    icon: ArrowDownUp,
    accent: "#818cf8",
    glow: "rgba(129,140,248,0.30)",
    gradientTo: "#6366f1",
  },
  limit: {
    icon: Hash,
    accent: "#c084fc",
    glow: "rgba(192,132,252,0.30)",
    gradientTo: "#a855f7",
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
  const config = TYPE_CONFIG[d.nodeType] ?? DEFAULT_CONFIG;
  const Icon = config.icon;

  const [expanded, setExpanded] = useState(false);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    // Broadcast to parent for dagre re-layout
    if (d.onExpandToggle) {
      d.onExpandToggle(id, next);
    }
  };

  return (
    <div
      className="sql-node"
      style={{
        zIndex: expanded ? 1000 : 1,
        minWidth: 290,
        maxWidth: 360,
        borderRadius: 16,
        border: `1.5px solid ${config.accent}44`,
        background: "rgba(14, 16, 24, 0.92)",
        backdropFilter: "blur(20px) saturate(1.5)",
        WebkitBackdropFilter: "blur(20px) saturate(1.5)",
        boxShadow: `
          0 0 28px ${config.glow},
          0 0 0 1px rgba(255,255,255,0.03),
          inset 0 1px 0 rgba(255,255,255,0.05)
        `,
        padding: "14px 16px 12px",
        color: "#e8eaf0",
        fontFamily: "var(--font-sans), system-ui, sans-serif",
      }}
    >
      {/* Target handle — top */}
      <Handle
        type="target"
        position={Position.Top}
        style={{
          width: 10,
          height: 10,
          background: `linear-gradient(135deg, ${config.accent}, ${config.gradientTo})`,
          border: "2px solid rgba(14,16,24,0.95)",
          top: -5,
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
          maxHeight: expanded ? 200 : 0,
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
        </div>
      </div>

      {/* Source handle — bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          width: 10,
          height: 10,
          background: `linear-gradient(135deg, ${config.accent}, ${config.gradientTo})`,
          border: "2px solid rgba(14,16,24,0.95)",
          bottom: -5,
        }}
      />
    </div>
  );
}

export default memo(SqlNodeComponent);
