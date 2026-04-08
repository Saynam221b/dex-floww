"use client";

import React, { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { motion } from "framer-motion";

function GlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  animated,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
    borderRadius: 24,
  });

  const color = (data?.originalColor as string) || "#6366f1";
  const isSelected = data?.isActive === true;

  return (
    <>
      {/* Background glow path (static) */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: isSelected ? "#22d3ee" : color,
          strokeWidth: isSelected ? 4 : 2,
          opacity: isSelected ? 0.8 : 0.3,
          transition: "stroke 0.3s, stroke-width 0.3s, opacity 0.3s",
        }}
      />

      {/* Animated Flowing Line */}
      {(animated || isSelected) && (
        <path
          d={edgePath}
          fill="none"
          stroke={isSelected ? "#22d3ee" : color}
          strokeWidth={isSelected ? 4 : 2}
          strokeDasharray="12,12"
          className="flow-line-animation"
          style={{
            opacity: 1,
            filter: isSelected ? "drop-shadow(0 0 8px rgba(34,211,238,0.8))" : "none",
          }}
        />
      )}

      {/* Moving Glow Pulse (only when active/selected) */}
      {isSelected && (
        <motion.circle
          r="4"
          fill="#22d3ee"
          style={{ filter: "drop-shadow(0 0 10px #22d3ee)" }}
        >
          <animateMotion
            dur="2s"
            repeatCount="indefinite"
            path={edgePath}
          />
        </motion.circle>
      )}

      {data?.reason && isSelected && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 9,
              background: "rgba(10, 11, 16, 0.85)",
              color: "#cbd5e1",
              padding: "2px 6px",
              borderRadius: 4,
              border: `1px solid ${color}40`,
              backdropFilter: "blur(4px)",
              pointerEvents: "none",
              zIndex: 100,
              textTransform: "uppercase",
              fontWeight: 700,
              letterSpacing: "0.05em",
            }}
          >
            {String(data.reason)}
          </div>
        </EdgeLabelRenderer>
      )}
      
      <style jsx>{`
        .flow-line-animation {
          stroke-dashoffset: 24;
          animation: flow 1s linear infinite;
        }
        @keyframes flow {
          to {
            stroke-dashoffset: 0;
          }
        }
      `}</style>
    </>
  );
}

export default memo(GlowEdge);
