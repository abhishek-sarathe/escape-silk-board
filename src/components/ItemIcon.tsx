// Bag icons. There is no samosa emoji (🫓 is flatbread and reads as a cookie on Android), so the samosa
// is drawn: a golden fried triangle with a crimped edge.
import type { ItemId } from "@/game/types";

const EMOJI: Record<Exclude<ItemId, "samosa">, string> = {
  chai: "☕",
  coffee: "☕",
  water: "💧",
  umbrella: "☂️",
};

/** The samosa as SVG paths in a 24x24 box, so it can sit inside other SVGs (the map's pins). */
export function SamosaPaths() {
  return (
    <>
      <path d="M12 2.5 L22 19.5 Q12 22.5 2 19.5 Z" fill="#d9922e" stroke="#8a4f12" strokeWidth={1.4} strokeLinejoin="round" />
      <path d="M12 6 L7.5 16" stroke="#f3c35f" strokeWidth={1.6} strokeLinecap="round" fill="none" />
      <path d="M4.5 19.6 l1.2 -1.1 M8 20.3 l1 -1.2 M12 20.6 l0 -1.4 M16 20.3 l-1 -1.2 M19.5 19.6 l-1.2 -1.1" stroke="#8a4f12" strokeWidth={1.1} strokeLinecap="round" />
      <circle cx="13.5" cy="12" r="0.8" fill="#8a4f12" />
      <circle cx="15" cy="15.2" r="0.7" fill="#8a4f12" />
    </>
  );
}

export function SamosaIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={`inline-block shrink-0 align-[-0.15em] ${className}`}>
      <SamosaPaths />
    </svg>
  );
}

export function ItemIcon({ id, size = 18 }: { id: ItemId; size?: number }) {
  if (id === "samosa") return <SamosaIcon size={size} />;
  return <span aria-hidden>{EMOJI[id]}</span>;
}
