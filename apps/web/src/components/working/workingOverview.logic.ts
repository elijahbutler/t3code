import { sortWorkingThreadsBySend } from "@t3tools/client-runtime/state/thread-inbox";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isListedThreadLineage } from "@t3tools/contracts";

import {
  filterSidebarV2VisibleThreads,
  resolveThreadStatusPill,
  type ThreadStatusPill,
} from "../Sidebar.logic";

export type WorkingOverviewSectionId = "finished" | "needs-you" | "working";

/** Finished first: those are the threads waiting to be read. */
export const WORKING_OVERVIEW_SECTIONS: ReadonlyArray<{
  readonly id: WorkingOverviewSectionId;
  readonly title: string;
}> = [
  { id: "finished", title: "Finished" },
  { id: "needs-you", title: "Needs you" },
  { id: "working", title: "Working" },
];

export interface WorkingOverviewEntry<T> {
  readonly thread: T;
  readonly status: ThreadStatusPill;
  /** Subagents and side chats of this thread. Idle ones have no status. */
  readonly children: ReadonlyArray<{
    readonly thread: T;
    readonly status: ThreadStatusPill | null;
  }>;
}

export type WorkingOverviewSections<T> = Record<
  WorkingOverviewSectionId,
  ReadonlyArray<WorkingOverviewEntry<T>>
>;

const SECTION_BY_STATUS: Record<ThreadStatusPill["label"], WorkingOverviewSectionId> = {
  "Pending Approval": "needs-you",
  "Awaiting Input": "needs-you",
  "Guest Request": "needs-you",
  "Plan Ready": "needs-you",
  Failed: "needs-you",
  Working: "working",
  Connecting: "working",
  Waiting: "working",
  Completed: "finished",
};

type WorkingOverviewThreadInput = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "id"
  | "projectId"
  | "archivedAt"
  | "lineage"
  | "createdAt"
  | "latestRun"
  | "latestUserAuthoredMessageAt"
  | "runtime"
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "pendingGuestMessageCount"
  | "interactionMode"
  | "pendingBackgroundTasks"
  | "blockedOnThreadWait"
>;

/**
 * Sorts the sidebar's visible threads by what they need from the user. Threads with no
 * status (idle and already seen) are left out, so the page lists only live work.
 */
export function groupWorkingOverviewThreads<T extends WorkingOverviewThreadInput>(input: {
  readonly threads: ReadonlyArray<T>;
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly disconnectedEnvironmentIds: ReadonlySet<string>;
  readonly lastVisitedAt: (thread: T) => string | undefined;
}): WorkingOverviewSections<T> {
  const statusOf = (thread: T) =>
    resolveThreadStatusPill({ thread: { ...thread, lastVisitedAt: input.lastVisitedAt(thread) } });
  const childrenByParent = new Map<string, Array<WorkingOverviewEntry<T>["children"][number]>>();
  for (const thread of sortWorkingThreadsBySend(input.threads)) {
    const parentId = thread.lineage.parentThreadId;
    if (parentId === null || isListedThreadLineage(thread.lineage) || thread.archivedAt !== null) {
      continue;
    }
    const key = `${thread.environmentId}:${parentId}`;
    const children = childrenByParent.get(key) ?? [];
    children.push({ thread, status: statusOf(thread) });
    childrenByParent.set(key, children);
  }

  const sections: Record<WorkingOverviewSectionId, Array<WorkingOverviewEntry<T>>> = {
    finished: [],
    "needs-you": [],
    working: [],
  };
  const visible = filterSidebarV2VisibleThreads(input.threads, null, input.delegatedUnderParent);
  for (const thread of sortWorkingThreadsBySend(visible)) {
    if (input.disconnectedEnvironmentIds.has(thread.environmentId)) continue;
    const status = statusOf(thread);
    if (status === null) continue;
    sections[SECTION_BY_STATUS[status.label]].push({
      thread,
      status,
      children: childrenByParent.get(`${thread.environmentId}:${thread.id}`) ?? [],
    });
  }
  return sections;
}

interface ProjectGroupInput {
  readonly projectKey: string;
  readonly displayName: string;
  readonly memberProjectRefs: ReadonlyArray<{
    readonly environmentId: string;
    readonly projectId: string;
  }>;
}

/**
 * Splits a section by the sidebar's project groups, in the sidebar's project order.
 * Threads whose project has no group land in a trailing group with no name.
 */
export function groupEntriesByProject<
  T extends Pick<EnvironmentThreadShell, "environmentId" | "projectId">,
>(
  entries: ReadonlyArray<WorkingOverviewEntry<T>>,
  groups: ReadonlyArray<ProjectGroupInput>,
): Array<{ key: string; name: string | null; entries: Array<WorkingOverviewEntry<T>> }> {
  const groupIndexByProject = new Map<string, number>();
  groups.forEach((group, index) => {
    for (const ref of group.memberProjectRefs) {
      groupIndexByProject.set(`${ref.environmentId}:${ref.projectId}`, index);
    }
  });
  const buckets = new Map<number, Array<WorkingOverviewEntry<T>>>();
  for (const entry of entries) {
    const index =
      groupIndexByProject.get(`${entry.thread.environmentId}:${entry.thread.projectId}`) ??
      groups.length;
    const bucket = buckets.get(index) ?? [];
    bucket.push(entry);
    buckets.set(index, bucket);
  }
  return [...buckets]
    .toSorted(([left], [right]) => left - right)
    .map(([index, bucketEntries]) => ({
      key: groups[index]?.projectKey ?? "ungrouped",
      name: groups[index]?.displayName ?? null,
      entries: bucketEntries,
    }));
}
