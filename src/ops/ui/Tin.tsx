import type { CSSProperties } from "react";
import type { Vessel } from "../engine/data";

type Box = { x: number; y: number; w: number; h: number; rx: number };

// Inner fill area for each vessel, in a 100 × 130 viewBox.
const INNER: Record<Vessel, Box> = {
  tin: { x: 24, y: 30, w: 52, h: 88, rx: 3 },
  carton: { x: 26, y: 42, w: 48, h: 77, rx: 2 },
  jar: { x: 23, y: 34, w: 54, h: 84, rx: 12 },
  box: { x: 18, y: 50, w: 64, h: 69, rx: 2 },
};

function Outline({ vessel }: { vessel: Vessel }) {
  switch (vessel) {
    case "tin":
      return <>
        <rect className="vessel-body" x="20" y="24" width="60" height="98" rx="6" />
        <rect className="vessel-cap" x="16" y="10" width="68" height="17" rx="4" />
        <line className="vessel-band" x1="20" y1="44" x2="80" y2="44" />
      </>;
    case "carton":
      return <>
        <rect className="vessel-body" x="22" y="38" width="56" height="84" rx="3" />
        <path className="vessel-cap" d="M22 38 L50 15 L78 38 Z" />
        <rect className="vessel-cap" x="44" y="7" width="12" height="9" rx="2" />
      </>;
    case "jar":
      return <>
        <rect className="vessel-body" x="18" y="28" width="64" height="94" rx="16" />
        <rect className="vessel-cap" x="27" y="9" width="46" height="15" rx="3" />
        <rect className="vessel-neck" x="31" y="22" width="38" height="8" rx="2" />
      </>;
    case "box":
      return <>
        <rect className="vessel-body" x="14" y="46" width="72" height="76" rx="3" />
        <path className="vessel-cap" d="M14 46 L4 30 L38 38 L44 46 Z" />
        <path className="vessel-cap" d="M86 46 L96 30 L62 38 L56 46 Z" />
      </>;
  }
}

export function TinGraphic({ id, vessel, color, fill, reorderLine, drainIndex, size = 96 }: {
  id: string;
  vessel: Vessel;
  color: string;
  fill: number;
  /** 0–1 position of the reorder point on the same scale as `fill`. */
  reorderLine: number;
  /** When set, this tin is part of the current order's drain and animates in sequence. */
  drainIndex?: number;
  size?: number;
}) {
  const inner = INNER[vessel];
  const clipId = `tin-clip-${id}`;
  const style: CSSProperties = {
    transform: `scaleY(${Math.max(0, Math.min(1, fill))})`,
    transitionDelay: drainIndex !== undefined ? `${drainIndex * 110}ms` : undefined,
  };
  const lineY = inner.y + inner.h * (1 - Math.min(1, reorderLine));
  return (
    <svg className={`tin-graphic vessel-${vessel}`} viewBox="0 0 100 130" width={size} height={size * 1.3} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}><rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} rx={inner.rx} /></clipPath>
      </defs>
      <Outline vessel={vessel} />
      <g clipPath={`url(#${clipId})`}>
        <rect className="vessel-empty" x={inner.x} y={inner.y} width={inner.w} height={inner.h} />
        <rect className="vessel-fill" x={inner.x} y={inner.y} width={inner.w} height={inner.h} fill={color} style={style} />
        {fill > 0.01 && <line className="vessel-surface" x1={inner.x} x2={inner.x + inner.w} y1={inner.y} y2={inner.y} style={{ transform: `translateY(${inner.h * (1 - Math.min(1, fill))}px)`, transitionDelay: style.transitionDelay }} />}
        {vessel === "box" && [0.2, 0.4, 0.6, 0.8].map((level) => (
          <line key={level} className="vessel-stack" x1={inner.x} x2={inner.x + inner.w} y1={inner.y + inner.h * level} y2={inner.y + inner.h * level} />
        ))}
        {reorderLine > 0 && reorderLine < 1 && <line className="vessel-reorder" x1={inner.x} x2={inner.x + inner.w} y1={lineY} y2={lineY} />}
      </g>
    </svg>
  );
}
