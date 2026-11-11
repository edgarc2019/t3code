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

/** A "Connect the dots" run is a thread with this tag; it is neither an idea nor a cat. */
export const CONNECT_TAG = "idea-connect";
const DOMAIN_TAG_PREFIX = "domain:";
const MAX_DOMAIN_LENGTH = 40;

export const isConnectThread = (thread: IdeaThread) => tagsOf(thread).includes(CONNECT_TAG);

/** The domain a connect run gave this idea, if any. */
export function domainOf(thread: IdeaThread): string | null {
  const tag = tagsOf(thread).find((candidate) => candidate.startsWith(DOMAIN_TAG_PREFIX));
  return tag ? tag.slice(DOMAIN_TAG_PREFIX.length) : null;
}

/** The short id a connect run uses to name an idea. */
const shortIdeaId = (threadId: string) => threadId.slice(0, 8);

const domainSlug = (raw: string) =>
  raw
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, MAX_DOMAIN_LENGTH);

const MAX_GLOSSARY_CHARS = 6_000;

/** The glossary goes into the prompt, so a small model never has to find and open it. */
export const connectPrompt = (
  ideas: ReadonlyArray<{ readonly id: string; readonly title: string }>,
  glossary: string | null,
) =>
  [
    "Sort these one-line ideas for this project into the project's domain areas. Do not edit files, write code, or open anything on GitHub.",
    "",
    glossary
      ? "1. The project's glossary is below. Its areas are the project's domains."
      : "1. The project has no GLOSSARY.md. Skim the top-level folders to learn its domain areas.",
    "2. Give every idea exactly one domain: a short lowercase name such as `quoting` or `broker-portal`. When the glossary names areas, use only those names, picking the area whose description covers the idea. Ideas about the same area must share a name.",
    "3. End your reply with this block, one line per idea, using the ids below:",
    "",
    "```domains",
    "<id>: <domain>",
    "```",
    "",
    "Ideas:",
    ...ideas.map((idea) => `- ${shortIdeaId(idea.id)} ${idea.title}`),
    ...(glossary ? ["", "GLOSSARY.md:", "", glossary.slice(0, MAX_GLOSSARY_CHARS)] : []),
  ].join("\n");

/**
 * The domains a connect run's reply assigns, keyed by idea thread id. Reads the last
 * ```domains block, or the whole reply when it has none; lines naming an unknown idea are ignored.
 */
export function parseDomainAssignments(
  reply: string,
  ideaIds: ReadonlyArray<string>,
): ReadonlyMap<string, string> {
  const blocks = [...reply.matchAll(/```domains\s*\n([\s\S]*?)```/g)];
  // Small models sometimes drop the fence; then any `<id>: <domain>` line in the reply counts.
  const block = blocks.at(-1)?.[1] ?? reply;
  const assignments = new Map<string, string>();
  for (const line of block.split("\n")) {
    const match = /^\s*[-*]?\s*([0-9a-f]{8})\s*:\s*(.+?)\s*$/i.exec(line);
    if (!match) continue;
    const id = ideaIds.find((candidate) => shortIdeaId(candidate) === match[1]!.toLowerCase());
    const domain = domainSlug(match[2]!);
    if (id && domain) assignments.set(id, domain);
  }
  return assignments;
}

/**
 * The tag writes that make each idea carry exactly its new domain. An idea the run did not
 * mention keeps what it has, so an empty or broken reply never wipes the board.
 */
export function domainTagChanges(
  ideas: ReadonlyArray<{ readonly id: string; readonly tags: ReadonlyArray<string> }>,
  assignments: ReadonlyMap<string, string>,
): ReadonlyArray<{ readonly threadId: string; readonly tag: string; readonly tagged: boolean }> {
  return ideas.flatMap((idea) => {
    const domain = assignments.get(idea.id);
    if (domain === undefined) return [];
    const wanted = `${DOMAIN_TAG_PREFIX}${domain}`;
    const stale = idea.tags
      .filter((tag) => tag.startsWith(DOMAIN_TAG_PREFIX) && tag !== wanted)
      .map((tag) => ({ threadId: idea.id, tag, tagged: false }));
    return idea.tags.includes(wanted)
      ? stale
      : [...stale, { threadId: idea.id, tag: wanted, tagged: true }];
  });
}
