import { Download, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import type { Api, Receipt } from "../api";
import { kilobytes } from "../format";

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

  // The image receipts' ids, joined: the list is a new array on every poll of the claim, and
  // keying the effect on it downloaded every image again each second and a half.
  const images = receipts
    .filter((r) => r.media_type.startsWith("image/"))
    .map((r) => r.receipt_id)
    .join(",");
  useEffect(() => {
    let live = true;
    const made: string[] = [];
    for (const receiptId of images ? images.split(",") : []) {
      api.receipt(claimId, receiptId).then(
        (blob) => {
          // One that lands after the panel has gone is never shown, so it's let go at once.
          if (!live) return;
          const url = URL.createObjectURL(blob);
          made.push(url);
          setUrls((current) => ({ ...current, [receiptId]: url }));
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
  }, [api, claimId, images]);

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
                <FileText size={32} strokeWidth={1.75} aria-hidden="true" />
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
              <Download size={16} strokeWidth={1.75} aria-hidden="true" />
              Download
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
