import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import { groupEntriesByProject, groupWorkingOverviewThreads } from "./workingOverview.logic";

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

const thread = (id: string, overrides: Parameters<typeof makeThreadFixture>[0] = {}) =>
  makeThreadFixture({ id: ThreadId.make(id), ...overrides });

describe("groupWorkingOverviewThreads", () => {
  it("groups live threads by what they need and leaves out quiet, archived, and offline ones", () => {
    const offline = EnvironmentId.make("environment-offline");
    const visits = new Map([
      ["unseen-done", "2026-03-09T08:00:00.000Z"],
      ["seen-done", "2026-03-09T10:00:00.000Z"],
    ]);

    const groups = groupWorkingOverviewThreads({
      threads: [
        thread("running", { runtime: runtime("running") }),
        thread("approval", { runtime: runtime("running"), hasPendingApprovals: true }),
        thread("unseen-done", { runtime: runtime("idle"), latestRun: completedRun }),
        thread("seen-done", { runtime: runtime("idle"), latestRun: completedRun }),
        thread("archived", {
          runtime: runtime("running"),
          archivedAt: "2026-03-09T10:00:00.000Z",
        }),
        thread("offline", { environmentId: offline, runtime: runtime("running") }),
      ],
      delegatedUnderParent: new Set(),
      disconnectedEnvironmentIds: new Set([offline]),
      lastVisitedAt: (entry) => visits.get(entry.id),
    });

    const ids = (group: keyof typeof groups) => groups[group].map((entry) => entry.thread.id);
    expect(ids("needs-you")).toEqual(["approval"]);
    expect(ids("working")).toEqual(["running"]);
    expect(ids("finished")).toEqual(["unseen-done"]);
    expect(groups["needs-you"][0]?.status.label).toBe("Pending Approval");
  });

  it("nests subagents under their parent with their own status", () => {
    const parentId = ThreadId.make("parent");
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
      ],
      delegatedUnderParent: new Set(),
      disconnectedEnvironmentIds: new Set(),
      lastVisitedAt: () => undefined,
    });

    expect(groups.working.map((entry) => entry.thread.id)).toEqual(["parent"]);
    expect(
      groups.working[0]?.children.map((child) => [child.thread.id, child.status?.label ?? null]),
    ).toEqual([
      ["explorer", "Working"],
      ["reviewer", null],
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
