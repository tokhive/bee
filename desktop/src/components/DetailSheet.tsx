import { t } from '../i18n/index';
import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
export function DetailSheet({
  trigger,
  title,
  description,
  children,
  open,onOpenChange,onCloseAutoFocus,onOpenAutoFocus,
}: {
  trigger: ReactNode;
  /** Already translated by the caller; interpolated business values stay literal. */
  title: string;
  description: string;
  children: ReactNode;
  open?:boolean;onOpenChange?:(open:boolean)=>void;onCloseAutoFocus?:(event:Event)=>void;onOpenAutoFocus?:(event:Event)=>void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="detail-sheet" onCloseAutoFocus={onCloseAutoFocus} onOpenAutoFocus={onOpenAutoFocus}>
          <header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button>{t("关闭")}</button>
            </Dialog.Close>
          </header>
          <Dialog.Description>{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
