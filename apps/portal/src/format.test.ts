import { date, dollars, when } from "./format";

test("money shows two decimals in US dollars", () => {
  expect(dollars(1234.5)).toBe("$1,234.50");
});

test("a date that isn't one is shown as it came, never thrown", () => {
  expect(date("not a date")).toBe("not a date");
  expect(when("soon")).toBe("soon");
});
