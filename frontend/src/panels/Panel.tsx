import { useState } from "react";
import type { ReactNode } from "react";

type Position = { x: number; y: number };

// ponytail: nudge-and-persist dragging (mouse only, no touch, no collision/z-index
// stacking manager) - upgrade to a proper layout library if free-form stacking or
// touch support is needed later.
function useDraggablePosition(storageKey: string) {
  const [pos, setPos] = useState<Position>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? (JSON.parse(saved) as Position) : { x: 0, y: 0 };
    } catch {
      return { x: 0, y: 0 };
    }
  });

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = pos;

    function onMove(ev: MouseEvent) {
      setPos({ x: origin.x + (ev.clientX - startX), y: origin.y + (ev.clientY - startY) });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setPos((p) => {
        localStorage.setItem(storageKey, JSON.stringify(p));
        return p;
      });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return { pos, startDrag };
}

export function Panel({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  const { pos, startDrag } = useDraggablePosition(`pitwall-widget-pos:${id}`);

  return (
    <div
      className={className ? `pitwall-panel ${className}` : "pitwall-panel"}
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
    >
      <div className="pitwall-panel-title pitwall-drag-handle" onMouseDown={startDrag}>
        {title}
      </div>
      {children}
    </div>
  );
}
