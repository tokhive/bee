import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "../../lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative h-5 w-9 flex-none cursor-pointer rounded-full border-0 bg-line-strong data-[state=checked]:bg-good disabled:cursor-default disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="absolute top-0.5 left-0.5 block size-4 rounded-full bg-page transition-[left] duration-150 data-[state=checked]:left-[18px]" />
    </SwitchPrimitive.Root>
  );
}
