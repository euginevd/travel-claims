import { FileText, ImageUp, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export const RECEIPT_TYPES = ["image/jpeg", "image/png", "application/pdf"];
export const MAX_RECEIPTS = 5;
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

interface ReceiptPickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  /** How many receipts the claim already has, which count towards the five. */
  already?: number;
}

/** Why a file can't be a receipt, or null if it can. The api checks the contents again. */
export function receiptProblem(file: File): string | null {
  if (!RECEIPT_TYPES.includes(file.type)) return `${file.name} isn't a JPEG, PNG or PDF.`;
  if (file.size > MAX_RECEIPT_BYTES) return `${file.name} is over 5 MB.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

export function kilobytes(size: number): string {
  return size < 1024 * 1024
    ? `${String(Math.max(1, Math.round(size / 1024)))} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

// A drop zone with a file picker beside it (design-system 7), previews of what's chosen, and
// the type, size and count checks before anything is sent.
export function ReceiptPicker({ files, onChange, already = 0 }: ReceiptPickerProps) {
  const ids = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const room = MAX_RECEIPTS - already - files.length;
  const previews = useMemo(
    () => files.map((file) => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null)),
    [files],
  );
  useEffect(
    () => () => {
      for (const url of previews) if (url) URL.revokeObjectURL(url);
    },
    [previews],
  );

  function add(chosen: File[]) {
    const problems = chosen.map(receiptProblem).filter((p): p is string => p !== null);
    const good = chosen.filter((file) => receiptProblem(file) === null);
    if (good.length > room)
      problems.push(`A claim can have up to ${String(MAX_RECEIPTS)} receipts.`);
    setProblem(problems.length > 0 ? problems.join(" ") : null);
    onChange([...files, ...good.slice(0, Math.max(0, room))]);
  }

  // Dropping files is a mouse shortcut, wired up here; the file input inside the zone is the
  // keyboard and screen-reader way to choose them.
  const zone = useRef<HTMLLabelElement>(null);
  const addRef = useRef(add);
  useEffect(() => {
    addRef.current = add;
  });
  useEffect(() => {
    const element = zone.current;
    if (!element) return;
    const over = (event: DragEvent) => {
      event.preventDefault();
      setDragging(true);
    };
    const leave = () => {
      setDragging(false);
    };
    const dropped = (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      addRef.current(Array.from(event.dataTransfer?.files ?? []));
    };
    element.addEventListener("dragover", over);
    element.addEventListener("dragleave", leave);
    element.addEventListener("drop", dropped);
    return () => {
      element.removeEventListener("dragover", over);
      element.removeEventListener("dragleave", leave);
      element.removeEventListener("drop", dropped);
    };
  }, []);

  // The whole zone is the file input's label: drop files on it, or click or press it to pick.
  return (
    <div className="receipt-picker">
      <label
        ref={zone}
        htmlFor={`${ids}-files`}
        className={`drop-zone${dragging ? " dragging" : ""}`}
      >
        <ImageUp size={28} strokeWidth={2} aria-hidden="true" />
        <span>Drag receipts here, or</span>
        <span className="button secondary">Choose files</span>
        <input
          id={`${ids}-files`}
          className="visually-hidden"
          type="file"
          multiple
          accept={RECEIPT_TYPES.join(",")}
          disabled={room <= 0}
          aria-describedby={`${ids}-hint`}
          onChange={(event) => {
            add(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </label>
      <p id={`${ids}-hint`} className="small muted">
        JPEG, PNG or PDF, up to 5 MB each. {Math.max(0, room)} of {MAX_RECEIPTS} left.
      </p>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {files.length > 0 && (
        <ul className="previews" aria-label="Receipts chosen">
          {files.map((file, index) => (
            <li key={`${file.name}-${String(index)}`} className="preview">
              {previews[index] ? (
                <img src={previews[index]} alt="" />
              ) : (
                <FileText size={32} strokeWidth={2} aria-hidden="true" />
              )}
              <span className="preview-name" dir="auto">
                {file.name}
                <span className="small muted"> · {kilobytes(file.size)}</span>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${file.name}`}
                onClick={() => {
                  onChange(files.filter((_, i) => i !== index));
                }}
              >
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
