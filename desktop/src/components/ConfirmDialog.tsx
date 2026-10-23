import { t } from '../i18n/index';
import { Dialog } from 'radix-ui';
import { useState, type ReactNode } from 'react';
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  busy,
  onConfirm,
}: {
  trigger: ReactNode;
  /** Already translated by the caller; interpolated business values stay literal. */
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" aria-busy={busy}>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button disabled={busy}>{t("取消")}</button>
            </Dialog.Close>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                void onConfirm().then(() => setOpen(false));
              }}
            >
              {busy ? t('处理中…') : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
