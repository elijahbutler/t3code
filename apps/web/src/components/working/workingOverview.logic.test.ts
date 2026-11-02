import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import { groupWorkingOverviewThreads } from "./workingOverview.logic";

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

describe("groupWorkingOverviewThreads", () => {
  it("groups live threads by what they need and leaves out quiet, archived, and offline ones", () => {
    const thread = (id: string, overrides: Parameters<typeof makeThreadFixture>[0] = {}) =>
      makeThreadFixture({ id: ThreadId.make(id), ...overrides });
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
});
