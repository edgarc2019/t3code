import type { EnvironmentId, OrchestrationV2PlanArtifact, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  boatVerifyRoute,
  currentTodoProgress,
  layoutOffice,
  type OfficeThread,
} from "./officeLayout";

const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString();

function thread(id: string, overrides: Partial<OfficeThread> = {}): OfficeThread {
  return {
    environmentId: "env-1" as EnvironmentId,
    id: id as ThreadId,
    createdAt: ago(48),
    updatedAt: ago(1),
    archivedAt: null,
    deletedAt: null,
    runtime: null,
    hasPendingUserInput: false,
    hasPendingApprovals: false,
    settledOverride: null,
    settledAt: null,
    lineage: { parentThreadId: null, relationshipToParent: null } as OfficeThread["lineage"],
    ...overrides,
  };
}

const running = { status: "running", activeRunId: "run-1" } as OfficeThread["runtime"];
const kittenOf = (parent: string) =>
  ({ parentThreadId: parent, relationshipToParent: "subagent" }) as OfficeThread["lineage"];
/** Threads created in list order, so desks fill in that order. */
const inOrder = (...threads: Array<OfficeThread>) =>
  threads.map((entry, index) => ({ ...entry, createdAt: ago(48 - index) }));
const ids = (cats: ReadonlyArray<{ thread: OfficeThread }>) => cats.map((cat) => cat.thread.id);

describe("layoutOffice", () => {
  it("seats each thread by its state", () => {
    const layout = layoutOffice(
      inOrder(
        thread("working", { runtime: running }),
        thread("asking", { hasPendingUserInput: true }),
        thread("approval", { hasPendingApprovals: true, updatedAt: ago(50) }),
        thread("idle"),
        thread("idle-old", { updatedAt: ago(30) }),
        thread("settled", { settledOverride: "settled", settledAt: ago(2) }),
        thread("settled-old", { settledOverride: "settled", settledAt: ago(30) }),
        thread("archived", { runtime: running, archivedAt: ago(1) }),
      ),
      NOW,
    );

    expect(ids(layout.desks)).toEqual(["working", "asking", "approval"]);
    expect(ids(layout.breakRoom)).toEqual(["idle"]);
    expect(ids(layout.lounge)).toEqual(["settled"]);
    expect(ids(layout.needsYou)).toEqual(["approval", "asking"]);
  });

  it("keeps a parent at its desk beside its working subagents and drops the rest", () => {
    const layout = layoutOffice(
      inOrder(
        thread("parent", { runtime: running }),
        thread("kitten-working", { runtime: running, lineage: kittenOf("parent") }),
        thread("kitten-asking", { hasPendingUserInput: true, lineage: kittenOf("parent") }),
        thread("kitten-done", { lineage: kittenOf("parent") }),
        thread("orphan", { runtime: running, lineage: kittenOf("gone") }),
        thread("waiting-on-kittens", { settledOverride: "settled", settledAt: ago(30) }),
        thread("delegate", { runtime: running, lineage: kittenOf("waiting-on-kittens") }),
      ),
      NOW,
    );

    expect(ids(layout.desks)).toEqual(["parent", "waiting-on-kittens"]);
    expect(ids(layout.desks[0]!.kittens)).toEqual(["kitten-working", "kitten-asking"]);
    expect(ids(layout.desks[1]!.kittens)).toEqual(["delegate"]);
    expect(layout.desks[1]!.working).toBe(false);
    expect(ids(layout.needsYou)).toEqual(["kitten-asking"]);
    expect(ids(layout.breakRoom)).toEqual([]);
    expect(ids(layout.lounge)).toEqual([]);
  });
});

describe("currentTodoProgress", () => {
  const todoList = (status: string, texts: Array<[string, string]>) =>
    ({
      kind: "todo_list",
      status,
      steps: texts.map(([text, stepStatus], index) => ({
        id: `s${index}`,
        text,
        status: stepStatus,
      })),
    }) as unknown as OrchestrationV2PlanArtifact;

  it("reads the latest live todo list and its current step", () => {
    const progress = currentTodoProgress([
      todoList("active", [["old", "running"]]),
      todoList("active", [
        ["Read", "completed"],
        ["Build", "running"],
        ["Ship", "pending"],
      ]),
      todoList("superseded", [["dropped", "pending"]]),
    ]);

    expect(progress?.done).toBe(1);
    expect(progress?.steps).toHaveLength(3);
    expect(progress?.current?.text).toBe("Build");
  });

  it("has no progress without a todo list", () => {
    expect(currentTodoProgress([])).toBeNull();
  });
});

describe("boatVerifyRoute", () => {
  const gate = "node ~/.agents/skills/boat-verify/scripts/verify.mjs affected abc123";

  it("reads the route boat-verify announces", () => {
    expect(boatVerifyRoute(gate, "verify: remote (load average 46.4 above 28 cores)\n…")).toBe(
      "remote",
    );
    expect(boatVerifyRoute(gate, "\u001b[0mverify: local (boat CLI missing)")).toBe("local");
    expect(boatVerifyRoute(gate, "noise\nverify: local (queue empty)")).toBe("local");
    expect(boatVerifyRoute(gate, "  verify: remote, said the log")).toBeNull();
    expect(boatVerifyRoute(gate, "")).toBeNull();
  });

  it("trusts a forced route over the output", () => {
    const forced = "node ~/.agents/skills/boat-verify/scripts/verify.mjs --remote affected abc";
    expect(boatVerifyRoute(forced, "")).toBe("remote");
    expect(boatVerifyRoute(forced.replace("--remote", "--local"), "verify: remote")).toBe("local");
    expect(boatVerifyRoute(`${gate} --remote`, "")).toBeNull();
  });
});
