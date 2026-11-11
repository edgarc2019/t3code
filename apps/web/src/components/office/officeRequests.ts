import type {
  ThreadPendingUserInput,
  ThreadUserInputQuestion,
} from "@t3tools/client-runtime/state/thread-requests";

/** A question without options is answered by typing, unless the agent forbids a typed answer. */
export function questionWantsTypedAnswer(
  question: Pick<ThreadUserInputQuestion, "options" | "allowCustomAnswer">,
): boolean {
  return question.options.length === 0 && question.allowCustomAnswer !== false;
}

/** The cat popover can answer a live question when every part is picked from options or typed. */
export function canAnswerInOffice(
  input: Pick<ThreadPendingUserInput, "questions" | "responseCapability">,
): boolean {
  return (
    input.responseCapability !== "not_resumable" &&
    input.questions.every(
      (question) => question.options.length > 0 || questionWantsTypedAnswer(question),
    )
  );
}
