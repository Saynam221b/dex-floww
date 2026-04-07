"use client";

import { motion } from "framer-motion";
import { Database, Code2, GitBranch } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Node positions — simple inverted-triangle DAG layout               */
/* ------------------------------------------------------------------ */

const NODE_CFG = [
  { id: "n1", cx: 200, cy: 70, icon: Database, delay: 0 },
  { id: "n2", cx: 400, cy: 70, icon: Code2, delay: 0.15 },
  { id: "n3", cx: 300, cy: 200, icon: GitBranch, delay: 0.3 },
];

const LINES = [
  { x1: 200, y1: 70, x2: 300, y2: 200, delay: 0.45 },
  { x1: 400, y1: 70, x2: 300, y2: 200, delay: 0.55 },
  { x1: 200, y1: 70, x2: 400, y2: 70, delay: 0.65 },
];

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function SplashScreen() {
  return (
    <motion.div
      className="splash-screen"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#050507",
        overflow: "hidden",
      }}
    >
      {/* ── Ambient glow backdrop ── */}
      <div
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          background:
            "radial-gradient(ellipse 50% 50% at 50% 45%, rgba(99,102,241,0.06) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      {/* ── DAG SVG ── */}
      <svg
        width="600"
        height="280"
        viewBox="0 0 600 280"
        fill="none"
        style={{ maxWidth: "90vw", position: "relative", zIndex: 1 }}
      >
        {/* Defs — glows */}
        <defs>
          <filter id="node-glow">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="line-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#c084fc" stopOpacity="0.6" />
          </linearGradient>
        </defs>

        {/* Connecting lines — draw on with pathLength */}
        {LINES.map((l, i) => (
          <motion.line
            key={i}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke="url(#line-grad)"
            strokeWidth={2}
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{
              pathLength: { duration: 0.5, delay: l.delay, ease: "easeInOut" },
              opacity: { duration: 0.2, delay: l.delay },
            }}
          />
        ))}

        {/* Nodes — scale in with glow */}
        {NODE_CFG.map((n) => {
          const Icon = n.icon;
          return (
            <motion.g
              key={n.id}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                type: "spring",
                stiffness: 260,
                damping: 20,
                delay: n.delay,
              }}
              style={{ originX: `${n.cx}px`, originY: `${n.cy}px` }}
            >
              {/* Outer glow ring */}
              <motion.circle
                cx={n.cx}
                cy={n.cy}
                r={30}
                fill="none"
                stroke="#818cf8"
                strokeWidth={1.5}
                filter="url(#node-glow)"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.6, 0.3] }}
                transition={{
                  duration: 2,
                  delay: n.delay + 0.3,
                  repeat: Infinity,
                  repeatType: "reverse",
                }}
              />
              {/* Core circle */}
              <circle
                cx={n.cx}
                cy={n.cy}
                r={24}
                fill="rgba(15,15,25,0.9)"
                stroke="rgba(129,140,248,0.4)"
                strokeWidth={1.5}
              />
              {/* Icon — foreignObject for Lucide React */}
              <foreignObject
                x={n.cx - 12}
                y={n.cy - 12}
                width={24}
                height={24}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "100%",
                    height: "100%",
                  }}
                >
                  <Icon size={16} color="#a78bfa" strokeWidth={2} />
                </div>
              </foreignObject>
            </motion.g>
          );
        })}
      </svg>

      {/* ── Title text — fades in after nodes connect ── */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 1.0, ease: "easeOut" }}
        style={{
          position: "relative",
          zIndex: 1,
          textAlign: "center",
          marginTop: 12,
        }}
      >
        <h1
          style={{
            fontSize: "clamp(1.6rem, 4vw, 2.8rem)",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            background:
              "linear-gradient(135deg, #818cf8 0%, #c084fc 50%, #f0abfc 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            filter: "drop-shadow(0 0 24px rgba(129,140,248,0.35))",
            margin: 0,
          }}
        >
          D3xTRverse Flow
        </h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          transition={{ duration: 0.6, delay: 1.4 }}
          style={{
            marginTop: 10,
            fontSize: 12,
            fontFamily: "var(--font-mono, monospace)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#818cf8",
          }}
        >
          Initializing Engine...
        </motion.p>
      </motion.div>

      {/* ── Bottom pulse bar ── */}
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 2.2, delay: 0.3, ease: "easeInOut" }}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 2,
          background:
            "linear-gradient(90deg, transparent, #818cf8, #c084fc, #818cf8, transparent)",
          transformOrigin: "left",
          opacity: 0.6,
        }}
      />
    </motion.div>
  );
}
