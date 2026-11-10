import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  buildPendingUserInputAnswers,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ThreadPendingUserInput } from "@t3tools/client-runtime/state/thread-requests";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { useQuietThreadProjection } from "../../state/entities";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { catFurFor, OfficeCatAvatar, type CatPose } from "./OfficeArt";
import { currentTodoProgress, type OfficeCat } from "./officeLayout";

/** What the popover shows when a cat is clicked: the plan, and the question when it asks one. */
export function OfficeCatDetails(props: {
  readonly cat: OfficeCat<EnvironmentThreadShell>;
  readonly pose: CatPose;
  readonly projectTitle: string | null;
  readonly parentTitle: string | null;
  readonly onClose: () => void;
}) {
  const { thread } = props.cat;
  const ref = scopeThreadRef(thread.environmentId, thread.id);
  const structure = useQuietThreadProjection(ref);
  const pending = useAtomValue(environmentThreadDetails.pendingRequestsAtom(ref));
  const navigate = useNavigate();
  const progress = structure ? currentTodoProgress(structure.projection.plans) : null;
  const question = pending?.userInputs[0] ?? null;
  const latest = thread.source.latestVisibleMessage;
  const summary =
    latest && latest.role === "assistant" ? latest.text.replace(/\s+/g, " ").trim() : null;

  const openThread = () => {
    props.onClose();
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };

  return (
    <div className="flex w-full flex-col gap-3 text-sm">
      <div className="flex items-start gap-3">
        <OfficeCatAvatar fur={catFurFor(props.cat.key)} pose={props.pose} size={40} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-snug">{thread.title}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {props.projectTitle ? <Badge variant="outline">{props.projectTitle}</Badge> : null}
            {props.parentTitle ? (
              <Badge variant="outline">kitten of {props.parentTitle}</Badge>
            ) : null}
            <Badge variant={statusVariant(props.cat)}>{statusLabel(props.cat)}</Badge>
          </div>
        </div>
      </div>

      {summary ? <p className="line-clamp-4 text-muted-foreground">{summary}</p> : null}

      {progress ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Plan {progress.done}/{progress.steps.length}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-success"
                style={{ width: `${(100 * progress.done) / progress.steps.length}%` }}
              />
            </span>
          </div>
          <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto">
            {progress.steps.map((step) => (
              <li
                key={step.id}
                className={cn(
                  "flex items-start gap-2 leading-snug",
                  step.status === "completed" && "text-muted-foreground",
                  step.status === "running" && "font-medium",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full border",
                    step.status === "completed" && "border-success bg-success text-background",
                    step.status === "running" && "border-primary",
                    step.status === "pending" && "border-muted-foreground",
                  )}
                >
                  {step.status === "completed" ? <CheckIcon className="size-2.5" /> : null}
                </span>
                {step.text}
              </li>
            ))}
          </ul>
        </div>
      ) : structure ? (
        <p className="text-xs text-muted-foreground">No todo list in this thread yet.</p>
      ) : (
        <p className="text-xs text-muted-foreground">Loading plan…</p>
      )}

      {question ? (
        <OfficeQuestion
          key={question.requestId}
          environmentId={thread.environmentId}
          threadId={thread.id}
          input={question}
          onAnswered={props.onClose}
        />
      ) : (pending?.approvals.length ?? 0) > 0 ? (
        <p className="rounded-md border border-warning/40 bg-warning/8 p-2 text-xs">
          Waiting for you to approve an action. Open the thread to approve or deny it.
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={openThread}>
          Open thread
        </Button>
      </div>
    </div>
  );
}

function statusLabel(cat: OfficeCat<EnvironmentThreadShell>) {
  if (cat.needsYou) return "needs you";
  if (cat.working) return "working";
  return cat.zone === "lounge" ? "settled" : "on break";
}

function statusVariant(cat: OfficeCat<EnvironmentThreadShell>) {
  if (cat.needsYou) return "warning" as const;
  if (cat.working) return "info" as const;
  return cat.zone === "lounge" ? ("success" as const) : ("secondary" as const);
}

/** Answers a question with its offered options; anything else is answered in the thread. */
function OfficeQuestion(props: {
  readonly environmentId: EnvironmentThreadShell["environmentId"];
  readonly threadId: EnvironmentThreadShell["id"];
  readonly input: ThreadPendingUserInput;
  readonly onAnswered: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const respond = useOrchestrationCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const answerable =
    props.input.responseCapability !== "not_resumable" &&
    props.input.questions.every((question) => question.options.length > 0);
  const answers = buildPendingUserInputAnswers(props.input.questions, drafts);

  const send = async () => {
    if (!answers || sending) return;
    setSending(true);
    setError(null);
    const result = await respond({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, requestId: props.input.requestId, answers },
    });
    setSending(false);
    if (result._tag === "Success") {
      props.onAnswered();
    } else if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Couldn't send the answer.");
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      {props.input.questions.map((question) => (
        <div key={question.id} className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {question.header}
          </div>
          <div className="font-medium leading-snug">{question.question}</div>
          {answerable
            ? question.options.map((option) => {
                const value = option.value ?? option.label;
                const selected =
                  drafts[question.id]?.selectedOptionValues?.includes(value) === true;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setDrafts((current) => ({
                        ...current,
                        [question.id]: togglePendingUserInputOptionSelection(
                          question,
                          current[question.id],
                          value,
                        ),
                      }))
                    }
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-left transition-colors hover:bg-accent",
                      selected && "border-primary ring-1 ring-primary",
                    )}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    {option.description && option.description !== option.label ? (
                      <span className="block text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </button>
                );
              })
            : null}
        </div>
      ))}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {answerable ? (
        <div className="flex justify-end">
          <Button size="sm" disabled={!answers || sending} onClick={() => void send()}>
            {sending ? "Sending…" : "Send answer"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          This question needs a typed answer. Open the thread to reply.
        </p>
      )}
    </div>
  );
}
