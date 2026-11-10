import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isListedThreadLineage,
  type OrchestrationV2PlanArtifact,
  type OrchestrationV2PlanStep,
} from "@t3tools/contracts";

/** Idle and settled cats leave the office a day after their thread last changed. */
const OFFICE_RECENT_MS = 24 * 60 * 60 * 1000;

export type OfficeZone = "desk" | "breakRoom" | "lounge";

export type OfficeThread = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "id"
  | "createdAt"
  | "updatedAt"
  | "archivedAt"
  | "deletedAt"
  | "runtime"
  | "hasPendingUserInput"
  | "hasPendingApprovals"
  | "settledOverride"
  | "settledAt"
  | "lineage"
>;

export interface OfficeCat<T extends OfficeThread> {
  readonly key: string;
  readonly thread: T;
  readonly zone: OfficeZone;
  readonly working: boolean;
  readonly needsYou: boolean;
  /** Subagent threads still working or asking, drawn beside this cat. */
  readonly kittens: ReadonlyArray<OfficeCat<T>>;
}

export interface OfficeLayout<T extends OfficeThread> {
  readonly desks: ReadonlyArray<OfficeCat<T>>;
  readonly breakRoom: ReadonlyArray<OfficeCat<T>>;
  readonly lounge: ReadonlyArray<OfficeCat<T>>;
  /** Every cat waiting on the user, kittens included, oldest first. */
  readonly needsYou: ReadonlyArray<OfficeCat<T>>;
}

const keyOf = (thread: Pick<OfficeThread, "environmentId" | "id">) =>
  `${thread.environmentId}:${thread.id}`;

const isListed = (thread: OfficeThread) => isListedThreadLineage(thread.lineage);

/**
 * Where each thread's cat sits. Running or waiting threads take a desk; finished
 * threads drink coffee in the break room until settled, then nap in the lounge.
 * Working subagent threads are kittens at their parent's desk; the rest stay out of the office.
 */
export function layoutOffice<T extends OfficeThread>(
  threads: ReadonlyArray<T>,
  nowMs: number,
): OfficeLayout<T> {
  const recent = (iso: string | null) => iso !== null && nowMs - Date.parse(iso) < OFFICE_RECENT_MS;
  const sorted = threads
    .filter((thread) => thread.archivedAt === null && thread.deletedAt === null)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const place = (thread: T): Omit<OfficeCat<T>, "kittens"> | null => {
    const needsYou = thread.hasPendingUserInput || thread.hasPendingApprovals;
    const working = threadRuntimeIsActive(thread.runtime);
    const base = { key: keyOf(thread), thread, working, needsYou };
    if (needsYou || working) return { ...base, zone: "desk" };
    if (thread.settledOverride === "settled") {
      return recent(thread.settledAt ?? thread.updatedAt) ? { ...base, zone: "lounge" } : null;
    }
    return recent(thread.updatedAt) ? { ...base, zone: "breakRoom" } : null;
  };

  const listed = sorted.filter(isListed);
  const listedKeys = new Set(listed.map(keyOf));
  const kittensByParent = new Map<string, Array<OfficeCat<T>>>();
  for (const thread of sorted) {
    if (isListed(thread)) continue;
    const cat = place(thread);
    const parentKey = `${thread.environmentId}:${thread.lineage.parentThreadId}`;
    if (!cat || cat.zone !== "desk" || !listedKeys.has(parentKey)) continue;
    const list = kittensByParent.get(parentKey) ?? [];
    list.push({ ...cat, kittens: [] });
    kittensByParent.set(parentKey, list);
  }

  const cats = listed.flatMap((thread): Array<OfficeCat<T>> => {
    const cat = place(thread);
    const kittens = kittensByParent.get(keyOf(thread)) ?? [];
    // A parent whose subagents still work keeps its desk, even after its own turn ends.
    if (kittens.length > 0) {
      const base = cat ?? { key: keyOf(thread), thread, working: false, needsYou: false };
      return [{ ...base, zone: "desk", kittens }];
    }
    return cat ? [{ ...cat, kittens: [] }] : [];
  });
  const needsYou = cats
    .flatMap((cat) => [cat, ...cat.kittens])
    .filter((cat) => cat.needsYou)
    .toSorted((a, b) => a.thread.updatedAt.localeCompare(b.thread.updatedAt));
  return {
    desks: cats.filter((cat) => cat.zone === "desk"),
    breakRoom: cats.filter((cat) => cat.zone === "breakRoom"),
    lounge: cats.filter((cat) => cat.zone === "lounge"),
    needsYou,
  };
}

export interface TodoProgress {
  readonly steps: ReadonlyArray<OrchestrationV2PlanStep>;
  readonly done: number;
  /** The running step, else the next pending one. */
  readonly current: OrchestrationV2PlanStep | null;
}

/** The thread's latest todo list, the one the server keeps in full. */
export function currentTodoProgress(
  plans: ReadonlyArray<OrchestrationV2PlanArtifact>,
): TodoProgress | null {
  const plan = plans.findLast(
    (candidate) => candidate.kind === "todo_list" && candidate.status !== "superseded",
  );
  if (plan?.kind !== "todo_list" || plan.steps.length === 0) return null;
  return {
    steps: plan.steps,
    done: plan.steps.filter((step) => step.status === "completed").length,
    current:
      plan.steps.find((step) => step.status === "running") ??
      plan.steps.find((step) => step.status === "pending") ??
      null,
  };
}

const BOAT_VERIFY_SCRIPT = "boat-verify/scripts/verify.mjs";

export const isBoatVerifyCommand = (command: string | undefined) =>
  command !== undefined && command.includes(BOAT_VERIFY_SCRIPT);

/**
 * Where a `boat-verify` gate runs: a forced `--remote` or `--local` in the command, else the
 * route its first output line announces, such as `verify: remote (load …)`. Null while unknown,
 * which is always the case for a background command whose output is not streamed.
 */
export function boatVerifyRoute(command: string, output: string): "remote" | "local" | null {
  const forced = /boat-verify\/scripts\/verify\.mjs\s+--(remote|local)\b/.exec(command);
  if (forced) return forced[1] as "remote" | "local";
  // Terminal colour codes come off before matching.
  const match = /^verify: (remote|local)\b/m.exec(output.replaceAll(/\u001b\[[0-9;]*m/g, ""));
  return match ? (match[1] as "remote" | "local") : null;
}
