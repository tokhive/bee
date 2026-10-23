import { t } from '../i18n/index';
import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
export function DetailSheet({
  trigger,
  title,
  description,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="detail-sheet">
          <header>
            <Dialog.Title>{t(title)}</Dialog.Title>
            <Dialog.Close asChild>
              <button>{t("关闭")}</button>
            </Dialog.Close>
          </header>
          <Dialog.Description>{t(description)}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
