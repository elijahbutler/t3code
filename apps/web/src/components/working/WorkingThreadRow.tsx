import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveThreadProviderStack } from "@t3tools/client-runtime/state/models";
import {
  resolveThreadCurrentPullRequestLink,
  resolveThreadPullRequestBadge,
} from "@t3tools/client-runtime/thread-pull-requests";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { GitBranchIcon } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";

import { useSupportsMultiplePullRequests } from "../../hooks/useSupportsMultiplePullRequests";
import { useOpenPrLink } from "../../lib/openPullRequestLink";
import { cn } from "../../lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentThreadDetails } from "../../state/threads";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatElapsedDurationLabel } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import type { SidebarProviderEntry } from "../sidebar/SidebarThreadRow";
import { resolveWorkingStartedAt } from "../Sidebar.logic";
import {
  linkedPullRequestSnapshotStatus,
  prStatusIndicator,
  ThreadPullRequestBadgeControl,
} from "../ThreadStatusIndicators";
import { InlineButton } from "../ui/button";
import {
  latestActivityLine,
  type WorkingOverviewEntry,
  type WorkingOverviewStatus,
} from "./workingOverview.logic";

/** Live rows re-read their thread's stream this often, not on every token. */
const LIVE_ACTIVITY_INTERVAL_MS = 5_000;

/** Past this many, a row points to the thread for the rest of its subagents. */
const MAX_SUBAGENT_ROWS = 4;

const ROW_LINK_CLASS =
  "rounded-md outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function WorkingThreadRow({
  entry,
  projectName,
  providerEntries,
  nowMs,
  live,
}: {
  entry: WorkingOverviewEntry<SidebarThreadSummary>;
  projectName: string | null;
  providerEntries: ReadonlyMap<string, SidebarProviderEntry> | undefined;
  nowMs: number;
  /** Subscribes to the thread's stream to show the agent's latest message. */
  live: boolean;
}) {
  const { thread, status, children } = entry;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const activity = useLiveActivityLine(thread.environmentId, thread.id, live);
  const provider = providerEntries?.get(resolveThreadProviderStack(thread).at(-1) ?? "") ?? null;
  const modelName =
    provider?.models.find((model) => model.slug === thread.modelSelection.model)?.name ??
    thread.modelSelection.model;
  const activeChildren = children.filter((child) => child.status?.label !== "Completed").length;
  const detail =
    status.label === "Failed"
      ? thread.runtime?.lastError
      : (activity ?? thread.goal?.objective ?? thread.pendingBackgroundTasks[0]?.description);
  const facts = [
    projectName,
    provider === null ? modelName : `${provider.displayName} · ${modelName}`,
    activeChildren > 0
      ? `${activeChildren} ${activeChildren === 1 ? "subagent" : "subagents"} active`
      : null,
    thread.pendingBackgroundTasks.length > 0
      ? `${thread.pendingBackgroundTasks.length} background ${
          thread.pendingBackgroundTasks.length === 1 ? "task" : "tasks"
        }`
      : null,
  ].filter((fact): fact is string => fact !== null);
  const shownChildren = children.slice(0, MAX_SUBAGENT_ROWS);
  const hiddenChildren = children.length - shownChildren.length;

  return (
    <li className="min-w-0">
      {/* The link fills the row so the PR badge above it can stay its own control. */}
      <div className="relative grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-md px-2 py-1 has-[>a:hover]:bg-accent/60">
        <Link
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(threadRef)}
          aria-label={thread.title}
          className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        />
        <span className="pointer-events-none flex h-5 items-center">
          {provider === null ? null : (
            <ProviderInstanceIcon
              driverKind={provider.driverKind}
              displayName={provider.displayName}
              accentColor={provider.accentColor}
              acpRegistryAgentId={provider.acpRegistryAgentId}
              acpRegistryIconUrl={provider.acpRegistryIconUrl}
              size="compact"
            />
          )}
        </span>
        <span className="pointer-events-none flex min-w-0 flex-col">
          <span className="truncate text-sm leading-5 font-medium">{thread.title}</span>
          <span className="flex min-w-0 items-center gap-x-2 text-xs leading-4 text-muted-foreground">
            <span className="truncate">{facts.join(" · ")}</span>
            {thread.branch === null ? null : (
              <span className="hidden min-w-0 shrink items-center gap-1 @2xl/working:flex">
                <GitBranchIcon aria-hidden className="size-3 shrink-0" />
                <span className="truncate font-mono">{thread.branch}</span>
              </span>
            )}
            <RowPullRequestBadge thread={thread} />
          </span>
          {detail ? (
            <span
              className={cn(
                "truncate text-xs leading-4",
                activity !== null && detail === activity
                  ? "text-foreground/75"
                  : "text-muted-foreground/80",
              )}
            >
              {detail}
            </span>
          ) : null}
        </span>
        <span className="pointer-events-none flex flex-col items-end text-xs leading-5 whitespace-nowrap">
          <StatusLabel status={status} />
          <span className="leading-4 text-muted-foreground tabular-nums">
            {rowTiming(thread, status, nowMs)}
          </span>
        </span>
      </div>
      {shownChildren.length > 0 ? (
        <ul className="ms-[1.125rem] flex flex-col border-s ps-2">
          {shownChildren.map((child) => (
            <li key={`${child.thread.environmentId}:${child.thread.id}`} className="min-w-0">
              <Link
                to="/$environmentId/$threadId"
                params={buildThreadRouteParams(
                  scopeThreadRef(child.thread.environmentId, child.thread.id),
                )}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-2 py-0.5 text-xs",
                  ROW_LINK_CLASS,
                )}
              >
                <span className="truncate text-foreground/90">{child.thread.title}</span>
                {child.status === null ? null : <StatusLabel status={child.status} />}
              </Link>
            </li>
          ))}
          {hiddenChildren > 0 ? (
            <li className="px-2 py-0.5 text-xs text-muted-foreground">
              {hiddenChildren} more in the thread
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

/** The sidebar's PR badge: one PR opens directly, several open a list to pick from. */
function RowPullRequestBadge({ thread }: { thread: SidebarThreadSummary }) {
  const navigate = useNavigate();
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const openPrLink = useOpenPrLink();
  const supportsMultiple = useSupportsMultiplePullRequests(thread.environmentId);
  const link = resolveThreadCurrentPullRequestLink(thread.pullRequests);
  // Threads from older servers, or with only a branch PR, carry a number and URL but no link.
  const current = link ?? thread.linkedPullRequest ?? thread.branchPullRequest ?? null;
  if (current === null) return null;
  const snapshot = link === null ? null : linkedPullRequestSnapshotStatus(link);
  const openThread = () =>
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(threadRef) });
  return (
    <span className="pointer-events-auto relative shrink-0">
      <ThreadPullRequestBadgeControl
        render={<InlineButton />}
        text="full"
        badge={supportsMultiple ? resolveThreadPullRequestBadge(thread.pullRequests) : null}
        pullRequests={thread.pullRequests}
        number={current.number}
        url={current.url}
        status={prStatusIndicator(snapshot?.pr ?? null, snapshot?.sourceControlProvider)}
        onOpenList={() => {
          useRightPanelStore.getState().open(threadRef, "pull-requests");
          openThread();
        }}
        onOpenPullRequest={(event: MouseEvent<HTMLElement>, url?: string) => {
          if (openPrLink(event, url ?? current.url, url === undefined ? undefined : threadRef)) {
            openThread();
          }
        }}
      />
    </span>
  );
}

function StatusLabel({ status }: { status: WorkingOverviewStatus }) {
  return (
    <span className={cn("flex items-center gap-1.5 text-xs", status.colorClass)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)} />
      {status.label}
    </span>
  );
}

