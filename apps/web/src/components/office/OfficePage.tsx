import type { CommandOutputView } from "@t3tools/client-runtime/state/command-output";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentId,
  HostResourcesSnapshot,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import {
  useProjects,
  useQuietThreadProjection,
  useQuietThreadShells,
  useThreadShells,
} from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useCommandOutputStreaming } from "../chat/CommandOutputPanel";
import { Badge } from "../ui/badge";
import { Popover, PopoverPopup } from "../ui/popover";
import { SidebarInset } from "../ui/sidebar";
import {
  catFurFor,
  OFFICE_PALETTE_CLASS,
  OfficeCat,
  OfficeCatAvatar,
  OfficeDog,
  type CatPose,
} from "./OfficeArt";
import { OfficeCatDetails } from "./OfficeCatDetails";
import {
  ConnectWatcher,
  IdeaIssueWatcher,
  OfficeIdeasBoard,
  useOfficeIdeas,
} from "./OfficeIdeasBoard";
import { isGoalThread, isOfficeHelperThread } from "./officeScout";
import { ScoutFinds, useScoutCarrying } from "./OfficeScoutViews";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import {
  boatVerifyRoute,
  currentTodoProgress,
  isBoatVerifyCommand,
  layoutOffice,
  type OfficeCat as OfficeCatModel,
} from "./officeLayout";

type Cat = OfficeCatModel<EnvironmentThreadShell>;
type Point = readonly [number, number];

// Isometric grid: x runs down-right, y runs down-left. One tile is 52 × 26 screen units.
const TILE_W = 26;
const TILE_H = 13;
const GRID_X = 14;
const GRID_Y = 9;
const ORIGIN_X = GRID_Y * TILE_W + 40;
const ORIGIN_Y = 110;
const WALL_H = 84;
const VIEW_W = (GRID_X + GRID_Y) * TILE_W + 80;
const VIEW_H = ORIGIN_Y + (GRID_X + GRID_Y) * TILE_H + 40;

const iso = (x: number, y: number): Point => [
  ORIGIN_X + (x - y) * TILE_W,
  ORIGIN_Y + (x + y) * TILE_H,
];
const lift = ([x, y]: Point, height: number): Point => [x, y - height];
const points = (list: ReadonlyArray<Point>) =>
  list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

const DESK_SLOTS: ReadonlyArray<Point> = [0.9, 2.95, 5.0].flatMap((y) =>
  [0.5, 2.4, 4.3, 6.2].map((x): Point => [x, y]),
);
const KITTEN_OFFSETS: ReadonlyArray<Point> = [
  [0.25, 1.3],
  [1.15, 1.3],
];
// Break-room cats carry no name tag, so a full room stays readable; hover or click names them.
const BREAK_SPOTS: ReadonlyArray<Point> = [1.8, 3.2].flatMap((y) =>
  [8.7, 10.1, 11.5, 12.9].map((x): Point => [x + (y > 2 ? 0.5 : 0), y]),
);
const LOUNGE_SPOTS: ReadonlyArray<{ readonly at: Point; readonly seat: number }> = [
  { at: [13.25, 5.3], seat: 10 },
  { at: [13.25, 6.6], seat: 10 },
  { at: [10.2, 7.3], seat: 6 },
  { at: [9.5, 5.4], seat: 0 },
  { at: [11.2, 5.8], seat: 0 },
  { at: [11.6, 7.6], seat: 0 },
];

function Box(props: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly color: string;
  readonly base?: number;
}) {
  const base = props.base ?? 0;
  const a = iso(props.x, props.y);
  const b = iso(props.x + props.w, props.y);
  const c = iso(props.x + props.w, props.y + props.d);
  const e = iso(props.x, props.y + props.d);
  const top = base + props.h;
  const stroke = { stroke: "var(--border)", strokeWidth: 0.7, strokeLinejoin: "round" as const };
  return (
    <g>
      <polygon
        points={points([lift(e, base), lift(c, base), lift(c, top), lift(e, top)])}
        fill={`color-mix(in oklab, ${props.color} 82%, black)`}
        {...stroke}
      />
      <polygon
        points={points([lift(b, base), lift(c, base), lift(c, top), lift(b, top)])}
        fill={`color-mix(in oklab, ${props.color} 70%, black)`}
        {...stroke}
      />
      <polygon
        points={points([a, b, c, e].map((p) => lift(p, top)))}
        fill={props.color}
        {...stroke}
      />
    </g>
  );
}

function FloorQuad(props: { readonly from: Point; readonly to: Point; readonly fill: string }) {
  const [x0, y0] = props.from;
  const [x1, y1] = props.to;
  return (
    <polygon
      points={points([iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1)])}
      fill={props.fill}
    />
  );
}

