import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function CteGroupNode({ data }: { data: { label: string; isExpanded?: boolean; onCteExpandToggle?: (id: string, expanded: boolean) => void; nodeId: string } }) {
  const expanded = data.isExpanded !== false;
  
  return (
    <div
      className="relative rounded-xl border-2 border-dashed border-indigo-500/50 bg-indigo-950/20 transition-all duration-300"
      style={{
        width: "100%",
        height: "100%",
        padding: expanded ? 16 : 8,
        boxSizing: "border-box",
        zIndex: -1,
      }}
    >
      <div className="absolute flex items-center gap-1 top-0 left-0 -translate-y-1/2 translate-x-4 bg-slate-900 px-3 py-1 text-xs font-semibold text-indigo-300 rounded-md border border-indigo-500/30 shadow-lg whitespace-nowrap">
        <span>CTE: {data.label}</span>
        <button
          className="ml-1 hover:bg-slate-700/50 p-0.5 rounded text-indigo-400 transition-colors"
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
    </div>
  );
}

export default memo(CteGroupNode);
