import type { ComponentProps } from 'react';
import { Progress as ProgressPrimitive, Slot } from 'radix-ui';

// Adapt the repository's shadcn Button/Badge/Progress contracts to Bee's CSS tokens.
// The same Radix primitives preserve focus and progress semantics without extra class utilities.
export function Button({ variant = 'default', size = 'sm', asChild = false, className = '', ...props }:
  ComponentProps<'button'> & { variant?: 'default' | 'outline' | 'ghost'; size?: 'sm' | 'icon'; asChild?: boolean }) {
  const Component = asChild ? Slot.Root : 'button';
  return <Component data-slot="button" data-variant={variant} data-size={size}
    className={`ui-button ${variant === 'default' ? 'primary' : variant === 'ghost' ? 'quiet' : ''} ${className}`} {...props} />;
}

export function Badge({ className = '', ...props }: ComponentProps<'span'>) {
  return <span data-slot="badge" className={`ui-badge ${className}`} {...props} />;
}

export function Progress({ value, ...props }: Omit<ComponentProps<typeof ProgressPrimitive.Root>, 'value'> & { value: number | null }) {
  const drawn = value === null ? null : Math.max(0, Math.min(100, value));
  return <ProgressPrimitive.Root data-slot="progress" className="ui-progress" value={drawn} {...props}>
    <ProgressPrimitive.Indicator data-slot="progress-indicator"
      style={{ transform: `translateX(-${100 - (drawn ?? 0)}%)` }} />
  </ProgressPrimitive.Root>;
}
