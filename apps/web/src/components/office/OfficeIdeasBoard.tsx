import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { CommandId, type EnvironmentId, type ThreadTag } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { newMessageId, newThreadId, randomUUID } from "~/lib/utils";
import { useProjects, useThreadProjection, useThreadShells } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  IDEA_TAG,
  ideaStage,
  implementPrompt,
  interviewPrompt,
  findIssueLink,
  issueTag,
  issueUrl,
  type IdeaStage,
} from "./officeIdeas";

export interface OfficeIdea {
  readonly thread: EnvironmentThreadShell;
  readonly stage: IdeaStage;
}

/**
 * Every idea thread, hidden-tag ones included: a user who hides `idea` threads from the sidebar
 * still sees them on the whiteboard.
 */
export function useOfficeIdeas(): ReadonlyArray<OfficeIdea> {
  return useThreadShells()
    .flatMap((thread) => {
      const stage = ideaStage(thread);
      return stage ? [{ thread, stage }] : [];
    })
    .toSorted((a, b) => a.thread.createdAt.localeCompare(b.thread.createdAt));
}

/** The newest thread in the project sets the model and access an idea's agents run with. */
function templateThread(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  project: EnvironmentProject,
): EnvironmentThreadShell | null {
  const inEnvironment = threads.filter((thread) => thread.environmentId === project.environmentId);
  const newest = (list: ReadonlyArray<EnvironmentThreadShell>) =>
    list.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  return (
    newest(inEnvironment.filter((thread) => thread.projectId === project.id)) ??
    newest(inEnvironment)
  );
}

const ideaTag = IDEA_TAG as ThreadTag;

