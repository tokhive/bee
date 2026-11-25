// A term with a light dashed underline. Hovering, focusing or clicking it shows
// a short explanation; it is the only "explainable" marker (no icon).
import * as React from "react";

export function Term({ children, help }: { children: React.ReactNode; help: string }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <span className="relative inline">
      <span
        role="button"
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        className="cursor-help border-b border-dashed border-current/45 hover:border-current focus:border-current"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        {children}
      </span>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute top-5 left-0 z-40 w-60 cursor-default rounded-[7px] bg-fg px-2.5 py-2 text-left text-xs leading-normal font-normal text-page shadow-pop"
        >
          {help}
        </span>
      )}
    </span>
  );
}
