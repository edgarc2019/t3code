import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

/** An idea is a thread with this tag. Untagging it takes the idea off the whiteboard. */
export const IDEA_TAG = "idea";
const ISSUE_TAG_PREFIX = "issue:";
const LINEAR_TAG_PREFIX = "linear:";
const SPEC_TAG = "spec";
const COVERS_TAG_PREFIX = "covers:";
const MAX_TAG_LENGTH = 64;

export type IdeaThread = Pick<EnvironmentThreadShell, "latestRun" | "archivedAt" | "deletedAt"> & {
  readonly source: { readonly tags?: ReadonlyArray<string> | undefined };
};

/** Where a project's interviews file their result. */
export type IdeaTracker = "github" | "linear" | "t3";
export const IDEA_TRACKERS: ReadonlyArray<{ readonly id: IdeaTracker; readonly label: string }> = [
  { id: "github", label: "GitHub Issues" },
  { id: "linear", label: "Linear" },
  { id: "t3", label: "T3 spec" },
];

/** What an interview filed: a GitHub issue, a Linear issue, or a T3 proposed plan on its thread. */
export type FiledRef =
  | {
      readonly kind: "github";
      readonly owner: string;
      readonly repo: string;
      readonly number: number;
    }
  | { readonly kind: "linear"; readonly workspace: string; readonly key: string }
  | { readonly kind: "t3" };

/** Where an idea is: on the board, being interviewed, or filed. */
export type IdeaStage =
  | { readonly kind: "board" }
  | { readonly kind: "interviewing" }
  | { readonly kind: "filed"; readonly ref: FiledRef; readonly covers: ReadonlyArray<string> };

const tagsOf = (thread: IdeaThread) => thread.source.tags ?? [];

export function ideaStage(thread: IdeaThread): IdeaStage | null {
  if (thread.archivedAt !== null || thread.deletedAt !== null) return null;
  const tags = tagsOf(thread);
  if (!tags.includes(IDEA_TAG)) return null;
  const ref = tags.map(parseFiledTag).find((candidate) => candidate !== null) ?? null;
  if (ref) {
    const covers = tags
      .filter((tag) => tag.startsWith(COVERS_TAG_PREFIX))
      .map((tag) => tag.slice(COVERS_TAG_PREFIX.length));
    return { kind: "filed", ref, covers };
  }
  return thread.latestRun === null ? { kind: "board" } : { kind: "interviewing" };
}

/** An idea nobody has interviewed yet is a sticky note, not a cat. */
export const isIdeaOnBoard = (thread: IdeaThread) => ideaStage(thread)?.kind === "board";

/** The first GitHub or Linear issue link in an agent's reply. */
export function findFiledLink(text: string): FiledRef | null {
  const github = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/.exec(text);
  if (github) {
    return { kind: "github", owner: github[1]!, repo: github[2]!, number: Number(github[3]) };
  }
  const linear = /https:\/\/linear\.app\/([\w-]+)\/issue\/([A-Z][A-Z0-9]*-\d+)/.exec(text);
  return linear ? { kind: "linear", workspace: linear[1]!, key: linear[2]! } : null;
}

/** The tag that remembers what was filed, or null when it would not fit in a tag. */
export function filedTag(ref: FiledRef): string | null {
  const tag =
    ref.kind === "github"
      ? `${ISSUE_TAG_PREFIX}${ref.owner}/${ref.repo}#${ref.number}`
      : ref.kind === "linear"
        ? `${LINEAR_TAG_PREFIX}${ref.workspace}/${ref.key}`
        : SPEC_TAG;
  return tag.length <= MAX_TAG_LENGTH ? tag : null;
}

