import { describe, expect, it } from "vite-plus/test";

import { findIssueLink, ideaStage, issueTag, type IdeaThread } from "./officeIdeas";

const thread = (
  tags: Array<string> | undefined,
  overrides: Partial<IdeaThread> = {},
): IdeaThread => ({
  latestRun: null,
  archivedAt: null,
  deletedAt: null,
  source: { tags },
  ...overrides,
});
const ran = { latestRun: { runId: "run-1" } as unknown as IdeaThread["latestRun"] };

describe("ideaStage", () => {
  it("follows an idea from the board through its interview to a filed issue", () => {
    expect(ideaStage(thread(["idea"]))).toEqual({ kind: "board" });
    expect(ideaStage(thread(["idea"], ran))).toEqual({ kind: "interviewing" });
    expect(ideaStage(thread(["idea", "issue:acme/cafe#12"], ran))).toEqual({
      kind: "filed",
      issue: { owner: "acme", repo: "cafe", number: 12 },
    });
  });

  it("ignores threads that are not ideas, or no longer are", () => {
    expect(ideaStage(thread(undefined))).toBeNull();
    expect(ideaStage(thread(["issue:acme/cafe#12"]))).toBeNull();
    expect(ideaStage(thread(["idea"], { archivedAt: "2026-11-10T00:00:00.000Z" }))).toBeNull();
  });
});

describe("issue links", () => {
  it("finds the filed issue in a reply and round-trips it through a tag", () => {
    const issue = findIssueLink(
      "Filed it: https://github.com/edgarc2019/office-ideas-demo/issues/3 (and see #4).",
    );
    expect(issue).toEqual({ owner: "edgarc2019", repo: "office-ideas-demo", number: 3 });
    const tag = issueTag(issue!);
    expect(tag).toBe("issue:edgarc2019/office-ideas-demo#3");
    expect(ideaStage(thread(["idea", tag!], ran))).toEqual({ kind: "filed", issue });
  });

  it("does not take a pull request link for the issue", () => {
    expect(findIssueLink("PR: https://github.com/acme/cafe/pull/7")).toBeNull();
  });

  it("skips a tag that would be longer than a thread tag allows", () => {
    expect(issueTag({ owner: "o".repeat(40), repo: "r".repeat(30), number: 1 })).toBeNull();
  });
});
