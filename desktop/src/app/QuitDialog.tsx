import * as React from "react";
import { useApp } from "./context";
import { Button } from "../components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle } from "../components/ui/dialog";

/** The tray's Quit, when quitting would stop the app's own Bee. */
export function QuitDialog() {
  const { shell, t } = useApp();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => shell.onQuitRequest(() => setOpen(true)), [shell]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>{t.quit.title}</DialogTitle>
        <p className="m-0 text-[13.5px]">{t.quit.text}</p>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{t.quit.cancel}</Button>
          </DialogClose>
          <Button
            onClick={() => {
              setOpen(false);
              shell.quit();
            }}
          >
            {t.quit.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
