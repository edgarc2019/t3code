import { describe, expect, it } from "vite-plus/test";

import {
  domainOf,
  domainTagChanges,
  filedTag,
  findFiledLink,
  ideaStage,
  interviewPrompt,
  parseBundledIdeas,
  parseDomainAssignments,
  type IdeaThread,
} from "./officeIdeas";

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
  it("follows an idea from the board through its interview to what it filed", () => {
    expect(ideaStage(thread(["idea"]))).toEqual({ kind: "board" });
    expect(ideaStage(thread(["idea"], ran))).toEqual({ kind: "interviewing" });
    expect(ideaStage(thread(["idea", "issue:acme/cafe#12"], ran))).toEqual({
      kind: "filed",
      ref: { kind: "github", owner: "acme", repo: "cafe", number: 12 },
      covers: [],
    });
    expect(
      ideaStage(thread(["idea", "linear:acme/CAFE-7", "covers:Seasonal drinks"], ran)),
    ).toEqual({
      kind: "filed",
      ref: { kind: "linear", workspace: "acme", key: "CAFE-7" },
      covers: ["Seasonal drinks"],
    });
    expect(ideaStage(thread(["idea", "spec"], ran))).toEqual({
      kind: "filed",
      ref: { kind: "t3" },
      covers: [],
    });
  });

  it("ignores threads that are not ideas, or no longer are", () => {
    expect(ideaStage(thread(undefined))).toBeNull();
    expect(ideaStage(thread(["issue:acme/cafe#12"]))).toBeNull();
    expect(ideaStage(thread(["idea"], { archivedAt: "2026-11-10T00:00:00.000Z" }))).toBeNull();
  });
});

describe("filed links", () => {
  it("finds a GitHub or Linear issue in a reply and round-trips it through a tag", () => {
    const github = findFiledLink(
      "Filed it: https://github.com/edgarc2019/office-ideas-demo/issues/3 (and see #4).",
    );
    expect(github).toEqual({
      kind: "github",
      owner: "edgarc2019",
      repo: "office-ideas-demo",
      number: 3,
    });
    expect(filedTag(github!)).toBe("issue:edgarc2019/office-ideas-demo#3");

    const linear = findFiledLink("Done: https://linear.app/cat-cafe/issue/CAFE-42/seasonal-menu");
    expect(linear).toEqual({ kind: "linear", workspace: "cat-cafe", key: "CAFE-42" });
    expect(filedTag(linear!)).toBe("linear:cat-cafe/CAFE-42");
    expect(ideaStage(thread(["idea", filedTag(linear!)!], ran))).toMatchObject({
      kind: "filed",
      ref: linear,
    });
  });

  it("does not take a pull request link for the issue", () => {
    expect(findFiledLink("PR: https://github.com/acme/cafe/pull/7")).toBeNull();
  });

  it("skips a tag that would be longer than a thread tag allows", () => {
    expect(
      filedTag({ kind: "github", owner: "o".repeat(40), repo: "r".repeat(30), number: 1 }),
    ).toBeNull();
  });
});

describe("bundled ideas", () => {
  const seat = "13707430-0000-4000-8000-000000000001";
  const waitlist = "cffc2dd7-0000-4000-8000-000000000002";
  const menu = "970b819c-0000-4000-8000-000000000003";

  it("reads the ideas the interview folded in from its last bundled block", () => {
    const text = [
      "Spec...",
      "```bundled",
      "cffc2dd7",
      "- 970b819c (not agreed, ignored below)",
      "```",
      "Final answer:",
      "```bundled",
      "- cffc2dd7 Text the waitlist",
      "```",
    ].join("\n");
    expect(parseBundledIdeas(text, [seat, waitlist, menu])).toEqual([waitlist]);
    expect(parseBundledIdeas("```bundled\n```", [seat, waitlist])).toEqual([]);
    expect(parseBundledIdeas("no block", [seat, waitlist])).toEqual([]);
  });

  it("offers linked ideas only when there are some", () => {
    const withLinks = interviewPrompt("Reserve the window seat", "t3", [
      { id: waitlist, title: "Text the waitlist" },
    ]);
    expect(withLinks).toContain("- cffc2dd7 Text the waitlist");
    expect(withLinks).toContain("which linked ideas belong");
    expect(interviewPrompt("Reserve the window seat", "github", [])).not.toContain("Linked ideas");
  });
});

describe("connecting ideas by domain", () => {
  const quote = "3f9c2a1b-0000-4000-8000-000000000001";
  const rates = "7d1e0b2c-0000-4000-8000-000000000002";
  const login = "a0b1c2d3-0000-4000-8000-000000000003";
  const ids = [quote, rates, login];

  it("reads the last domains block and normalizes the names", () => {
    const reply = [
      "Draft:",
      "```domains",
      "3f9c2a1b: wrong",
      "```",
      "Final:",
      "```domains",
      "3f9c2a1b: Quoting",
      "- 7d1e0b2c: quoting ",
      "a0b1c2d3: Broker Portal!",
      "ffffffff: unknown-idea",
      "```",
    ].join("\n");
    expect([...parseDomainAssignments(reply, ids)]).toEqual([
      [quote, "quoting"],
      [rates, "quoting"],
      [login, "broker-portal"],
    ]);
    expect(parseDomainAssignments("No block here.", ids).size).toBe(0);
    expect([
      ...parseDomainAssignments("Sorted:\n3f9c2a1b: menu\n7d1e0b2c: seating\nDone.", ids),
    ]).toEqual([
      [quote, "menu"],
      [rates, "seating"],
    ]);
  });

  it("replaces an idea's old domain and leaves unmentioned ideas alone", () => {
    const changes = domainTagChanges(
      [
        { id: quote, tags: ["idea", "domain:pricing"] },
        { id: rates, tags: ["idea", "domain:quoting"] },
        { id: login, tags: ["idea", "domain:auth"] },
      ],
      new Map([
        [quote, "quoting"],
        [rates, "quoting"],
      ]),
    );
    expect(changes).toEqual([
      { threadId: quote, tag: "domain:pricing", tagged: false },
      { threadId: quote, tag: "domain:quoting", tagged: true },
    ]);
  });

  it("reads an idea's domain back from its tags", () => {
    expect(domainOf(thread(["idea", "domain:quoting"]))).toBe("quoting");
    expect(domainOf(thread(["idea"]))).toBeNull();
  });
});
