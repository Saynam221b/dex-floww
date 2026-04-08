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

      {/* Hover Instruction (Only when collapsed) */}
      {!expanded && (
        <motion.div 
          initial={{ opacity: 0 }}
          whileHover={{ opacity: 1 }}
          className="absolute inset-x-0 -bottom-8 flex justify-center pointer-events-none"
        >
          <div className="px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-[9px] font-bold text-indigo-300 backdrop-blur-md whitespace-nowrap">
            Click &apos;Explore CTE&apos; to view logic
          </div>
        </motion.div>
      )}

      {/* Pulsing visual for collapsed state to signpost interactivity */}
      {!expanded && (
        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3], scale: [0.98, 1.02, 0.98] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 border border-indigo-500/20 rounded-2xl pointer-events-none"
        />
      )}


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
        className="absolute flex items-center gap-1.5 top-0 left-6 -translate-y-1/2 px-0 py-0 overflow-hidden rounded-full border border-indigo-500/30 shadow-2xl backdrop-blur-xl"
        style={{
          background: "linear-gradient(135deg, #0f172a, #1e1b4b)",
        }}
      >
        <div className="flex items-center gap-2 pl-4 pr-2 py-1.5 border-r border-indigo-500/20">
          <Binary size={12} className="text-indigo-400" />
          <span className="text-[10px] font-black tracking-widest uppercase text-indigo-100/90 whitespace-nowrap">
            CTE: {data.label}
          </span>
        </div>
        
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-indigo-500/20 active:bg-indigo-500/30 transition-all group/expand"
          onClick={(e) => {
            e.stopPropagation();
            data.onCteExpandToggle?.(data.nodeId, !expanded);
          }}
        >
          <span className="text-[9px] font-extrabold uppercase tracking-tighter text-indigo-300 group-hover/expand:text-indigo-100 transition-colors">
            {expanded ? "Collapse Content" : "Explore CTE"}
          </span>
          <div className="text-indigo-400 group-hover/expand:translate-x-0.5 transition-transform">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
        </button>
      </div>


      {/* Invisible handles for React Flow wiring */}
      <Handle type="target" position={Position.Left} className="opacity-0" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="opacity-0" isConnectable={false} />
    </motion.div>
  );
}

export default memo(CteGroupNode);
