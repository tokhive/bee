// The shared accounts page: one sentence on whether the accounts are sharing,
// then one card per account, grouped by platform.
import { useApp } from "../app/context";
import { useNav } from "../app/nav";
import { PageHeader } from "../app/chrome";
import { Button } from "../components/ui/button";
import { Callout } from "../components/ui/bits";
import { accountsOf, cardStatus, globalIssue, managesAccounts, PLATFORMS, summaryText, type CardStatus } from "../lib/model";
import { cn } from "../lib/utils";
import { AccountCard } from "./AccountCard";

export function Home() {
  const { snapshot, t, syncingSince } = useApp();
  const { go } = useNav();
  if (!snapshot) return null;
  const overview = snapshot.overview;
  const blocked = globalIssue(snapshot) !== null;
  const manage = managesAccounts(overview);
  const accounts = accountsOf(overview);
  const statuses = new Map<string, CardStatus | null>();
  for (const account of accounts) statuses.set(account.id || account.platform, cardStatus(account, snapshot, syncingSince[account.platform]));
  const addButton = (big: boolean) =>
    manage && (
      <Button variant={big ? "primary" : "secondary"} size={big ? "big" : "default"} className={big ? "mt-1.5" : undefined} onClick={() => go({ name: "add", step: "platform" })}>
        {big ? t.home.emptyAdd : t.home.add}
      </Button>
    );

  if (!accounts.length && overview) {
    return (
      <>
        <PageHeader title={t.nav.accounts} />
        <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
          <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-line-strong bg-card px-5 py-12 text-center">
            <h2 className="m-0 text-lg font-semibold">{t.home.emptyTitle}</h2>
            <p className="m-0 text-muted">{t.home.emptyText}</p>
            {addButton(true)}
            {!manage && <Callout tone="info">{t.home.cliAccounts}</Callout>}
          </div>
        </div>
      </>
    );
  }

  const states = [...statuses.values()].filter((s): s is CardStatus => s !== null).map((s) => s.state);
  return (
    <>
      <PageHeader title={t.nav.accounts}>{addButton(false)}</PageHeader>
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        <h2 className="m-0 mb-1 text-[15px] font-semibold">{blocked || !overview ? t.summary.blocked : summaryText(states, t)}</h2>
        {!manage && overview && accounts.length > 0 && <Callout tone="info" className="mb-2">{t.home.cliAccounts}</Callout>}
        <div className={cn(blocked && "pointer-events-none opacity-50 grayscale-[.4]")} inert={blocked}>
          {PLATFORMS.map((platform) => {
            const list = accounts.filter((a) => a.platform === platform);
            if (!list.length) return null;
            return (
              <section key={platform} className="mt-3.5" aria-label={t.platforms[platform].group}>
                <h2 className="m-0 mb-2 text-xs font-semibold tracking-[.04em] text-muted">{t.platforms[platform].group}</h2>
                <div className="flex flex-col gap-3">
                  {list.map((account) => (
                    <AccountCard key={account.id || account.platform} account={account} status={statuses.get(account.id || account.platform) ?? null} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
