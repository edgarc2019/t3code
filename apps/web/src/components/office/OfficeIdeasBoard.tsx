import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  threadRuntimeIsActive,
  type EnvironmentProject,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  CommandId,
  type EnvironmentId,
  type OrchestrationV2PlanArtifact,
  type PlanId,
  type ProjectReadFileResult,
  type ThreadTag,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { newMessageId, newThreadId, randomUUID } from "~/lib/utils";
import { useProjects, useThreadProjection, useThreadShells } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { resolveAppModelSelectionState } from "../../modelSelection";
import { useEnvironmentSettings } from "../../hooks/useSettings";

import { useEnvironmentProviders, usePrimaryEnvironmentId } from "../../state/environments";
import { OFFICE_PALETTE_CLASS } from "./OfficeArt";
import {
  CONNECT_TAG,
  connectPrompt,
  domainOf,
  domainTagChanges,
  IDEA_TAG,
  ideaStage,
  isConnectThread,
  parseDomainAssignments,
  coversTag,
  filedLabel,
  filedTag,
  filedUrl,
  filingOfRun,
  IDEA_TRACKERS,
  implementPrompt,
  interviewPrompt,
  parseBundledIdeas,
  type IdeaTracker,
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

/** A T3 spec: the active proposed plan on an idea's thread. */
interface ProposedSpec {
  readonly id: PlanId;
  readonly markdown: string;
}

const activeSpecOf = (plans: ReadonlyArray<OrchestrationV2PlanArtifact>): ProposedSpec | null => {
  const plan = plans.findLast(
    (candidate) => candidate.kind === "proposed_plan" && candidate.status === "active",
  );
  return plan?.kind === "proposed_plan" ? { id: plan.id, markdown: plan.markdown } : null;
};

// The tracker is a per-device choice per project, so it lives in this browser's storage.
const trackerStorageKey = (projectKey: string) => `t3.office.ideaTracker.${projectKey}`;
const trackerListeners = new Set<() => void>();

// Kept in memory too, so a choice sticks for this session when storage is unavailable.
const chosenTrackers = new Map<string, IdeaTracker>();

function readIdeaTracker(projectKey: string): IdeaTracker {
  const chosen = chosenTrackers.get(projectKey);
  if (chosen) return chosen;
  try {
    const stored = window.localStorage.getItem(trackerStorageKey(projectKey));
    return IDEA_TRACKERS.some((option) => option.id === stored)
      ? (stored as IdeaTracker)
      : "github";
  } catch {
    return "github";
  }
}

function writeIdeaTracker(projectKey: string, tracker: IdeaTracker) {
  chosenTrackers.set(projectKey, tracker);
  try {
    window.localStorage.setItem(trackerStorageKey(projectKey), tracker);
  } catch {
    // Storage can be unavailable (private mode); the in-memory choice lasts until reload.
  }
  for (const listener of trackerListeners) listener();
}

function subscribeIdeaTracker(listener: () => void) {
  trackerListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    trackerListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function useIdeaTracker(projectKey: string | null): IdeaTracker {
  return useSyncExternalStore(subscribeIdeaTracker, () =>
    projectKey === null ? "github" : readIdeaTracker(projectKey),
  );
}

/** Implement for a T3 spec reads the plan off the idea's thread, so only these stickies open it. */
function ImplementSpecButton(props: {
  readonly thread: EnvironmentThreadShell;
  readonly disabled: boolean;
  readonly onImplement: (spec: ProposedSpec) => void;
}) {
  const detail = useThreadProjection(scopeThreadRef(props.thread.environmentId, props.thread.id));
  const spec = detail ? activeSpecOf(detail.projection.plans) : null;
  return (
    <Button
      size="xs"
      disabled={props.disabled || spec === null}
      onClick={() => (spec ? props.onImplement(spec) : null)}
    >
      Implement
    </Button>
  );
}

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
  const setInteractionMode = useOrchestrationCommand(threadEnvironment.setInteractionMode);
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
  // Connect runs are light, so they use the cheap model T3 already uses for titles.
  const tracker = useIdeaTracker(project ? keyOf(project) : null);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const settingsEnvironmentId = (project?.environmentId ??
    primaryEnvironmentId ??
    "") as EnvironmentId;
  const environmentSettings = useEnvironmentSettings(settingsEnvironmentId);
  const providers = useEnvironmentProviders().get(settingsEnvironmentId) ?? [];
  const cheapModel = resolveAppModelSelectionState(environmentSettings, providers);
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

  // Ideas on the same red string that nobody has interviewed yet; the interview offers to fold them in.
  const linkedIdeas = (thread: EnvironmentThreadShell) => {
    const domain = domainOf(thread);
    if (domain === null) return [];
    return props.ideas
      .filter(
        ({ thread: other, stage }) =>
          other.id !== thread.id &&
          other.environmentId === thread.environmentId &&
          other.projectId === thread.projectId &&
          stage.kind === "board" &&
          domainOf(other) === domain,
      )
      .map(({ thread: other }) => ({ id: other.id, title: other.title }));
  };

  const interview = async (thread: EnvironmentThreadShell) => {
    // A turn's interaction mode does not switch an existing thread, so a T3 spec interview puts
    // its thread in plan mode first, the way the chat's mode toggle does.
    if (
      tracker === "t3" &&
      !(await run(() =>
        setInteractionMode({
          environmentId: thread.environmentId,
          input: { threadId: thread.id, interactionMode: "plan" },
        }),
      ))
    ) {
      return;
    }
    const started = await run(() =>
      startTurn({
        environmentId: thread.environmentId,
        input: {
          threadId: thread.id,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: interviewPrompt(thread.title, tracker, linkedIdeas(thread)),
            attachments: [],
          },
          runtimeMode: thread.runtimeMode,
          // A T3 spec is the interview's proposed plan, so that interview runs in plan mode.
          interactionMode: tracker === "t3" ? "plan" : "default",
        },
      }),
    );
    if (started) openThread(thread);
  };

  const implement = async (
    thread: EnvironmentThreadShell,
    stage: IdeaStage,
    spec: ProposedSpec | null,
  ) => {
    if (stage.kind !== "filed") return;
    if (stage.ref.kind === "t3" && spec === null) {
      setError("This idea's spec isn't loaded yet. Try again in a moment.");
      return;
    }
    // Take the idea off the board first, so a failed untag can never launch a second implementer.
    if (!(await run(() => setIdeaTag(thread.environmentId, thread, false)))) return;
    const threadId = newThreadId();
    const title = `Implement ${stage.ref.kind === "t3" ? "spec" : filedLabel(stage.ref)}: ${thread.title}`;
    // Create, then start: only a plain start carries the plan reference that marks a spec done.
    const created = await run(() =>
      createThread({
        environmentId: thread.environmentId,
        input: {
          threadId,
          projectId: thread.projectId,
          title,
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: "default",
          branch: null,
          worktreePath: null,
        },
      }),
    );
    const started =
      created &&
      (await run(() =>
        startTurn({
          environmentId: thread.environmentId,
          input: {
            threadId,
            message: {
              messageId: newMessageId(),
              role: "user",
              text: implementPrompt(stage.ref, spec?.markdown ?? null),
              attachments: [],
            },
            // Marks the spec implemented; the server checks it is still active and in this project.
            ...(spec ? { sourceProposedPlan: { threadId: thread.id, planId: spec.id } } : {}),
            runtimeMode: thread.runtimeMode,
            interactionMode: "default",
          },
        }),
      ));
    if (!started) {
      if (created) {
        await deleteThread({
          environmentId: thread.environmentId,
          input: { threadId, onlyIfUnused: true },
        });
      }
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

  const { data: glossary, error: glossaryError } = useEnvironmentQuery<
    ProjectReadFileResult,
    unknown
  >(
    project
      ? projectEnvironment.readFile({
          environmentId: project.environmentId,
          input: { cwd: project.workspaceRoot, relativePath: "GLOSSARY.md", allowMissing: true },
        })
      : null,
  );
  const projectIdeas = props.ideas.filter(
    ({ thread }) =>
      project !== undefined &&
      thread.environmentId === project.environmentId &&
      thread.projectId === project.id,
  );
  const connecting = project
    ? threads.find(
        (thread) =>
          isConnectThread(thread) &&
          thread.environmentId === project.environmentId &&
          thread.projectId === project.id &&
          thread.archivedAt === null &&
          thread.deletedAt === null &&
          thread.settledOverride !== "settled",
      )
    : undefined;

  const connect = async () => {
    if (!project || projectIdeas.length < 2) return;
    const template = templateThread(threads, project);
    if (!template) return;
    const threadId = newThreadId();
    const created = await run(() =>
      createThread({
        environmentId: project.environmentId,
        input: {
          threadId,
          projectId: project.id,
          title: `Connect the dots: ${project.title}`,
          modelSelection: cheapModel,
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
          tag: CONNECT_TAG as ThreadTag,
          tagged: true,
        },
      }),
    );
    if (!tagged) {
      await deleteThread({
        environmentId: project.environmentId,
        input: { threadId, onlyIfUnused: true },
      });
      return;
    }
    const started = await run(() =>
      startTurn({
        environmentId: project.environmentId,
        input: {
          threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: connectPrompt(
              projectIdeas.map(({ thread }) => thread),
              glossary?.exists === false ? null : glossary?.contents.trim() || null,
            ),
            attachments: [],
          },
          runtimeMode: template.runtimeMode,
          interactionMode: "default",
        },
      }),
    );
    // A connect thread that never started would block the button; drop it.
    if (!started) {
      await deleteThread({
        environmentId: project.environmentId,
        input: { threadId, onlyIfUnused: true },
      });
    }
  };

  const actions = ({ thread, stage }: OfficeIdea) => (
    <div className="flex flex-wrap items-center gap-1">
      {stage.kind === "board" ? (
        <Button size="xs" disabled={busy} onClick={() => void interview(thread)}>
          Interview
        </Button>
      ) : stage.kind === "interviewing" ? (
        <Button size="xs" variant="outline" onClick={() => openThread(thread)}>
          Open
        </Button>
      ) : stage.kind === "filed" && stage.ref.kind === "t3" ? (
        <ImplementSpecButton
          thread={thread}
          disabled={busy}
          onImplement={(spec) => void implement(thread, stage, spec)}
        />
      ) : (
        <Button size="xs" disabled={busy} onClick={() => void implement(thread, stage, null)}>
          Implement
        </Button>
      )}
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => void remove(thread, stage)}>
        Remove
      </Button>
    </div>
  );

  return (
    <div className="flex w-full flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-2 pe-8">
        {projects.length > 1 && project ? (
          <Select
            value={keyOf(project)}
            onValueChange={(next) => (typeof next === "string" ? setProjectKey(next) : null)}
          >
            <SelectTrigger size="sm" className="w-56" aria-label="Project">
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
          <span className="font-medium">{project?.title ?? "No project yet"}</span>
        )}
        {project ? (
          <Select
            value={tracker}
            onValueChange={(next) =>
              typeof next === "string"
                ? writeIdeaTracker(keyOf(project), next as IdeaTracker)
                : null
            }
          >
            <SelectTrigger size="sm" className="w-44" aria-label="Where interviews file">
              <SelectValue>
                {IDEA_TRACKERS.find((option) => option.id === tracker)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {IDEA_TRACKERS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        <span className="flex-1" />
        {connecting ? (
          <Button size="sm" variant="outline" onClick={() => openThread(connecting)}>
            Connecting the dots…
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={
              busy || projectIdeas.length < 2 || (glossary === null && glossaryError === null)
            }
            onClick={() => void connect()}
          >
            Connect the dots
          </Button>
        )}
      </div>
      <form
        className="flex items-center gap-2"
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
        <Button type="submit" size="sm" disabled={busy || !text.trim() || !project}>
          Add idea
        </Button>
      </form>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {glossaryError ? (
        <p className="text-xs text-muted-foreground">
          Couldn&apos;t read GLOSSARY.md ({glossaryError}), so Connect the dots works without it.
        </p>
      ) : null}
      {projectIdeas.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">No ideas for this project yet.</p>
      ) : (
        <Corkboard ideas={projectIdeas} renderActions={actions} />
      )}
    </div>
  );
}

const STICKY_W = 176;
const STICKY_H = 124;
const PANEL_PAD = 16;
const PANEL_TOP = 36;
const STICKY_FILLS = [
  "var(--office-fur-orange)",
  "var(--office-floor-break)",
  "var(--office-rug)",
  "var(--office-fur-cream)",
];

const hashOf = (value: string) => {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
};

/** Stickies zigzag down two columns; the string runs pin to pin in that order. */
const stickyAt = (index: number) => ({
  x: PANEL_PAD + (index % 2) * (STICKY_W + 24),
  y: PANEL_TOP + Math.floor(index / 2) * (STICKY_H + 20) + (index % 2) * 28,
});

/** One cork panel per domain, red string through its stickies; unsorted ideas get no string. */
function Corkboard(props: {
  readonly ideas: ReadonlyArray<OfficeIdea>;
  readonly renderActions: (idea: OfficeIdea) => ReactNode;
}) {
  const clusters = new Map<string | null, Array<OfficeIdea>>();
  for (const idea of props.ideas) {
    const domain = domainOf(idea.thread);
    clusters.set(domain, [...(clusters.get(domain) ?? []), idea]);
  }
  const ordered = [...clusters.entries()].toSorted(
    ([a, aIdeas], [b, bIdeas]) =>
      (a === null ? 1 : 0) - (b === null ? 1 : 0) ||
      bIdeas.length - aIdeas.length ||
      (a ?? "").localeCompare(b ?? ""),
  );
  const panelWidth = PANEL_PAD * 2 + STICKY_W * 2 + 24;
  return (
    <div
      className={`grid gap-4 rounded-lg p-4 sm:grid-cols-2 ${OFFICE_PALETTE_CLASS}`}
      style={{ background: "var(--office-cork)" }}
    >
      {ordered.map(([domain, ideas]) => {
        const rows = Math.ceil(ideas.length / 2);
        const height = PANEL_TOP + rows * (STICKY_H + 20) + (ideas.length > 1 ? 28 : 0) + 8;
        const pins = ideas.map((_, index) => {
          const at = stickyAt(index);
          return { x: at.x + STICKY_W / 2, y: at.y + 8 };
        });
        return (
          <section
            key={domain ?? "unsorted"}
            aria-label={domain ? `Domain ${domain}` : "Not connected yet"}
            className="relative overflow-x-auto rounded-md border border-dashed border-border/70"
            style={{ minHeight: height }}
          >
            <div className="absolute left-3 top-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {domain ?? "Not connected yet"}
            </div>
            <div className="relative" style={{ width: panelWidth, height }}>
              {ideas.map((idea, index) => {
                const at = stickyAt(index);
                const tilt = (hashOf(idea.thread.id) % 5) - 2;
                return (
                  <article
                    key={`${idea.thread.environmentId}:${idea.thread.id}`}
                    className="absolute flex flex-col justify-between gap-1 rounded-sm p-2 pt-4 text-foreground shadow-md"
                    style={{
                      left: at.x,
                      top: at.y,
                      width: STICKY_W,
                      height: STICKY_H,
                      background:
                        STICKY_FILLS[hashOf(domain ?? idea.thread.id) % STICKY_FILLS.length],
                      transform: `rotate(${tilt * 0.6}deg)`,
                    }}
                  >
                    <div className="line-clamp-2 text-xs font-medium leading-snug">
                      {idea.thread.title}
                    </div>
                    {idea.stage.kind === "filed" ? (
                      <div className="flex min-w-0 flex-col">
                        {filedUrl(idea.stage.ref) ? (
                          <a
                            href={filedUrl(idea.stage.ref) ?? undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 truncate text-2xs text-primary hover:underline"
                          >
                            {filedLabel(idea.stage.ref)}
                            <ExternalLinkIcon className="size-3" />
                          </a>
                        ) : (
                          <span className="text-2xs font-medium text-success">
                            {filedLabel(idea.stage.ref)}
                          </span>
                        )}
                        {idea.stage.covers.length > 0 ? (
                          <span className="truncate text-2xs text-muted-foreground">
                            also covers: {idea.stage.covers.join(", ")}
                          </span>
                        ) : null}
                      </div>
                    ) : idea.stage.kind === "interviewing" ? (
                      <span className="text-2xs text-muted-foreground">interviewing</span>
                    ) : null}
                    {props.renderActions(idea)}
                  </article>
                );
              })}
              <svg
                className="pointer-events-none absolute inset-0"
                width={panelWidth}
                height={height}
                aria-hidden
              >
                {domain !== null
                  ? pins.slice(1).map((pin, index) => {
                      const from = pins[index]!;
                      const midX = (from.x + pin.x) / 2;
                      const midY = Math.max(from.y, pin.y) + 22;
                      return (
                        <path
                          key={`string-${pin.x}-${pin.y}`}
                          d={`M${from.x} ${from.y} Q${midX} ${midY} ${pin.x} ${pin.y}`}
                          fill="none"
                          stroke="var(--destructive)"
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                      );
                    })
                  : null}
                {pins.map((pin) => (
                  <circle
                    key={`pin-${pin.x}-${pin.y}`}
                    cx={pin.x}
                    cy={pin.y}
                    r={4.5}
                    fill="var(--destructive)"
                    stroke="var(--office-line)"
                    strokeWidth={0.8}
                  />
                ))}
              </svg>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Records what an interview filed once its run finishes: a GitHub link in its reply, or
 * its proposed plan for a T3 spec. Folded-in ideas leave the board first (their titles saved as
 * `covers:` tags), then the filed tag goes on, which is what marks the interview done. Thread
 * summaries carry no reply text, so each interview being watched opens its own thread.
 */
export function IdeaIssueWatcher(props: { readonly ideas: ReadonlyArray<OfficeIdea> }) {
  return props.ideas.map(({ thread, stage }) =>
    stage.kind === "interviewing" ? (
      <IdeaFiledProbe
        key={`${thread.environmentId}:${thread.id}`}
        thread={thread}
        ideas={props.ideas}
      />
    ) : null,
  );
}

const FILED_RETRY_MS = 10_000;

interface FilingResult {
  readonly filedTag: string | null;
  readonly folded: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly unused: boolean;
  }>;
}

function IdeaFiledProbe(props: {
  readonly thread: EnvironmentThreadShell;
  readonly ideas: ReadonlyArray<OfficeIdea>;
}) {
  const { thread } = props;
  const detail = useThreadProjection(scopeThreadRef(thread.environmentId, thread.id));
  const dispatch = useOrchestrationCommand(orchestrationEnvironment.v2.dispatchCommand);
  const deleteThread = useOrchestrationCommand(threadEnvironment.delete);
  const written = useRef<string | null>(null);

  const runId = thread.latestRun?.runId ?? null;
  const detailRun = detail?.projection.runs.find((candidate) => candidate.id === runId);
  const finished = detailRun !== undefined && FINISHED_RUN_STATUSES.has(detailRun.status);
  const filing =
    finished && detail && runId !== null
      ? filingOfRun(
          runId,
          detail.projection.turnItems.flatMap((item) =>
            item.type === "assistant_message" && !item.streaming
              ? [{ runId: item.runId, text: item.text }]
              : [],
          ),
          detail.projection.plans.flatMap((plan) =>
            plan.kind === "proposed_plan"
              ? [{ runId: plan.runId, status: plan.status, markdown: plan.markdown }]
              : [],
          ),
        )
      : null;
  const candidates = props.ideas.filter(
    ({ thread: other, stage }) =>
      other.id !== thread.id &&
      other.environmentId === thread.environmentId &&
      other.projectId === thread.projectId &&
      stage.kind === "board",
  );
  const result: FilingResult | null =
    filing === null
      ? null
      : {
          filedTag: filedTag(filing.ref),
          folded: parseBundledIdeas(
            filing.text,
            candidates.map(({ thread: other }) => other.id),
          ).map((id) => {
            const other = candidates.find(({ thread: candidate }) => candidate.id === id)!.thread;
            return { id, title: other.title, unused: other.latestRun === null };
          }),
        };
  // Folding removes ideas from the board, which would change this result mid-apply; the first
  // result for a run is kept until it has been written.
  const [frozen, setFrozen] = useState<{ readonly runId: string; readonly key: string } | null>(
    null,
  );
  if (result !== null && runId !== null && frozen?.runId !== runId) {
    setFrozen({ runId, key: JSON.stringify(result) });
  }
  const resultKey = frozen !== null && frozen.runId === runId ? frozen.key : null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the filing to the server (folded ideas, then the filed tag), retrying until it lands; no React state is synced
  useEffect(() => {
    if (resultKey === null || written.current === resultKey) return;
    const filing = JSON.parse(resultKey) as FilingResult;
    let cancelled = false;
    let timer: number | undefined;
    const setTag = (threadId: string, tag: string, tagged: boolean) =>
      dispatch({
        environmentId: thread.environmentId,
        input: {
          type: "thread.tag.set",
          commandId: CommandId.make(randomUUID()),
          threadId: threadId as EnvironmentThreadShell["id"],
          tag: tag as ThreadTag,
          tagged,
        },
      });
    const attempt = async () => {
      const steps: Array<() => Promise<{ readonly _tag: string }>> = [
        ...filing.folded.map((idea) => () => setTag(thread.id, coversTag(idea.title), true)),
        ...filing.folded.map((idea) => () => setTag(idea.id, IDEA_TAG, false)),
        ...filing.folded
          .filter((idea) => idea.unused)
          .map(
            (idea) => () =>
              deleteThread({
                environmentId: thread.environmentId,
                input: { threadId: idea.id as EnvironmentThreadShell["id"], onlyIfUnused: true },
              }),
          ),
        ...(filing.filedTag ? [() => setTag(thread.id, filing.filedTag!, true)] : []),
      ];
      for (const step of steps) {
        const outcome = await step();
        if (cancelled) return;
        if (outcome._tag !== "Success") {
          timer = window.setTimeout(() => void attempt(), FILED_RETRY_MS);
          return;
        }
      }
      written.current = resultKey;
    };
    void attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deleteThread, dispatch, resultKey, thread.environmentId, thread.id]);
  return null;
}

const CONNECT_RETRY_MS = 10_000;
const FINISHED_RUN_STATUSES = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);

/**
 * Applies a finished "Connect the dots" run: reads its domains block, writes each idea's
 * `domain:` tag, then settles the run so it is applied once. Unsettled runs are the ones left.
 */
export function ConnectWatcher(props: { readonly ideas: ReadonlyArray<OfficeIdea> }) {
  const runs = useThreadShells().filter(
    (thread) =>
      isConnectThread(thread) &&
      thread.archivedAt === null &&
      thread.deletedAt === null &&
      thread.settledOverride !== "settled" &&
      thread.latestRun !== null &&
      !threadRuntimeIsActive(thread.runtime),
  );
  return runs.map((run) => (
    <ConnectProbe
      key={`${run.environmentId}:${run.id}`}
      run={run}
      ideas={props.ideas.filter(
        ({ thread }) =>
          thread.environmentId === run.environmentId && thread.projectId === run.projectId,
      )}
    />
  ));
}

function ConnectProbe(props: {
  readonly run: EnvironmentThreadShell;
  readonly ideas: ReadonlyArray<OfficeIdea>;
}) {
  const { run } = props;
  const detail = useThreadProjection(scopeThreadRef(run.environmentId, run.id));
  const dispatch = useOrchestrationCommand(orchestrationEnvironment.v2.dispatchCommand);
  const settle = useOrchestrationCommand(threadEnvironment.settle);
  // The summary can say the run ended before the thread detail has its final reply, so wait until
  // the detail itself shows that run finished. A run that ended with no usable reply settles empty.
  const runId = run.latestRun?.runId ?? null;
  const detailRun = detail?.projection.runs.find((candidate) => candidate.id === runId);
  const finished = detailRun !== undefined && FINISHED_RUN_STATUSES.has(detailRun.status);
  const reply = finished
    ? detail?.projection.turnItems.findLast(
        (item) => item.type === "assistant_message" && item.runId === runId && !item.streaming,
      )
    : undefined;
  const replyText = finished ? (reply?.type === "assistant_message" ? reply.text : "") : null;
  const ideaTags = props.ideas.map(({ thread }) => ({
    id: thread.id as string,
    tags: thread.source.tags ?? [],
  }));
  const changes =
    replyText === null
      ? null
      : domainTagChanges(
          ideaTags,
          parseDomainAssignments(
            replyText,
            ideaTags.map((idea) => idea.id),
          ),
        );
  const changesKey = changes === null ? null : JSON.stringify(changes);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the run's domain tags and settles it on the server, retrying until both land; no React state is synced
  useEffect(() => {
    if (changesKey === null) return;
    const pending = JSON.parse(changesKey) as ReadonlyArray<{
      readonly threadId: string;
      readonly tag: string;
      readonly tagged: boolean;
    }>;
    let cancelled = false;
    let timer: number | undefined;
    const attempt = async () => {
      for (const change of pending) {
        const result = await dispatch({
          environmentId: run.environmentId,
          input: {
            type: "thread.tag.set",
            commandId: CommandId.make(randomUUID()),
            threadId: change.threadId as EnvironmentThreadShell["id"],
            tag: change.tag as ThreadTag,
            tagged: change.tagged,
          },
        });
        if (cancelled) return;
        if (result._tag !== "Success") {
          timer = window.setTimeout(() => void attempt(), CONNECT_RETRY_MS);
          return;
        }
      }
      const settled = await settle({
        environmentId: run.environmentId,
        input: { threadId: run.id },
      });
      if (!cancelled && settled._tag !== "Success") {
        timer = window.setTimeout(() => void attempt(), CONNECT_RETRY_MS);
      }
    };
    void attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [changesKey, dispatch, settle, run.environmentId, run.id]);
  return null;
}
