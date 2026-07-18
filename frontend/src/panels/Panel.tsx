import { forwardRef } from "react";
import type { ReactNode, HTMLAttributes } from "react";

type PanelProps = {
  id: string;
  title: string;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>;

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  { id, title, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      id={id}
      className={className ? `pitwall-panel ${className}` : "pitwall-panel"}
      {...rest}
    >
      <div className="pitwall-panel-title pitwall-drag-handle">{title}</div>
      <div className="pitwall-panel-body">{children}</div>
    </div>
  );
});
