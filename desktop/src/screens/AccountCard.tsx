// One account: who it is, whether it shares and why, its quota, and what can
// be done. A failed operation leaves the card as it was and says why.
import * as React from "react";
import { useApp } from "../app/context";
import { useNav } from "../app/nav";
import { useDiagnostics } from "../app/useDiagnostics";
import { Button } from "../components/ui/button";
import { Kbd, PlatformMark } from "../components/ui/bits";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle } from "../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Term } from "../components/ui/term";
import type { Account, Detection, PlatformState } from "../lib/bee";
import { describeError } from "../lib/errors";
import { maskEmail, monthDay, planLabel, resetTime, shortFingerprint, staleMinutes, windowName } from "../lib/format";
import { managesAccounts, stateTone, type CardStatus } from "../lib/model";
import { cn } from "../lib/utils";

const pillTones = {
  good: "bg-good-bg text-good",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
  idle: "bg-sunken text-muted",
};

function StatusPill({ status }: { status: CardStatus }) {
  const { t } = useApp();
  const tone = stateTone[status.state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold whitespace-nowrap", pillTones[tone])}>
      {status.state === "syncing" ? (
        <span className="spinner !size-2.5 !border-[1.5px]" aria-hidden="true" />
      ) : (
        <i className={cn("inline-block size-[7px] rounded-full", tone === "idle" ? "border-[1.5px] border-current" : "bg-current")} aria-hidden="true" />
      )}
      {t.status[status.state]}
    </span>
  );
}

/** How long a card may show no quota before it suggests a proxy. */
const NO_QUOTA_BEFORE_PROXY_HINT_MS = 60_000;

