import { Check, History, Lock, Save } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import {
  ApiError,
  SETTING_REASON_LIMIT,
  settingKeys,
  type Api,
  type Handler,
  type SettingChange,
  type SettingKey,
  type Settings,
  type SettingValues,
} from "../api";
import { dollars, when, words } from "../format";
import { DemoControls } from "../components/DemoControls";
import { useFocusHeading } from "../useFocusHeading";

type Kind = "money" | "percent" | "whole";

interface FieldDef {
  label: string;
  kind: Kind;
  step: number;
  help: string;
}

const FIELDS: Record<SettingKey, FieldDef> = {
  approval_limit: {
    label: "Approval limit",
    kind: "money",
    step: 50,
    help: "Payouts over this wait for a senior's sign-off",
  },
  round_spend_limit: {
    label: "Improvement budget",
    kind: "money",
    step: 0.5,
    help: "The most one improvement round may spend",
  },
  accuracy_objective: {
    label: "Accuracy",
    kind: "percent",
    step: 1,
    help: "How often it must match a handler on test claims",
  },
  straight_through_objective: {
    label: "Decided alone",
    kind: "percent",
    step: 1,
    help: "Claims it should settle without a person",
  },
  agents_at_once: {
    label: "Claims worked at once",
    kind: "whole",
    step: 1,
    help: "Claims the agent works side by side",
  },
};

/** A stored value as the number typed in its field: a share is typed as a percentage. */
function typed(kind: Kind, value: number): number {
  return kind === "percent" ? Number((value * 100).toFixed(2)) : value;
}

/** A stored value as people read it: "$1,000.00", "80%" or "5". */
export function shown(key: string, value: number): string {
  const kind = settingKeys.find((known) => known === key);
  if (!kind) return String(value);
  if (FIELDS[kind].kind === "money") return dollars(value);
  if (FIELDS[kind].kind === "percent") return `${String(typed("percent", value))}%`;
  return String(value);
}

/** A range as people read it at a glance: "$100–$5,000", "50–100%", "1–25". */
function rangeText(key: SettingKey, range: { min: number; max: number }): string {
  const one = (value: number) => shown(key, value).replace(/\.00$/, "");
  const low = one(range.min).replace(/%$/, "");
  return `${low}–${one(range.max)}`;
}

// The settings in two groups: what handlers feel, then what the AI team is held to.
const GROUPS: { title: string; keys: SettingKey[] }[] = [
  { title: "Payouts and the agent", keys: ["approval_limit", "agents_at_once"] },
  {
    title: "AI targets",
    keys: ["accuracy_objective", "straight_through_objective", "round_spend_limit"],
  },
];

type Texts = Record<SettingKey, string>;

function textsOf(values: SettingValues): Texts {
  const texts = {} as Texts;
  for (const key of settingKeys) texts[key] = String(typed(FIELDS[key].kind, values[key]));
  return texts;
}

/** What was typed as the value the api takes, or why it can't be saved. */
export function read(
  key: SettingKey,
  text: string,
  range: { min: number; max: number },
): { value: number } | { problem: string } {
  const { kind } = FIELDS[key];
  const number = text.trim() === "" ? Number.NaN : Number(text);
  if (!Number.isFinite(number)) return { problem: "Enter a number." };
  if (kind === "whole" && !Number.isInteger(number)) return { problem: "Enter a whole number." };
  const value = kind === "percent" ? number / 100 : number;
  if (value < range.min || value > range.max) {
    return { problem: `Enter ${shown(key, range.min)} to ${shown(key, range.max)}.` };
  }
  return { value };
}

function Change({ change }: { change: SettingChange }) {
  const known = settingKeys.find((key) => key === change.key);
  return (
    <li>
      <p>
        <strong>{known ? FIELDS[known].label : words(change.key)}</strong>{" "}
        {change.old === null ? "set" : `changed from ${shown(change.key, change.old)}`} to{" "}
        {shown(change.key, change.new)}
      </p>
      <p className="muted small">
        {change.changed_by} · {when(change.changed_at)}
        {change.reason ? <> · &ldquo;{change.reason}&rdquo;</> : null}
      </p>
    </li>
  );
}

interface Props {
  api: Api;
  handler: Handler;
  /** After a reset of the demo: the header's switches load again. */
  onReset?: () => void;
}

