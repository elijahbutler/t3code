import { useAtomValue } from "@effect/atom-react";
import { formatTokens, formatUsd, makeWindow } from "@t3tools/shared/usageFormat";
import {
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  formatResetsIn,
  type LimitPool,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { environmentPresentations } from "../../state/presentation";
import { useUsage } from "../../state/usage";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { barColor } from "../usage/UsageLimits";
import { PROVIDER_PRESENTATION } from "../usage/usageProviders";

const PERIODS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
] as const;
type PeriodDays = (typeof PERIODS)[number]["days"];

const MAX_LIMIT_PROVIDERS = 3;

/** Token totals for a period, then each top provider's session and weekly limits. */
export function WorkingUsageStrip({ nowMs }: { readonly nowMs: number }) {
  const [days, setDays] = useState<PeriodDays>(7);
  // Fixed per period for the page's lifetime so each query key stays stable.
  const [windows] = useState(() => ({ 7: makeWindow(7), 30: makeWindow(30) }));
  const { shown, selectedEnvironments } = useUsage(windows[days]);
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const usage = shown?.merged ?? null;
  const unreadable =
    selectedEnvironments.length > 0 &&
    selectedEnvironments.every((environment) => !environment.canReadDiagnostics);

  // Providers the user spent the most tokens with lead; ones without usage keep limit order.
  const tokensByDriver = new Map(
    (usage?.providers ?? []).map(
      (provider) =>
        [PROVIDER_PRESENTATION[provider.provider].driverKind, provider.totalTokens] as const,
    ),
  );
  const pools = collectLimitPools(collectLimitAccounts(presentations), nowMs)
    .map((pool) => ({ pool, windows: primaryLimitWindows(pool) }))
    .filter(({ windows: poolWindows }) => poolWindows.length > 0)
    .toSorted(
      (left, right) =>
        (tokensByDriver.get(right.pool.driver) ?? -1) -
        (tokensByDriver.get(left.pool.driver) ?? -1),
    )
    .slice(0, MAX_LIMIT_PROVIDERS);

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
      className="flex max-h-[40%] shrink-0 flex-col gap-2.5 overflow-y-auto border-t bg-background px-4 pt-2.5 pb-3"
    >
      <div className="flex items-center gap-3">
        <h2 id="working-usage" className="text-xs font-medium text-muted-foreground">
          Usage
        </h2>
        <ToggleGroup
          aria-label="Usage period"
          variant="segmented"
          value={[String(days)]}
          onValueChange={(next) => {
            const period = PERIODS.find((option) => String(option.days) === next[0]);
            if (period) setDays(period.days);
          }}
        >
          {PERIODS.map((period) => (
            <Toggle key={period.days} value={String(period.days)}>
              {period.label}
            </Toggle>
          ))}
        </ToggleGroup>
        <Link
          to="/usage"
          className="ms-auto rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          Open usage
        </Link>
      </div>
      {stats === null ? (
        <p className="text-xs text-muted-foreground">
          {unreadable ? "This connection can't read usage." : "Loading usage…"}
        </p>
      ) : (
        <dl className="grid grid-cols-3 gap-x-4 gap-y-2 @2xl/working:grid-cols-6">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="text-base leading-6 font-medium tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-col gap-1.5 border-t pt-2">
        {pools.length === 0 ? (
          <p className="text-xs text-muted-foreground">No provider reports subscription limits.</p>
        ) : (
          pools.map(({ pool, windows: poolWindows }) => (
            <PoolLimits key={pool.driver} pool={pool} windows={poolWindows} nowMs={nowMs} />
          ))
        )}
      </div>
    </section>
  );
}

/** The provider-wide session and weekly windows; model-scoped ones follow their general one. */
function primaryLimitWindows(pool: LimitPool): LimitPoolWindow[] {
  const windows = displayLimitWindows(pool);
  return (["session", "weekly"] as const).flatMap((kind) => {
    const window = windows.find((candidate) => candidate.kind === kind);
    return window === undefined ? [] : [window];
  });
}

function PoolLimits({
  pool,
  windows,
  nowMs,
}: {
  readonly pool: LimitPool;
  readonly windows: ReadonlyArray<LimitPoolWindow>;
  readonly nowMs: number;
}) {
  const label = providerClients.get(pool.driver)?.label ?? String(pool.driver);
  const color = barColor(pool.driver);
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 text-xs">
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        <ProviderInstanceIcon driverKind={pool.driver} displayName={label} size="compact" />
        <span className="truncate">{label}</span>
      </span>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 @xl/working:grid-cols-2">
        {windows.map((window) => {
          const reset = window.resets[0];
          const resetsIn = reset ? formatResetsIn(reset.member.window, nowMs) : null;
          return (
            <div key={`${window.kind}:${window.id}`} className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 items-baseline gap-2 text-muted-foreground tabular-nums">
                <span className="truncate">{window.label}</span>
                <span className="ms-auto shrink-0 whitespace-nowrap">
                  <span className="text-foreground">{window.remainingPercent}% left</span>
                  {resetsIn ? ` · ${resetsIn}` : ""}
                </span>
              </span>
              <span aria-hidden className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${window.remainingPercent}%`, backgroundColor: color }}
                />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
