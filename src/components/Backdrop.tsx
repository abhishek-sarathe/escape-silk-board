// Weather and pressure, drawn over the page: rain when the engine says it's raining, and a hard
// frame that closes in as check-in gets near. Decoration only; it reads state, never changes it.

export default function Backdrop({ raining, minutesLeft, over }: { raining: boolean; minutesLeft: number; over: boolean }) {
  const final = !over && minutesLeft <= 15;
  const warning = !over && minutesLeft <= 30;
  const frame = final ? "inset 0 0 0 6px var(--color-brake)" : warning ? "inset 0 0 0 3px var(--color-sodium)" : "none";
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {raining && (
        <>
          <div className="rain rain-far" />
          <div className="rain rain-near" />
        </>
      )}
      <div className={`absolute inset-0 ${final ? "animate-pulse-soft" : ""}`} style={{ boxShadow: frame }} />
    </div>
  );
}
