import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "../../lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative h-[21px] w-9 flex-none cursor-pointer rounded-full border-0 bg-line-strong data-[state=checked]:bg-btn disabled:cursor-default disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="absolute top-0.5 left-0.5 block size-[17px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.25)] transition-[left] duration-150 data-[state=checked]:left-[17px]" />
    </SwitchPrimitive.Root>
  );
}
