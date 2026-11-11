import { buildPendingUserInputAnswers } from "@t3tools/client-runtime/state/pending-user-input";
import type { ThreadUserInputQuestion } from "@t3tools/client-runtime/state/thread-requests";
import { describe, expect, it } from "vite-plus/test";

import { canAnswerInOffice, questionWantsTypedAnswer } from "./officeRequests";

function question(overrides: Partial<ThreadUserInputQuestion> = {}): ThreadUserInputQuestion {
  return {
    id: "q1",
    header: "Name",
    question: "What should the cat be called?",
    options: [],
    multiSelect: false,
    ...overrides,
  };
}

const option = { label: "Mochi", description: "A round cat" };

describe("canAnswerInOffice", () => {
  it("answers a question that needs a typed answer", () => {
    const typed = question();
    expect(questionWantsTypedAnswer(typed)).toBe(true);
    expect(canAnswerInOffice({ questions: [typed], responseCapability: "live" })).toBe(true);
    expect(buildPendingUserInputAnswers([typed], { q1: { customAnswer: " Biscuit " } })).toEqual({
      q1: "Biscuit",
    });
  });

  it("still answers questions with options by picking one", () => {
    const picked = question({ options: [option] });
    expect(questionWantsTypedAnswer(picked)).toBe(false);
    expect(canAnswerInOffice({ questions: [picked], responseCapability: "live" })).toBe(true);
  });

  it("sends the user to the thread when an answer can't be given here", () => {
    const noTyping = question({ allowCustomAnswer: false });
    expect(canAnswerInOffice({ questions: [noTyping], responseCapability: "live" })).toBe(false);
    expect(
      canAnswerInOffice({ questions: [question()], responseCapability: "not_resumable" }),
    ).toBe(false);
  });
});
