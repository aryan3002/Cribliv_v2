"use client";
export default function AmenityGrid({
  title,
  options,
  value,
  onChange
}: {
  title: string;
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (k: string) => {
    const s = new Set(value);
    s.has(k) ? s.delete(k) : s.add(k);
    onChange(Array.from(s));
  };
  return (
    <fieldset>
      <legend>{title}</legend>
      {options.map((k) => (
        <label key={k}>
          <input
            type="checkbox"
            aria-label={k}
            checked={value.includes(k)}
            onChange={() => toggle(k)}
          />{" "}
          {k.replace(/_/g, " ")}
        </label>
      ))}
    </fieldset>
  );
}
