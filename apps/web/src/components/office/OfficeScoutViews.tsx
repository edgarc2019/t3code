import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThread,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  CommandId,
  ScheduledTaskId,
  type EnvironmentId,
  type ModelSelection,
  type ThreadId,
  type ThreadTag,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { ExternalLinkIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { newThreadId, randomUUID } from "~/lib/utils";
import { orchestrationEnvironment } from "../../state/orchestration";
import { serverEnvironment } from "../../state/server";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { filedTag, IDEA_TAG, type IdeaStage } from "./officeIdeas";
import {
  GOAL_TAG,
  isGoalThread,
  isScoutThread,
  issueKey,
  pendingFinds,
  SCOUT_EVERY_MS,
  SCOUT_TAG,
  scoutPrompt,
  scoutSeenTag,
  scoutTaskId,
  seenIssueKeys,
  templateThread,
  type ScoutFind,
} from "./officeScout";

const errorOf = <A, E>(result: AtomCommandResult<A, E>) => {
  if (result._tag !== "Failure") return null;
  const failure = squashAtomCommandFailure(result);
  return failure instanceof Error ? failure.message : "That didn't work.";
};

function useTagCommand() {
  const dispatch = useOrchestrationCommand(orchestrationEnvironment.v2.dispatchCommand);
  return (environmentId: EnvironmentId, threadId: ThreadId, tag: string, tagged: boolean) =>
    dispatch({
      environmentId,
      input: {
        type: "thread.tag.set",
        commandId: CommandId.make(randomUUID()),
        threadId,
        tag: tag as ThreadTag,
        tagged,
      },
    });
}

const byAge = (a: EnvironmentThreadShell, b: EnvironmentThreadShell) =>
  a.createdAt.localeCompare(b.createdAt);
const inProject = (thread: EnvironmentThreadShell, project: EnvironmentProject) =>
  thread.environmentId === project.environmentId && thread.projectId === project.id;

/**
 * The corkboard's Goals box. Goals are threads tagged `goal`; every change rewrites the project's
 * hourly Scout task with the new goals, and the last goal going pauses it.
 */
export function GoalsBox(props: {
  readonly project: EnvironmentProject;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly cheapModel: ModelSelection;
}) {
  const { project, threads } = props;
  const createThread = useOrchestrationCommand(threadEnvironment.create);
  const deleteThread = useOrchestrationCommand(threadEnvironment.delete);
  const setTag = useTagCommand();
  const upsertTask = useAtomCommand(serverEnvironment.upsertScheduledTask, {
    label: "scout task upsert",
  });
  const runTaskNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "scout first run",
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const goals = threads.filter((thread) => isGoalThread(thread) && inProject(thread, project));
  goals.sort(byAge);
  const scout = threads.filter((thread) => isScoutThread(thread) && inProject(thread, project));
  scout.sort(byAge);

  const step = async <A, E>(action: () => Promise<AtomCommandResult<A, E>>) => {
    const result = await action();
    const message = errorOf(result);
    if (message) setError(message);
    return message === null;
  };

  // Points the project's Scout task at the current goals, setting Scout up on the first goal.
  const syncScout = async (nextGoals: ReadonlyArray<string>) => {
    const template = templateThread(threads, project);
    if (!template) return false;
    let scoutThreadId = scout[0]?.id ?? null;
    const firstTime = scoutThreadId === null;
    if (scoutThreadId === null) {
      if (nextGoals.length === 0) return true;
      const threadId = newThreadId();
      const created = await step(() =>
        createThread({
          environmentId: project.environmentId,
          input: {
            threadId,
            projectId: project.id,
            title: `Scout: ${project.title}`,
            modelSelection: props.cheapModel,
            runtimeMode: template.runtimeMode,
            interactionMode: "default",
            branch: null,
            worktreePath: null,
          },
        }),
      );
      if (!created) return false;
      if (!(await step(() => setTag(project.environmentId, threadId, SCOUT_TAG, true)))) {
        await deleteThread({
          environmentId: project.environmentId,
          input: { threadId, onlyIfUnused: true },
        });
        return false;
      }
      scoutThreadId = threadId;
    }
    const id = ScheduledTaskId.make(scoutTaskId(project.id));
    const saved = await step(() =>
      upsertTask({
        environmentId: project.environmentId,
        input: {
          id,
          title: `Scout: ${project.title}`,
          prompt: scoutPrompt(nextGoals),
          enabled: nextGoals.length > 0,
          schedule: { type: "interval", everyMs: SCOUT_EVERY_MS },
          projectId: project.id,
          threadId: scoutThreadId,
          workspaceStrategy: { type: "root" },
          modelSelection: props.cheapModel,
          runtimeMode: template.runtimeMode,
          interactionMode: "default",
          creationSource: "web",
        },
      }),
    );
    // The first check runs now, so Scout doesn't wait an hour to bring anything back.
    if (saved && firstTime) {
      await step(() => runTaskNow({ environmentId: project.environmentId, input: { id } }));
    }
    return saved;
  };

  const add = async () => {
    const goal = text.trim();
    if (!goal) return;
    if (!templateThread(threads, project)) {
      setError("Start one thread in this project first, so Scout knows how it may run.");
      return;
    }
    setBusy(true);
    setError(null);
    const threadId = newThreadId();
    const created = await step(() =>
      createThread({
        environmentId: project.environmentId,
        input: {
          threadId,
          projectId: project.id,
          title: goal,
          modelSelection: props.cheapModel,
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
        },
      }),
    );
    const tagged =
      created && (await step(() => setTag(project.environmentId, threadId, GOAL_TAG, true)));
    if (created && !tagged) {
      await deleteThread({
        environmentId: project.environmentId,
        input: { threadId, onlyIfUnused: true },
      });
    }
    if (tagged) {
      setText("");
      await syncScout([...goals.map((thread) => thread.title), goal]);
    }
    setBusy(false);
  };

  const remove = async (goal: EnvironmentThreadShell) => {
    setBusy(true);
    setError(null);
    if (await step(() => setTag(goal.environmentId, goal.id, GOAL_TAG, false))) {
      await deleteThread({
        environmentId: goal.environmentId,
        input: { threadId: goal.id, onlyIfUnused: true },
      });
      await syncScout(
        goals.filter((thread) => thread.id !== goal.id).map((thread) => thread.title),
      );
    }
    setBusy(false);
  };

  return (
    <section aria-label="Goals" className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Goals</span>
        <span className="text-xs text-muted-foreground">
          {goals.length > 0
            ? "Scout checks this project's new GitHub issues against these every hour. Pause him in Settings → Scheduled tasks."
            : "Add a goal and Scout checks this project's new GitHub issues for it every hour."}
        </span>
      </div>
      {goals.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {goals.map((goal) => (
            <li
              key={goal.id}
              className="flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 ps-2.5 pe-1 text-xs"
            >
              {goal.title}
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove goal ${goal.title}`}
                disabled={busy}
                onClick={() => void remove(goal)}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <Input
          size="sm"
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          placeholder="New goal, one line"
          aria-label="New goal"
          maxLength={120}
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy || !text.trim()}>
          Add goal
        </Button>
      </form>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}

const scoutDetailsAtom = Atom.family((keys: string) =>
  Atom.make((get) =>
    (JSON.parse(keys) as ReadonlyArray<readonly [EnvironmentId, ThreadId]>).map(
      ([environmentId, threadId]) =>
        get(environmentThreadDetails.threadAtom(scopeThreadRef(environmentId, threadId))),
    ),
  ).pipe(Atom.withLabel(`office-scout-details:${keys}`)),
);

export interface ScoutCarry {
  readonly scout: EnvironmentThreadShell;
  readonly find: ScoutFind;
}

/** Every issue Scout is carrying across projects, minus the ones kept, dropped or already an idea. */
export function useScoutCarrying(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  ideas: ReadonlyArray<{ readonly stage: IdeaStage }>,
): ReadonlyArray<ScoutCarry> {
  const scouts = threads.filter(isScoutThread);
  const details: ReadonlyArray<EnvironmentThread | null> = useAtomValue(
    scoutDetailsAtom(JSON.stringify(scouts.map((thread) => [thread.environmentId, thread.id]))),
  );
  const filed = ideas.flatMap(({ stage }) =>
    stage.kind === "filed" && stage.ref.kind === "github" ? [issueKey(stage.ref)] : [],
  );
  return scouts.flatMap((scout, index) => {
    const replies =
      details[index]?.projection.turnItems.flatMap((item) =>
        item.type === "assistant_message" && !item.streaming ? [item.text] : [],
      ) ?? [];
    const hidden = new Set([...seenIssueKeys(scout.source.tags ?? []), ...filed]);
    return pendingFinds(replies, hidden).map((find) => ({ scout, find }));
  });
}

/**
 * Scout's popover: each issue he brought, with Keep (a Filed idea, ready to Implement) and Drop.
 * Both are remembered as tags on his thread, so an issue never comes back.
 */
export function ScoutFinds(props: {
  readonly carrying: ReadonlyArray<ScoutCarry>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly hasGoals: boolean;
}) {
  const createThread = useOrchestrationCommand(threadEnvironment.create);
  const deleteThread = useOrchestrationCommand(threadEnvironment.delete);
  const setTag = useTagCommand();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remember = async ({ scout, find }: ScoutCarry, kind: "kept" | "dropped") => {
    const tag = scoutSeenTag(kind, find);
    if (!tag) return "That issue's link is too long to remember.";
    return errorOf(await setTag(scout.environmentId, scout.id, tag, true));
  };

  const keep = async (carry: ScoutCarry) => {
    const { scout, find } = carry;
    const project = props.projects.find(
      (candidate) =>
        candidate.environmentId === scout.environmentId && candidate.id === scout.projectId,
    );
    const template = project ? templateThread(props.threads, project) : null;
    const issueTag = filedTag({
      kind: "github",
      owner: find.owner,
      repo: find.repo,
      number: find.number,
    });
    if (!project || !template || !issueTag) {
      return "This issue can't become an idea here.";
    }
    const threadId = newThreadId();
    const created = errorOf(
      await createThread({
        environmentId: scout.environmentId,
        input: {
          threadId,
          projectId: scout.projectId,
          title: find.title,
          modelSelection: template.modelSelection,
          runtimeMode: template.runtimeMode,
          interactionMode: "default",
          branch: null,
          worktreePath: null,
        },
      }),
    );
    if (created) return created;
    // The issue tag goes on first, so the thread is never an unfiled idea that needs an interview.
    const tagged =
      errorOf(await setTag(scout.environmentId, threadId, issueTag, true)) ??
      errorOf(await setTag(scout.environmentId, threadId, IDEA_TAG, true));
    if (tagged) {
      await deleteThread({
        environmentId: scout.environmentId,
        input: { threadId, onlyIfUnused: true },
      });
      return tagged;
    }
    // A filed idea already hides the issue, so a failed tag here can't bring it back twice.
    return remember(carry, "kept");
  };

  const act = async (carry: ScoutCarry, action: "keep" | "drop") => {
    setBusy(true);
    setError(null);
    setError(await (action === "keep" ? keep(carry) : remember(carry, "dropped")));
    setBusy(false);
  };

  if (props.carrying.length === 0 && !props.hasGoals) {
    return (
      <p className="text-sm">
        Scout fetches new GitHub issues that match your goals. Add goals on the corkboard (click the
        whiteboard) and he checks each project every hour.
      </p>
    );
  }
  if (props.carrying.length === 0) {
    return (
      <p className="text-sm">
        No new issues match your goals. Scout checks every hour; pause him in Settings → Scheduled
        tasks.
      </p>
    );
  }
  return (
    <div className="flex max-h-80 flex-col gap-2 overflow-y-auto text-sm">
      {props.carrying.map((carry) => (
        <div
          key={`${carry.scout.environmentId}:${issueKey(carry.find)}`}
          className="flex flex-col gap-1 rounded-md border p-2"
        >
          <a
            href={carry.find.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-start gap-1 font-medium hover:underline"
          >
            <span className="min-w-0 flex-1">{carry.find.title}</span>
            <ExternalLinkIcon className="mt-0.5 size-3 shrink-0" />
          </a>
          <span className="text-xs text-muted-foreground">
            {carry.find.repo}#{carry.find.number} · matches “{carry.find.goal}”
          </span>
          <div className="flex gap-1">
            <Button size="xs" disabled={busy} onClick={() => void act(carry, "keep")}>
              Keep
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => void act(carry, "drop")}
            >
              Drop
            </Button>
          </div>
        </div>
      ))}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
