import { threadKey } from "@t3tools/client-runtime/state/entities";
import { sortWorkingThreadsBySend } from "@t3tools/client-runtime/state/thread-inbox";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isListedThreadLineage,
  type OrchestrationV2ThreadProjection,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";

import {
  filterSidebarV2VisibleThreads,
  resolveThreadStatusPill,
  type ThreadStatusPill,
} from "../Sidebar.logic";

export type WorkingOverviewSectionId = "needs-you" | "working" | "completed" | "settled";

/** Live work first; finished work collects at the bottom, then what was settled. */
export const WORKING_OVERVIEW_SECTIONS: ReadonlyArray<{
  readonly id: WorkingOverviewSectionId;
  readonly title: string;
}> = [
  { id: "needs-you", title: "Needs you" },
  { id: "working", title: "Working" },
  { id: "completed", title: "Completed" },
  { id: "settled", title: "Settled" },
];

/**
 * Completed holds finished threads until they settle, which the server does per the
 * user's auto-settle settings. Settled then lists them for this long.
 */
const SETTLED_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS_PER_FINISHED_SECTION = 30;

export interface WorkingOverviewStatus extends Omit<ThreadStatusPill, "label"> {
  readonly label: ThreadStatusPill["label"] | "Settled";
}

/** A completion the user already saw. It has no sidebar pill, so the page names it. */
export const SEEN_COMPLETION_STATUS: WorkingOverviewStatus = {
  label: "Completed",
  colorClass: "text-muted-foreground",
  dotClass: "bg-muted-foreground/50",
  pulse: false,
};

const SETTLED_STATUS: WorkingOverviewStatus = {
  label: "Settled",
  colorClass: "text-muted-foreground",
  dotClass: "bg-muted-foreground/30",
  pulse: false,
};