/**
 * Holds the thread's live detail subscription while the row is mounted and samples the
 * latest step on a timer, so streaming text does not re-render the page per token.
 */
function useLiveActivityLine(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  enabled: boolean,
): string | null {
  const [line, setLine] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the thread's stream and samples it every few seconds
  useEffect(() => {
    if (!enabled) return;
    const atom = environmentThreadDetails.threadAtom(scopeThreadRef(environmentId, threadId));
    let dirty = true;
    let shown = false;
    const read = () => {
      if (!dirty) return;
      dirty = false;
      const thread = appAtomRegistry.get(atom);
      const next = thread === null ? null : latestActivityLine(thread.projection);
      if (next !== null) shown = true;
      setLine(next);
    };
    const unsubscribe = appAtomRegistry.subscribe(atom, () => {
      dirty = true;
      // The first load lands between ticks; show it without waiting for one.
      if (!shown) read();
    });
    read();
    const timer = setInterval(read, LIVE_ACTIVITY_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [environmentId, threadId, enabled]);
  return enabled ? line : null;
}

function rowTiming(thread: SidebarThreadSummary, status: WorkingOverviewStatus, nowMs: number) {
  const finished =
    status.label === "Settled" || status.label === "Completed" || status.label === "Failed";
  const since =
    status.label === "Settled"
      ? thread.settledAt
      : finished
        ? (thread.latestRun?.completedAt ?? null)
        : resolveWorkingStartedAt(thread);
  if (since === null) return null;
  const elapsed = minuteElapsedLabel(since, nowMs);
  if (elapsed === "just now") return elapsed;
  return finished ? `${elapsed} ago` : `for ${elapsed}`;
}

// The page ticks once a minute, so a seconds label would sit stale until the next tick.
function minuteElapsedLabel(iso: string, nowMs: number): string {
  const label = formatElapsedDurationLabel(iso, nowMs);
  return /^\d+s$/.test(label) ? "just now" : label;
}
