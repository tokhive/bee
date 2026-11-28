// The proxy Bee's connections to the official services go through. It is kept
// by Bee and applies when Bee starts, so saving it may offer a restart.
import * as React from "react";
import { useApp } from "../app/context";
import { Button } from "../components/ui/button";
import { toBeeError, type Network, type NetworkCheck } from "../lib/bee";

export function NetworkSettings() {
  const { t, shell, snapshot, toast } = useApp();
  const pid = snapshot?.overview?.pid;
  const [network, setNetwork] = React.useState<Network | null>(null);
  const [failed, setFailed] = React.useState(false);
  // A Bee that predates this setting answers 404; there is nothing to show.
  const [unsupported, setUnsupported] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState<"" | "test" | "save" | "restart">("");
  const [result, setResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const edited = React.useRef(false);

  // The saved value is read when the page opens and again whenever a new
  // Bee has started, which is what a restart ends with.
  React.useEffect(() => {
    let live = true;
    shell
      .request<Network>("GET", "/v1/network")
      .then((next) => {
        if (!live) return;
        if (typeof next?.connect_proxy !== "string") throw new Error("not a network setting");
        setNetwork(next);
        setFailed(false);
        if (!edited.current) setDraft(next.connect_proxy);
        setBusy((now) => (now === "restart" ? "" : now));
      })
      .catch((err) => live && (toBeeError(err).status === 404 ? setUnsupported(true) : setFailed(true)));
    return () => {
      live = false;
    };
  }, [shell, pid]);

  const proxy = draft.trim();
  const editable = Boolean(network?.editable);

  const problemText = (code: string, fallback: string) => t.network.problems[code] ?? fallback;

  const test = async () => {
    setBusy("test");
    setResult(null);
    try {
      const check = await shell.request<NetworkCheck>("POST", "/v1/network/check", { connect_proxy: proxy });
      setResult(check.ok ? { ok: true, text: t.network.testOk(check.target, proxy !== "") } : { ok: false, text: problemText(check.problem?.code ?? "", t.network.testFailed) });
    } catch (err) {
      setResult({ ok: false, text: toBeeError(err).code === "invalid_proxy" ? t.network.invalid : t.network.testFailed });
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    setBusy("save");
    setResult(null);
    try {
      const next = await shell.request<Network>("PUT", "/v1/network", { connect_proxy: proxy });
      edited.current = false;
      setNetwork(next);
      setDraft(next.connect_proxy);
      if (!next.restart_required) setResult({ ok: true, text: t.network.saved });
    } catch (err) {
      const code = toBeeError(err).code;
      setResult({ ok: false, text: code === "invalid_proxy" ? t.network.invalid : t.network.saveFailed });
    } finally {
      setBusy("");
    }
  };

  const restart = async () => {
    setBusy("restart");
    try {
      if (!(await shell.restartService())) throw new Error("not the app's own Bee");
    } catch {
      setBusy("");
      toast(t.network.restartFailed);
    }
  };

  if (unsupported) return null;
  if (failed && !network) return <p className="m-0 py-1 text-[12.5px] text-muted">{t.network.loadFailed}</p>;
  if (!network) return null;

  const ownBee = snapshot?.service === "running";
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <p className="m-0 text-[12.5px] text-muted">{t.network.intro}</p>
      {network.source === "egress" && <p className="m-0">{t.network.inEgress(network.connect_proxy)}</p>}
      {!network.editable && network.source !== "egress" && (
        <p className="m-0">
          {t.network.cli}
          {network.active_proxy && ` ${t.network.active(network.active_proxy)}`}
        </p>
      )}
      {network.env_override && <p className="m-0 text-warn">{t.network.env}</p>}
      {editable && (
        <>
          <label htmlFor="setting-proxy" className="text-[12.5px] text-muted">
            {t.network.label}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="setting-proxy"
              value={draft}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={t.network.placeholder}
              onChange={(e) => {
                edited.current = true;
                setDraft(e.target.value);
                setResult(null);
              }}
              className="min-w-[220px] flex-1 rounded-lg border border-line-strong bg-card px-2.5 py-1 font-mono text-[13px] text-fg"
            />
            <Button variant="secondary" disabled={busy !== ""} onClick={test}>
              {busy === "test" ? t.network.testing : t.network.test}
            </Button>
            <Button disabled={busy !== "" || proxy === network.connect_proxy} onClick={save}>
              {t.network.save}
            </Button>
          </div>
          <p className="m-0 text-[12px] text-faint">{t.network.hint}</p>
          {result && (
            <p role="status" className={result.ok ? "m-0 text-good" : "m-0 text-bad"}>
              {result.text}
            </p>
          )}
          {network.restart_required && (
            <div className="flex flex-wrap items-center gap-2" role="status">
              <span>{busy === "restart" ? t.network.restarting : ownBee ? t.network.restartNeeded : t.network.restartByHand}</span>
              {ownBee && busy !== "restart" && (
                <Button variant="secondary" onClick={restart}>
                  {t.network.restart}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
