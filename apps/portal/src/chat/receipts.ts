// What a receipt may be. The api checks the contents again.
export const RECEIPT_TYPES = ["image/jpeg", "image/png", "application/pdf"];
export const MAX_RECEIPTS = 5;
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

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
