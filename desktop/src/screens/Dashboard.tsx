// The first page: who this computer is linked to, whether Bee is connected
// and how many accounts share. Earnings and shared usage come with Hive's
// device statistics; until then the page links to them on the web.
import type * as React from "react";
import { useApp } from "../app/context";
import { useNav } from "../app/nav";
import { PageHeader, dotTone, useAccountCounts, useConnection } from "../app/chrome";
import { Button } from "../components/ui/button";
import { maskEmail } from "../lib/format";
import { managesAccounts } from "../lib/model";
import { cn } from "../lib/utils";

function StatCard({ label, value, hint, onClick }: { label: string; value: React.ReactNode; hint: React.ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1.5 flex min-w-0 items-center gap-[7px] truncate text-[15px] font-semibold">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{hint}</div>
    </>
  );
  const box = "min-w-0 rounded-xl border border-line bg-card p-4 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(box, "cursor-pointer text-fg hover:border-line-strong")}>
      {body}
    </button>
  ) : (
    <div className={box}>{body}</div>
  );
}

export function Dashboard() {
  const { snapshot, t, shell } = useApp();
  const { go } = useNav();
  const connection = useConnection();
  const counts = useAccountCounts();
  const overview = snapshot?.overview ?? null;
  const owner = maskEmail(overview?.device?.owner_email);
  const d = t.dashboard;

  return (
    <>
      <PageHeader title={t.nav.dashboard} />
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label={d.account} value={owner || "—"} hint={d.accountBound} onClick={() => go({ name: "settings" })} />
          <StatCard
            label={d.connection}
            value={
              <>
                <i className={cn("inline-block size-[7px] flex-none rounded-full", dotTone[connection.tone])} aria-hidden="true" />
                {connection.label}
              </>
            }
            hint={connection.hint}
          />
          <StatCard
            label={d.accounts}
            value={counts.all ? d.sharing(counts.on) : d.noAccounts}
            hint={
              counts.all ? (
                <>
                  {d.total(counts.all)}
                  {counts.need > 0 && <span className="text-bad"> · {d.needs(counts.need)}</span>}
                </>
              ) : (
                d.addAccount
              )
            }
            onClick={() => go(counts.all || !managesAccounts(overview) ? { name: "accounts" } : { name: "add", step: "platform" })}
          />
        </div>
        <section aria-label={d.earnings} className="mt-3 rounded-xl border border-line bg-card p-4">
          <h2 className="m-0 text-[13.5px] font-semibold">{d.earnings}</h2>
          <p className="mt-1.5 mb-3 text-[13px] text-muted">{d.earningsSoon}</p>
          {overview?.hive && (
            <Button variant="secondary" onClick={() => shell.openUrl(`${overview.hive.replace(/\/$/, "")}/earnings`)}>
              {d.earningsOpen} ↗
            </Button>
          )}
        </section>
      </div>
    </>
  );
}
