import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import { FolderIcon } from "lucide-react";

import { isElectron } from "~/env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useBoringSidebarEnabled } from "../../hooks/useSettings";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { useDelegatedUnderParent, useQuietThreadShells } from "../../state/entities";
import { useEnvironmentConnectionSummaries } from "../../state/environments";
import { liveShellEnvironmentIdsAtom } from "../../state/shell";
import { sidebarProviderEntriesAtom } from "../../state/sidebarProviderEntries";
import { useUiStateStore } from "../../uiStateStore";
import { isSidebarEnvironmentDisconnected, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  collectWorkingPullRequests,
  groupEntriesByProject,
  groupWorkingOverviewThreads,
  WORKING_OVERVIEW_SECTIONS,
} from "./workingOverview.logic";
import { WorkingPullRequests } from "./WorkingPullRequests";
import { WorkingThreadRow } from "./WorkingThreadRow";
import { WorkingUsageStrip } from "./WorkingUsageStrip";

/**
 * Each live row holds a thread subscription, as an open thread does. Past this many,
 * rows show their goal or facts instead of the latest step.
 */
const MAX_LIVE_ROWS = 6;

const COLLAPSED_SECTIONS_KEY = "t3code:working-overview:collapsed-sections";
const EMPTY_COLLAPSED: ReadonlyArray<string> = [];
const COLLAPSED_SECTIONS_SCHEMA = Schema.Array(Schema.String);

export function WorkingOverviewPage() {
  const threads = useQuietThreadShells();
  const projectGroups = useSidebarProjectGroups();
  const projectFolders = useBoringSidebarEnabled();
  const delegatedUnderParent = useDelegatedUnderParent();
  const providerEntriesByEnvironment = useAtomValue(sidebarProviderEntriesAtom);
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById);
  const environmentConnections = useEnvironmentConnectionSummaries();
  const liveShellEnvironmentIds = useAtomValue(liveShellEnvironmentIdsAtom);
  // Minute ticks keep elapsed labels current without repainting every second.
  const nowMs = Date.parse(`${useNowMinute()}:00.000Z`);
  const [collapsed, setCollapsed] = useLocalStorage(
    COLLAPSED_SECTIONS_KEY,
    EMPTY_COLLAPSED,
    COLLAPSED_SECTIONS_SCHEMA,
  );
  const toggleSection = (id: string) =>
    setCollapsed((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );

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
    nowMs,
    lastVisitedAt: (thread) =>
      resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        localLastVisitedAt[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
      ),
  });
  const pullRequests = collectWorkingPullRequests(sections);
  const liveKeys = new Set(
    [...sections["needs-you"], ...sections.working]
      .slice(0, MAX_LIVE_ROWS)
      .map((entry) => `${entry.thread.environmentId}:${entry.thread.id}`),
  );
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
          <div className="grid grid-cols-1 gap-x-4 gap-y-4 px-2 pt-6 pb-4 @4xl/working:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
            <div className="flex min-w-0 flex-col gap-3">
              {total === 0 ? (
                <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                  No threads are running and nothing is waiting to be read.
                </p>
              ) : (
                WORKING_OVERVIEW_SECTIONS.map((section) => {
                  const entries = sections[section.id];
                  if (entries.length === 0) return null;
                  const groups = projectFolders
                    ? groupEntriesByProject(entries, projectGroups)
                    : [{ key: "all", name: null, entries }];
                  return (
                    <section key={section.id} aria-label={section.title}>
                      <CollapsibleSectionHeader
                        expanded={!collapsed.includes(section.id)}
                        onClick={() => toggleSection(section.id)}
                        accessory={
                          <span className="font-normal tabular-nums">
                            {section.id === "settled"
                              ? `${entries.length} · last 24 hours`
                              : entries.length}
                          </span>
                        }
                      >
                        {section.title}
                      </CollapsibleSectionHeader>
                      {collapsed.includes(section.id) ? null : (
                        <>
                          {groups.map((group) => (
                            <div key={group.key}>
                              {projectFolders ? (
                                <h3 className="flex items-center gap-1.5 px-2 pt-1 text-xs text-foreground/80">
                                  <FolderIcon
                                    aria-hidden
                                    className="size-3.5 text-muted-foreground"
                                  />
                                  {group.name ?? "Other"}
                                </h3>
                              ) : null}
                              <ul className="flex flex-col">
                                {group.entries.map((entry) => {
                                  const key = `${entry.thread.environmentId}:${entry.thread.id}`;
                                  return (
                                    <WorkingThreadRow
                                      key={key}
                                      entry={entry}
                                      projectName={
                                        projectFolders
                                          ? null
                                          : (projectNames.get(
                                              `${entry.thread.environmentId}:${entry.thread.projectId}`,
                                            ) ?? null)
                                      }
                                      providerEntries={providerEntriesByEnvironment.get(
                                        entry.thread.environmentId,
                                      )}
                                      nowMs={nowMs}
                                      live={liveKeys.has(key)}
                                    />
                                  );
                                })}
                              </ul>
                            </div>
                          ))}
                        </>
                      )}
                    </section>
                  );
                })
              )}
            </div>
            <WorkingPullRequests
              pullRequests={pullRequests}
              expanded={!collapsed.includes("pull-requests")}
              onToggle={() => toggleSection("pull-requests")}
              className="@4xl/working:border-s @4xl/working:ps-2"
            />
          </div>
        </div>

        <WorkingUsageStrip nowMs={nowMs} />
      </div>
    </SidebarInset>
  );
}
