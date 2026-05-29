"use client";
const TITLES = [
  "Property & Identity",
  "Rooms & Pricing",
  "Payment",
  "Rules",
  "Amenities & Food",
  "Photos & Review"
] as const;

export default function PgStepIndicator({ current }: { current: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const pct = Math.round(((current - 1) / 6) * 100);
  return (
    <nav aria-label="Wizard progress">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ width: `${pct}%` }}
      />
      <ol>
        {TITLES.map((t, i) => (
          <li key={t} aria-current={current === i + 1 ? "step" : undefined}>
            {t}
          </li>
        ))}
      </ol>
    </nav>
  );
}