export function OfficeIdeasBoard(props: {
  readonly ideas: ReadonlyArray<OfficeIdea>;
  readonly onClose: () => void;
}) {
  const projects = useProjects();
  const threads = useThreadShells();
  const navigate = useNavigate();
  const createThread = useOrchestrationCommand(threadEnvironment.create);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn);
  const deleteThread = useOrchestrationCommand(threadEnvironment.delete);
  const dispatch = useOrchestrationCommand(orchestrationEnvironment.v2.dispatchCommand);
  const [text, setText] = useState("");
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyOf = (project: EnvironmentProject) => `${project.environmentId}:${project.id}`;
  const newestThread = threads.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const recentProject = newestThread
    ? projects.find(
        (candidate) =>
          candidate.environmentId === newestThread.environmentId &&
          candidate.id === newestThread.projectId,
      )
    : undefined;
  const project =
    projects.find((candidate) => keyOf(candidate) === projectKey) ?? recentProject ?? projects[0];
  const projectTitle = (thread: EnvironmentThreadShell) =>
    projects.find(
      (candidate) =>
        candidate.environmentId === thread.environmentId && candidate.id === thread.projectId,
    )?.title ?? null;

  const run = async <A, E>(action: () => Promise<AtomCommandResult<A, E>>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "That didn't work.");
      return false;
    }
    return true;
  };
  const setIdeaTag = (
    environmentId: EnvironmentId,
    thread: EnvironmentThreadShell,
    tagged: boolean,
  ) =>
    dispatch({
      environmentId,
      input: {
        type: "thread.tag.set",
        commandId: CommandId.make(randomUUID()),
        threadId: thread.id,
        tag: ideaTag,
        tagged,
      },
    });
  const openThread = (thread: EnvironmentThreadShell) => {
    props.onClose();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  };

  const add = async () => {
    const title = text.trim();
    if (!title || !project) return;
    const template = templateThread(threads, project);
    if (!template) {
      setError("Start one thread in this project first, so the idea knows which model to use.");
      return;
    }
    const threadId = newThreadId();
    const created = await run(() =>
      createThread({
        environmentId: project.environmentId,
        input: {
          threadId,
          projectId: project.id,
          title,
          modelSelection: template.modelSelection,
          runtimeMode: template.runtimeMode,
          interactionMode: "default",
          branch: null,
          worktreePath: null,
        },
      }),
    );
    if (!created) return;
    const tagged = await run(() =>
      dispatch({
        environmentId: project.environmentId,
        input: {
          type: "thread.tag.set",
          commandId: CommandId.make(randomUUID()),
          threadId,
          tag: ideaTag,
          tagged: true,
        },
      }),
    );
    if (tagged) {
      setText("");
      return;
    }
    // An untagged empty thread is not an idea; drop it so a retry does not leave strays behind.
    await deleteThread({
      environmentId: project.environmentId,
      input: { threadId, onlyIfUnused: true },
    });
  };

  const interview = async (thread: EnvironmentThreadShell) => {
    const started = await run(() =>
      startTurn({
        environmentId: thread.environmentId,
        input: {
          threadId: thread.id,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: interviewPrompt(thread.title),
            attachments: [],
          },
          runtimeMode: thread.runtimeMode,
          interactionMode: "default",
        },
      }),
    );
    if (started) openThread(thread);
  };

  const implement = async (thread: EnvironmentThreadShell, stage: IdeaStage) => {
    if (stage.kind !== "filed") return;
    // Take the idea off the board first, so a failed untag can never launch a second implementer.
    if (!(await run(() => setIdeaTag(thread.environmentId, thread, false)))) return;
    const threadId = newThreadId();
    const title = `Implement #${stage.issue.number}: ${thread.title}`;
    const started = await run(() =>
      startTurn({
        environmentId: thread.environmentId,
        input: {
          threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: implementPrompt(stage.issue),
            attachments: [],
          },
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: "default",
          bootstrap: {
            createThread: {
              projectId: thread.projectId,
              title,
              modelSelection: thread.modelSelection,
              runtimeMode: thread.runtimeMode,
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              createdAt: new Date().toISOString(),
            },
          },
        },
      }),
    );
    if (!started) {
      await setIdeaTag(thread.environmentId, thread, true);
      return;
    }
    props.onClose();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, threadId)),
    });
  };

  // Removing takes the idea off the board. An idea nobody touched is an empty thread, so it is
  // deleted too; one that ran, even from another device just now, stays a normal thread.
  const remove = async (thread: EnvironmentThreadShell, stage: IdeaStage) => {
    if (!(await run(() => setIdeaTag(thread.environmentId, thread, false)))) return;
    if (stage.kind === "board") {
      await run(() =>
        deleteThread({
          environmentId: thread.environmentId,
          input: { threadId: thread.id, onlyIfUnused: true },
        }),
      );
    }
  };

  const section = (title: string, list: ReadonlyArray<OfficeIdea>) =>
    list.length === 0 ? null : (
      <div className="flex flex-col gap-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        {list.map(({ thread, stage }) => (
          <div
            key={`${thread.environmentId}:${thread.id}`}
            className="flex items-center gap-2 py-1"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{thread.title}</div>
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                {projectTitle(thread) ? <span>{projectTitle(thread)}</span> : null}
                {stage.kind === "filed" ? (
                  <a
                    href={issueUrl(stage.issue)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-primary hover:underline"
                  >
                    {stage.issue.owner}/{stage.issue.repo}#{stage.issue.number}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                ) : null}
              </div>
            </div>
            {stage.kind === "board" ? (
              <Button size="xs" disabled={busy} onClick={() => void interview(thread)}>
                Interview
              </Button>
            ) : stage.kind === "interviewing" ? (
              <Button size="xs" variant="outline" onClick={() => openThread(thread)}>
                Open
              </Button>
            ) : (
              <Button size="xs" disabled={busy} onClick={() => void implement(thread, stage)}>
                Implement
              </Button>
            )}
            <Button
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => void remove(thread, stage)}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
    );

  const byStage = (kind: IdeaStage["kind"]) =>
    props.ideas.filter((idea) => idea.stage.kind === kind);

  return (
    <div className="flex w-full flex-col gap-3 text-sm">
      <div>
        <div className="font-semibold">Ideas</div>
        <p className="text-xs text-muted-foreground">
          One line each. Interview turns an idea into a GitHub issue; Implement hands the issue to a
          new agent.
        </p>
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <Input
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          placeholder="New idea, one line"
          aria-label="New idea"
          maxLength={200}
        />
        <div className="flex items-center gap-2">
          {projects.length > 1 && project ? (
            <Select
              value={keyOf(project)}
              onValueChange={(next) => (typeof next === "string" ? setProjectKey(next) : null)}
            >
              <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Project for the idea">
                <SelectValue>{project.title}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {projects.map((candidate) => (
                  <SelectItem key={keyOf(candidate)} value={keyOf(candidate)}>
                    {candidate.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {project?.title ?? "No project yet"}
            </span>
          )}
          <Button type="submit" size="sm" disabled={busy || !text.trim() || !project}>
            Add idea
          </Button>
        </div>
      </form>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {props.ideas.length === 0 ? (
        <p className="text-xs text-muted-foreground">No ideas yet.</p>
      ) : (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {section("On the board", byStage("board"))}
          {section("Interviewing", byStage("interviewing"))}
          {section("Filed", byStage("filed"))}
        </div>
      )}
    </div>
  );
}

/**
 * Remembers the issue an interview filed, as a tag on its thread, so the idea stays filed after the
 * conversation moves on. Thread summaries carry no reply text, so each interview being watched
 * opens its own thread; only interviews still waiting for an issue are watched.
 */
export function IdeaIssueWatcher(props: { readonly ideas: ReadonlyArray<OfficeIdea> }) {
  return props.ideas.map(({ thread, stage }) =>
    stage.kind === "interviewing" ? (
      <IdeaIssueProbe key={`${thread.environmentId}:${thread.id}`} thread={thread} />
    ) : null,
  );
}

const ISSUE_TAG_RETRY_MS = 10_000;

function IdeaIssueProbe(props: { readonly thread: EnvironmentThreadShell }) {
  const { thread } = props;
  const detail = useThreadProjection(scopeThreadRef(thread.environmentId, thread.id));
  const dispatch = useOrchestrationCommand(orchestrationEnvironment.v2.dispatchCommand);
  const written = useRef<string | null>(null);
  const issue =
    detail?.projection.turnItems
      .flatMap((item) =>
        item.type === "assistant_message" && !item.streaming ? [findIssueLink(item.text)] : [],
      )
      .findLast((ref) => ref !== null) ?? null;
  const tag = issue ? issueTag(issue) : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes a thread tag to the server once per filed issue, retrying until it lands; no React state is synced
  useEffect(() => {
    if (tag === null || written.current === tag) return;
    let cancelled = false;
    let timer: number | undefined;
    const attempt = () =>
      void dispatch({
        environmentId: thread.environmentId,
        input: {
          type: "thread.tag.set",
          commandId: CommandId.make(randomUUID()),
          threadId: thread.id,
          tag: tag as ThreadTag,
          tagged: true,
        },
      }).then((result) => {
        if (cancelled) return;
        if (result._tag === "Success") written.current = tag;
        else timer = window.setTimeout(attempt, ISSUE_TAG_RETRY_MS);
      });
    attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dispatch, tag, thread.environmentId, thread.id]);
  return null;
}
