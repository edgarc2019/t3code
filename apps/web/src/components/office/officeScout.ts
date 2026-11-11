import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";

import { ideaStage, isConnectThread, type IdeaThread } from "./officeIdeas";

/** A goal is a thread with this tag, titled with the goal. */
export const GOAL_TAG = "goal";
/** Scout's thread for a project, which his hourly scheduled task continues. */
export const SCOUT_TAG = "scout";
export const SCOUT_EVERY_MS = 60 * 60 * 1000;
const MAX_TAG_LENGTH = 64;

const tagsOf = (thread: IdeaThread) => thread.source.tags ?? [];
const isLive = (thread: IdeaThread) => thread.archivedAt === null && thread.deletedAt === null;

export const isGoalThread = (thread: IdeaThread) =>
  isLive(thread) && tagsOf(thread).includes(GOAL_TAG);
export const isScoutThread = (thread: IdeaThread) =>
  isLive(thread) && tagsOf(thread).includes(SCOUT_TAG);

/** Threads the office draws as stickies, goals or Scout instead of cats. */
export const isOfficeHelperThread = (thread: IdeaThread) =>
  (ideaStage(thread) !== null && thread.latestRun === null) ||
  isConnectThread(thread) ||
  isGoalThread(thread) ||
  isScoutThread(thread);

/**
 * The newest real thread in the project sets the model and access an idea's agents run with.
 * Helper threads never set it: they use the cheap model, or an older pick.
 */
export function templateThread(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  project: EnvironmentProject,
): EnvironmentThreadShell | null {
  const candidates = threads.filter(
    (thread) => thread.environmentId === project.environmentId && !isOfficeHelperThread(thread),
  );
  const newest = (list: ReadonlyArray<EnvironmentThreadShell>) =>
    list.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  return (
    newest(candidates.filter((thread) => thread.projectId === project.id)) ?? newest(candidates)
  );
}

/** One project's Scout task; a fixed id lets every device update the same task. */
export const scoutTaskId = (projectId: string) => `scheduled-task:scout:${projectId}`;

/** An issue Scout brought back, and the goal it matched. */
export interface ScoutFind {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly goal: string;
}

export const issueKey = (issue: Pick<ScoutFind, "owner" | "repo" | "number">) =>
  `${issue.owner}/${issue.repo}#${issue.number}`.toLowerCase();

export function scoutPrompt(goals: ReadonlyArray<string>) {
  return [
    "You are Scout. Check this project's GitHub repository for new issues that match my goals. Do not edit files, write code, or comment on, label or close any issue.",
    "",
    "Goals:",
    ...goals.map((goal) => `- ${goal}`),
    "",
    "1. Run `date -u +%Y-%m-%d` and work out the date 7 days before it.",
    '2. In this project\'s folder, list the issues opened since that date: `gh issue list --state all --search "created:>=<that date>" --limit 1000 --json number,title,url,labels`. If that fails, say why and stop, with no block.',
    "3. Keep only issues that clearly match one of the goals. When a title isn't enough to judge, read the issue with `gh issue view <number>`.",
    "4. End your reply with this block, one line per kept issue, with the goal copied exactly. Leave the block empty when nothing matches.",
    "",
    "```scout",
    "<issue url> | <issue title> | <goal>",
    "```",
  ].join("\n");
}

const ISSUE_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?$/;

const lastScoutBlock = (reply: string) =>
  [...reply.matchAll(/```scout\s*\n([\s\S]*?)```/g)].at(-1)?.[1] ?? null;

/** The issues in a reply's last ```scout block; lines that aren't `<issue url> | <title> | <goal>` are skipped. */
export function parseScoutFinds(reply: string): ReadonlyArray<ScoutFind> {
  const block = lastScoutBlock(reply) ?? "";
  return block.split("\n").flatMap((line) => {
    const parts = line
      .replace(/^\s*[-*]\s*/, "")
      .split("|")
      .map((part) => part.trim());
    if (parts.length < 3) return [];
    const url = ISSUE_URL.exec(parts[0]!.replace(/^<|>$/g, ""));
    const goal = parts.at(-1)!;
    const title = parts.slice(1, -1).join(" | ");
    if (!url || !title || !goal) return [];
    return [
      {
        owner: url[1]!,
        repo: url[2]!,
        number: Number(url[3]),
        url: `https://github.com/${url[1]}/${url[2]}/issues/${url[3]}`,
        title,
        goal,
      },
    ];
  });
}

/** Remembers on Scout's thread that an issue was kept or dropped, or null when it won't fit in a tag. */
export function scoutSeenTag(
  kind: "kept" | "dropped",
  issue: Pick<ScoutFind, "owner" | "repo" | "number">,
): string | null {
  const tag = `scout-${kind}:${issue.owner}/${issue.repo}#${issue.number}`;
  return tag.length <= MAX_TAG_LENGTH ? tag : null;
}

/** Issues kept or dropped already, by issueKey, from Scout's thread tags. */
export function seenIssueKeys(tags: ReadonlyArray<string>): ReadonlySet<string> {
  return new Set(
    tags.flatMap((tag) => {
      const match = /^scout-(?:kept|dropped):(.+)$/.exec(tag);
      return match ? [match[1]!.toLowerCase()] : [];
    }),
  );
}

/**
 * What Scout is carrying: the matches in his latest check, minus the ones already kept, dropped or
 * filed as an idea. Every check lists the past 7 days, so the latest one is the whole list; a
 * failed check has no block and leaves the one before it in place.
 */
export function pendingFinds(
  replies: ReadonlyArray<string>,
  hidden: ReadonlySet<string>,
): ReadonlyArray<ScoutFind> {
  const latest = replies.findLast((reply) => lastScoutBlock(reply) !== null) ?? "";
  return parseScoutFinds(latest).filter((find) => !hidden.has(issueKey(find)));
}
