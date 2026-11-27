// First run and linking: welcome, link the TokHive account, confirm in the
// browser, done. Switching account and linking again reuse the same pages.
import * as React from "react";
import { useApp } from "../app/context";
import { useNav, type BindMode } from "../app/nav";
import { Button } from "../components/ui/button";
import { BeeGlyph, Callout } from "../components/ui/bits";
import { toBeeError, type Pairing } from "../lib/bee";
import { maskEmail } from "../lib/format";
import { accountsOf, cardStatus } from "../lib/model";
import { cn, isMac } from "../lib/utils";

export function Flow({ center, children, className }: { center?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-14 py-7", center && "items-center justify-center text-center", className)}>{children}</div>
  );
}

export function StepLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold tracking-[.04em] text-muted">{children}</div>;
}

export function FlowTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h1 tabIndex={-1} className={cn("m-0 text-[22px] font-semibold text-balance outline-none", className)}>
      {children}
    </h1>
  );
}

export function BackButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="cursor-pointer self-start border-0 bg-transparent p-0 text-[13px] text-muted hover:text-fg" onClick={onClick}>
      {children}
    </button>
  );
}

function Dots({ step }: { step: number }) {
  const { t } = useApp();
  return (
    <div className="flex items-center justify-center gap-1.5 text-xs text-faint">
      {[1, 2, 3].map((n) => (
        <i key={n} className={cn("inline-block size-[7px] rounded-full", n <= step ? "bg-volt" : "bg-line-strong")} aria-hidden="true" />
      ))}
      <span className="ml-1.5">{t.welcome.dots}</span>
    </div>
  );
}

export function Welcome() {
  const { t } = useApp();
  const { go } = useNav();
  return (
    <Flow center>
      <BeeGlyph size={64} />
      <FlowTitle className="mt-1 text-[28px] tracking-[-.01em]">
        <span className="font-light">Tok</span>Hive {t.appName}
      </FlowTitle>
      <p className="m-0 max-w-[62ch] text-[15px] text-fg2">{t.welcome.tagline}</p>
      <ul className="m-0 mt-3 flex w-full max-w-[460px] list-none flex-col gap-2 p-0 text-left">
        {t.welcome.points.map(([title, text]) => (
          <li key={title} className="rounded-xl border border-line bg-card px-3.5 py-3">
            <div className="font-semibold">{title}</div>
            <div className="text-[12.5px] text-muted">{text}</div>
          </li>
        ))}
      </ul>
      <Button size="big" className="mt-3" onClick={() => go({ name: "bind", mode: "onboarding" })} autoFocus>
        {t.welcome.start}
      </Button>
      <div className="text-xs text-muted">{t.welcome.time}</div>
      <div className="mt-4">
        <Dots step={1} />
      </div>
    </Flow>
  );
}

export function Bind({ mode }: { mode: BindMode }) {
  const { t, snapshot } = useApp();
  const { go } = useNav();
  const current = snapshot?.overview?.hive ?? "";
  const [hive, setHive] = React.useState(current);
  const title = mode === "switch" ? t.bind.switchTitle : mode === "rebind" ? t.bind.rebindTitle : t.bind.title;
  return (
    <Flow>
      {mode === "onboarding" && <StepLabel>{t.step(1)}</StepLabel>}
      {mode === "switch" && <BackButton onClick={() => go({ name: "settings" })}>{t.bind.backToSettings}</BackButton>}
      {mode === "rebind" && <BackButton onClick={() => go({ name: "accounts" })}>{t.bind.back}</BackButton>}
      <FlowTitle>{title}</FlowTitle>
      <p className="m-0 max-w-[62ch]">{t.bind.intro}</p>
      <Callout tone="info">{t.bind.onePerAccount}</Callout>
      {mode === "switch" && <Callout tone="info">{t.bind.switchNote}</Callout>}
      <div>
        <Button size="big" autoFocus onClick={() => go({ name: "wait", mode, hive: hive.trim() && hive.trim() !== current ? hive.trim() : undefined })}>
          {t.bind.start}
        </Button>
      </div>
      <details className="mt-auto max-w-[640px] text-[13px]">
        <summary className="cursor-pointer text-muted">{t.bind.advanced}</summary>
        <div className="mt-2 flex items-center gap-2">
          <input
            aria-label={t.bind.hive}
            value={hive}
            placeholder={t.bind.hiveDefault}
            onChange={(e) => setHive(e.target.value)}
            spellCheck={false}
            className="w-[300px] rounded-lg border border-line-strong bg-card px-2 py-[5px] text-[13px] text-fg"
          />
        </div>
      </details>
    </Flow>
  );
}

type Phase = "starting" | "pending" | "expired" | "unreachable" | "failed";

function remaining(expires: string | undefined, now: number): number {
  if (!expires) return 0;
  return Math.max(0, Math.round((new Date(expires).getTime() - now) / 1000));
}

