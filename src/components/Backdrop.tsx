// Weather drawn over the page: rain streaks when the engine says it's raining. Decoration only; it
// reads state, never changes it. Time pressure lives on the clock badge in the HUD, not on the whole screen.

// Fixed positions and timings (not Math.random) so server and client render the same drops.
const DROPS = Array.from({ length: 48 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 53) % 85) / 100,
  duration: 0.7 + ((i * 29) % 30) / 100,
}));

export default function Backdrop({ raining }: { raining: boolean }) {
  if (!raining) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {DROPS.map((d, i) => (
        <span
          key={i}
          className="rain-drop"
          style={{ left: `${d.left}%`, animationDelay: `-${d.delay}s`, animationDuration: `${d.duration}s` }}
        />
      ))}
    </div>
  );
}
