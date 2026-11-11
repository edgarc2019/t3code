import { describe, expect, it } from "vite-plus/test";

import {
  domainOf,
  domainTagChanges,
  filedTag,
  filingOfRun,
  findFiledLink,
  ideaStage,
  implementerTag,
  interviewPrompt,
  parseBundledIdeas,
  parseDomainAssignments,
  type IdeaThread,
  type ImplementerThread,
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
const NOW = Date.parse("2026-11-11T12:00:00.000Z");
const noImplementers = () => undefined;
const stageOf = (idea: IdeaThread) => ideaStage(idea, noImplementers, NOW);

describe("ideaStage", () => {
  it("follows an idea from the board through its interview to what it filed", () => {
    expect(stageOf(thread(["idea"]))).toEqual({ kind: "board" });
    expect(stageOf(thread(["idea"], ran))).toEqual({ kind: "interviewing" });
    expect(stageOf(thread(["idea", "issue:acme/cafe#12"], ran))).toEqual({
      kind: "filed",
      ref: { kind: "github", owner: "acme", repo: "cafe", number: 12 },
      covers: [],
      implementation: null,
    });
    expect(stageOf(thread(["idea", "spec", "covers:Seasonal drinks"], ran))).toEqual({
      kind: "filed",
      ref: { kind: "t3" },
      covers: ["Seasonal drinks"],
      implementation: null,
    });
    expect(stageOf(thread(["idea", "spec"], ran))).toEqual({
      kind: "filed",
      ref: { kind: "t3" },
      covers: [],
      implementation: null,
    });
  });

  it("ignores threads that are not ideas, or no longer are", () => {
    expect(stageOf(thread(undefined))).toBeNull();
    expect(stageOf(thread(["issue:acme/cafe#12"]))).toBeNull();
    expect(stageOf(thread(["idea"], { archivedAt: "2026-11-10T00:00:00.000Z" }))).toBeNull();
  });
});

describe("ideas being implemented", () => {
  const IMPLEMENTER_ID = "5f0c2a8e-1b7d-4c3e-9a6f-2d8b4e1c7a90";
  const pr = (
    snapshot: NonNullable<ImplementerThread["pullRequests"][number]["snapshot"]>,
  ): ImplementerThread["pullRequests"][number] => ({
    url: "https://github.com/acme/cafe/pull/7",
    number: 7,
    linkedAt: "2026-11-10T00:00:00.000Z",
    snapshot,
  });
  const implementer = (
    pullRequests: ImplementerThread["pullRequests"] = [],
    deletedAt: string | null = null,
  ): ImplementerThread => ({ createdAt: "2026-11-09T00:00:00.000Z", deletedAt, pullRequests });
  const filedIdea = thread(["idea", "issue:acme/cafe#12", implementerTag(IMPLEMENTER_ID)], ran);
  const stageWith = (found: ImplementerThread | undefined, now = NOW) =>
    ideaStage(filedIdea, (threadId) => (threadId === IMPLEMENTER_ID ? found : undefined), now);
  const prStatus = (found: ImplementerThread) => {
    const stage = stageWith(found);
    return stage?.kind === "filed" ? stage.implementation?.pullRequest?.status : "not filed";
  };

  it("keeps the idea as Implementing, linked to its implementer, until a PR shows up", () => {
    expect(implementerTag(IMPLEMENTER_ID)).toHaveLength(48);
    expect(stageWith(implementer())).toMatchObject({
      kind: "filed",
      implementation: { threadId: IMPLEMENTER_ID, pullRequest: null },
    });
  });

  it("shows the implementer's PR as open, checks failing, ready or merged", () => {
    const open = { state: "open", isDraft: false } as const;
    expect(prStatus(implementer([pr({ ...open, checksState: "pending" })]))).toBe("open");
    expect(prStatus(implementer([pr({ ...open, isDraft: true, checksState: "passing" })]))).toBe(
      "open",
    );
    expect(prStatus(implementer([pr({ ...open, checksState: "failing" })]))).toBe("failing");
    expect(prStatus(implementer([pr({ ...open, checksState: "passing" })]))).toBe("ready");
    expect(
      prStatus(
        implementer([
          pr({ state: "merged", isDraft: false, mergedAt: "2026-11-10T12:00:00.000Z" }),
        ]),
      ),
    ).toBe("merged");
  });

  it("drops a shipped idea 7 days after its PR merged", () => {
    const merged = implementer([
      pr({ state: "merged", isDraft: false, mergedAt: "2026-11-04T13:00:00.000Z" }),
    ]);
    expect(stageWith(merged)).not.toBeNull();
    expect(stageWith(merged, Date.parse("2026-11-11T13:00:01.000Z"))).toBeNull();
  });

  it("goes back to Filed when the implementer is deleted or its PR closes unmerged", () => {
    const filed = { kind: "filed", implementation: null };
    expect(stageWith(undefined)).toMatchObject(filed);
    expect(stageWith(implementer([], "2026-11-10T00:00:00.000Z"))).toMatchObject(filed);
    expect(stageWith(implementer([pr({ state: "closed", isDraft: false })]))).toMatchObject(filed);
  });
});

describe("filed links", () => {
  it("finds a GitHub issue in a reply and round-trips it through a tag", () => {
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

    expect(stageOf(thread(["idea", filedTag(github!)!], ran))).toMatchObject({
      kind: "filed",
      ref: github,
    });
  });

  it("takes only what the finished interview run filed", () => {
    const oldLink = { runId: "run-1", text: "Related: https://github.com/acme/cafe/issues/9" };
    const oldPlan = { runId: "run-1", status: "active", markdown: "old scope" };
    const newPlan = { runId: "run-2", status: "active", markdown: "new" };
    // A spec written by this run wins over a link an earlier run mentioned.
    expect(filingOfRun("run-2", [oldLink], [oldPlan, newPlan])).toEqual({
      ref: { kind: "t3" },
      text: "new",
    });
    // A run that wrote nothing files nothing, even with an older active plan around.
    expect(
      filingOfRun("run-2", [oldLink, { runId: "run-2", text: "No spec." }], [oldPlan]),
    ).toBeNull();
    const link = "https://github.com/acme/cafe/issues/12";
    expect(filingOfRun("run-2", [{ runId: "run-2", text: link }], [])).toEqual({
      ref: { kind: "github", owner: "acme", repo: "cafe", number: 12 },
      text: link,
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
