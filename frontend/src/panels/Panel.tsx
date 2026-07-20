import { forwardRef } from "react";
import type { ReactNode, HTMLAttributes } from "react";

type PanelProps = {
  id: string;
  title: string;
  className?: string;
  onClose?: () => void;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>;

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  { id, title, className, onClose, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      id={id}
      className={className ? `pitwall-panel ${className}` : "pitwall-panel"}
      {...rest}
    >
      <div className="pitwall-panel-title pitwall-drag-handle">
        {title}
        {onClose && (
          <button
            type="button"
            className="pitwall-panel-close"
            aria-label={`Hide ${title}`}
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
      <div className="pitwall-panel-body">{children}</div>
    </div>
  );
});
