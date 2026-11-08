import { Download, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import type { Api, Receipt } from "../api";
import { kilobytes } from "./ReceiptPicker";

interface ReceiptsPanelProps {
  api: Api;
  claimId: string;
  receipts: Receipt[];
}

// The customer's receipts for a handler: image thumbnails and downloads, each fetched with the
// handler's sign-in, since receipts are never on a public URL.
export function ReceiptsPanel({ api, claimId, receipts }: ReceiptsPanelProps) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const made: string[] = [];
    for (const receipt of receipts.filter((r) => r.media_type.startsWith("image/"))) {
      api.receipt(claimId, receipt.receipt_id).then(
        (blob) => {
          const url = URL.createObjectURL(blob);
          made.push(url);
          if (live) setUrls((current) => ({ ...current, [receipt.receipt_id]: url }));
        },
        () => {
          if (live) setError("Some receipts couldn't be loaded.");
        },
      );
    }
    return () => {
      live = false;
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [api, claimId, receipts]);

  async function download(receipt: Receipt, index: number) {
    try {
      const url = URL.createObjectURL(await api.receipt(claimId, receipt.receipt_id));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${claimId}-receipt-${String(index + 1)}.${receipt.media_type === "application/pdf" ? "pdf" : (receipt.media_type.split("/")[1] ?? "bin")}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("That receipt couldn't be downloaded.");
    }
  }

  if (receipts.length === 0) return null;
  return (
    <>
      <h3>Receipts from the customer</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="receipt-grid">
        {receipts.map((receipt, index) => (
          <li key={receipt.receipt_id} className="receipt-tile">
            {urls[receipt.receipt_id] ? (
              <img src={urls[receipt.receipt_id]} alt={`Receipt ${String(index + 1)}`} />
            ) : (
              <span className="receipt-icon">
                <FileText size={32} strokeWidth={2} aria-hidden="true" />
              </span>
            )}
            <span className="small">
              Receipt {index + 1} · {kilobytes(receipt.size)}
            </span>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                void download(receipt, index);
              }}
            >
              <Download size={16} strokeWidth={2} aria-hidden="true" />
              Download
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