function FloorLabel(props: { readonly at: Point; readonly children: string }) {
  const [x, y] = iso(...props.at);
  return (
    <text
      transform={`matrix(.894,.447,-.894,.447,${x},${y})`}
      fontSize={11}
      fontWeight={700}
      letterSpacing="0.14em"
      fill="var(--office-floor-label)"
    >
      {props.children}
    </text>
  );
}

/** Content drawn flat on the back wall, starting `x` tiles along it and `top` units up. */
function BackWall(props: {
  readonly x: number;
  readonly top: number;
  readonly children: ReactNode;
}) {
  const [px, py] = iso(props.x, 0);
  return <g transform={`translate(${px},${py - props.top}) skewY(26.565)`}>{props.children}</g>;
}

/** Content drawn flat on the left wall; `y` is where its left edge sits. */
function LeftWall(props: {
  readonly y: number;
  readonly top: number;
  readonly children: ReactNode;
}) {
  const [px, py] = iso(0, props.y);
  return <g transform={`translate(${px},${py - props.top}) skewY(-26.565)`}>{props.children}</g>;
}

function NameTag(props: {
  readonly at: Point;
  readonly title: string;
  readonly sub?: string | null;
  readonly tone?: "default" | "warning";
  /** Tags float over cats and let clicks through, unless the tag is the button itself. */
  readonly clickable?: boolean;
}) {
  const title = props.title.length > 18 ? `${props.title.slice(0, 17)}…` : props.title;
  const sub = props.sub ?? null;
  const width = Math.max(title.length * 5.6, (sub?.length ?? 0) * 4.9) + 14;
  const height = sub ? 25 : 15;
  const warning = props.tone === "warning";
  return (
    <g
      transform={`translate(${props.at[0]},${props.at[1]})`}
      className={props.clickable ? undefined : "pointer-events-none"}
    >
      <rect
        x={-width / 2}
        y={-height}
        width={width}
        height={height}
        rx={5}
        fill={warning ? "var(--warning-surface)" : "var(--popover)"}
        stroke={warning ? "var(--warning)" : "var(--border)"}
      />
      <text
        x={0}
        y={sub ? -14 : -4.5}
        textAnchor="middle"
        fontSize={9.5}
        fontWeight={600}
        fill="var(--foreground)"
      >
        {title}
      </text>
      {sub ? (
        <text
          x={0}
          y={-4}
          textAnchor="middle"
          fontSize={8.5}
          fill="var(--muted-foreground)"
          fontFamily="var(--font-mono)"
        >
          {sub}
        </text>
      ) : null}
    </g>
  );
}

const poseOf = (cat: Cat): CatPose =>
  cat.needsYou ? "waiting" : cat.working ? "typing" : cat.zone === "lounge" ? "sleeping" : "coffee";

type OpenCat = (cat: Cat, anchor: Element) => void;

/** Clickable wrapper that makes an SVG group act like a button. */
function Hit(props: {
  readonly label: string;
  readonly onOpen: (anchor: Element) => void;
  readonly children: ReactNode;
}) {
  const onClick = (event: MouseEvent<SVGGElement>) => props.onOpen(event.currentTarget);
  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    props.onOpen(event.currentTarget);
  };
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={props.label}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className="cursor-pointer outline-none focus-visible:[&>*:first-child]:opacity-100"
    >
      <title>{props.label}</title>
      {props.children}
    </g>
  );
}

