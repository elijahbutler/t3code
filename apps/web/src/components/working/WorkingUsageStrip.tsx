import { useAtomValue } from "@effect/atom-react";
import { formatTokens, formatUsd, makeWindow } from "@t3tools/shared/usageFormat";
import {
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  formatResetsIn,
  type LimitPool,
} from "@t3tools/shared/usageLimits";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { environmentPresentations } from "../../state/presentation";
import { useUsage } from "../../state/usage";
import { providerClients } from "../settings/providerDriverMeta";
import { barColor } from "../usage/UsageLimits";

/** Seven days of token totals and the current subscription limits, for the Working page. */
export function WorkingUsageStrip({ nowMs }: { readonly nowMs: number }) {
  // Fixed for the page's lifetime so the query key stays stable.
  const [window] = useState(() => makeWindow(7));
  const { shown, selectedEnvironments } = useUsage(window);
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const pools = collectLimitPools(collectLimitAccounts(presentations), nowMs);
  const usage = shown?.merged ?? null;
  const unreadable =
    selectedEnvironments.length > 0 &&
    selectedEnvironments.every((environment) => !environment.canReadDiagnostics);

  const stats =
    usage === null
      ? null
      : [
          { label: "Tokens", value: formatTokens(usage.totalTokens) },
          { label: "Input", value: formatTokens(usage.uncachedInputTokens) },
          { label: "Cached", value: formatTokens(usage.cachedInputTokens) },
          { label: "Output", value: formatTokens(usage.outputTokens) },
          { label: "API cost est.", value: formatUsd(usage.costUsd) },
          { label: "Sessions", value: usage.sessions.toLocaleString() },
        ];

  return (
    <section
      aria-labelledby="working-usage"
      className="flex h-1/4 min-h-40 shrink-0 flex-col gap-3 overflow-y-auto border-t bg-background px-5 pt-3 pb-4 sm:px-6"
    >
      <div className="flex items-center gap-2">
        <h2 id="working-usage" className="text-sm font-medium">
          Usage
        </h2>
        <span className="text-xs text-muted-foreground">Last 7 days</span>
        <Link
          to="/usage"
          className="ms-auto rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          Open usage
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 @4xl/working:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {stats === null ? (
          <p className="text-xs text-muted-foreground">
            {unreadable ? "This connection can't read usage." : "Loading usage…"}
          </p>
        ) : (
          <dl className="grid grid-cols-3 gap-x-4 gap-y-3 @2xl/working:grid-cols-6">
            {stats.map((stat) => (
              <div key={stat.label} className="min-w-0">
                <dt className="truncate text-xs text-muted-foreground">{stat.label}</dt>
                <dd className="text-lg font-medium tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="flex min-w-0 flex-col gap-2">
          {pools.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No provider reports subscription limits.
            </p>
          ) : (
            pools.map((pool) => <PoolLimits key={pool.driver} pool={pool} nowMs={nowMs} />)
          )}
        </div>
      </div>
    </section>
  );
}

function PoolLimits({ pool, nowMs }: { readonly pool: LimitPool; readonly nowMs: number }) {
  const label = providerClients.get(pool.driver)?.label ?? String(pool.driver);
  const color = barColor(pool.driver);
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-3 text-xs">
      <span className="truncate pt-px font-medium">{label}</span>
      <ul className="flex min-w-0 flex-col gap-1">
        {displayLimitWindows(pool).map((window) => {
          const reset = window.resets[0];
          const resetsIn = reset ? formatResetsIn(reset.member.window, nowMs) : null;
          return (
            <li
              key={`${window.kind}:${window.id}`}
              className="grid grid-cols-[minmax(0,7rem)_minmax(2rem,1fr)_auto] items-center gap-x-2"
            >
              <span className="truncate text-muted-foreground">{window.label}</span>
              <span aria-hidden className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${window.remainingPercent}%`, backgroundColor: color }}
                />
              </span>
              <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                <span className="text-foreground">{window.remainingPercent}% left</span>
                {resetsIn ? ` · ${resetsIn}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
