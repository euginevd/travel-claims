import { render, screen } from "@testing-library/react";
import { emphasised } from "./Copilot";

test("words Wattle marks with asterisks show in bold, and the rest stays plain text", () => {
  render(<p>{emphasised("**Claimed:** $1,950.00 across 8 items. <b>not markup</b>")}</p>);
  expect(screen.getByText("Claimed:").tagName).toBe("STRONG");
  expect(screen.getByText(/\$1,950\.00 across 8 items\. <b>not markup<\/b>/)).toBeInTheDocument();
});
