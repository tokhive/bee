import * as React from "react";
import { useApp } from "../app/context";
import { useUpdate } from "../app/useUpdate";
import { Button } from "../components/ui/button";

/** The app's releases, for installing by hand when an update cannot install. */
const releases = (version: string) => `https://github.com/tokhive/bee/releases/tag/desktop-v${version}`;

/** About: the app's version and its update, checked and installed from here. */
export function UpdateRow() {
  const { t, shell, info } = useApp();
  const update = useUpdate(shell);
  const u = t.update;

  const check = () => shell.checkUpdate().catch(() => {});
  // A failure arrives as the update's state, which says what went wrong.
  const install = () => shell.installUpdate().catch(() => {});
  // Trying again asks again first: the release may have been fixed since.
  const retry = async () => {
    const found = await shell.checkUpdate().catch(() => null);
    if (found?.state === "available") await install();
  };

  let action: React.ReactNode = null;
  let status: React.ReactNode = null;
  switch (update.state) {
    case "idle":
    case "up_to_date":
    case "unconfigured":
    case "checking":
      action = (
        <Button variant="secondary" busy={update.state === "checking"} disabled={update.state === "checking" || update.state === "unconfigured"} onClick={check}>
          {update.state === "checking" ? u.checking : u.check}
        </Button>
      );
      if (update.state === "up_to_date") status = u.upToDate;
      if (update.state === "unconfigured") status = u.unconfigured;
      break;
    case "available":
      action = <Button onClick={install}>{u.install}</Button>;
      status = (
        <>
          <span className="text-fg">{u.available(update.version)}</span> {u.restartNote}
          {update.notes && <span className="mt-1 block max-h-28 overflow-auto whitespace-pre-wrap">{update.notes}</span>}
        </>
      );
      break;
    case "downloading": {
      const percent = update.total ? Math.min(100, Math.round((update.downloaded / update.total) * 100)) : null;
      status = (
        <>
          {u.downloading(update.version, percent)}
          {percent !== null && (
            <span role="progressbar" aria-label={u.progress} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="mt-1.5 block h-1 overflow-hidden rounded-full bg-sunken">
              <span className="block h-full bg-fg transition-[width]" style={{ width: `${percent}%` }} />
            </span>
          )}
        </>
      );
      break;
    }
    case "restarting":
      status = u.restarting(update.version);
      break;
    case "failed": {
      const version = update.version;
      action = version ? <Button onClick={retry}>{u.retry}</Button> : <Button variant="secondary" onClick={check}>{u.check}</Button>;
      status = (
        <>
          {update.stage === "check" ? u.checkFailed : update.stage === "download" ? u.downloadFailed : u.installFailed}
          {version && update.stage === "install" && (
            <>
              {" "}
              <button type="button" className="cursor-pointer border-0 border-b border-line-strong bg-transparent p-0 text-fg" onClick={() => shell.openUrl(releases(version))}>
                {u.manual}
              </button>
            </>
          )}
        </>
      );
      break;
    }
  }

  return (
    <div className="border-b border-line py-[9px] text-[13.5px]">
      <div className="flex items-center gap-3">
        <span>{t.settings.version(info?.version ?? "")}</span>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {status && (
        <p role="status" className="m-0 mt-1 text-[12.5px] text-muted">
          {status}
        </p>
      )}
    </div>
  );
}
