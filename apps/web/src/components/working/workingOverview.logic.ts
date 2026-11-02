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

export type WorkingOverviewSectionId = "needs-you" | "working" | "completed";

/** Live work first; everything that finished recently collects at the bottom. */
export const WORKING_OVERVIEW_SECTIONS: ReadonlyArray<{
  readonly id: WorkingOverviewSectionId;
  readonly title: string;
}> = [
  { id: "needs-you", title: "Needs you" },
  { id: "working", title: "Working" },
  { id: "completed", title: "Completed" },
];

/** How far back Completed reaches. The sidebar only flags unseen completions. */
const COMPLETED_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_COMPLETED = 30;

/** A completion the user already saw. It has no sidebar pill, so the page names it. */
export const SEEN_COMPLETION_STATUS: ThreadStatusPill = {
  label: "Completed",
  colorClass: "text-muted-foreground",
  dotClass: "bg-muted-foreground/50",
  pulse: false,
};

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
>;

/**
 * Sorts the sidebar's visible threads by what they need from the user, and adds every
 * thread that completed in the last day, seen or not.
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
    "needs-you": [],
    working: [],
    completed: [],
  };
  const visible = filterSidebarV2VisibleThreads(input.threads, null, input.delegatedUnderParent);
  const completedAt = (thread: T) => Date.parse(thread.latestRun?.completedAt ?? "");
  for (const thread of sortWorkingThreadsBySend(visible)) {
    if (input.disconnectedEnvironmentIds.has(thread.environmentId)) continue;
    const status =
      statusOf(thread) ??
      (thread.latestRun?.status === "completed" &&
      input.nowMs - completedAt(thread) <= COMPLETED_WINDOW_MS
        ? SEEN_COMPLETION_STATUS
        : null);
    if (status === null) continue;
    sections[SECTION_BY_STATUS[status.label]].push({
      thread,
      status,
      children: childrenByParent.get(`${thread.environmentId}:${thread.id}`) ?? [],
    });
  }
  sections.completed = sections.completed
    .toSorted((left, right) => completedAt(right.thread) - completedAt(left.thread))
    .slice(0, MAX_COMPLETED);
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

export interface WorkingPullRequest<T> {
  readonly link: ThreadPullRequestLink & {
    readonly snapshot: NonNullable<ThreadPullRequestLink["snapshot"]>;
  };
  readonly thread: T;
  readonly status: ThreadStatusPill;
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
  for (const section of ["needs-you", "working", "completed"] as const) {
    for (const { thread, status } of sections[section]) {
      for (const link of thread.pullRequests) {
        if (link.snapshot === null || link.snapshot.state !== "open" || byUrl.has(link.url)) {
          continue;
        }
        byUrl.set(link.url, {
          link: { ...link, snapshot: link.snapshot },
          thread,
          status,
          active: section !== "completed",
        });
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
