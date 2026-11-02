import { threadKey } from "@t3tools/client-runtime/state/entities";
import {
  sortInboxThreadsByReturn,
  sortWorkingThreadsBySend,
} from "@t3tools/client-runtime/state/thread-inbox";
import {
  effectiveSnoozed,
  type ThreadSnoozeShell,
} from "@t3tools/client-runtime/state/thread-settled";
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

export type WorkingOverviewSectionId = "inbox" | "working" | "snoozed" | "settled";

/** The sidebar's order: the inbox, then the Working, Snoozed, and Settled shelves. */
export const WORKING_OVERVIEW_SECTIONS: ReadonlyArray<{
  readonly id: WorkingOverviewSectionId;
  readonly title: string;
}> = [
  { id: "inbox", title: "Inbox" },
  { id: "working", title: "Working" },
  { id: "snoozed", title: "Snoozed" },
  { id: "settled", title: "Settled" },
];

/** A finished subagent stays listed this long, or until its parent is next opened. */
const RECENT_SUBAGENT_MS = 60 * 60 * 1000;

export interface WorkingOverviewStatus extends Omit<ThreadStatusPill, "label"> {
  readonly label: ThreadStatusPill["label"] | "Snoozed" | "Settled";
}

/** A completion the user already saw. It has no sidebar pill, so the page names it. */
export const SEEN_COMPLETION_STATUS: WorkingOverviewStatus = {
  label: "Completed",
  colorClass: "text-muted-foreground",
  dotClass: "bg-muted-foreground/50",
  pulse: false,
};

const SNOOZED_STATUS: WorkingOverviewStatus = {
  label: "Snoozed",
  colorClass: "text-muted-foreground",
  dotClass: "bg-muted-foreground/30",
  pulse: false,
};

const SETTLED_STATUS: WorkingOverviewStatus = {
  label: "Settled",
  colorClass: "text-muted-foreground",
  dotClass: "bg-muted-foreground/30",
  pulse: false,
};

const WORKING_LABELS: ReadonlySet<ThreadStatusPill["label"]> = new Set([
  "Working",
  "Connecting",
  "Waiting",
]);

export interface WorkingOverviewEntry<T> {
  readonly thread: T;
  readonly status: WorkingOverviewStatus;
  /** Active subagents and side chats of this thread, and ones that finished recently. */
  readonly children: ReadonlyArray<{
    readonly thread: T;
    readonly status: WorkingOverviewStatus | null;
  }>;
}

export type WorkingOverviewSections<T> = Record<
  WorkingOverviewSectionId,
  ReadonlyArray<WorkingOverviewEntry<T>>
>;

type WorkingOverviewThreadInput = ThreadSnoozeShell &
  Pick<
    EnvironmentThreadShell,
    | "environmentId"
    | "id"
    | "projectId"
    | "archivedAt"
    | "lineage"
    | "createdAt"
    | "unsettledAt"
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
    | "snoozedUntil"
    | "snoozedAt"
  >;

const timestampMs = (iso: string | null | undefined) => Date.parse(iso ?? "") || 0;

/**
 * Places the sidebar's visible threads in the sidebar's sections, with its precedence:
 * snoozed, then settled, then working, then the inbox. The inbox keeps threads that need
 * the user and finished ones; idle threads that never finished are left out.
 */
export function groupWorkingOverviewThreads<T extends WorkingOverviewThreadInput>(input: {
  readonly threads: ReadonlyArray<T>;
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly disconnectedEnvironmentIds: ReadonlySet<string>;
  readonly lastVisitedAt: (thread: T) => string | undefined;
  readonly nowMs: number;
}): WorkingOverviewSections<T> {
  const now = new Date(input.nowMs).toISOString();
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
    inbox: [],
    working: [],
    snoozed: [],
    settled: [],
  };
  const visible = filterSidebarV2VisibleThreads(input.threads, null, input.delegatedUnderParent);
  for (const thread of sortInboxThreadsByReturn(visible)) {
    if (input.disconnectedEnvironmentIds.has(thread.environmentId)) continue;
    const pill = statusOf(thread);
    // New activity un-snoozes and un-settles a thread on the server, as in the sidebar.
    const placement: { section: WorkingOverviewSectionId; status: WorkingOverviewStatus } | null =
      effectiveSnoozed(thread, { now })
        ? { section: "snoozed", status: SNOOZED_STATUS }
        : thread.settledOverride === "settled"
          ? { section: "settled", status: SETTLED_STATUS }
          : pill !== null
            ? { section: WORKING_LABELS.has(pill.label) ? "working" : "inbox", status: pill }
            : thread.latestRun?.status === "completed"
              ? { section: "inbox", status: SEEN_COMPLETION_STATUS }
              : null;
    if (placement === null) continue;
    // Idle subagents are noise here; finished ones stay while they are news.
    const newsSince = Math.min(
      input.nowMs - RECENT_SUBAGENT_MS,
      timestampMs(input.lastVisitedAt(thread)) || Infinity,
    );
    const children = (childrenByParent.get(threadKey(scopeThread(thread))) ?? []).flatMap(
      (child) => {
        if (child.status !== null && child.status.label !== "Completed") return [child];
        const finishedAt = timestampMs(child.thread.latestRun?.completedAt);
        return child.thread.latestRun?.status === "completed" && finishedAt > newsSince
          ? [{ thread: child.thread, status: child.status ?? SEEN_COMPLETION_STATUS }]
          : [];
      },
    );
    sections[placement.section].push({ thread, status: placement.status, children });
  }
  // The sidebar's Working shelf orders by send time, not by return.
  const sendOrder = new Map(
    sortWorkingThreadsBySend(sections.working.map((entry) => entry.thread)).map(
      (thread, index) => [thread, index] as const,
    ),
  );
  sections.working = sections.working.toSorted(
    (left, right) => sendOrder.get(left.thread)! - sendOrder.get(right.thread)!,
  );
  sections.snoozed = sections.snoozed.toSorted(
    (left, right) => timestampMs(left.thread.snoozedUntil) - timestampMs(right.thread.snoozedUntil),
  );
  sections.settled = sections.settled.toSorted(
    (left, right) => timestampMs(right.thread.settledAt) - timestampMs(left.thread.settledAt),
  );
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
  for (const section of ["working", "inbox", "snoozed", "settled"] as const) {
    for (const entry of sections[section]) {
      const owners = [entry, ...entry.children.filter((child) => child.status !== null)];
      for (const { thread, status } of owners) {
        if (status === null) continue;
        const active =
          section === "working" ||
          (section === "inbox" && status.label !== "Completed" && status.label !== "Failed");
        for (const link of thread.pullRequests) {
          if (link.snapshot === null || link.snapshot.state !== "open") continue;
          // A PR shared by several threads belongs to the one working on it.
          const existing = byUrl.get(link.url);
          if (existing !== undefined && (existing.active || !active)) continue;
          byUrl.set(link.url, {
            link: { ...link, snapshot: link.snapshot },
            thread,
            status,
            active,
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

/** The last line of the agent's newest message. Tool calls and thinking are left out. */
export function latestActivityLine(
  projection: Pick<OrchestrationV2ThreadProjection, "turnItems">,
): string | null {
  type Item = OrchestrationV2ThreadProjection["turnItems"][number];
  const messages = projection.turnItems
    .filter(
      (item): item is Extract<Item, { type: "assistant_message" }> =>
        item.type === "assistant_message",
    )
    .toSorted((left, right) => right.ordinal - left.ordinal);
  for (const message of messages) {
    const line = lastLine(message.text);
    if (line !== null) return line;
  }
  return null;
}