export function Wait({ mode, hive }: { mode: BindMode; hive?: string }) {
  const { t, shell, toast, explain } = useApp();
  const { go } = useNav();
  const [phase, setPhase] = React.useState<Phase>("starting");
  const [pairing, setPairing] = React.useState<Pairing | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(Date.now());
  const started = React.useRef(false);
  const finished = React.useRef(false);

  const finish = React.useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    if (mode === "onboarding") go({ name: "add", step: "platform" });
    else {
      toast(mode === "switch" ? t.wait.switched : t.wait.relinked);
      go({ name: "accounts" });
    }
  }, [go, mode, t, toast]);

  const start = React.useCallback(async () => {
    setPhase("starting");
    setProblem(null);
    try {
      const answer = await shell.request<Pairing>("POST", "/v1/pairing", hive ? { hive } : {});
      setPairing(answer);
      setPhase("pending");
      if (answer.verification_url) {
        shell.openUrl(answer.verification_url).then(
          () => toast(t.wait.browserOpened),
          () => {},
        );
      }
    } catch (err) {
      const e = toBeeError(err);
      if (e.status === 0 || e.status === 502 || e.code === "hive_unavailable" || e.code === "BEE-HIVE-UNREACHABLE") setPhase("unreachable");
      else {
        setProblem(explain(e.code).cause);
        setPhase("failed");
      }
    }
  }, [shell, hive, toast, t, explain]);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
  }, [start]);

  // Follow the pairing until it is confirmed, expires or fails.
  React.useEffect(() => {
    if (phase !== "pending") return;
    const timer = window.setInterval(async () => {
      setNow(Date.now());
      try {
        const answer = await shell.request<Pairing>("GET", "/v1/pairing");
        if (answer.status === "completed") finish();
        else if (answer.status === "expired") setPhase("expired");
        else if (answer.status === "failed") {
          setProblem(answer.problem ? explain(answer.problem.code).cause : null);
          setPhase("failed");
        } else if (answer.status === "cancelled") go({ name: "bind", mode });
        else if (answer.status === "pending") setPairing((p) => ({ ...p, ...answer }));
      } catch {
        // Keep waiting; the shell reports a stopped Bee on its own.
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, shell, finish, explain, go, mode]);

  const left = remaining(pairing?.expires_at, now);
  React.useEffect(() => {
    if (phase === "pending" && pairing?.expires_at && left === 0) setPhase("expired");
  }, [phase, pairing, left]);

  const cancel = async () => {
    await shell.request("DELETE", "/v1/pairing").catch(() => {});
    if (mode === "switch") go({ name: "settings" });
    else if (mode === "rebind") go({ name: "accounts" });
    else go({ name: "bind", mode });
  };

  const copyLink = async () => {
    if (!pairing?.verification_url) return;
    await shell.copy(pairing.verification_url);
    toast(t.wait.linkCopied);
  };

  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <Flow center>
      {mode === "onboarding" && <StepLabel>{t.step(1)}</StepLabel>}
      <FlowTitle>{t.wait.title}</FlowTitle>
      <p className="m-0 max-w-[62ch] text-muted">{t.wait.intro}</p>
      {pairing?.user_code && (
        <div
          className={cn(
            "rounded-[10px] border border-line-strong bg-sunken px-7 py-3 font-mono text-[30px] font-semibold tracking-[.12em] tabular-nums",
            phase !== "pending" && "line-through opacity-40",
          )}
        >
          {pairing.user_code}
        </div>
      )}
      <div aria-live="polite" className="flex flex-col items-center gap-2">
        {(phase === "starting" || phase === "pending") && (
          <>
            <div>
              <span className="spinner mr-1.5" aria-hidden="true" />
              {phase === "starting" ? t.bind.starting : pairing?.waiting_for_old_device ? t.wait.oldDevice : t.wait.waiting}
            </div>
            {phase === "pending" && pairing?.expires_at && <div className="text-[13px] text-muted">{t.wait.expiresIn(clock)}</div>}
          </>
        )}
        {phase === "expired" && (
          <>
            <Callout tone="warn">{t.wait.expired}</Callout>
            <Button onClick={start}>{t.wait.renew}</Button>
          </>
        )}
        {phase === "unreachable" && (
          <>
            <Callout tone="bad" role="alert">
              {t.wait.unreachable}
            </Callout>
            <Button onClick={start}>{t.wait.retry}</Button>
          </>
        )}
        {phase === "failed" && (
          <>
            <Callout tone="bad" role="alert">
              {problem ?? t.wait.failed}
            </Callout>
            <Button onClick={start}>{t.wait.retry}</Button>
          </>
        )}
      </div>
      <div className="mt-2 text-[13px] text-muted">
        {t.wait.noBrowser}{" "}
        <Button variant="secondary" onClick={copyLink} disabled={!pairing?.verification_url}>
          {t.wait.copyLink}
        </Button>{" "}
        {t.wait.anyDevice}
      </div>
      <div>
        <Button variant="ghost" onClick={cancel}>
          {t.wait.cancel}
        </Button>
      </div>
    </Flow>
  );
}

export function Done() {
  const { t, snapshot, syncingSince } = useApp();
  const { finishOnboarding } = useNav();
  const account = accountsOf(snapshot?.overview ?? null)[0];
  // Say what is true: the account may still be syncing or need the person.
  const state = account && snapshot ? cardStatus(account, snapshot, syncingSince[account.platform])?.state : undefined;
  const name = account ? t.platforms[account.platform].name : "";
  const title = !account ? t.done.bound : state === "sharing" ? t.done.sharing(name) : state === "syncing" || state === undefined ? t.done.syncing(name) : state === "action" || state === "restricted" ? t.done.attention(name) : t.done.added(name);
  const owner = maskEmail(snapshot?.overview?.device?.owner_email);
  return (
    <Flow center>
      <div className="text-[40px] text-good" aria-hidden="true">
        ✓
      </div>
      <FlowTitle>{title}</FlowTitle>
      {owner && <p className="m-0 text-muted">{t.done.boundTo(owner)}</p>}
      <p className="m-0 text-muted">{t.done.tray(isMac)}</p>
      <Button size="big" onClick={finishOnboarding} autoFocus>
        {t.done.enter}
      </Button>
      <div className="mt-3">
        <Dots step={3} />
      </div>
    </Flow>
  );
}
