import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import {
  collectWorkingPullRequests,
  groupEntriesByProject,
  groupWorkingOverviewThreads,
  latestActivityLine,
  SEEN_COMPLETION_STATUS,
} from "./workingOverview.logic";

const runtime = (status: "running" | "idle") => ({
  status,
  activeRunId: status === "running" ? RunId.make("run-active") : null,
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerName: "Codex",
  lastError: null,
  updatedAt: "2026-03-09T10:00:00.000Z",
});

const completedRun = {
  runId: RunId.make("run-done"),
  status: "completed" as const,
  requestedAt: "2026-03-09T09:00:00.000Z",
  startedAt: "2026-03-09T09:00:01.000Z",
  completedAt: "2026-03-09T09:05:00.000Z",
  assistantMessageId: null,
};

const NOW_MS = Date.parse("2026-03-09T12:00:00.000Z");

const thread = (id: string, overrides: Parameters<typeof makeThreadFixture>[0] = {}) =>
  makeThreadFixture({ id: ThreadId.make(id), ...overrides });

describe("groupWorkingOverviewThreads", () => {
  it("places threads in the sidebar's sections and leaves out archived and offline ones", () => {
    const offline = EnvironmentId.make("environment-offline");
    const visits = new Map([
      ["unseen-done", "2026-03-09T08:00:00.000Z"],
      ["seen-done", "2026-03-09T10:00:00.000Z"],
      ["old-unseen-done", "2026-03-07T08:00:00.000Z"],
    ]);

    const groups = groupWorkingOverviewThreads({
      threads: [
        thread("running", { runtime: runtime("running") }),
        thread("approval", { runtime: runtime("running"), hasPendingApprovals: true }),
        thread("unseen-done", { runtime: runtime("idle"), latestRun: completedRun }),
        thread("seen-done", { runtime: runtime("idle"), latestRun: completedRun }),
        thread("old-unseen-done", {
          runtime: runtime("idle"),
          latestRun: { ...completedRun, completedAt: "2026-03-07T09:05:00.000Z" },
        }),
        thread("old-done", {
          runtime: runtime("idle"),
          latestRun: { ...completedRun, completedAt: "2026-03-07T09:05:00.000Z" },
        }),
        thread("settled-today", {
          runtime: runtime("idle"),
          latestRun: completedRun,
          settledOverride: "settled",
          settledAt: "2026-03-09T11:00:00.000Z",
        }),
        thread("settled-but-stuck-waiting", {
          runtime: { ...runtime("running"), activeRunId: null },
          blockedOnThreadWait: true,
          settledOverride: "settled",
          settledAt: "2026-03-09T10:30:00.000Z",
        }),
        thread("settled-last-week", {
          runtime: runtime("idle"),
          latestRun: completedRun,
          settledOverride: "settled",
          settledAt: "2026-03-02T11:00:00.000Z",
        }),
        thread("snoozed-until-tonight", {
          runtime: runtime("idle"),
          latestRun: completedRun,
          snoozedAt: "2026-03-09T09:30:00.000Z",
          snoozedUntil: "2026-03-09T20:00:00.000Z",
        }),
        thread("snooze-expired", {
          runtime: runtime("idle"),
          latestRun: completedRun,
          snoozedAt: "2026-03-08T09:30:00.000Z",
          snoozedUntil: "2026-03-09T08:00:00.000Z",
        }),
        thread("archived", {
          runtime: runtime("running"),
          archivedAt: "2026-03-09T10:00:00.000Z",
        }),
        thread("offline", { environmentId: offline, runtime: runtime("running") }),
      ],
      delegatedUnderParent: new Set(),
      disconnectedEnvironmentIds: new Set([offline]),
      lastVisitedAt: (entry) => visits.get(entry.id),
      nowMs: NOW_MS,
    });

    const ids = (group: keyof typeof groups) => groups[group].map((entry) => entry.thread.id);
    expect(ids("inbox")).toEqual([
      "seen-done",
      "snooze-expired",
      "unseen-done",
      "old-done",
      "old-unseen-done",
      "approval",
    ]);
    expect(ids("working")).toEqual(["running"]);
    expect(ids("snoozed")).toEqual(["snoozed-until-tonight"]);
    expect(ids("settled")).toEqual([
      "settled-today",
      "settled-but-stuck-waiting",
      "settled-last-week",
    ]);
    expect(groups.inbox.find((entry) => entry.thread.id === "approval")?.status.label).toBe(
      "Pending Approval",
    );
    expect(groups.inbox.find((entry) => entry.thread.id === "seen-done")?.status).toBe(
      SEEN_COMPLETION_STATUS,
    );
  });

  it("nests active and recently finished subagents and delegated tasks, hiding idle ones", () => {
    const parentId = ThreadId.make("parent");
    const remote = EnvironmentId.make("environment-remote");
    const subagentLineage = {
      rootThreadId: parentId,
      parentThreadId: parentId,
      relationshipToParent: "subagent" as const,
    };
    const groups = groupWorkingOverviewThreads({
      threads: [
        thread("parent", { runtime: runtime("running") }),
        thread("explorer", { runtime: runtime("running"), lineage: subagentLineage }),
        thread("reviewer", { runtime: runtime("idle"), lineage: subagentLineage }),
        thread("finished-recently", {
          runtime: runtime("idle"),
          lineage: subagentLineage,
          latestRun: { ...completedRun, completedAt: "2026-03-09T11:30:00.000Z" },
        }),
        thread("finished-earlier", {
          runtime: runtime("idle"),
          lineage: subagentLineage,
          latestRun: { ...completedRun, completedAt: "2026-03-09T09:00:00.000Z" },
        }),
        thread("remote-task", {
          environmentId: remote,
          runtime: runtime("running"),
          delegatedFrom: {
            environmentId: EnvironmentId.make("environment-test"),
            threadId: parentId,
            title: "parent",
          },
        }),
      ],
      delegatedUnderParent: new Set([
        threadKey({ environmentId: remote, threadId: ThreadId.make("remote-task") }),
      ]),
      disconnectedEnvironmentIds: new Set(),
      lastVisitedAt: () => undefined,
      nowMs: NOW_MS,
    });

    expect(groups.working.map((entry) => entry.thread.id)).toEqual(["parent"]);
    expect(
      groups.working[0]?.children.map((child) => [child.thread.id, child.status?.label ?? null]),
    ).toEqual([
      ["finished-recently", "Completed"],
      ["explorer", "Working"],
      ["remote-task", "Working"],
    ]);
  });
});