/** A desk with its cat, kittens and name tag. Reads the thread's todo list for the tag. */
function DeskCat(props: { readonly cat: Cat; readonly slot: Point; readonly onOpen: OpenCat }) {
  const { cat } = props;
  const [dx, dy] = props.slot;
  const structure = useQuietThreadProjection(
    scopeThreadRef(cat.thread.environmentId, cat.thread.id),
  );
  const progress = structure ? currentTodoProgress(structure.projection.plans) : null;
  const seat = iso(dx + 0.75, dy - 0.05);
  const lid0 = lift(iso(dx + 0.45, dy + 0.32), 15);
  const lid1 = lift(iso(dx + 1.05, dy + 0.32), 15);
  const logo = lift(iso(dx + 0.75, dy + 0.32), 21.5);
  const mug = lift(iso(dx + 1.3, dy + 0.55), 15);
  const extra =
    cat.kittens.length > KITTEN_OFFSETS.length ? cat.kittens.length - KITTEN_OFFSETS.length : 0;
  const tagTitle = `${cat.thread.title}${cat.kittens.length > 0 ? ` +${cat.kittens.length}` : ""}`;
  const tagSub = cat.needsYou
    ? "needs you"
    : progress
      ? `${progress.done}/${progress.steps.length} todos`
      : "working";
  return (
    <>
      <Hit label={`${cat.thread.title}: ${tagSub}`} onOpen={(anchor) => props.onOpen(cat, anchor)}>
        <g transform={`translate(${seat[0]},${seat[1]}) scale(1.08)`}>
          <OfficeCat fur={catFurFor(cat.key)} pose={poseOf(cat)} />
        </g>
        <Box x={dx} y={dy} w={1.5} d={0.8} h={15} color="var(--office-wood)" />
        <polygon
          points={points([lid0, lid1, lift(lid1, 13), lift(lid0, 13)])}
          fill="var(--office-metal)"
          stroke="var(--office-line)"
          strokeWidth={0.7}
        />
        <circle
          cx={logo[0]}
          cy={logo[1]}
          r={2.2}
          fill={cat.working ? "var(--primary)" : "var(--muted-foreground)"}
        />
        <rect
          x={mug[0] - 2.5}
          y={mug[1] - 5}
          width={5}
          height={5}
          rx={1}
          fill="var(--card)"
          stroke="var(--office-line)"
          strokeWidth={0.6}
        />
      </Hit>
      {cat.kittens.slice(0, KITTEN_OFFSETS.length).map((kitten, index) => {
        const [ox, oy] = KITTEN_OFFSETS[index]!;
        const [kx, ky] = iso(dx + ox, dy + oy);
        return (
          <Hit
            key={kitten.key}
            label={`${kitten.thread.title} (kitten of ${cat.thread.title})`}
            onOpen={(anchor) => props.onOpen(kitten, anchor)}
          >
            <g transform={`translate(${kx},${ky}) scale(.62)`}>
              <OfficeCat fur={catFurFor(kitten.key)} pose={poseOf(kitten)} />
            </g>
            <rect
              x={kx - 8}
              y={ky - 8}
              width={16}
              height={9}
              rx={1}
              fill="var(--office-metal)"
              stroke="var(--office-line)"
              strokeWidth={0.6}
            />
            <circle cx={kx} cy={ky - 3.5} r={1.4} fill="var(--primary)" />
          </Hit>
        );
      })}
      <NameTag
        at={lift(seat, cat.needsYou ? 66 : 52)}
        title={tagTitle}
        sub={extra > 0 ? `${tagSub} · +${extra} kittens` : tagSub}
        tone={cat.needsYou ? "warning" : "default"}
      />
    </>
  );
}

function EmptyDesk(props: { readonly slot: Point }) {
  const [dx, dy] = props.slot;
  const lid0 = lift(iso(dx + 0.45, dy + 0.32), 15);
  const lid1 = lift(iso(dx + 1.05, dy + 0.32), 15);
  return (
    <g opacity={0.75}>
      <Box x={dx} y={dy} w={1.5} d={0.8} h={15} color="var(--office-wood)" />
      <polygon
        points={points([lid0, lid1, lift(lid1, 13), lift(lid0, 13)])}
        fill="var(--office-metal)"
      />
    </g>
  );
}

function Plant(props: { readonly at: Point }) {
  const [x, y] = iso(props.at[0] + 0.2, props.at[1] + 0.2);
  const leaf = { fill: "var(--office-leaf)", stroke: "var(--office-line)", strokeWidth: 0.6 };
  return (
    <g>
      <Box x={props.at[0]} y={props.at[1]} w={0.4} d={0.4} h={10} color="var(--office-wood)" />
      <circle cx={x} cy={y - 20} r={8} {...leaf} />
      <circle cx={x - 5} cy={y - 14} r={5} {...leaf} />
      <circle cx={x + 5} cy={y - 15} r={5.5} {...leaf} />
    </g>
  );
}

const HOST_REFRESH_MS = 10_000;

/** One machine's CPU and memory, refreshed while the tab is visible. */
function useHostResources(environmentId: EnvironmentId) {
  const query = useEnvironmentQuery<HostResourcesSnapshot, unknown>(
    serverEnvironment.hostResources({ environmentId, input: {} }),
  );
  const { refresh } = query;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls a pull-only RPC on a timer; no React state is synced
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, HOST_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return query.data;
}

