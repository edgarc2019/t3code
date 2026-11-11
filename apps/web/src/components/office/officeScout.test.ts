import { describe, expect, it } from "vite-plus/test";

import {
  issueKey,
  parseScoutFinds,
  pendingFinds,
  scoutPrompt,
  scoutSeenTag,
  seenIssueKeys,
} from "./officeScout";

const reply = (...lines: Array<string>) =>
  ["Checked at 2026-11-11T10:00:00Z", "```scout", ...lines, "```"].join("\n");

describe("Scout's replies", () => {
  it("reads the issues and goals in the last scout block", () => {
    const text = [
      reply("https://github.com/acme/cafe/issues/1 | Draft | Old goal"),
      "Final:",
      reply(
        "- https://github.com/acme/cafe/issues/12 | Oat milk | runs out | Menu ideas",
        "https://github.com/acme/cafe/pull/13 | A pull request | Menu ideas",
        "not a line",
        "https://github.com/acme/cafe/issues/14 | No goal |",
      ),
    ].join("\n");
    expect(parseScoutFinds(text)).toEqual([
      {
        owner: "acme",
        repo: "cafe",
        number: 12,
        url: "https://github.com/acme/cafe/issues/12",
        title: "Oat milk | runs out",
        goal: "Menu ideas",
      },
    ]);
    expect(parseScoutFinds("No block.")).toEqual([]);
    expect(parseScoutFinds(reply())).toEqual([]);
  });

  it("carries each issue once, newest reply first, minus kept, dropped and filed ones", () => {
    const first = reply(
      "https://github.com/acme/cafe/issues/1 | Seats | Seating",
      "https://github.com/acme/cafe/issues/2 | Tea | Menu",
    );
    const second = reply(
      "https://github.com/Acme/Cafe/issues/2 | Tea again | Menu",
      "https://github.com/acme/cafe/issues/3 | Stamps | Loyalty",
    );
    const hidden = seenIssueKeys(["scout", "scout-dropped:acme/cafe#3", "idea"]);
    expect(
      pendingFinds([first, second], hidden).map((find) => [issueKey(find), find.title]),
    ).toEqual([
      ["acme/cafe#2", "Tea again"],
      ["acme/cafe#1", "Seats"],
    ]);
  });
});

describe("remembering kept and dropped issues", () => {
  it("round-trips through a tag on Scout's thread", () => {
    const issue = { owner: "acme", repo: "cafe", number: 7 };
    expect(scoutSeenTag("kept", issue)).toBe("scout-kept:acme/cafe#7");
    expect(
      seenIssueKeys([
        scoutSeenTag("kept", issue)!,
        scoutSeenTag("dropped", { ...issue, number: 8 })!,
      ]),
    ).toEqual(new Set(["acme/cafe#7", "acme/cafe#8"]));
    expect(
      scoutSeenTag("dropped", { owner: "o".repeat(40), repo: "r".repeat(20), number: 1 }),
    ).toBeNull();
  });
});

describe("Scout's prompt", () => {
  it("lists the goals and asks for the scout block", () => {
    const prompt = scoutPrompt(["Menu ideas", "Faster seating"]);
    expect(prompt).toContain("- Menu ideas\n- Faster seating");
    expect(prompt).toContain("```scout\n<issue url> | <issue title> | <goal>\n```");
    expect(prompt).toContain("Do not edit files");
  });
});
