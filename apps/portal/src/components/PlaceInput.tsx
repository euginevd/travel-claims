import { Plane } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { loadAirports, placeText, suggest, type Airport } from "../places";

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  destination?: string;
  className?: string;
}

/** "Where?" with airport and city suggestions: a WAI-ARIA combobox that still takes free text. */
export function PlaceInput({ id, value, onChange, destination = "", className }: Props) {
  const listId = useId();
  const [airports, setAirports] = useState<Airport[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (!open || airports.length > 0) return;
    let live = true;
    void loadAirports().then((loaded) => {
      if (live) setAirports(loaded);
    });
    return () => {
      live = false;
    };
  }, [open, airports.length]);

  const options = open ? suggest(airports, value, destination) : [];
  const expanded = options.length > 0;

  function pick(airport: Airport) {
    onChange(placeText(airport));
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="place-input">
      <input
        id={id}
        className={className}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${String(active)}` : undefined}
        autoComplete="off"
        maxLength={200}
        placeholder="City or airport"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(index + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && expanded && active >= 0) {
            event.preventDefault();
            const chosen = options[active];
            if (chosen) pick(chosen);
          } else if (event.key === "Escape") {
            setOpen(false);
            setActive(-1);
          }
        }}
      />
      <div id={listId} role="listbox" className="place-options" hidden={!expanded}>
        {options.map((airport, index) => (
          <div
            key={airport.iata}
            id={`${listId}-${String(index)}`}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            className={`place-option${index === active ? " active" : ""}`}
            onMouseDown={(event) => {
              // Pick before the input's blur closes the list.
              event.preventDefault();
              pick(airport);
            }}
          >
            <Plane size={16} strokeWidth={2} aria-hidden="true" />
            <span>
              <strong>{airport.city}</strong> · {airport.iata}
              <span className="muted">
                {" "}
                — {airport.name}, {airport.country}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
