// The card's ⋯ menu (Radix): arrow keys move, Enter picks, Escape closes.
import * as React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { cn } from "../../lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        align="end"
        className={cn("z-40 w-[180px] rounded-lg border border-line-strong bg-card p-[5px] text-fg shadow-pop", className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, destructive, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "block w-full cursor-pointer rounded-[5px] px-2.5 py-[7px] text-left text-[13px] outline-none data-[highlighted]:bg-sunken",
        destructive && "text-bad",
        className,
      )}
      {...props}
    />
  );
}
