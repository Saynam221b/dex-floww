"use client";

import { useCallback, type RefObject } from "react";
import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";
import { toPng, toSvg } from "html-to-image";

interface UseCanvasExportParams {
  reactFlowWrapper: RefObject<HTMLDivElement | null>;
  getNodes: () => Node[];
  onExportStart?: () => void;
}

export function useCanvasExport({
  reactFlowWrapper,
  getNodes,
  onExportStart,
}: UseCanvasExportParams) {
  const MAX_EXPORT_PIXELS = 16_000_000; // ~16MP safety cap

  const handleDownloadPNG = useCallback(async () => {
    if (reactFlowWrapper.current === null) return;
    onExportStart?.();

    const allNodes = getNodes();
    if (allNodes.length === 0) return;

    const nodeBounds = getNodesBounds(allNodes);
    const padding = 100;
    const imageWidth = nodeBounds.width + padding * 2;
    const imageHeight = nodeBounds.height + padding * 2;
    if (imageWidth * imageHeight > MAX_EXPORT_PIXELS) {
      console.warn("Export skipped: graph dimensions exceed safe export size.");
      return;
    }

    const viewport = getViewportForBounds(
      nodeBounds,
      imageWidth,
      imageHeight,
      1,
      1,
      padding
    );

    const flowViewport = reactFlowWrapper.current.querySelector(
      ".react-flow__viewport"
    ) as HTMLElement;
    if (!flowViewport) return;

    const exportOptions = {
      backgroundColor: "#0f172a",
      width: imageWidth,
      height: imageHeight,
      pixelRatio: 3,
      quality: 1,
      style: {
        width: `${imageWidth}px`,
        height: `${imageHeight}px`,
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      },
      filter: (node: Element) => {
        const cls = node.classList;
        if (!cls) return true;
        return (
          !cls.contains("react-flow__minimap") &&
          !cls.contains("react-flow__controls") &&
          !cls.contains("react-flow__attribution") &&
          !cls.contains("react-flow__panel")
        );
      },
    };

    try {
      const dataUrl = await toPng(flowViewport, exportOptions);
      const a = document.createElement("a");
      a.setAttribute("download", "dex-flow-visualization.png");
      a.setAttribute("href", dataUrl);
      a.click();
    } catch (err) {
      console.error("PNG export failed", err);
    }
  }, [getNodes, onExportStart, reactFlowWrapper]);

  const handleDownloadSVG = useCallback(async () => {
    if (reactFlowWrapper.current === null) return;
    onExportStart?.();

    const allNodes = getNodes();
    if (allNodes.length === 0) return;

    const nodeBounds = getNodesBounds(allNodes);
    const padding = 100;
    const imageWidth = nodeBounds.width + padding * 2;
    const imageHeight = nodeBounds.height + padding * 2;
    if (imageWidth * imageHeight > MAX_EXPORT_PIXELS) {
      console.warn("Export skipped: graph dimensions exceed safe export size.");
      return;
    }
    const viewport = getViewportForBounds(
      nodeBounds,
      imageWidth,
      imageHeight,
      1,
      1,
      padding
    );

    const flowViewport = reactFlowWrapper.current.querySelector(
      ".react-flow__viewport"
    ) as HTMLElement;
    if (!flowViewport) return;

    try {
      const dataUrl = await toSvg(flowViewport, {
        backgroundColor: "#0f172a",
        width: imageWidth,
        height: imageHeight,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
        filter: (node: Element) => {
          const cls = node.classList;
          if (!cls) return true;
          return (
            !cls.contains("react-flow__minimap") &&
            !cls.contains("react-flow__controls") &&
            !cls.contains("react-flow__attribution") &&
            !cls.contains("react-flow__panel")
          );
        },
      });
      const a = document.createElement("a");
      a.setAttribute("download", "dex-flow-visualization.svg");
      a.setAttribute("href", dataUrl);
      a.click();
    } catch (err) {
      console.error("SVG export failed", err);
    }
  }, [getNodes, onExportStart, reactFlowWrapper]);

  return { handleDownloadPNG, handleDownloadSVG };
}
