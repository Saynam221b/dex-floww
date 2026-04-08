import { memo } from "react";
import { Handle, Position } from "@xyflow/react";

export function CteGroupNode({ data }: { data: { label: string } }) {
  return (
    <div
      className="relative rounded-xl border-2 border-dashed border-indigo-500/50 bg-indigo-950/20"
      style={{
        width: "100%",
        height: "100%",
        padding: 16,
        boxSizing: "border-box",
        zIndex: -1,
      }}
    >
      <div className="absolute top-0 left-0 -translate-y-1/2 translate-x-4 bg-slate-900 px-3 py-1 text-xs font-semibold text-indigo-300 rounded-md border border-indigo-500/30 shadow-lg whitespace-nowrap">
        CTE: {data.label}
      </div>
      {/* Invisible handles for React Flow wiring */}
      <Handle type="target" position={Position.Left} className="opacity-0" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="opacity-0" isConnectable={false} />
    </div>
  );
}

export default memo(CteGroupNode);

