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
 * Connect runs, goals and Scout use the cheap model, so they never set it.
 */
export function templateThread(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  project: EnvironmentProject,
): EnvironmentThreadShell | null {
  const candidates = threads.filter(
    (thread) =>
      thread.environmentId === project.environmentId &&
      !isConnectThread(thread) &&
      !isGoalThread(thread) &&
      !isScoutThread(thread),
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
    "1. Run `date -u +%Y-%m-%dT%H:%M:%SZ` for the time now.",
    '2. Find the latest "Checked at" time in this conversation. With none, use 7 days ago.',
    '3. In this project\'s folder, list the issues opened since then: `gh issue list --state all --search "created:>=<that time>" --limit 100 --json number,title,url,body`. If that fails, say why and stop: write no "Checked at" line and no block, so the next check covers this time too.',
    "4. Keep only issues that clearly match one of the goals. Skip issues you listed in an earlier check.",
    '5. End your reply with "Checked at <the time from step 1>", then this block, one line per kept issue, with the goal copied exactly. Leave the block empty when nothing matches.',
    "",
    "```scout",
    "<issue url> | <issue title> | <goal>",
    "```",
  ].join("\n");
}

const ISSUE_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?$/;

/** The issues in a reply's last ```scout block; lines that aren't `<issue url> | <title> | <goal>` are skipped. */
export function parseScoutFinds(reply: string): ReadonlyArray<ScoutFind> {
  const block = [...reply.matchAll(/```scout\s*\n([\s\S]*?)```/g)].at(-1)?.[1] ?? "";
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
 * What Scout is carrying: every issue his replies brought, newest reply first, once each, minus
 * the ones already kept, dropped or filed as an idea.
 */
export function pendingFinds(
  replies: ReadonlyArray<string>,
  hidden: ReadonlySet<string>,
): ReadonlyArray<ScoutFind> {
  const seen = new Set(hidden);
  return replies.toReversed().flatMap((reply) =>
    parseScoutFinds(reply).filter((find) => {
      const key = issueKey(find);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}
