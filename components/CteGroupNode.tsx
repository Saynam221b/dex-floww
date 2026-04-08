import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { ChevronDown, ChevronRight, Binary } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function CteGroupNode({ data }: { data: { label: string; isExpanded?: boolean; onCteExpandToggle?: (id: string, expanded: boolean) => void; nodeId: string } }) {
  const expanded = data.isExpanded !== false;
  
  return (
    <motion.div
      layout
      className="relative rounded-2xl border border-indigo-500/30 bg-indigo-950/10 backdrop-blur-sm transition-all duration-500"
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        zIndex: -1,
        boxShadow: expanded 
          ? "inset 0 0 40px rgba(99, 102, 241, 0.05), 0 0 20px rgba(0, 0, 0, 0.2)"
          : "none",
      }}
    >
      {/* Technical Corner Markers */}
      <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-indigo-500/60 rounded-tl-sm pointer-events-none" />
      <div className="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-indigo-500/60 rounded-tr-sm pointer-events-none" />
      <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-indigo-500/60 rounded-bl-sm pointer-events-none" />
      <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-indigo-500/60 rounded-br-sm pointer-events-none" />

      {/* Cyber Grid Background (only when expanded) */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(circle at 2px 2px, #6366f1 1px, transparent 0)`,
              backgroundSize: "24px 24px",
            }}
          />
        )}
      </AnimatePresence>

      <div 
        className="absolute flex items-center gap-2 top-0 left-6 -translate-y-1/2 px-4 py-1.5 text-[10px] font-black tracking-widest uppercase text-indigo-400 rounded-full border border-indigo-500/30 shadow-xl backdrop-blur-md"
        style={{
          background: "linear-gradient(135deg, #0f172a, #1e1b4b)",
        }}
      >
        <Binary size={12} className="text-indigo-500" />
        <span>CTE: {data.label}</span>
        <button
          className="ml-2 hover:bg-white/10 p-0.5 rounded-full transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            data.onCteExpandToggle?.(data.nodeId, !expanded);
          }}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {/* Invisible handles for React Flow wiring */}
      <Handle type="target" position={Position.Left} className="opacity-0" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="opacity-0" isConnectable={false} />
    </motion.div>
  );
}

export default memo(CteGroupNode);