function parseFiledTag(tag: string): FiledRef | null {
  if (tag === SPEC_TAG) return { kind: "t3" };
  const github = /^issue:([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(tag);
  if (github) {
    return { kind: "github", owner: github[1]!, repo: github[2]!, number: Number(github[3]) };
  }
  const linear = /^linear:([\w-]+)\/([A-Z][A-Z0-9]*-\d+)$/.exec(tag);
  return linear ? { kind: "linear", workspace: linear[1]!, key: linear[2]! } : null;
}

export const filedUrl = (ref: FiledRef): string | null =>
  ref.kind === "github"
    ? `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.number}`
    : ref.kind === "linear"
      ? `https://linear.app/${ref.workspace}/issue/${ref.key}`
      : null;

export const filedLabel = (ref: FiledRef) =>
  ref.kind === "github"
    ? `${ref.repo}#${ref.number}`
    : ref.kind === "linear"
      ? ref.key
      : "Spec ready";

/** Remembers a folded-in idea's title on the idea it joined, since the folded thread goes away. */
export const coversTag = (title: string) =>
  `${COVERS_TAG_PREFIX}${title}`.slice(0, MAX_TAG_LENGTH).trim();

const TRACKER_STEPS: Record<IdeaTracker, ReadonlyArray<string>> = {
  github: [
    "- Then file the issue on this project's GitHub repository. I approve filing it: file it.",
    "- End your reply with the ```bundled block, then the issue URL.",
  ],
  linear: [
    "- Then file it as an issue in Linear with your Linear tools, in the team that fits this project (ask me if unsure). I approve filing it: file it.",
    "- End your reply with the ```bundled block, then the Linear issue URL.",
  ],
  t3: [
    "- Then write the spec as your proposed plan. Don't file it anywhere else: the plan is the spec.",
    "- End the plan with the ```bundled block.",
  ],
};

/**
 * Interviews one idea. Linked ideas (same domain, still on the board) are offered for bundling;
 * the agent asks before folding any in, and lists the ones I agreed to in a ```bundled block.
 */
export function interviewPrompt(
  idea: string,
  tracker: IdeaTracker,
  linked: ReadonlyArray<{ readonly id: string; readonly title: string }>,
) {
  const what =
    tracker === "t3" ? "a spec" : tracker === "linear" ? "a Linear issue" : "a GitHub issue";
  return [
    `Interview me about this idea and turn it into ${what} for this project.`,
    "",
    `Idea: ${idea}`,
    ...(linked.length > 0
      ? [
          "",
          "Linked ideas in the same area of the project (one-line ideas; the title is all there is):",
          ...linked.map((other) => `- ${shortIdeaId(other.id)} ${other.title}`),
        ]
      : []),
    "",
    "- Read the code you need, then ask me questions with your question tool until the scope is clear.",
    ...(linked.length > 0
      ? [
          "- Ask me with your question tool which linked ideas belong in the same piece of work, your recommendation first. Fold in only the ones I agree to.",
        ]
      : []),
    ...TRACKER_STEPS[tracker],
    "- The ```bundled block lists the ids of the linked ideas I agreed to fold in, one per line, and is empty when there are none.",
    "- Do not edit files, write code, or open a pull request.",
  ].join("\n");
}

/** The ideas a reply or plan folded in, from its last ```bundled block of short ids. */
export function parseBundledIdeas(
  text: string,
  ideaIds: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const block = [...text.matchAll(/```bundled\s*\n([\s\S]*?)```/g)].at(-1)?.[1] ?? "";
  const shortIds = new Set(
    [...block.matchAll(/\b([0-9a-f]{8})\b/gi)].map((match) => match[1]!.toLowerCase()),
  );
  return ideaIds.filter((id) => shortIds.has(shortIdeaId(id)));
}

export function implementPrompt(ref: FiledRef, spec: string | null) {
  if (ref.kind !== "t3") return `Implement ${filedUrl(ref)}.\n\nfull stop`;
  return [
    "Implement this spec. It is already agreed: treat it as the plan and don't file an issue for it.",
    "",
    spec ?? "",
    "",
    "full stop",
  ].join("\n");
}

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
    ...(glossary ? ["", "GLOSSARY.md:", "", glossary] : []),
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
