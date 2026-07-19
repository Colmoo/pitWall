import { useState } from "react";
import type { ReactNode } from "react";
import GridLayout from "react-grid-layout";
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
  const [layout, setLayout] = useState<WidgetLayoutItem[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? (JSON.parse(saved) as WidgetLayoutItem[]) : defaultLayout;
    } catch {
      return defaultLayout;
    }
  });

  function handleLayoutChange(next: readonly WidgetLayoutItem[]) {
    setLayout([...next]);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  return (
    <GridLayout
      className="pitwall-widget-grid"
      layout={layout}
      cols={12}
      rowHeight={30}
      margin={[8, 8]}
      compactType={"vertical" as const}
      draggableHandle=".pitwall-drag-handle"
      resizeHandles={["s", "w", "e", "n", "sw", "se", "nw", "ne"]}
      onLayoutChange={handleLayoutChange}
      width={1200}
    >
      {children}
    </GridLayout>
  );
}