function HostScreen(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly onOpen: (anchor: Element) => void;
}) {
  const host = useHostResources(props.environmentId);
  const width = 4.5 * TILE_W;
  const cpu = host?.cpuUtilization ?? null;
  const usedGb = host ? (host.totalMemoryBytes - host.availableMemoryBytes) / 1024 ** 3 : null;
  const totalGb = host ? host.totalMemoryBytes / 1024 ** 3 : null;
  const meter = (y: number, fraction: number | null, color: string) => (
    <>
      <rect x={6} y={y} width={width - 12} height={5} rx={2.5} fill="var(--muted)" />
      {fraction !== null ? (
        <rect
          x={6}
          y={y}
          width={(width - 12) * Math.min(1, fraction)}
          height={5}
          rx={2.5}
          fill={color}
        />
      ) : null}
    </>
  );
  return (
    <Hit label={`${props.label} CPU and memory`} onOpen={props.onOpen}>
      <BackWall x={8.7} top={84}>
        <rect
          width={width}
          height={48}
          rx={3}
          fill="var(--code-background)"
          stroke="var(--office-line)"
          strokeWidth={0.8}
        />
        <text x={6} y={11} fontSize={9} fontWeight={700} fill="var(--foreground)">
          {props.label.length > 16 ? `${props.label.slice(0, 15)}…` : props.label}
        </text>
        <text
          x={6}
          y={21}
          fontSize={8}
          fontFamily="var(--font-mono)"
          fill="var(--muted-foreground)"
        >
          CPU {cpu === null ? "–" : `${Math.round(cpu * 100)}%`}
        </text>
        {meter(24, cpu, "var(--chart-1, var(--primary))")}
        <text
          x={6}
          y={37}
          fontSize={8}
          fontFamily="var(--font-mono)"
          fill="var(--muted-foreground)"
        >
          mem {usedGb === null ? "–" : `${usedGb.toFixed(0)}/${totalGb!.toFixed(0)} GB`}
        </text>
        {meter(40, usedGb !== null && totalGb ? usedGb / totalGb : null, "var(--info)")}
      </BackWall>
    </Hit>
  );
}

export interface BoatGate {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly command: string;
  readonly threadTitle: string;
}

/** Background `boat-verify` commands, found on the thread summaries without opening details. */
function findBoatGates(threads: ReadonlyArray<EnvironmentThreadShell>): ReadonlyArray<BoatGate> {
  return threads.flatMap((thread) =>
    thread.pendingBackgroundTasks.flatMap((task) =>
      task.kind === "command" && task.itemId && isBoatVerifyCommand(task.command)
        ? [
            {
              environmentId: thread.environmentId,
              threadId: thread.id,
              itemId: task.itemId,
              command: task.command ?? "",
              threadTitle: thread.title,
            },
          ]
        : [],
    ),
  );
}

/** Whether the gate went to boat.dev, from its forced flag or its first output line. */
function useBoatRoute(gate: BoatGate | null) {
  // The output keeps only a tail, so the first line scrolls away on a long gate: remember the
  // route once seen, and stop streaming output then.
  const [seen, setSeen] = useState<{ itemId: TurnItemId; route: "remote" | "local" } | null>(null);
  const forced = gate ? boatVerifyRoute(gate.command, "") : null;
  const remembered = gate && seen?.itemId === gate.itemId ? seen.route : null;
  const known = forced ?? remembered;
  const streaming = useCommandOutputStreaming(gate?.environmentId ?? ("" as EnvironmentId));
  const { data } = useEnvironmentQuery<CommandOutputView, unknown>(
    gate && streaming && known === null
      ? orchestrationEnvironment.v2.commandOutput({
          environmentId: gate.environmentId,
          input: { threadId: gate.threadId, itemId: gate.itemId },
        })
      : null,
  );
  const printed = data ? boatVerifyRoute("", data.output.text) : null;
  if (gate && printed && known === null) setSeen({ itemId: gate.itemId, route: printed });
  return known ?? printed;
}

function BoatRack(props: {
  readonly gate: BoatGate | null;
  readonly onOpen: (anchor: Element) => void;
}) {
  const route = useBoatRoute(props.gate);
  const lit = route === "remote";
  // Amber while a gate runs whose route the office can't see yet; dark when idle or local.
  const pending = props.gate !== null && route === null;
  const face = iso(6.0, 0.82);
  const label = props.gate
    ? route === "remote"
      ? `boat.dev: gate running for ${props.gate.threadTitle}`
      : route === "local"
        ? `Gate running locally for ${props.gate.threadTitle}`
        : `Gate running for ${props.gate.threadTitle}, route unknown`
    : "boat.dev: no remote gate running";
  return (
    <Hit label={label} onOpen={props.onOpen}>
      <Box x={6.0} y={0.12} w={1.05} d={0.7} h={66} color="var(--office-rack)" />
      <g transform={`translate(${face[0]},${face[1] - 66}) skewY(26.565)`}>
        {Array.from({ length: 18 }, (_, index) => {
          const row = Math.floor(index / 3);
          const col = index % 3;
          return (
            <rect
              key={index}
              x={5 + col * 7}
              y={8 + row * 8}
              width={4}
              height={2.4}
              rx={1}
              fill={
                lit
                  ? index % 4 === 0
                    ? "var(--warning)"
                    : "var(--success)"
                  : pending && index % 2 === 0
                    ? "var(--warning)"
                    : "var(--office-slab)"
              }
            />
          );
        })}
        <text x={3} y={62} fontSize={7} fill={lit ? "var(--info)" : "var(--muted-foreground)"}>
          boat.dev
        </text>
      </g>
    </Hit>
  );
}

