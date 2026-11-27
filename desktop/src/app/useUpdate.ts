import * as React from "react";
import type { Shell, UpdateState } from "../lib/bee";

/** The app's own update as the shell reports it, kept current. */
export function useUpdate(shell: Shell): UpdateState {
  const [state, setState] = React.useState<UpdateState>({ state: "idle" });
  React.useEffect(() => {
    let live = true;
    let pushed = false;
    const stop = shell.onUpdate((next) => {
      pushed = true;
      setState(next);
    });
    // What the shell knew before this window listened, unless it has
    // already pushed something newer.
    shell
      .updateStatus()
      .then((current) => live && !pushed && setState(current))
      .catch(() => {});
    return () => {
      live = false;
      stop();
    };
  }, [shell]);
  return state;
}
