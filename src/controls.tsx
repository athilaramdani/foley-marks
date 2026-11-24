import type { ReactNode } from "react";
export function Icon({
  label,
  onClick,
  children,
  active = false,
  disabled = false,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      className={"button icon " + (active ? "active" : "ghost")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function NumberField({
  label,
  value,
  min = 0,
  max,
  step = 0.01,
  change,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  change: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        key={String(value)}
        defaultValue={Number(value.toFixed(4))}
        min={min}
        max={max}
        step={step}
        onBlur={(e) => {
          const n = e.target.valueAsNumber;
          if (
            Number.isFinite(n) &&
            n >= min &&
            (max === undefined || n <= max) &&
            n !== value
          )
            change(n);
          else e.target.value = String(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </Field>
  );
}
