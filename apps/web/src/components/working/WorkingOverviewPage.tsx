import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Link } from "@tanstack/react-router";

import { isElectron } from "~/env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { cn } from "../../lib/utils";
import { useDelegatedUnderParent, useProjects, useQuietThreadShells } from "../../state/entities";
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
} from "../Sidebar.logic";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  groupWorkingOverviewThreads,
  type WorkingOverviewEntry,
  type WorkingOverviewGroupId,
} from "./workingOverview.logic";

const SECTIONS: ReadonlyArray<{ id: WorkingOverviewGroupId; title: string }> = [
  { id: "needs-you", title: "Needs you" },
  { id: "working", title: "Working" },
  { id: "finished", title: "Finished" },
];

export function WorkingOverviewPage() {
  const threads = useQuietThreadShells();
  const projects = useProjects();
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
  const projectTitles = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project.title] as const),
  );
  const groups = groupWorkingOverviewThreads({
    threads,
    delegatedUnderParent,
    disconnectedEnvironmentIds,
    lastVisitedAt: (thread) =>
      resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        localLastVisitedAt[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
      ),
  });
  const total = SECTIONS.reduce((count, section) => count + groups[section.id].length, 0);

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
          <WorkspacePageContainer width="expanded" className="gap-8">
            {total === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No threads are running. Threads show up here while they work, when they need you,
                and when they finish.
              </p>
            ) : (
              SECTIONS.map((section) =>
                groups[section.id].length === 0 ? null : (
                  <section key={section.id} aria-labelledby={`working-${section.id}`}>
                    <h2
                      id={`working-${section.id}`}
                      className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground"
                    >
                      {section.title}
                      <span className="font-normal tabular-nums">{groups[section.id].length}</span>
                    </h2>
                    <ul className="grid grid-cols-1 gap-3 @2xl/working:grid-cols-2 @5xl/working:grid-cols-3">
                      {groups[section.id].map((entry) => (
                        <WorkingThreadCard
                          key={`${entry.thread.environmentId}:${entry.thread.id}`}
                          entry={entry}
                          projectTitle={
                            projectTitles.get(
                              `${entry.thread.environmentId}:${entry.thread.projectId}`,
                            ) ?? null
                          }
                          nowMs={nowMs}
                        />
                      ))}
                    </ul>
                  </section>
                ),
              )
            )}
          </WorkspacePageContainer>
        </div>
      </div>
    </SidebarInset>
  );
}

function WorkingThreadCard({
  entry,
  projectTitle,
  nowMs,
}: {
  entry: WorkingOverviewEntry<SidebarThreadSummary>;
  projectTitle: string | null;
  nowMs: number;
}) {
  const { thread, status } = entry;
  const startedAt = resolveWorkingStartedAt(thread);
  const finishedAt = thread.latestRun?.completedAt ?? null;
  const finished = status.label === "Completed" || status.label === "Failed";
  const since = finished ? finishedAt : startedAt;
  const elapsed = since === null ? null : minuteElapsedLabel(since, nowMs);
  const timing =
    elapsed === null
      ? null
      : elapsed === "just now"
        ? elapsed
        : finished
          ? `${elapsed} ago`
          : `for ${elapsed}`;
  const backgroundTaskCount = thread.pendingBackgroundTasks.length;
  const detail =
    status.label === "Failed"
      ? thread.runtime?.lastError
      : (thread.goal?.objective ?? thread.pendingBackgroundTasks[0]?.description);

  return (
    <li className="min-w-0">
      <Link
        to="/$environmentId/$threadId"
        params={buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id))}
        className="flex h-full min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="flex items-center gap-2 text-xs">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", status.dotClass)} />
          <span className={cn("font-medium", status.colorClass)}>{status.label}</span>
          {timing === null ? null : (
            <span className="ms-auto shrink-0 text-muted-foreground tabular-nums">{timing}</span>
          )}
        </div>
        <p className="line-clamp-2 text-sm font-medium">{thread.title}</p>
        {detail ? <p className="line-clamp-2 text-xs text-muted-foreground">{detail}</p> : null}
        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
          {projectTitle === null ? null : <span className="truncate">{projectTitle}</span>}
          {thread.branch === null ? null : (
            <span className="truncate font-mono">{thread.branch}</span>
          )}
          {thread.runtime?.providerName ? <span>{thread.runtime.providerName}</span> : null}
          {backgroundTaskCount > 0 ? (
            <span>
              {backgroundTaskCount} background {backgroundTaskCount === 1 ? "task" : "tasks"}
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

// The page ticks once a minute, so a seconds label would sit stale until the next tick.
function minuteElapsedLabel(iso: string, nowMs: number): string {
  const label = formatElapsedDurationLabel(iso, nowMs);
  return /^\d+s$/.test(label) ? "just now" : label;
}