describe("groupEntriesByProject", () => {
  it("follows the sidebar's project groups and keeps unknown projects last", () => {
    const environmentId = EnvironmentId.make("environment-test");
    const entry = (id: string, projectId: string) => ({
      thread: thread(id, { projectId: ProjectId.make(projectId) }),
      status: { label: "Working" as const, colorClass: "", dotClass: "", pulse: false },
      children: [],
    });
    const grouped = groupEntriesByProject(
      [entry("a", "web"), entry("b", "orphan"), entry("c", "api"), entry("d", "web-copy")],
      [
        {
          projectKey: "api",
          displayName: "api",
          memberProjectRefs: [{ environmentId, projectId: "api" }],
        },
        {
          projectKey: "web",
          displayName: "web",
          memberProjectRefs: [
            { environmentId, projectId: "web" },
            { environmentId, projectId: "web-copy" },
          ],
        },
      ],
    );

    expect(grouped.map((group) => [group.name, group.entries.map((e) => e.thread.id)])).toEqual([
      ["api", ["c"]],
      ["web", ["a", "d"]],
      [null, ["b"]],
    ]);
  });
});

describe("collectWorkingPullRequests", () => {
  it("lists each open pull request once, including subagents', with live threads first", () => {
    const link = (number: number, state: "open" | "merged", updatedAt: string) => ({
      number,
      url: `https://github.com/acme/web/pull/${number}`,
      snapshot: {
        state,
        title: `PR ${number}`,
        headBranch: `branch-${number}`,
        baseBranch: "main",
        isDraft: false,
        updatedAt,
        syncedAt: updatedAt,
      },
      stack: null,
    });
    const working = { label: "Working" as const, colorClass: "", dotClass: "", pulse: false };
    const entry = (
      id: string,
      pullRequests: ReadonlyArray<ReturnType<typeof link>>,
      children: ReadonlyArray<{
        id: string;
        pullRequests: ReadonlyArray<ReturnType<typeof link>>;
      }> = [],
    ) => ({
      thread: thread(id, { pullRequests: pullRequests as never }),
      status: working,
      children: children.map((child) => ({
        thread: thread(child.id, { pullRequests: child.pullRequests as never }),
        status: working,
      })),
    });
    const pullRequests = collectWorkingPullRequests({
      working: [
        entry(
          "live",
          [link(2, "open", "2026-03-09T08:00:00.000Z")],
          [{ id: "live-subagent", pullRequests: [link(4, "open", "2026-03-09T07:00:00.000Z")] }],
        ),
      ],
      snoozed: [],
      inbox: [
        {
          ...entry("done", [
            link(1, "open", "2026-03-09T11:00:00.000Z"),
            link(2, "open", "2026-03-09T11:00:00.000Z"),
            link(3, "merged", "2026-03-09T11:00:00.000Z"),
          ]),
          status: SEEN_COMPLETION_STATUS,
        },
      ],
      settled: [],
    });

    expect(
      pullRequests.map((pullRequest) => [
        pullRequest.link.number,
        pullRequest.thread.id,
        pullRequest.active,
      ]),
    ).toEqual([
      [2, "live", true],
      [4, "live-subagent", true],
      [1, "done", false],
    ]);
  });
});

describe("latestActivityLine", () => {
  const item = (ordinal: number, fields: Record<string, unknown>) =>
    ({ ordinal, ...fields }) as never;

  it("shows the last line of the agent's newest message and skips tool calls", () => {
    expect(
      latestActivityLine({
        turnItems: [
          item(1, { type: "assistant_message", text: "Looking.\n\nFound two failures.\n" }),
          item(3, { type: "command_execution", input: "vp test run src/cart.test.ts" }),
          item(2, { type: "reasoning", text: "Maybe the fixture is stale." }),
        ],
      }),
    ).toBe("Found two failures.");
    expect(
      latestActivityLine({ turnItems: [item(1, { type: "command_execution", input: "ls" })] }),
    ).toBeNull();
  });
});