export function Quota({ platform, syncing }: { platform?: PlatformState; syncing: boolean }) {
  const { t } = useApp();
  const { go } = useNav();
  const windows = platform?.capabilities.windows ?? [];
  const none = syncing || !windows.length;
  // Bee cannot say it is the network that keeps the quota from being read, so
  // a card still without one after a minute offers the proxy setting, unless
  // something else already needs the person (a sign-in, a pause, a limit).
  const [late, setLate] = React.useState(false);
  React.useEffect(() => {
    if (!none) return setLate(false);
    const timer = setTimeout(() => setLate(true), NO_QUOTA_BEFORE_PROXY_HINT_MS);
    return () => clearTimeout(timer);
  }, [none]);
  const state = platform?.sharing.state;
  if (none) {
    return (
      <div className="text-[12.5px] text-muted">
        {t.quota.none}
        {late && state !== "action" && state !== "paused" && state !== "restricted" && (
          <p className="m-0 mt-1">
            {t.quota.proxyHint}{" "}
            <button type="button" className="cursor-pointer underline" onClick={() => go({ name: "settings" })}>
              {t.quota.proxyLink}
            </button>
          </p>
        )}
      </div>
    );
  }
  const stale = staleMinutes(platform?.capabilities.observed_at);
  return (
    <div>
      <div className="mb-1 text-[11.5px] text-faint">
        {t.quota.head}
        {stale !== null && ` · ${t.quota.updated(stale)}`}
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_44px_auto] items-center gap-x-3 gap-y-1.5 text-[12.5px]" role="list" aria-label={t.quota.label}>
        {windows.map((window, i) => {
          const name = windowName(window, t);
          const used = window.used_percent;
          const full = used !== null && used >= 100;
          return (
            <div key={i} role="listitem" className="contents">
              <span className="whitespace-nowrap text-muted">{name}</span>
              <div
                className="h-1.5 overflow-hidden rounded-[3px] bg-bar-track"
                role="progressbar"
                aria-label={name}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={used ?? undefined}
              >
                {used !== null && <b className={cn("block h-full rounded-[3px]", full ? "bg-bad" : "bg-bar")} style={{ width: `${Math.min(100, used)}%` }} />}
              </div>
              <span className={cn("text-right font-semibold tabular-nums", full && "text-bad")}>{used === null ? "—" : `${used}%`}</span>
              <span className="whitespace-nowrap text-muted tabular-nums">{used === null ? t.quota.noData : window.reset_at ? t.quota.resets(resetTime(window.reset_at, t)) : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type OpError = { text: string; retry: () => void };

export function AccountCard({ account, status }: { account: Account; status: CardStatus | null }) {
  const { t, shell, snapshot, explain, toast } = useApp();
  const { go } = useNav();
  const exportReport = useDiagnostics();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [opError, setOpError] = React.useState<OpError | null>(null);
  const [waitPaused, setWaitPaused] = React.useState<boolean | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const [switchedTo, setSwitchedTo] = React.useState<string | null>(null);
  const names = t.platforms[account.platform];
  const platform = snapshot?.platforms[account.platform];
  const imported = account.source === "import";
  const manage = managesAccounts(snapshot?.overview ?? null) && Boolean(account.id);
  const fp = shortFingerprint(account.fingerprint);
  const plan = planLabel(account.plan || platform?.capabilities.plan);
  const why = explain(status?.reason, imported);

  // After a pause or resume, keep the button busy until the card shows it.
  const confirmedPaused = platform?.supply.paused;
  React.useEffect(() => {
    if (waitPaused === null) return;
    if (confirmedPaused === waitPaused) {
      setBusy(null);
      setWaitPaused(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setBusy(null);
      setWaitPaused(null);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [waitPaused, confirmedPaused]);

  // A client that switched accounts: say which account it switched to.
  const switching = status?.reason?.endsWith("_confirmation_required") && account.source === "local";
  React.useEffect(() => {
    if (!switching) return;
    let live = true;
    shell
      .request<Detection>("GET", `/v1/platforms/${account.platform}/login`)
      .then((found) => {
        if (live && found.available && found.email && found.fingerprint !== account.fingerprint) setSwitchedTo(maskEmail(found.email));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [switching, shell, account.platform, account.fingerprint]);

  const fail = (what: string, err: unknown, retry: () => void) => {
    const { text, known } = describeError(err, explain, t);
    setOpError({ text: t.card.failed(what, known ? text : `${text}${t.card.unchanged}`), retry });
  };

  const setPaused = async (paused: boolean) => {
    setBusy(paused ? t.card.pausing : t.card.resuming);
    setOpError(null);
    try {
      await shell.request("PUT", `/v1/platforms/${account.platform}/supply`, { paused });
      setWaitPaused(paused);
      toast(paused ? t.card.paused : t.card.resumed);
    } catch (err) {
      setBusy(null);
      fail(paused ? t.card.pauseFailed : t.card.resumeFailed, err, () => setPaused(paused));
    }
  };

  const recheck = async () => {
    setBusy(t.card.checking);
    setOpError(null);
    try {
      const found = await shell.request<Detection>("GET", `/v1/platforms/${account.platform}/login`);
      if (found.available) toast(t.card.recheckOk);
      else setOpError({ text: t.card.stillMissing, retry: recheck });
    } catch (err) {
      fail(t.card.stillMissing, err, recheck);
    } finally {
      setBusy(null);
    }
  };

  const confirmSwitch = async () => {
    setBusy(t.card.switching);
    setOpError(null);
    try {
      await shell.request("POST", `/v1/accounts/${account.id}/confirm`);
      toast(t.card.switched);
    } catch (err) {
      fail(t.card.switchFailed, err, confirmSwitch);
    } finally {
      setBusy(null);
    }
  };

  const copyNumber = async () => {
    await shell.copy(fp);
    toast(t.card.numberCopied(fp));
  };

  let main: React.ReactNode = null;
  if (busy) {
    main = (
      <Button variant="secondary" busy>
        {busy}
      </Button>
    );
  } else if (status?.state === "paused") {
    main = <Button onClick={() => setPaused(false)}>{t.card.resume}</Button>;
  } else if (status && ["sharing", "waiting", "syncing", "offline"].includes(status.state)) {
    main = (
      <Button variant="secondary" onClick={() => setPaused(true)}>
        {t.card.pause}
      </Button>
    );
  }

  const attention = status?.state === "action" || status?.state === "restricted";
  const removeButton = manage && (
    <Button variant="secondary" onClick={() => setRemoving(true)}>
      {t.card.removeThis}
    </Button>
  );

  let reason: React.ReactNode = null;
  let showQuota = true;
  if (status?.stuck) {
    reason = (
      <div className="text-[13px]">
        {t.card.stuck}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportReport}>
            {t.card.exportDiagnostics}
          </Button>
        </div>
      </div>
    );
  } else if (status?.state === "syncing" || status?.state === "paused") {
    const syncing = status.state === "syncing";
    const text = syncing ? explain(status.reason ?? "capabilities_unknown").both : why.cause;
    reason = <div className="text-[13px] text-muted">{text}</div>;
  } else if (status?.state === "waiting" && status.reason === "quota_exhausted") {
    const out = (platform?.capabilities.windows ?? []).filter((w) => (w.used_percent ?? 0) >= 100);
    const last = out.sort((a, b) => (a.reset_at ?? "").localeCompare(b.reset_at ?? "")).at(-1);
    reason = <div className="text-[13px]">{last ? t.card.quotaOut(windowName(last, t), resetTime(last.reset_at, t)) : why.both}</div>;
  } else if (status?.state === "waiting" || status?.state === "offline") {
    reason = (
      <div className="text-[13px]">
        {why.cause}
        <div className="mt-0.5 text-muted">{why.fix}</div>
      </div>
    );
  } else if (status?.state === "restricted") {
    showQuota = false;
    reason = (
      <div className="text-[13px]">
        {why.cause}
        <div className="mt-0.5 text-muted">
          {t.card.how}
          {why.fix}
        </div>
        {fp && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span>
              {t.card.contactNumber} <span className="font-mono text-xs">{fp}</span>
            </span>
            <Button variant="secondary" onClick={copyNumber}>
              {t.card.copyFp}
            </Button>
          </div>
        )}
      </div>
    );
  } else if (status?.state === "action") {
    let buttons: React.ReactNode = null;
    let cause: React.ReactNode = why.cause;
    if (why.action === "relogin") {
      buttons = imported ? (
        manage && <Button onClick={() => go({ name: "add", step: "import", platform: account.platform, replacing: account })}>{t.card.reimport}</Button>
      ) : (
        <Button onClick={recheck} disabled={Boolean(busy)}>
          {t.card.recheck}
        </Button>
      );
    } else if (why.action === "confirm_switch") {
      showQuota = false;
      if (switchedTo) cause = t.card.switchedTo(names.cli, switchedTo, maskEmail(account.email) || t.card.local);
      buttons = (
        <>
          {manage && (
            <Button onClick={confirmSwitch} disabled={Boolean(busy)}>
              {t.card.useNew}
            </Button>
          )}
          {removeButton}
        </>
      );
    } else if (why.action === "remove_account") {
      showQuota = false;
      buttons = removeButton;
    }
    reason = (
      <div className="text-[13px]">
        {cause}
        {why.fix && !(why.action === "confirm_switch" && switchedTo) && (
          <div className="mt-0.5 text-muted">
            {t.card.how}
            <FixText text={why.fix} command={names.login} />
          </div>
        )}
        {buttons && <div className="mt-2 flex flex-wrap gap-2">{buttons}</div>}
      </div>
    );
  }

  const reasons = platform?.supply.reasons ?? [];
  return (
    <article
      className={cn("flex flex-col gap-2.5 rounded-[10px] border border-line bg-page px-4 py-3.5", attention && "border-[color-mix(in_srgb,var(--bad)_45%,var(--line))]")}
      aria-label={`${names.name} ${maskEmail(account.email)}`.trim()}
    >
      <div className="flex items-center gap-2.5">
        <PlatformMark platform={account.platform} />
        <div className="min-w-0">
          <div className="font-semibold">
            {names.name}
            {plan && <small className="ml-1 text-[13px] font-medium text-muted">{plan}</small>}
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-muted">
            {account.email && <span>{maskEmail(account.email)}</span>}
            {account.id && <span>{imported ? t.card.import : t.card.local}</span>}
            {fp && (
              <span>
                <Term help={t.terms.numberHelp}>{t.terms.number}</Term> <span className="font-mono text-xs">{fp}</span>
              </span>
            )}
            {account.added_at && <span>{t.card.added(monthDay(account.added_at))}</span>}
          </div>
        </div>
        <div className="relative ml-auto flex items-center gap-1.5">
          {status && <StatusPill status={status} />}
          {main}
          {(fp || manage) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t.card.more}
                  className="h-7 w-[30px] cursor-pointer rounded-md border border-transparent bg-transparent text-base leading-none text-muted hover:border-line hover:bg-sunken data-[state=open]:border-line data-[state=open]:bg-sunken"
                >
                  ⋯
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {fp && <DropdownMenuItem onSelect={copyNumber}>{t.card.copyNumber}</DropdownMenuItem>}
                {manage && (
                  <DropdownMenuItem destructive onSelect={() => setRemoving(true)}>
                    {t.card.remove}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {opError && (
        <div role="alert" className="flex items-center gap-2 rounded-md bg-bad-bg px-2.5 py-1.5 text-[12.5px] text-bad">
          <span aria-hidden="true">⛔</span>
          <span className="min-w-0 flex-1">{opError.text}</span>
          <Button variant="secondary" className="ml-auto" onClick={opError.retry}>
            {t.card.retry}
          </Button>
        </div>
      )}
      {reason}
      {status && showQuota && <Quota platform={platform} syncing={status.state === "syncing"} />}
      {attention && reasons.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">{t.card.details}</summary>
          <pre className="mt-1.5 mb-0 rounded-md bg-sunken p-2 font-mono text-[11.5px] whitespace-pre-wrap">{reasons.join("\n")}</pre>
        </details>
      )}
      {manage && <RemoveDialog account={account} open={removing} onOpenChange={setRemoving} />}
    </article>
  );
}

/** A fix that names the command to run shows the command as code. */
function FixText({ text, command }: { text: string; command: string }) {
  const at = text.indexOf(command);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Kbd>{command}</Kbd>
      {text.slice(at + command.length)}
    </>
  );
}

function RemoveDialog({ account, open, onOpenChange }: { account: Account; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, shell, toast, explain } = useApp();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const names = t.platforms[account.platform];
  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await shell.request("DELETE", `/v1/accounts/${account.id}`);
      onOpenChange(false);
      toast(t.remove.done(names.name));
    } catch (err) {
      const { text, known } = describeError(err, explain, t);
      setError(t.card.failed(t.remove.failed, known ? text : `${text}${t.remove.unchanged}`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogTitle>{t.remove.title(names.name)}</DialogTitle>
        <p className="m-0 text-[13.5px]">{account.email ? t.remove.what(maskEmail(account.email)) : t.remove.whatNoEmail}</p>
        <p className="m-0 text-[13.5px]">{account.source === "import" ? t.remove.import : t.remove.local(names.cli)}</p>
        <p className="m-0 text-xs text-muted">{t.remove.owned}</p>
        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-md bg-bad-bg px-2.5 py-1.5 text-[12.5px] text-bad">
            <span aria-hidden="true">⛔</span>
            {error}
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={busy}>
              {t.remove.cancel}
            </Button>
          </DialogClose>
          <Button variant="danger" busy={busy} onClick={remove}>
            {busy ? t.remove.busy : error ? t.remove.retry : t.remove.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
