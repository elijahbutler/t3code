import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveThreadCurrentPullRequestLink } from "@t3tools/client-runtime/thread-pull-requests";
import { Link } from "@tanstack/react-router";
import { FolderIcon, GitBranchIcon } from "lucide-react";

import { isElectron } from "~/env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useBoringSidebarEnabled } from "../../hooks/useSettings";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { cn } from "../../lib/utils";
import { useDelegatedUnderParent, useQuietThreadShells } from "../../state/entities";
import { useEnvironmentConnectionSummaries } from "../../state/environments";
import { liveShellEnvironmentIdsAtom } from "../../state/shell";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatElapsedDurationLabel } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import { useUiStateStore } from "../../uiStateStore";
import {
  isSidebarEnvironmentDisconnected,
  resolveThreadLastVisitedAt,
  resolveWorkingStartedAt,
  type ThreadStatusPill,
} from "../Sidebar.logic";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  groupEntriesByProject,
  groupWorkingOverviewThreads,
  WORKING_OVERVIEW_SECTIONS,
  type WorkingOverviewEntry,
} from "./workingOverview.logic";
import { WorkingUsageStrip } from "./WorkingUsageStrip";

type Entry = WorkingOverviewEntry<SidebarThreadSummary>;

export function WorkingOverviewPage() {
  const threads = useQuietThreadShells();
  const projectGroups = useSidebarProjectGroups();
  const projectFolders = useBoringSidebarEnabled();
  const delegatedUnderParent = useDelegatedUnderParent();
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById);
  const environmentConnections = useEnvironmentConnectionSummaries();
  const liveShellEnvironmentIds = useAtomValue(liveShellEnvironmentIdsAtom);
  // Minute ticks keep elapsed labels current without repainting every second.
  const nowMs = Date.parse(`${useNowMinute()}:00.000Z`);

  const disconnectedEnvironmentIds = new Set<string>(
    environmentConnections
      .filter((environment) =>
        isSidebarEnvironmentDisconnected(
          environment.connectionState,
          liveShellEnvironmentIds.has(environment.environmentId),
        ),
      )
      .map((environment) => environment.environmentId),
  );
  // Project names follow the sidebar's grouping mode, so merged repositories share one name.
  const projectNames = new Map<string, string>();
  for (const group of projectGroups) {
    for (const ref of group.memberProjectRefs) {
      projectNames.set(`${ref.environmentId}:${ref.projectId}`, group.displayName);
    }
  }
  const sections = groupWorkingOverviewThreads({
    threads,
    delegatedUnderParent,
    disconnectedEnvironmentIds,
    lastVisitedAt: (thread) =>
      resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        localLastVisitedAt[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
      ),
  });
  const total = WORKING_OVERVIEW_SECTIONS.reduce(
    (count, section) => count + sections[section.id].length,
    0,
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div
        {...workspaceAreaProps("working-overview", 1, "Working overview")}
        className="@container/working flex min-h-0 min-w-0 flex-1 flex-col bg-background"
      >
        <WorkspacePageHeader electron={isElectron} className="bg-background">
          <WorkspaceBreadcrumb ariaLabel="Working overview breadcrumb">
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">Working</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>

        <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-3 pt-2 pb-6 sm:px-4">
            {total === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No threads are running. Threads show up here while they work, when they need you,
                and when they finish.
              </p>
            ) : (
              WORKING_OVERVIEW_SECTIONS.map((section) => {
                const entries = sections[section.id];
                if (entries.length === 0) return null;
                const groups = projectFolders
                  ? groupEntriesByProject(entries, projectGroups)
                  : [{ key: "all", name: null, entries }];
                return (
                  <section key={section.id} aria-labelledby={`working-${section.id}`}>
                    <h2
                      id={`working-${section.id}`}
                      className="flex items-center gap-2 px-2 pb-1 text-xs font-medium text-muted-foreground"
                    >
                      {section.title}
                      <span className="font-normal tabular-nums">{entries.length}</span>
                    </h2>
                    {groups.map((group) => (
                      <div key={group.key}>
                        {projectFolders ? (
                          <h3 className="flex items-center gap-1.5 px-2 pt-2 pb-0.5 text-xs text-foreground/80">
                            <FolderIcon aria-hidden className="size-3.5 text-muted-foreground" />
                            {group.name ?? "Other"}
                          </h3>
                        ) : null}
                        <ul className="flex flex-col">
                          {group.entries.map((entry) => (
                            <ThreadRow
                              key={`${entry.thread.environmentId}:${entry.thread.id}`}
                              entry={entry}
                              projectName={
                                projectFolders
                                  ? null
                                  : (projectNames.get(
                                      `${entry.thread.environmentId}:${entry.thread.projectId}`,
                                    ) ?? null)
                              }
                              nowMs={nowMs}
                            />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </section>
                );
              })
            )}
          </div>
        </div>

        <WorkingUsageStrip nowMs={nowMs} />
      </div>
    </SidebarInset>
  );
}

const ROW_LINK_CLASS =
  "rounded-md outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function ThreadRow({
  entry,
  projectName,
  nowMs,
}: {
  entry: Entry;
  projectName: string | null;
  nowMs: number;
}) {
  const { thread, status, children } = entry;
  const pullRequest = resolveThreadCurrentPullRequestLink(thread.pullRequests);
  const activeChildren = children.filter((child) => child.status !== null).length;
  const detail =
    status.label === "Failed"
      ? thread.runtime?.lastError
      : (thread.goal?.objective ?? thread.pendingBackgroundTasks[0]?.description ?? null);
  const facts = [
    projectName,
    thread.runtime?.providerName
      ? `${thread.runtime.providerName} · ${thread.modelSelection.model}`
      : thread.modelSelection.model,
    children.length > 0
      ? `${children.length} ${children.length === 1 ? "subagent" : "subagents"}${
          activeChildren > 0 ? `, ${activeChildren} active` : ""
        }`
      : null,
    thread.pendingBackgroundTasks.length > 0
      ? `${thread.pendingBackgroundTasks.length} background ${
          thread.pendingBackgroundTasks.length === 1 ? "task" : "tasks"
        }`
      : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <li className="min-w-0">
      <Link
        to="/$environmentId/$threadId"
        params={buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id))}
        className={cn(
          "grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 px-2 py-1.5 @xl/working:grid-cols-[6.5rem_minmax(0,1fr)_auto]",
          ROW_LINK_CLASS,
        )}
      >
        <StatusLabel status={status} collapsible />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{thread.title}</span>
          <span className="flex min-w-0 items-center gap-x-2 text-xs text-muted-foreground">
            <span className="truncate">{facts.join(" · ")}</span>
            {thread.branch === null ? null : (
              <span className="hidden min-w-0 shrink items-center gap-1 @2xl/working:flex">
                <GitBranchIcon aria-hidden className="size-3 shrink-0" />
                <span className="truncate font-mono">{thread.branch}</span>
              </span>
            )}
            {pullRequest === null ? null : (
              <span className="shrink-0 tabular-nums">#{pullRequest.number}</span>
            )}
          </span>
          {detail ? (
            <span className="truncate text-xs text-muted-foreground/80">{detail}</span>
          ) : null}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
          {rowTiming(thread, status, nowMs)}
        </span>
      </Link>
      {children.length > 0 ? (
        <ul className="ms-3 flex flex-col border-s ps-2 @xl/working:ms-[7.75rem]">
          {children.map((child) => (
            <li key={`${child.thread.environmentId}:${child.thread.id}`} className="min-w-0">
              <Link
                to="/$environmentId/$threadId"
                params={buildThreadRouteParams(
                  scopeThreadRef(child.thread.environmentId, child.thread.id),
                )}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 px-2 py-0.5 text-xs",
                  ROW_LINK_CLASS,
                )}
              >
                <span className="truncate text-foreground/90">{child.thread.title}</span>
                {child.status === null ? (
                  <span className="text-muted-foreground">Idle</span>
                ) : (
                  <StatusLabel status={child.status} />
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function StatusLabel({
  status,
  collapsible = false,
}: {
  status: ThreadStatusPill;
  /** Narrow layouts keep only the dot; the label stays for screen readers. */
  collapsible?: boolean;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-xs", status.colorClass)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)} />
      <span className={cn("truncate", collapsible && "sr-only @xl/working:not-sr-only")}>
        {status.label}
      </span>
    </span>
  );
}

function rowTiming(thread: SidebarThreadSummary, status: ThreadStatusPill, nowMs: number) {
  const finished = status.label === "Completed" || status.label === "Failed";
  const since = finished
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
