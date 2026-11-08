import { useId } from "react";

const LONGEST_AS_DAYS = 21;
const label = new Intl.DateTimeFormat("en-AU", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const full = new Intl.DateTimeFormat("en-AU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Every day from one ISO date to another, inclusive, as ISO dates. */
export function daysBetween(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
  const days: string[] = [];
  for (let t = start; t <= end && days.length < 400; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

interface DayPickerProps {
  label: string;
  from: string;
  to: string;
  value: string;
  unsure: boolean;
  onChange: (day: string) => void;
}

/** A day within the trip, chosen by tapping it: no typing and no mm/dd/yyyy. A long trip
 * falls back to a list of days. */
export function DayPicker({ label: legend, from, to, value, unsure, onChange }: DayPickerProps) {
  const ids = useId();
  const days = daysBetween(from, to);
  const at = (day: string) => new Date(`${day}T00:00:00Z`);

  if (days.length > LONGEST_AS_DAYS) {
    return (
      <p className="day-select">
        <label htmlFor={`${ids}-day`}>{legend}</label>
        <select
          id={`${ids}-day`}
          className={unsure ? "unsure" : ""}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          <option value="">Choose a day</option>
          {days.map((day) => (
            <option key={day} value={day}>
              {full.format(at(day))}
            </option>
          ))}
        </select>
      </p>
    );
  }

  return (
    <fieldset className={`day-picker${unsure ? " unsure" : ""}`}>
      <legend>{legend}</legend>
      <div className="days">
        {days.map((day) => (
          <label key={day} className={`day${day === value ? " chosen" : ""}`}>
            <input
              type="radio"
              name={`${ids}-day`}
              value={day}
              checked={day === value}
              aria-label={full.format(at(day))}
              onChange={() => {
                onChange(day);
              }}
            />
            {label.format(at(day))}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
