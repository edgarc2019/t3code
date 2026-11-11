import { useEffect, useRef } from "react";

/** Colours the office derives from the theme, set once on the scene's root `<svg>`. */
export const OFFICE_PALETTE_CLASS = [
  "[--office-line:color-mix(in_oklab,var(--foreground)_72%,var(--background))]",
  "[--office-fur-tux:color-mix(in_oklab,var(--foreground)_82%,var(--background))]",
  "[--office-belly-tux:color-mix(in_oklab,var(--background)_88%,var(--warning))]",
  "[--office-fur-orange:color-mix(in_oklab,var(--warning)_58%,var(--card))]",
  "[--office-fur-grey:color-mix(in_oklab,var(--muted-foreground)_52%,var(--card))]",
  "[--office-fur-cream:color-mix(in_oklab,var(--warning)_24%,var(--card))]",
  "[--office-belly:color-mix(in_oklab,var(--background)_90%,var(--warning))]",
  "[--office-pink:color-mix(in_oklab,var(--destructive)_55%,var(--background))]",
  "[--office-dog:color-mix(in_oklab,var(--muted-foreground)_62%,var(--card))]",
  "[--office-dog-dark:color-mix(in_oklab,var(--foreground)_70%,var(--background))]",
  "[--office-floor-desk:color-mix(in_oklab,var(--warning)_16%,var(--card))]",
  "[--office-floor-break:color-mix(in_oklab,var(--info)_14%,var(--card))]",
  "[--office-floor-lounge:color-mix(in_oklab,var(--success)_13%,var(--card))]",
  "[--office-floor-lobby:color-mix(in_oklab,var(--muted-foreground)_10%,var(--card))]",
  "[--office-rug:color-mix(in_oklab,var(--success)_30%,var(--card))]",
  "[--office-wall:color-mix(in_oklab,var(--muted-foreground)_8%,var(--background))]",
  "[--office-wall-side:color-mix(in_oklab,var(--muted-foreground)_16%,var(--background))]",
  "[--office-wood:color-mix(in_oklab,var(--warning)_38%,var(--card))]",
  "[--office-metal:color-mix(in_oklab,var(--muted-foreground)_35%,var(--card))]",
  "[--office-rack:color-mix(in_oklab,var(--foreground)_22%,var(--card))]",
  "[--office-couch:color-mix(in_oklab,var(--primary)_40%,var(--card))]",
  "[--office-leaf:color-mix(in_oklab,var(--success)_60%,var(--card))]",
  "[--office-slab:color-mix(in_oklab,var(--muted-foreground)_25%,var(--background))]",
  "[--office-slab-side:color-mix(in_oklab,var(--office-slab)_80%,black)]",
  "[--office-door:color-mix(in_oklab,var(--office-wood)_75%,black)]",
  "[--office-floor-label:color-mix(in_oklab,var(--muted-foreground)_70%,transparent)]",
  "[--office-cork:color-mix(in_oklab,var(--warning)_22%,var(--card))]",
].join(" ");

export type CatFur = "tux" | "orange" | "grey" | "cream";
export type CatPose = "typing" | "waiting" | "coffee" | "sleeping";

const FURS: ReadonlyArray<CatFur> = ["tux", "orange", "grey", "cream"];

/** A thread keeps the same fur everywhere it appears. */
export function catFurFor(key: string): CatFur {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return FURS[Math.abs(hash) % FURS.length]!;
}

const FUR_COLORS: Record<CatFur, { fur: string; belly: string; eye: string }> = {
  tux: { fur: "var(--office-fur-tux)", belly: "var(--office-belly-tux)", eye: "var(--warning)" },
  orange: {
    fur: "var(--office-fur-orange)",
    belly: "var(--office-belly)",
    eye: "var(--office-line)",
  },
  grey: { fur: "var(--office-fur-grey)", belly: "var(--office-belly)", eye: "var(--office-line)" },
  cream: {
    fur: "var(--office-fur-cream)",
    belly: "var(--office-belly)",
    eye: "var(--office-line)",
  },
};

const LINE = "var(--office-line)";
const PINK = "var(--office-pink)";

const BOUNCE_FRAMES: Keyframe[] = [
  { transform: "translateY(0) scale(1, 1)" },
  { transform: "translateY(0) scale(1.1, 0.9)", offset: 0.12 },
  { transform: "translateY(-16px) scale(0.95, 1.05)", offset: 0.5 },
  { transform: "translateY(0) scale(1.08, 0.92)", offset: 0.88 },
  { transform: "translateY(0) scale(1, 1)" },
];
const BOUNCE_EVERY_MS = 6_000;

