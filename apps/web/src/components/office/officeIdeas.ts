import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

/** An idea is a thread with this tag. Untagging it takes the idea off the whiteboard. */
export const IDEA_TAG = "idea";
const ISSUE_TAG_PREFIX = "issue:";
const MAX_TAG_LENGTH = 64;

export type IdeaThread = Pick<EnvironmentThreadShell, "latestRun" | "archivedAt" | "deletedAt"> & {
  readonly source: { readonly tags?: ReadonlyArray<string> | undefined };
};

export interface IssueRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/** Where an idea is: on the board, being interviewed, or filed as a GitHub issue. */
export type IdeaStage =
  | { readonly kind: "board" }
  | { readonly kind: "interviewing" }
  | { readonly kind: "filed"; readonly issue: IssueRef };

const tagsOf = (thread: IdeaThread) => thread.source.tags ?? [];

export function ideaStage(thread: IdeaThread): IdeaStage | null {
  if (thread.archivedAt !== null || thread.deletedAt !== null) return null;
  const tags = tagsOf(thread);
  if (!tags.includes(IDEA_TAG)) return null;
  const issue = tags.map(parseIssueTag).find((ref) => ref !== null) ?? null;
  if (issue) return { kind: "filed", issue };
  return thread.latestRun === null ? { kind: "board" } : { kind: "interviewing" };
}

/** An idea nobody has interviewed yet is a sticky note, not a cat. */
export const isIdeaOnBoard = (thread: IdeaThread) => ideaStage(thread)?.kind === "board";

/** The first GitHub issue link in an agent's reply, such as the one the interview files. */
export function findIssueLink(text: string): IssueRef | null {
  const match = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/.exec(text);
  return match ? { owner: match[1]!, repo: match[2]!, number: Number(match[3]) } : null;
}

/** The tag that remembers a filed issue, or null when it would not fit in a tag. */
export function issueTag(issue: IssueRef): string | null {
  const tag = `${ISSUE_TAG_PREFIX}${issue.owner}/${issue.repo}#${issue.number}`;
  return tag.length <= MAX_TAG_LENGTH ? tag : null;
}

function parseIssueTag(tag: string): IssueRef | null {
  const match = /^issue:([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(tag);
  return match ? { owner: match[1]!, repo: match[2]!, number: Number(match[3]) } : null;
}

export const issueUrl = (issue: IssueRef) =>
  `https://github.com/${issue.owner}/${issue.repo}/issues/${issue.number}`;

export const interviewPrompt = (idea: string) =>
  [
    "Interview me about this idea and turn it into a GitHub issue for this project.",
    "",
    `Idea: ${idea}`,
    "",
    "- Read the code you need, then ask me questions with your question tool until the scope is clear.",
    "- Then file the issue on this project's GitHub repository. I approve filing it: file it.",
    "- Do not edit files, write code, or open a pull request.",
    "- End your reply with the issue URL.",
  ].join("\n");

export const implementPrompt = (issue: IssueRef) =>
  `Implement GitHub issue ${issueUrl(issue)}.\n\nfull stop`;
