import { sortWorkingThreadsBySend } from "@t3tools/client-runtime/state/thread-inbox";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import {
  filterSidebarV2VisibleThreads,
  resolveThreadStatusPill,
  type ThreadStatusPill,
} from "../Sidebar.logic";

export type WorkingOverviewGroupId = "needs-you" | "working" | "finished";

export interface WorkingOverviewEntry<T> {
  readonly thread: T;
  readonly status: ThreadStatusPill;
}

export interface WorkingOverviewGroups<T> {
  readonly "needs-you": ReadonlyArray<WorkingOverviewEntry<T>>;
  readonly working: ReadonlyArray<WorkingOverviewEntry<T>>;
  readonly finished: ReadonlyArray<WorkingOverviewEntry<T>>;
}

const GROUP_BY_STATUS: Record<ThreadStatusPill["label"], WorkingOverviewGroupId> = {
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
}): WorkingOverviewGroups<T> {
  const groups: Record<WorkingOverviewGroupId, Array<WorkingOverviewEntry<T>>> = {
    "needs-you": [],
    working: [],
    finished: [],
  };
  const visible = filterSidebarV2VisibleThreads(input.threads, null, input.delegatedUnderParent);
  for (const thread of sortWorkingThreadsBySend(visible)) {
    if (input.disconnectedEnvironmentIds.has(thread.environmentId)) continue;
    const status = resolveThreadStatusPill({
      thread: { ...thread, lastVisitedAt: input.lastVisitedAt(thread) },
    });
    if (status === null) continue;
    groups[GROUP_BY_STATUS[status.label]].push({ thread, status });
  }
  return groups;
}
