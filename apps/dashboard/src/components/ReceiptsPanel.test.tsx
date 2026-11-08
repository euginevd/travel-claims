import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Api } from "../api";
import { ReceiptsPanel } from "./ReceiptsPanel";

const IMAGE = { receipt_id: "a".repeat(32), media_type: "image/png", size: 2048, uploaded_at: "x" };
const PDF = { ...IMAGE, receipt_id: "b".repeat(32), media_type: "application/pdf" };

beforeAll(() => {
  URL.createObjectURL = () => "blob:receipt";
  URL.revokeObjectURL = () => undefined;
});

test("a handler sees image thumbnails and downloads any receipt", async () => {
  const user = userEvent.setup();
  const blob = () => Promise.resolve(new Blob(["png"], { type: "image/png" }));
  const api = { receipt: vi.fn(blob) } as unknown as Api;
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  render(<ReceiptsPanel api={api} claimId="CLM-1027" receipts={[IMAGE, PDF]} />);

  expect(await screen.findByRole("img", { name: "Receipt 1" })).toHaveAttribute(
    "src",
    "blob:receipt",
  );
  await user.click(screen.getAllByRole("button", { name: "Download" })[1] as HTMLElement);
  expect(click).toHaveBeenCalled();
  expect(api.receipt).toHaveBeenCalledWith("CLM-1027", PDF.receipt_id);
  click.mockRestore();
});

test("a receipt that won't load says so", async () => {
  const api = { receipt: vi.fn(() => Promise.reject(new Error("gone"))) } as unknown as Api;
  render(<ReceiptsPanel api={api} claimId="CLM-1027" receipts={[IMAGE]} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn't be loaded");
});

test("no receipts, no panel", () => {
  const { container } = render(<ReceiptsPanel api={{} as Api} claimId="CLM-1" receipts={[]} />);
  expect(container).toBeEmptyDOMElement();
});