/**
 * Hops a few times, then rests, so the scene is not repainting all the time.
 * Paused while the tab is hidden and skipped under reduced motion.
 */
function useBounceBursts(enabled: boolean) {
  const ref = useRef<SVGGElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives a Web Animations burst on a timer; no React state is synced
  useEffect(() => {
    if (!enabled) return;
    const hop = () => {
      const element = ref.current;
      if (!element || document.visibilityState !== "visible") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      element.animate(BOUNCE_FRAMES, { duration: 620, iterations: 3, easing: "ease-in-out" });
    };
    hop();
    const timer = window.setInterval(hop, BOUNCE_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return ref;
}

/** A cat drawn with its feet at (0, 0), about 44 units tall. */
export function OfficeCat(props: { readonly fur: CatFur; readonly pose: CatPose }) {
  const { fur, belly, eye } = FUR_COLORS[props.fur];
  const bounceRef = useBounceBursts(props.pose === "waiting");
  const asleep = props.pose === "sleeping";
  const body = (
    <g>
      <path
        d="M8 -4C21 -5 22 -19 15 -24"
        fill="none"
        stroke={fur}
        strokeWidth={4.6}
        strokeLinecap="round"
      />
      <ellipse cx={0} cy={-11.5} rx={11} ry={11} fill={fur} stroke={LINE} strokeWidth={1.1} />
      <ellipse cx={0} cy={-9} rx={6} ry={7.5} fill={belly} />
      <ellipse cx={-5} cy={-1.5} rx={3.4} ry={2.3} fill={belly} stroke={LINE} strokeWidth={0.9} />
      <ellipse cx={5} cy={-1.5} rx={3.4} ry={2.3} fill={belly} stroke={LINE} strokeWidth={0.9} />
      <path
        d="M-9.5 -31L-8 -42.5L-1.5 -36.5Z"
        fill={fur}
        stroke={LINE}
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
      <path
        d="M9.5 -31L8 -42.5L1.5 -36.5Z"
        fill={fur}
        stroke={LINE}
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
      <path d="M-7.6 -34L-7.3 -39.5L-3.8 -36.2Z" fill={PINK} />
      <path d="M7.6 -34L7.3 -39.5L3.8 -36.2Z" fill={PINK} />
      <circle cx={0} cy={-28} r={10.5} fill={fur} stroke={LINE} strokeWidth={1.1} />
      <ellipse cx={0} cy={-24.2} rx={5.2} ry={3.6} fill={belly} />
      {asleep ? (
        <path
          d="M-6 -28.5q2 1.8 4 0M2 -28.5q2 1.8 4 0"
          stroke={LINE}
          strokeWidth={1.2}
          fill="none"
          strokeLinecap="round"
        />
      ) : (
        <>
          <ellipse cx={-4} cy={-29} rx={1.8} ry={2.2} fill={eye} />
          <ellipse cx={4} cy={-29} rx={1.8} ry={2.2} fill={eye} />
          <circle cx={-3.4} cy={-29.8} r={0.6} fill="var(--background)" />
          <circle cx={4.6} cy={-29.8} r={0.6} fill="var(--background)" />
        </>
      )}
      <ellipse cx={-7} cy={-25} rx={2} ry={1.2} fill={PINK} opacity={0.55} />
      <ellipse cx={7} cy={-25} rx={2} ry={1.2} fill={PINK} opacity={0.55} />
      <path d="M-1.3 -26h2.6l-1.3 1.5z" fill={PINK} />
      <path
        d="M0 -24.5q-1.5 1.6 -3 .4M0 -24.5q1.5 1.6 3 .4"
        stroke={LINE}
        strokeWidth={0.8}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M-5 -25.5l-7 -1M-5 -24.5l-7 1M5 -25.5l7 -1M5 -24.5l7 1"
        stroke={LINE}
        strokeWidth={0.5}
        opacity={0.7}
      />
      {props.pose === "coffee" ? (
        <g>
          <rect
            x={7}
            y={-17}
            width={7}
            height={7}
            rx={1.5}
            fill="var(--card)"
            stroke={LINE}
            strokeWidth={0.9}
          />
          <path d="M14 -15.5q3 1.5 0 3.5" fill="none" stroke={LINE} strokeWidth={0.9} />
          <path
            d="M9.5 -19q-1.5 -2 0 -4M12 -19q1.5 -2 0 -4"
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth={1}
            strokeLinecap="round"
          />
          <ellipse cx={7} cy={-12} rx={3} ry={2.3} fill={belly} stroke={LINE} strokeWidth={0.9} />
        </g>
      ) : null}
      {asleep ? (
        <text x={10} y={-38} fontSize={9} fontWeight={700} fill="var(--muted-foreground)">
          z
          <tspan dx={1} dy={-4}>
            z
          </tspan>
        </text>
      ) : null}
    </g>
  );
  if (props.pose !== "waiting") return body;
  return (
    <g ref={bounceRef} className="[transform-box:fill-box] [transform-origin:50%_100%]">
      {body}
      <g transform="translate(13,-52)">
        <circle r={7.5} fill="var(--warning)" />
        <text y={3.6} textAnchor="middle" fontSize={11} fontWeight={800} fill="var(--background)">
          ?
        </text>
      </g>
    </g>
  );
}

/** Scout, a blue merle Australian shepherd, feet at (0, 0), facing right. */
/** Scout. Carrying, he holds the issues he fetched in his mouth. */
export function OfficeDog(props: { readonly carrying?: boolean }) {
  const dog = "var(--office-dog)";
  const dark = "var(--office-dog-dark)";
  const white = "var(--office-belly)";
  return (
    <g>
      <path
        d="M-16 -22q-6 -4 -7 -9"
        stroke={dog}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />
      <rect
        x={-13}
        y={-14}
        width={4.5}
        height={14}
        rx={2}
        fill={dog}
        stroke={LINE}
        strokeWidth={0.8}
      />
      <rect
        x={-6}
        y={-14}
        width={4.5}
        height={14}
        rx={2}
        fill={white}
        stroke={LINE}
        strokeWidth={0.8}
      />
      <rect
        x={6}
        y={-14}
        width={4.5}
        height={14}
        rx={2}
        fill={white}
        stroke={LINE}
        strokeWidth={0.8}
      />
      <rect
        x={12}
        y={-14}
        width={4.5}
        height={14}
        rx={2}
        fill={dog}
        stroke={LINE}
        strokeWidth={0.8}
      />
      <ellipse cx={0} cy={-20} rx={18} ry={10} fill={dog} stroke={LINE} strokeWidth={1} />
      <circle cx={-8} cy={-23} r={3.6} fill={dark} />
      <circle cx={-1} cy={-26} r={2.6} fill={dark} />
      <circle cx={-11} cy={-16} r={2.3} fill={dark} />
      <circle cx={4} cy={-22} r={2} fill={dark} />
      <ellipse cx={12} cy={-17} rx={7} ry={8} fill={white} />
      <path
        d="M10 -27q8 -6 14 -12"
        stroke={white}
        strokeWidth={7}
        strokeLinecap="round"
        fill="none"
      />
      <circle cx={21} cy={-34} r={9.5} fill={dog} stroke={LINE} strokeWidth={1} />
      <circle cx={17} cy={-37} r={2.6} fill={dark} />
      <path
        d="M21 -43.5q1.5 6 0 13"
        stroke={white}
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
      <ellipse cx={28} cy={-30} rx={6.5} ry={4.3} fill={white} stroke={LINE} strokeWidth={0.9} />
      <ellipse cx={33.5} cy={-31.5} rx={2} ry={1.6} fill={dark} />
      <path d="M13 -40q-6 3 -4 10q4 -2 6 -7z" fill={dark} stroke={LINE} strokeWidth={0.8} />
      <path d="M26 -41q5 -2 6 3q-3 1 -6 -1z" fill={dog} stroke={LINE} strokeWidth={0.8} />
      <circle cx={24.5} cy={-36} r={1.9} fill="var(--info)" />
      <circle cx={25} cy={-36.6} r={0.6} fill="var(--background)" />
      {props.carrying ? (
        <g transform="rotate(-12 34 -26)">
          <rect
            x={27}
            y={-29}
            width={15}
            height={6}
            rx={1.5}
            fill="var(--background)"
            stroke={LINE}
            strokeWidth={0.8}
          />
          <path d="M30 -26h9" stroke="var(--muted-foreground)" strokeWidth={0.8} />
        </g>
      ) : null}
    </g>
  );
}

/** A small standalone cat for lists and the needs-you bar. */
export function OfficeCatAvatar(props: {
  readonly fur: CatFur;
  readonly pose: CatPose;
  readonly size?: number;
}) {
  const size = props.size ?? 36;
  const waiting = props.pose === "waiting";
  return (
    <svg
      width={size}
      height={size * 1.15}
      viewBox={waiting ? "-24 -62 48 66" : "-24 -50 48 54"}
      className={`shrink-0 overflow-visible ${OFFICE_PALETTE_CLASS}`}
      aria-hidden
    >
      <OfficeCat fur={props.fur} pose={props.pose} />
    </svg>
  );
}
