import { useApp } from "./context";
import { describeError } from "../lib/errors";

/** Saves Bee's diagnostic report where the person chooses and says where. */
export function useDiagnostics(): () => Promise<void> {
  const { shell, t, toast, explain } = useApp();
  return async () => {
    try {
      const path = await shell.exportDiagnostics();
      if (path) toast(t.settings.saved(path));
    } catch (err) {
      toast(`${t.settings.diagnosticsFailed}：${describeError(err, explain, t).text}`);
    }
  };
}