type Selection =
  | {
      readonly kind: "cat";
      readonly key: string;
      readonly zone: Cat["zone"];
      readonly needsYou: boolean;
      readonly anchor: Element;
    }
  | {
      readonly kind: "host" | "boat" | "scout" | "overflow";
      readonly anchor: Element;
    };

export function OfficePage() {
  const threads = useQuietThreadShells();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const nowIso = useNowMinute();
  const ideas = useOfficeIdeas(Date.parse(nowIso));
  const boardIdeas = ideas.filter((idea) => idea.stage.kind === "board");
  const layout = layoutOffice(
    threads.filter((thread) => !isOfficeHelperThread(thread)),
    Date.parse(nowIso),
  );
  // Scout's threads carry hidden tags for most people, so read them from every thread.
  const allThreads = useThreadShells();
  // Scout is paused when no project has a goal.
  const hasGoals = allThreads.some(isGoalThread);
  const carrying = useScoutCarrying(allThreads, ideas);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const boatGates = findBoatGates(threads);
  // A gate known to be on boat.dev wins, so one local gate can't hide a remote one.
  const boatGate =
    boatGates.find((gate) => boatVerifyRoute(gate.command, "") === "remote") ??
    boatGates[0] ??
    null;

  const projectTitle = (thread: EnvironmentThreadShell) =>
    projects.find(
      (project) =>
        project.environmentId === thread.environmentId && project.id === thread.projectId,
    )?.title ?? null;
  const threadTitle = (environmentId: EnvironmentId, id: ThreadId | null) =>
    threads.find((thread) => thread.environmentId === environmentId && thread.id === id)?.title ??
    null;
  const hostEnvironmentId = layout.desks[0]?.thread.environmentId ?? primaryEnvironmentId;
  const hostLabel =
    environments.find((environment) => environment.environmentId === hostEnvironmentId)?.label ??
    "This machine";

  const openCat: OpenCat = (cat, anchor) =>
    setSelection({ kind: "cat", key: cat.key, zone: cat.zone, needsYou: cat.needsYou, anchor });
  // The popover follows the cat's live state. It closes when the cat leaves the office or moves,
  // since the element it points at is gone then.
  const selectedCat =
    selection?.kind === "cat"
      ? ([...layout.desks, ...layout.breakRoom, ...layout.lounge]
          .flatMap((cat) => [cat, ...cat.kittens])
          .find((cat) => cat.key === selection.key) ?? null)
      : null;
  const selectionStale =
    selection?.kind === "cat" &&
    (selectedCat === null ||
      selectedCat.zone !== selection.zone ||
      selectedCat.needsYou !== selection.needsYou);
  if (selectionStale) setSelection(null);
  const popoverOpen = selection !== null && !selectionStale;
  const open = (kind: "host" | "boat" | "scout" | "overflow") => (anchor: Element) =>
    setSelection({ kind, anchor });

  // Two rows of desks, a third only when they fill up.
  const deskSlots = DESK_SLOTS.slice(0, layout.desks.length > 8 ? 12 : 8);
  const desks = layout.desks.slice(0, deskSlots.length);
  const breakRoom = layout.breakRoom.slice(0, BREAK_SPOTS.length);
  const lounge = layout.lounge.slice(0, LOUNGE_SPOTS.length);
  // Cats with no spot left, listed from the overflow sign so every one stays reachable.
  const overflowLabel = (count: number) => `${count} more ${count === 1 ? "cat" : "cats"}`;
  const overflowCats = [
    ...layout.desks.slice(desks.length).flatMap((cat) => [cat, ...cat.kittens]),
    ...desks.flatMap((cat) => cat.kittens.slice(KITTEN_OFFSETS.length)),
    ...layout.breakRoom.slice(breakRoom.length),
    ...layout.lounge.slice(lounge.length),
  ];
  const workingCount = layout.desks.filter((cat) => cat.working && !cat.needsYou).length;
  const kittenCount = layout.desks.reduce((sum, cat) => sum + cat.kittens.length, 0);
  const firstNeed = layout.needsYou[0] ?? null;

  // Paint back to front so nearer furniture covers what sits behind it.
  const drawn: Array<{ readonly depth: number; readonly node: ReactNode }> = [];
  if (hostEnvironmentId) {
    drawn.push({
      depth: -1,
      node: (
        <HostScreen
          key="host"
          environmentId={hostEnvironmentId}
          label={hostLabel}
          onOpen={open("host")}
        />
      ),
    });
  }
  drawn.push({ depth: 6.6, node: <BoatRack key="rack" gate={boatGate} onOpen={open("boat")} /> });
  deskSlots.forEach((slot, index) => {
    const cat = desks[index];
    drawn.push({
      depth: slot[0] + slot[1] + 0.8,
      node: cat ? (
        <DeskCat key={cat.key} cat={cat} slot={slot} onOpen={openCat} />
      ) : (
        <EmptyDesk key={`desk-${slot[0]}-${slot[1]}`} slot={slot} />
      ),
    });
  });
  drawn.push({
    depth: 7.8,
    node: <Box key="counter" x={8.3} y={0.1} w={5.4} d={0.62} h={20} color="var(--card)" />,
  });
  drawn.push({
    depth: 11.0,
    node: (
      <Box
        key="machine"
        x={12.4}
        y={0.18}
        w={0.62}
        d={0.42}
        h={17}
        base={20}
        color="var(--office-metal)"
      />
    ),
  });
  drawn.push({
    depth: 12.4,
    node: <Box key="table" x={10.0} y={1.0} w={1.1} d={0.5} h={11} color="var(--office-wood)" />,
  });
  breakRoom.forEach((cat, index) => {
    const spot = BREAK_SPOTS[index]!;
    const [x, y] = iso(...spot);
    drawn.push({
      depth: spot[0] + spot[1],
      node: (
        <Hit
          key={cat.key}
          label={`${cat.thread.title}: on break`}
          onOpen={(anchor) => openCat(cat, anchor)}
        >
          <g transform={`translate(${x},${y})`}>
            <OfficeCat fur={catFurFor(cat.key)} pose="coffee" />
          </g>
        </Hit>
      ),
    });
  });
  drawn.push({
    depth: 17,
    node: (
      <g key="couch">
        <Box x={12.9} y={4.6} w={0.85} d={3.0} h={10} color="var(--office-couch)" />
        <Box x={13.45} y={4.6} w={0.3} d={3.0} h={24} color="var(--office-couch)" />
        <Box x={12.9} y={4.45} w={0.85} d={0.2} h={18} color="var(--office-couch)" />
        <Box x={12.9} y={7.6} w={0.85} d={0.2} h={18} color="var(--office-couch)" />
      </g>
    ),
  });
  {
    const [bx, by] = iso(10.2, 7.3);
    drawn.push({
      depth: 17.2,
      node: (
        <ellipse
          key="beanbag"
          cx={bx}
          cy={by - 4}
          rx={16}
          ry={10}
          fill="var(--office-floor-break)"
          stroke="var(--office-line)"
          strokeWidth={0.7}
        />
      ),
    });
  }
  lounge.forEach((cat, index) => {
    const spot = LOUNGE_SPOTS[index]!;
    const [x, y] = iso(...spot.at);
    drawn.push({
      depth: 18 + index,
      node: (
        <Hit
          key={cat.key}
          label={`${cat.thread.title}: settled`}
          onOpen={(anchor) => openCat(cat, anchor)}
        >
          <g transform={`translate(${x},${y - spot.seat})`}>
            <OfficeCat fur={catFurFor(cat.key)} pose="sleeping" />
          </g>
        </Hit>
      ),
    });
  });
  for (const at of [
    [13.3, 1.0],
    [7.4, 8.3],
    [0.3, 5.5],
  ] as const) {
    drawn.push({ depth: at[0] + at[1] + 0.4, node: <Plant key={`plant-${at[0]}`} at={at} /> });
  }
  {
    const [sx, sy] = iso(1.8, 7.7);
    const scoutNews =
      carrying.length > 0
        ? `${carrying.length} new ${carrying.length === 1 ? "issue" : "issues"}`
        : hasGoals
          ? "on watch"
          : "needs goals";
    drawn.push({
      depth: 9.5,
      node: (
        <g key="scout">
          <Hit label={`Scout: ${scoutNews}`} onOpen={open("scout")}>
            <g transform={`translate(${sx},${sy})`}>
              <OfficeDog carrying={carrying.length > 0} />
            </g>
          </Hit>
          <NameTag at={[sx + 8, sy - 54]} title="Scout" sub={scoutNews} />
        </g>
      ),
    });
  }
  if (overflowCats.length > 0) {
    const [ox, oy] = iso(5.4, 8.0);
    drawn.push({
      depth: 13.5,
      node: (
        <Hit key="overflow" label={overflowLabel(overflowCats.length)} onOpen={open("overflow")}>
          <NameTag at={[ox, oy - 4]} title={`+${overflowLabel(overflowCats.length)}`} clickable />
        </Hit>
      ),
    });
  }
  drawn.sort((a, b) => a.depth - b.depth);

  const corner = iso(0, 0);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 scrollbar-gutter-both">
        <header className="flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-lg font-semibold">Office</h1>
          <Badge variant="info">{workingCount} working</Badge>
          {kittenCount > 0 ? <Badge variant="outline">{kittenCount} kittens</Badge> : null}
          <Badge variant={layout.needsYou.length > 0 ? "warning" : "outline"}>
            {layout.needsYou.length} need you
          </Badge>
          <Badge variant="secondary">{layout.breakRoom.length} on break</Badge>
          <Badge variant="success">{layout.lounge.length} settled</Badge>
        </header>

        <svg
          viewBox={`${corner[0] - GRID_Y * TILE_W - 12} 16 ${VIEW_W - 56} ${VIEW_H - 20}`}
          className={`mx-auto block h-auto w-full max-w-5xl select-none ${OFFICE_PALETTE_CLASS}`}
          role="group"
          aria-label="Office"
        >
          <polygon
            points={points([
              iso(0, GRID_Y),
              iso(GRID_X, GRID_Y),
              lift(iso(GRID_X, GRID_Y), -10),
              lift(iso(0, GRID_Y), -10),
            ])}
            fill="var(--office-slab)"
          />
          <polygon
            points={points([
              iso(GRID_X, 0),
              iso(GRID_X, GRID_Y),
              lift(iso(GRID_X, GRID_Y), -10),
              lift(iso(GRID_X, 0), -10),
            ])}
            fill="var(--office-slab-side)"
          />
          <FloorQuad from={[0, 0]} to={[8, 6]} fill="var(--office-floor-desk)" />
          <FloorQuad from={[8, 0]} to={[GRID_X, 4]} fill="var(--office-floor-break)" />
          <FloorQuad from={[8, 4]} to={[GRID_X, GRID_Y]} fill="var(--office-floor-lounge)" />
          <FloorQuad from={[0, 6]} to={[8, GRID_Y]} fill="var(--office-floor-lobby)" />
          <FloorQuad from={[8.8, 4.8]} to={[12.4, 8.4]} fill="var(--office-rug)" />
          <FloorQuad from={[0.15, 7.2]} to={[1.1, 8.5]} fill="var(--office-floor-desk)" />
          {Array.from({ length: 7 }, (_, index) => {
            const [x1, y1] = iso(index + 1, 0);
            const [x2, y2] = iso(index + 1, 6);
            return (
              <line
                key={index}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--border)"
                strokeWidth={0.5}
                opacity={0.6}
              />
            );
          })}
          <FloorLabel at={[1.0, 6.0]}>DESKS</FloorLabel>
          <FloorLabel at={[8.4, 3.85]}>BREAK ROOM</FloorLabel>
          <FloorLabel at={[8.6, 8.85]}>LOUNGE</FloorLabel>
          <FloorLabel at={[2.6, 8.85]}>LOBBY</FloorLabel>

          <polygon
            points={points([
              iso(0, GRID_Y),
              iso(0, 0),
              lift(iso(0, 0), WALL_H),
              lift(iso(0, GRID_Y), WALL_H),
            ])}
            fill="var(--office-wall-side)"
            stroke="var(--border)"
          />
          <polygon
            points={points([
              iso(0, 0),
              iso(GRID_X, 0),
              lift(iso(GRID_X, 0), WALL_H),
              lift(iso(0, 0), WALL_H),
            ])}
            fill="var(--office-wall)"
            stroke="var(--border)"
          />
          <polyline
            points={points([
              lift(iso(0, GRID_Y), WALL_H),
              lift(iso(0, 0), WALL_H),
              lift(iso(GRID_X, 0), WALL_H),
            ])}
            fill="none"
            stroke="var(--office-slab)"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <polygon
            points={points([
              iso(0, 8.6),
              iso(0, 7.2),
              lift(iso(0, 7.2), 58),
              lift(iso(0, 8.6), 58),
            ])}
            fill="var(--office-door)"
            stroke="var(--border)"
          />
          <BackWall x={1.0} top={74}>
            <rect
              width={3.6 * TILE_W}
              height={34}
              rx={3}
              fill="var(--office-floor-break)"
              stroke="var(--border)"
            />
            <line x1={1.8 * TILE_W} y1={0} x2={1.8 * TILE_W} y2={34} stroke="var(--border)" />
          </BackWall>
          <Hit
            label={`Ideas whiteboard, ${boardIdeas.length} on the board`}
            onOpen={() => setIdeasOpen(true)}
          >
            <LeftWall y={4.8} top={74}>
              <rect
                width={3.4 * TILE_W}
                height={50}
                rx={3}
                fill="var(--card)"
                stroke="var(--office-line)"
                strokeWidth={1.2}
              />
              <text x={6} y={11} fontSize={9} fontWeight={700} fill="var(--foreground)">
                IDEAS · {boardIdeas.length}
              </text>
              {[0, 1, 2, 3].slice(0, boardIdeas.length).map((index) => (
                <rect
                  key={index}
                  x={6 + index * 19}
                  y={18 + (index % 2) * 4}
                  width={16}
                  height={16}
                  rx={1.5}
                  fill={
                    [
                      "var(--office-fur-orange)",
                      "var(--office-floor-break)",
                      "var(--office-rug)",
                      "var(--office-fur-cream)",
                    ][index]
                  }
                />
              ))}
            </LeftWall>
          </Hit>

          {drawn.map((entry) => entry.node)}
        </svg>
        <IdeaIssueWatcher ideas={ideas} />
        <ConnectWatcher ideas={ideas} />

        {firstNeed ? (
          <button
            type="button"
            onClick={(event) => openCat(firstNeed, event.currentTarget)}
            className="mx-auto flex w-full max-w-5xl items-center gap-3 rounded-lg border border-warning bg-warning/10 px-3 py-2 text-left transition-colors hover:bg-warning/15"
          >
            <OfficeCatAvatar fur={catFurFor(firstNeed.key)} pose="waiting" size={34} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                {firstNeed.thread.title} needs you
                {layout.needsYou.length > 1 ? ` (+${layout.needsYou.length - 1} more)` : ""}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {firstNeed.thread.hasPendingUserInput
                  ? "Has a question for you"
                  : "Waiting for an approval"}
              </span>
            </span>
            <span className="text-sm font-medium text-primary">Answer</span>
          </button>
        ) : (
          <div className="mx-auto flex w-full max-w-5xl items-center gap-3 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
            <OfficeCatAvatar fur="grey" pose="sleeping" size={30} />
            Nothing needs you. Everyone is working, on break, or settled.
          </div>
        )}
      </div>

      <Popover open={popoverOpen} onOpenChange={(next) => (next ? null : setSelection(null))}>
        <PopoverPopup anchor={selection?.anchor ?? null} width="md" side="bottom" align="center">
          {selectedCat ? (
            <OfficeCatDetails
              key={selectedCat.key}
              cat={selectedCat}
              pose={poseOf(selectedCat)}
              projectTitle={projectTitle(selectedCat.thread)}
              parentTitle={
                selectedCat.thread.lineage.parentThreadId
                  ? threadTitle(
                      selectedCat.thread.environmentId,
                      selectedCat.thread.lineage.parentThreadId,
                    )
                  : null
              }
              onClose={() => setSelection(null)}
            />
          ) : selection?.kind === "host" ? (
            <p className="text-sm">
              <span className="font-semibold">{hostLabel}</span>: CPU and memory of the machine
              running these agents, refreshed every 10 seconds while this tab is open.
            </p>
          ) : selection?.kind === "boat" ? (
            <p className="text-sm">
              {boatGate
                ? `A boat-verify gate is running for “${boatGate.threadTitle}”. Green lights mean it went to a boat.dev VM, and dark means it runs locally. Amber means the route isn't known yet: a background gate's output isn't visible here, so pass --remote or --local to show it.`
                : "No boat-verify gate is running. The rack lights up while a gate runs on a boat.dev VM."}
            </p>
          ) : selection?.kind === "overflow" ? (
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {overflowCats.map((cat) => (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => openCat(cat, selection.anchor)}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent"
                >
                  <OfficeCatAvatar fur={catFurFor(cat.key)} pose={poseOf(cat)} size={24} />
                  <span className="min-w-0 flex-1 truncate">{cat.thread.title}</span>
                </button>
              ))}
            </div>
          ) : selection?.kind === "scout" ? (
            <ScoutFinds
              carrying={carrying}
              threads={allThreads}
              projects={projects}
              hasGoals={hasGoals}
            />
          ) : null}
        </PopoverPopup>
      </Popover>
      <Dialog open={ideasOpen} onOpenChange={setIdeasOpen}>
        <DialogPopup className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Ideas</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <OfficeIdeasBoard ideas={ideas} onClose={() => setIdeasOpen(false)} />
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </SidebarInset>
  );
}