/** The settings a senior handler changes, with the latest changes; read-only for everyone else. */
export function SettingsPage({ api, handler, onReset }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [texts, setTexts] = useState<Texts | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const inFlight = useRef(false);
  const heading = useFocusHeading();
  const ids = useId();
  const senior = handler.can_approve_over_limit;

  const show = useCallback((found: Settings) => {
    setSettings(found);
    setTexts(textsOf(found.values));
  }, []);

  useEffect(() => {
    let live = true;
    api.getSettings().then(
      (found) => {
        if (!live) return;
        show(found);
        setError(null);
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api, generation, show]);

  const changes: Partial<SettingValues> = {};
  const problems: Partial<Record<SettingKey, string>> = {};
  if (settings && texts) {
    for (const key of settingKeys) {
      const result = read(key, texts[key], settings.ranges[key]);
      if ("problem" in result) problems[key] = result.problem;
      else if (result.value !== settings.values[key]) changes[key] = result.value;
    }
  }
  const ready = Object.keys(changes).length > 0 && Object.keys(problems).length === 0;

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(true);
    setSaveError(null);
    setSaved(false);
    try {
      show(await api.saveSettings(changes, reason.trim()));
      setReason("");
      setSaved(true);
    } catch (caught) {
      setSaveError(
        caught instanceof ApiError ? caught.message : "Couldn't save the settings. Try again.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="settings-heading" className="page-in settings-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Handlers&apos; dashboard</p>
          <h1 id="settings-heading" ref={heading} tabIndex={-1}>
            Settings
          </h1>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setError(null);
              setGeneration((value) => value + 1);
            }}
          >
            Try again
          </button>
        </p>
      )}
      {!settings && !error && (
        <>
          <p role="status" className="visually-hidden">
            Loading the settings…
          </p>
          <span className="skeleton skeleton-card" aria-hidden="true" />
        </>
      )}
      {settings && texts && (
        <>
          <form className="panel settings-card" noValidate onSubmit={(event) => void save(event)}>
            <div className="panel-head">
              <h2>Limits and targets</h2>
              <p className="muted small">Each change is kept with who and why.</p>
            </div>
            {!senior && (
              <p className="settings-note">
                <Lock size={15} strokeWidth={1.75} aria-hidden="true" />
                Only a senior claims handler can change these. You can see what&apos;s in force and
                what has changed.
              </p>
            )}
            {GROUPS.map((group) => (
              <fieldset key={group.title} className="settings-group">
                <legend>{group.title}</legend>
                <div className="settings-fields">
                  {group.keys.map((key) => {
                    const field = FIELDS[key];
                    const range = settings.ranges[key];
                    const problem = problems[key];
                    const affix =
                      field.kind === "money" ? "$" : field.kind === "percent" ? "%" : "";
                    return (
                      <div key={key} className="settings-field">
                        <label htmlFor={`${ids}-${key}`}>{field.label}</label>
                        <span
                          className={`field-affix${affix === "$" ? " before" : affix ? " after" : ""}`}
                        >
                          {affix === "$" && <span aria-hidden="true">$</span>}
                          <input
                            id={`${ids}-${key}`}
                            type="number"
                            inputMode="decimal"
                            min={typed(field.kind, range.min)}
                            max={typed(field.kind, range.max)}
                            step={field.step}
                            value={texts[key]}
                            disabled={!senior || busy}
                            aria-invalid={problem ? true : undefined}
                            aria-describedby={`${ids}-${key}-help${problem ? ` ${ids}-${key}-problem` : ""}`}
                            onChange={(event) => {
                              setTexts({ ...texts, [key]: event.target.value });
                              setSaved(false);
                            }}
                          />
                          {affix === "%" && <span aria-hidden="true">%</span>}
                        </span>
                        {problem && (
                          <p id={`${ids}-${key}-problem`} className="field-error">
                            {problem}
                          </p>
                        )}
                        <p id={`${ids}-${key}-help`} className="muted small">
                          {field.help}{" "}
                          <span className="settings-range">{rangeText(key, range)}</span>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            {senior && (
              <div className="settings-save">
                <div className="settings-reason">
                  <label htmlFor={`${ids}-reason`}>
                    Why? <span className="muted">(optional)</span>
                  </label>
                  <input
                    id={`${ids}-reason`}
                    value={reason}
                    maxLength={SETTING_REASON_LIMIT}
                    disabled={busy}
                    onChange={(event) => {
                      setReason(event.target.value);
                    }}
                  />
                </div>
                <button className="button" type="submit" disabled={!ready || busy}>
                  <Save size={16} strokeWidth={1.75} aria-hidden="true" />
                  {busy ? "Saving…" : "Save changes"}
                </button>
              </div>
            )}
            {saveError && (
              <p className="error" role="alert">
                {saveError}
              </p>
            )}
            <p role="status" className="settings-saved">
              {saved && (
                <span className="chip chip-good">
                  <Check size={13} strokeWidth={1.75} aria-hidden="true" />
                  Saved
                </span>
              )}
            </p>
          </form>
          <section className="panel" aria-labelledby={`${ids}-changes`}>
            <div className="panel-head">
              <h2 id={`${ids}-changes`}>Recent changes</h2>
              <p className="muted small">Newest first.</p>
            </div>
            {settings.changes.length === 0 ? (
              <p className="muted settings-empty">
                <span className="icon-tile" aria-hidden="true">
                  <History size={15} strokeWidth={1.75} />
                </span>
                {senior
                  ? "Nothing has been changed yet. Change a value above and it's listed here with your name and reason."
                  : "Nothing has been changed yet. A senior handler's changes are listed here with their name and reason."}
              </p>
            ) : (
              <ol className="settings-changes">
                {settings.changes.map((change, index) => (
                  <Change
                    key={`${change.key}-${change.changed_at}-${String(index)}`}
                    change={change}
                  />
                ))}
              </ol>
            )}
          </section>
          {senior && onReset && <DemoControls api={api} onReset={onReset} />}
        </>
      )}
    </section>
  );
}
