"use client";

import { memo, type RefObject } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  BackgroundVariant,
  ConnectionLineType,
} from "@xyflow/react";
import { Braces } from "lucide-react";
import SqlNodeComponent from "@/components/SqlNode";
import CteGroupNode from "@/components/CteGroupNode";

const nodeTypes = { sqlNode: SqlNodeComponent, cteGroup: CteGroupNode };
const proOptions = { hideAttribution: true };

interface GraphCanvasProps {
  hasResult: boolean;
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node>;
  onEdgesChange: OnEdgesChange<Edge>;
  onNodeClick: (_event: React.MouseEvent, node: Node) => void;
  onPaneClick: () => void;
  reactFlowWrapper: RefObject<HTMLDivElement | null>;
}

function GraphCanvas({
  hasResult,
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  onPaneClick,
  reactFlowWrapper,
}: GraphCanvasProps) {
  if (!hasResult) {
    return (
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
    );
  }

  return (
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
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        proOptions={proOptions}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.1}
        maxZoom={2}
        panOnScroll
        preventScrolling={false}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#333" />
        <Controls className="dark:bg-gray-800 dark:border-gray-700 dark:fill-white" />
        <MiniMap className="hidden md:block dark:bg-gray-900" nodeColor="#4f46e5" />
      </ReactFlow>
    </div>
  );
}

export default memo(GraphCanvas);
