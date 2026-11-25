// Adding an AI account: choose the platform, then share the official client's
// sign-in on this computer or import a credential file, then confirm.
import * as React from "react";
import { useApp } from "../app/context";
import { useNav, type AddStep } from "../app/nav";
import { Button } from "../components/ui/button";
import { Callout, Kbd, PlatformMark } from "../components/ui/bits";
import { toBeeError, type Account, type Detection, type PlatformId } from "../lib/bee";
import { describeError } from "../lib/errors";
import { maskEmail, planLabel } from "../lib/format";
import { accountsOf, PLATFORMS } from "../lib/model";
import { cn, isMac } from "../lib/utils";
import { BackButton, Flow, FlowTitle, StepLabel } from "./Onboarding";

/** Detection problems that mean "not signed in here", answered with sign-in steps. */
const NOT_SIGNED_IN = ["BEE-SETUP-CODEX-NOT-FOUND", "BEE-CLAUDE-SOURCE", "BEE-CODEX-SOURCE"];

const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;

type Props = { initialStep: AddStep; platform?: PlatformId; replacing?: Account };

export function AddAccount({ initialStep, platform: initialPlatform, replacing: initialReplacing }: Props) {
  const { t, snapshot, shell, explain } = useApp();
  const { go, onboarding } = useNav();
  const [step, setStep] = React.useState<AddStep>(initialPlatform ? initialStep : "platform");
  const [platform, setPlatform] = React.useState<PlatformId | undefined>(initialPlatform);
  const [method, setMethod] = React.useState<"local" | "import">(initialStep === "import" ? "import" : "local");
  const [detection, setDetection] = React.useState<Detection | "loading" | null>(null);
  const [file, setFile] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [replacing, setReplacing] = React.useState<Account | undefined>(initialReplacing);
  const accounts = accountsOf(snapshot?.overview ?? null);
  const names = platform ? t.platforms[platform] : null;

  const detect = React.useCallback(async () => {
    if (!platform) return;
    setDetection("loading");
    try {
      setDetection(await shell.request<Detection>("GET", `/v1/platforms/${platform}/login`));
    } catch (err) {
      const e = toBeeError(err);
      setDetection({ platform, available: false, problem: { code: e.code, message: e.message } });
    }
  }, [shell, platform]);

  React.useEffect(() => {
    if (step === "method" && method === "local" && detection === null) detect();
  }, [step, method, detection, detect]);

  // A file dropped on the window while importing.
  React.useEffect(() => {
    if (step !== "import") return;
    return shell.onFileDrop((path) => {
      setFile(path);
      setError(null);
      setStep("confirm");
    });
  }, [shell, step]);

  const top = (title: string, back?: () => void) => (
    <>
      {back && <BackButton onClick={back}>{t.add.back}</BackButton>}
      {onboarding && <StepLabel>{t.step(2)}</StepLabel>}
      <FlowTitle>{title}</FlowTitle>
    </>
  );
  const later = onboarding && (
    <Button variant="ghost" onClick={() => go({ name: "done" })}>
      {t.add.later}
    </Button>
  );
  const leave = () => go({ name: "home" });

  if (step === "platform" || !platform || !names) {
    return (
      <Flow>
        {top(onboarding ? t.add.first : t.add.title, onboarding ? undefined : leave)}
        <p className="m-0 text-muted">{t.add.pickPlatform}</p>
        <div className="grid max-w-[640px] grid-cols-2 gap-3">
          {PLATFORMS.map((p) => {
            const taken = accounts.some((a) => a.platform === p);
            return (
              <button
                key={p}
                type="button"
                aria-disabled={taken}
                className={cn(
                  "flex cursor-pointer flex-col gap-1.5 rounded-[10px] border-[1.5px] border-line bg-page p-3.5 text-left hover:border-line-strong",
                  taken && "cursor-not-allowed bg-sunken opacity-80 hover:border-line",
                )}
                onClick={() => {
                  if (taken) return;
                  setPlatform(p);
                  setMethod("local");
                  setDetection(null);
                  setStep("method");
                }}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <PlatformMark platform={p} />
                  {t.platforms[p].group}
                </span>
                <span className="text-[12.5px] text-muted">{t.platforms[p].plans}</span>
                {taken && <span className="text-[12.5px] text-muted">{t.add.added}</span>}
              </button>
            );
          })}
        </div>
        <div className="mt-auto flex w-full max-w-[640px] justify-end gap-2.5 pt-2">{later}</div>
      </Flow>
    );
  }

  if (step === "method") {
    const found = detection && detection !== "loading" && detection.available ? detection : null;
    const problem = detection && detection !== "loading" && !detection.available ? detection.problem : undefined;
    const canNext = method === "import" || Boolean(found);
    let detail: React.ReactNode;
    if (detection === "loading" || detection === null) {
      detail = (
        <div className="mt-0.5 text-[13px] text-muted">
          <span className="spinner mr-1.5" aria-hidden="true" />
          {t.add.detecting}
        </div>
      );
    } else if (found) {
      detail = <div className="mt-0.5 text-[13px] text-good">{t.add.found(names.cli, maskEmail(found.email), planLabel(found.plan))}</div>;
    } else {
      const known = problem && !NOT_SIGNED_IN.includes(problem.code) ? explain(problem.code) : null;
      detail = (
        <div className="mt-0.5 text-[13px] text-muted">
          {known ? (
            <p className="m-0">
              {known.cause} {known.fix}
            </p>
          ) : (
            <>
              {t.add.notFound(names.cli)}
              <ol className="mt-1.5 mb-0 list-decimal pl-[18px] text-fg">
                {t.add.steps(names.cli, names.login).map((line, i) => (
                  <li key={i}>{i === 1 ? <StepWithCommand line={line} command={names.login} /> : line}</li>
                ))}
              </ol>
            </>
          )}
          <div className="mt-2">
            <Button variant="secondary" onClick={detect}>
              {t.add.redetect}
            </Button>
          </div>
        </div>
      );
    }
    return (
      <Flow>
        {top(t.add.platformTitle(names.name), replacing ? leave : () => setStep("platform"))}
        <div role="radiogroup" aria-label={t.add.platformTitle(names.name)} className="flex flex-col gap-3">
          <Option checked={method === "local"} onSelect={() => setMethod("local")} label={t.add.local}>
            {method === "local" && detail}
          </Option>
          <Option checked={method === "import"} onSelect={() => setMethod("import")} label={t.add.import}>
            <div className="mt-0.5 text-[13px] text-muted">{t.add.importHint}</div>
          </Option>
        </div>
        {isMac && platform === "claude" && method === "local" && <Callout tone="info">{t.add.keychain}</Callout>}
        <div className="mt-auto flex w-full max-w-[640px] justify-end gap-2.5 pt-2">
          {later}
          <Button disabled={!canNext} onClick={() => (method === "local" ? setStep("confirm") : setStep("import"))}>
            {t.add.next}
          </Button>
        </div>
      </Flow>
    );
  }

  if (step === "import") {
    const choose = async () => {
      const picked = await shell.pickFile(t.add.chooseTitle(names.file));
      if (picked) {
        setFile(picked);
        setError(null);
        setStep("confirm");
      }
    };
    return (
      <Flow>
        {top(t.add.importTitle(names.name), replacing ? leave : () => setStep("method"))}
        <div className="flex max-w-[640px] flex-col items-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-line-strong p-[26px] text-center">
          <div>{t.add.drop(names.file)}</div>
          <Button variant="secondary" onClick={choose} autoFocus>
            {t.add.choose}
          </Button>
        </div>
        {error && (
          <Callout tone="bad" role="alert">
            {error}
          </Callout>
        )}
        <details className="max-w-[640px] text-[13px]" open>
          <summary className="cursor-pointer text-muted">{t.add.where}</summary>
          <ul className="mt-1.5 mb-0 list-disc pl-[18px] text-muted">
            {(platform === "claude" ? t.add.whereClaude : t.add.whereCodex).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
        <Callout tone="warn">{t.add.mayDrop}</Callout>
        <div className="mt-auto flex w-full max-w-[640px] justify-end gap-2.5 pt-2">{later}</div>
      </Flow>
    );
  }

  // Confirm.
  const found = method === "local" && detection && detection !== "loading" && detection.available ? detection : null;
  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (replacing) {
        await shell.request("DELETE", `/v1/accounts/${replacing.id}`);
        setReplacing(undefined);
      }
      await shell.request("POST", "/v1/accounts", method === "import" ? { platform, source: "import", file } : { platform, source: "local" });
      if (onboarding) go({ name: "done" });
      else go({ name: "home" });
    } catch (err) {
      const e = toBeeError(err);
      const known = explain(e.code);
      const text = known.known ? `${known.cause} ${known.fix}` : describeError(err, explain, t).text;
      if (method === "import") {
        setError(`${file ? basename(file) : ""} · ${text}`);
        setStep("import");
      } else setError(text);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Flow>
      {top(t.add.confirm, () => setStep(method === "import" ? "import" : "method"))}
      <div className="flex max-w-[640px] items-center gap-3 rounded-[10px] border border-line px-4 py-3.5">
        <PlatformMark platform={platform} />
        <div className="min-w-0">
          <div className="font-semibold">
            {names.name}
            {found?.plan && <small className="ml-1 text-[13px] font-medium text-muted">{planLabel(found.plan)}</small>}
          </div>
          <div className="flex flex-wrap gap-x-2.5 text-[12.5px] text-muted">
            {found?.email && <span>{maskEmail(found.email)}</span>}
            {method === "import" && file && <span className="font-mono text-xs">{basename(file)}</span>}
            <span>{method === "local" ? t.card.local : t.card.import}</span>
          </div>
        </div>
      </div>
      <p className="m-0 max-w-[62ch]">{t.add.confirmText}</p>
      {method === "import" && <p className="m-0 max-w-[62ch] text-[13px] text-muted">{t.add.importConfirm}</p>}
      {error && (
        <Callout tone="bad" role="alert">
          {error}
        </Callout>
      )}
      <div className="mt-auto flex w-full max-w-[640px] justify-end gap-2.5 pt-2">
        <Button variant="secondary" onClick={() => (onboarding ? setStep("method") : leave())} disabled={submitting}>
          {t.add.cancel}
        </Button>
        <Button onClick={submit} busy={submitting} autoFocus>
          {submitting ? t.add.submitting : t.add.submit}
        </Button>
      </div>
    </Flow>
  );
}

function StepWithCommand({ line, command }: { line: string; command: string }) {
  const at = line.indexOf(command);
  if (at < 0) return <>{line}</>;
  return (
    <>
      {line.slice(0, at)}
      <Kbd>{command}</Kbd>
      {line.slice(at + command.length)}
    </>
  );
}

function Option({ checked, onSelect, label, children }: { checked: boolean; onSelect: () => void; label: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <div
      className={cn(
        "flex max-w-[640px] cursor-pointer gap-3 rounded-[10px] border-[1.5px] border-line bg-page px-3.5 py-3 text-left",
        checked && "border-honey bg-[color-mix(in_srgb,var(--honey-soft)_50%,var(--page))]",
      )}
      onClick={onSelect}
    >
      <input id={id} type="radio" name="method" checked={checked} onChange={onSelect} className="mt-1 size-4 flex-none accent-[var(--honey-ink)]" />
      <div>
        <label htmlFor={id} className="cursor-pointer font-semibold">
          {label}
        </label>
        {children}
      </div>
    </div>
  );
}
