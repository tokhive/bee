import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] border border-transparent font-medium cursor-pointer hover:brightness-[1.08] disabled:cursor-default disabled:opacity-50 disabled:hover:brightness-100",
  {
    variants: {
      variant: {
        primary: "bg-btn text-btn-fg",
        secondary: "bg-btn2 text-btn2-fg border-line",
        danger: "bg-bad text-white",
        ghost: "bg-transparent text-fg hover:bg-sunken",
      },
      size: {
        default: "px-[13px] py-1.5 text-[13px]",
        big: "px-[22px] py-2.5 text-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Shows a spinner and blocks clicks while an operation runs. */
    busy?: boolean;
  };

export function Button({ className, variant, size, busy, disabled, children, onClick, type = "button", ...props }: ButtonProps) {
  // A busy button stays focusable, so keyboard focus is not lost while it works.
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), busy && "cursor-progress opacity-70 hover:brightness-100", className)}
      disabled={disabled}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={busy ? undefined : onClick}
      {...props}
    >
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