export interface WorkingOverviewEntry<T> {
  readonly thread: T;
  readonly status: WorkingOverviewStatus;
  /** Subagents and side chats of this thread. Idle ones have no status. */
  readonly children: ReadonlyArray<{
    readonly thread: T;
    readonly status: WorkingOverviewStatus | null;
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
  Completed: "completed",
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
  | "delegatedFrom"
  | "settledOverride"
  | "settledAt"
>;

const timestampMs = (iso: string | null | undefined) => Date.parse(iso ?? "") || 0;

/**
 * Sorts the sidebar's visible threads by what they need from the user. Finished threads
 * stay in Completed until they settle, then show in Settled for a day.
 */
export function groupWorkingOverviewThreads<T extends WorkingOverviewThreadInput>(input: {
  readonly threads: ReadonlyArray<T>;
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly disconnectedEnvironmentIds: ReadonlySet<string>;
  readonly lastVisitedAt: (thread: T) => string | undefined;
  readonly nowMs: number;
}): WorkingOverviewSections<T> {
  const statusOf = (thread: T) =>
    resolveThreadStatusPill({ thread: { ...thread, lastVisitedAt: input.lastVisitedAt(thread) } });
  const childrenByParent = new Map<string, Array<WorkingOverviewEntry<T>["children"][number]>>();
  for (const thread of sortWorkingThreadsBySend(input.threads)) {
    if (thread.archivedAt !== null) continue;
    const parentKey = parentKeyOf(thread, input.delegatedUnderParent);
    if (parentKey === null) continue;
    const children = childrenByParent.get(parentKey) ?? [];
    children.push({ thread, status: statusOf(thread) });
    childrenByParent.set(parentKey, children);
  }

  const sections: Record<WorkingOverviewSectionId, Array<WorkingOverviewEntry<T>>> = {
    "needs-you": [],
    working: [],
    completed: [],
    settled: [],
  };
  const visible = filterSidebarV2VisibleThreads(input.threads, null, input.delegatedUnderParent);
  for (const thread of sortWorkingThreadsBySend(visible)) {
    if (input.disconnectedEnvironmentIds.has(thread.environmentId)) continue;
    const pill = statusOf(thread);
    const live = pill !== null && SECTION_BY_STATUS[pill.label] !== "completed";
    const placement: { section: WorkingOverviewSectionId; status: WorkingOverviewStatus } | null =
      live
        ? { section: SECTION_BY_STATUS[pill.label], status: pill }
        : thread.settledOverride === "settled"
          ? input.nowMs - timestampMs(thread.settledAt) <= SETTLED_WINDOW_MS
            ? { section: "settled", status: SETTLED_STATUS }
            : null
          : thread.latestRun?.status === "completed"
            ? { section: "completed", status: pill ?? SEEN_COMPLETION_STATUS }
            : null;
    if (placement === null) continue;
    sections[placement.section].push({
      thread,
      status: placement.status,
      children: childrenByParent.get(threadKey(scopeThread(thread))) ?? [],
    });
  }
  sections.completed = sections.completed
    .toSorted(
      (left, right) =>
        timestampMs(right.thread.latestRun?.completedAt) -
        timestampMs(left.thread.latestRun?.completedAt),
    )
    .slice(0, MAX_ROWS_PER_FINISHED_SECTION);
  sections.settled = sections.settled
    .toSorted(
      (left, right) => timestampMs(right.thread.settledAt) - timestampMs(left.thread.settledAt),
    )
    .slice(0, MAX_ROWS_PER_FINISHED_SECTION);
  return sections;
}

/**
 * The thread this one shows under, matching the sidebar: subagents and side chats under
 * their local parent, and delegated tasks under their listed parent in another environment.
 */
function parentKeyOf(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id" | "lineage" | "delegatedFrom">,
  delegatedUnderParent: ReadonlySet<string>,
): string | null {
  const parent = thread.delegatedFrom;
  if (parent != null && delegatedUnderParent.has(threadKey(scopeThread(thread)))) {
    return threadKey({ environmentId: parent.environmentId, threadId: parent.threadId });
  }
  const parentId = thread.lineage.parentThreadId;
  if (parentId === null || isListedThreadLineage(thread.lineage)) return null;
  return threadKey({ environmentId: thread.environmentId, threadId: parentId });
}

function scopeThread(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) {
  return { environmentId: thread.environmentId, threadId: thread.id };
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

export interface WorkingPullRequest<T> {
  readonly link: ThreadPullRequestLink & {
    readonly snapshot: NonNullable<ThreadPullRequestLink["snapshot"]>;
  };
  readonly thread: T;
  readonly status: WorkingOverviewStatus;
  /** The linked thread is working or waiting on the user right now. */
  readonly active: boolean;
}

/**
 * Open pull requests linked to the page's threads, one row per URL. Those whose thread is
 * live come first, then the most recently updated.
 */
export function collectWorkingPullRequests<
  T extends Pick<EnvironmentThreadShell, "environmentId" | "id" | "pullRequests">,
>(sections: WorkingOverviewSections<T>): Array<WorkingPullRequest<T>> {
  const byUrl = new Map<string, WorkingPullRequest<T>>();
  for (const section of ["needs-you", "working", "completed", "settled"] as const) {
    for (const entry of sections[section]) {
      const owners = [entry, ...entry.children.filter((child) => child.status !== null)];
      for (const { thread, status } of owners) {
        if (status === null) continue;
        for (const link of thread.pullRequests) {
          if (link.snapshot === null || link.snapshot.state !== "open" || byUrl.has(link.url)) {
            continue;
          }
          byUrl.set(link.url, {
            link: { ...link, snapshot: link.snapshot },
            thread,
            status,
            active: section === "needs-you" || section === "working",
          });
        }
      }
    }
  }
  const updatedAt = (pullRequest: WorkingPullRequest<T>) =>
    Date.parse(pullRequest.link.snapshot.updatedAt ?? pullRequest.link.snapshot.syncedAt) || 0;
  return [...byUrl.values()].toSorted(
    (left, right) =>
      Number(right.active) - Number(left.active) || updatedAt(right) - updatedAt(left),
  );
}

const ACTIVITY_MAX_LENGTH = 180;

function lastLine(text: string): string | null {
  const lines = text.split("\n").map((line) => line.trim());
  const line = lines.findLast((candidate) => candidate.length > 0);
  if (line === undefined) return null;
  return line.length > ACTIVITY_MAX_LENGTH ? `…${line.slice(-ACTIVITY_MAX_LENGTH)}` : line;
}

/** One line describing the most recent thing the agent did or said in this thread. */
export function latestActivityLine(
  projection: Pick<OrchestrationV2ThreadProjection, "turnItems">,
): string | null {
  const items = projection.turnItems.toSorted((left, right) => right.ordinal - left.ordinal);
  for (const item of items) {
    const line = (() => {
      switch (item.type) {
        case "assistant_message":
          return lastLine(item.text);
        case "reasoning": {
          const text = lastLine(item.text);
          return text === null ? null : `Thinking: ${text}`;
        }
        case "command_execution": {
          const command = lastLine(item.input);
          return command === null ? null : `$ ${command}`;
        }
        case "file_change":
          return `Edited ${item.fileName}`;
        case "file_search":
          return item.pattern ? `Searched files for ${item.pattern}` : null;
        case "web_search":
          return item.patterns?.[0] ? `Searched the web for ${item.patterns[0]}` : null;
        default:
          return null;
      }
    })();
    if (line !== null) return line;
  }
  return null;
}
