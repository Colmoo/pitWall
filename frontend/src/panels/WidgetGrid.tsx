import { useState } from "react";
import type { ReactNode } from "react";
import { ReactGridLayout as GridLayout } from "react-grid-layout/legacy";
import { useContainerWidth } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

export type WidgetLayoutItem = { i: string; x: number; y: number; w: number; h: number };

export function WidgetGrid({
  storageKey,
  defaultLayout,
  children,
}: {
  storageKey: string;
  defaultLayout: WidgetLayoutItem[];
  children: ReactNode;
}) {
  const { width, containerRef } = useContainerWidth();
  const [layout, setLayout] = useState<WidgetLayoutItem[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? (JSON.parse(saved) as WidgetLayoutItem[]) : defaultLayout;
    } catch {
      return defaultLayout;
    }
  });

  function handleLayoutChange(next: readonly WidgetLayoutItem[]) {
    // keep entries for currently-hidden widgets so re-showing restores their spot
    const visible = new Set(next.map((item) => item.i));
    const merged = [...next, ...layout.filter((item) => !visible.has(item.i))];
    setLayout(merged);
    localStorage.setItem(storageKey, JSON.stringify(merged));
  }

  return (
    <div ref={containerRef}>
      <GridLayout
        className="pitwall-widget-grid"
        layout={layout}
        cols={12}
        rowHeight={30}
        margin={[6, 6]}
        compactType={"vertical" as const}
        draggableHandle=".pitwall-drag-handle"
        draggableCancel=".pitwall-panel-close"
        resizeHandles={["s", "w", "e", "n", "sw", "se", "nw", "ne"]}
        onLayoutChange={handleLayoutChange}
        width={width}
      >
        {children}
      </GridLayout>
    </div>
  );
}
