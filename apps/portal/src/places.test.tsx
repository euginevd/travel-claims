import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { PlaceInput } from "./components/PlaceInput";
import { fold, onTrip, placeText, suggest, unpack, type Airport } from "./places";

vi.mock("./data/airports.json", () => ({
  default: {
    countries: ["Australia", "Kenya", "Sri Lanka", "Switzerland"],
    airports: [
      ["SYD", "Sydney Kingsford Smith International Airport", "Sydney", 0],
      ["SYQ", "Sydney Sykes Airport", "Sydney Hills", 0],
      ["NBO", "Jomo Kenyatta International Airport", "Nairobi", 1],
      ["CMB", "Bandaranaike International Colombo Airport", "Colombo", 2],
      ["ZRH", "Zürich Airport", "Zürich", 3],
    ],
  },
}));

const AIRPORTS: Airport[] = unpack({
  countries: ["Australia", "Kenya", "Sri Lanka", "Switzerland"],
  airports: [
    ["SYD", "Sydney Kingsford Smith International Airport", "Sydney", 0],
    ["SYQ", "Sydney Sykes Airport", "Sydney Hills", 0],
    ["NBO", "Jomo Kenyatta International Airport", "Nairobi", 1],
    ["CMB", "Bandaranaike International Colombo Airport", "Colombo", 2],
    ["ZRH", "Zürich Airport", "Zürich", 3],
  ],
});

test("an exact IATA code comes first, then cities by prefix", () => {
  expect(suggest(AIRPORTS, "syd").map((a) => a.iata)).toEqual(["SYD", "SYQ"]);
  expect(suggest(AIRPORTS, "nai").map((a) => a.iata)).toEqual(["NBO"]);
});

test("matching ignores case and accents, and words in the airport name count", () => {
  expect(fold("Zürich")).toBe("zurich");
  expect(suggest(AIRPORTS, "zurich").map((a) => a.iata)).toEqual(["ZRH"]);
  expect(suggest(AIRPORTS, "kenyatta").map((a) => a.iata)).toEqual(["NBO"]);
});

test("the trip's own places rank first", () => {
  const colombo = AIRPORTS.find((a) => a.iata === "CMB");
  expect(colombo && onTrip(colombo, "Bentota, Sri Lanka")).toBe(true);
  expect(suggest(AIRPORTS, "international", "Bentota, Sri Lanka")[0]?.iata).toBe("CMB");
});

test("one letter suggests nothing, and a pick reads as city, code and country", () => {
  expect(suggest(AIRPORTS, "s")).toEqual([]);
  const sydney = AIRPORTS[0];
  expect(sydney && placeText(sydney)).toBe("Sydney (SYD), Australia");
});

function Harness() {
  const [value, setValue] = useState("");
  return (
    <>
      <label htmlFor="where">Where?</label>
      <PlaceInput id="where" value={value} onChange={setValue} />
    </>
  );
}

test("type, arrow down and Enter fills in the airport", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const input = screen.getByRole("combobox", { name: "Where?" });
  await user.type(input, "syd");
  expect(await screen.findByRole("option", { name: /Sydney · SYD/ })).toBeInTheDocument();
  expect(input).toHaveAttribute("aria-expanded", "true");
  await user.keyboard("{ArrowDown}{Enter}");
  expect(input).toHaveValue("Sydney (SYD), Australia");
  expect(input).toHaveAttribute("aria-expanded", "false");
});
