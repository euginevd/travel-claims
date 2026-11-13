// Tests kept from the retired pages: the parts that live on in the chat-first portal.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type CustomerRequest } from "../api";
import { App } from "../App";
import { saveToken } from "../session";
import { fakeFetch, MAYA, MY_POLICY, MY_SUMMARY, myClaim } from "../testing";
import { parseHash } from "../useHashRoute";
import { initials } from "./Header";
import { NeedsPanel } from "./NeedsPanel";
import { SAYS, SignInMap } from "./SignInMap";
import { bolded } from "./Wattle";

const PNG = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "report.png", {
  type: "image/png",
});

const ASKED: CustomerRequest = {
  request_id: 1,
  text: "The airline's letter about the delay",
  asked_by: "Dana",
  asked_at: "2026-11-09T01:00:00+00:00",
  fulfilled_at: null,
  files: 0,
};

test("the sign-in map holds still on the paid moment without motion", () => {
  render(<SignInMap />);
  expect(document.querySelector(".map-tag.paid")).not.toBeNull();
  expect(document.body).toHaveTextContent(SAYS.paid);
});

test("the avatar shows up to two initials", () => {
  expect(initials("Maya Patel")).toBe("MP");
  expect(initials("Oliver James Grant")).toBe("OG");
  expect(initials("Cher")).toBe("C");
  expect(initials("")).toBe("");
});

test("a point's bold figure is split as text, never parsed as markup", () => {
  render(<p>{bolded("Up to **$3,000** <b>each</b>")}</p>);
  expect(screen.getByText("$3,000").tagName).toBe("STRONG");
  expect(document.body).toHaveTextContent("<b>each</b>");
});

test("links from our emails and texts open the right place", () => {
  expect(parseHash("#/claims/CLM-1001")).toEqual({ page: "claims", claimId: "CLM-1001" });
  expect(parseHash("#/claims")).toEqual({ page: "claims" });
  expect(parseHash("#/updates")).toEqual({ page: "messages" });
  expect(parseHash("#/messages")).toEqual({ page: "messages" });
  expect(parseHash("#/settings")).toEqual({ page: "settings" });
  expect(parseHash("#/new")).toEqual({ page: "new-claim" });
  expect(parseHash("#/anything")).toEqual({ page: "home" });
});

test("what we need is listed, and sending a file marks it done", async () => {
  const user = userEvent.setup();
  const updated = myClaim({
    requests: [{ ...ASKED, fulfilled_at: "2026-11-09T03:00:00+00:00", files: 1 }],
  });
  const api = createApi(
    fakeFetch({ "POST /api/customer/claims/CLM-1001/requests/1/files": () => [201, updated] }),
    () => "token",
  );
  let claim = myClaim({ requests: [ASKED] });
  const { rerender } = render(
    <NeedsPanel
      api={api}
      claimId="CLM-1001"
      requests={claim.requests}
      onUpdated={(next) => {
        claim = next;
      }}
    />,
  );
  expect(screen.getByRole("heading", { name: "What we need from you" })).toBeInTheDocument();
  await user.upload(screen.getByLabelText(/Upload/), PNG);
  await waitFor(() => {
    expect(claim.requests[0]?.files).toBe(1);
  });
  rerender(
    <NeedsPanel
      api={api}
      claimId="CLM-1001"
      requests={claim.requests}
      onUpdated={() => undefined}
    />,
  );
  expect(screen.getByRole("heading", { name: "What you sent us" })).toBeInTheDocument();
  expect(screen.getByText(/Sent 1 file/)).toBeInTheDocument();
});

test("a file that can't be sent says why", async () => {
  const user = userEvent.setup();
  const api = createApi(
    fakeFetch({
      "POST /api/customer/claims/CLM-1001/requests/1/files": () => [415, { detail: "Wrong type" }],
    }),
    () => "token",
  );
  render(
    <NeedsPanel api={api} claimId="CLM-1001" requests={[ASKED]} onUpdated={() => undefined} />,
  );
  await user.upload(screen.getByLabelText(/Upload/), PNG);
  expect(await screen.findByRole("alert")).toHaveTextContent("Wrong type");
});

test("a customer sets a PayID in Settings, and a bad one is refused with the reason", async () => {
  const user = userEvent.setup();
  saveToken("token-c");
  window.location.hash = "";
  let payid: string | null = null;
  const fetchFn = fakeFetch({
    "GET /api/customer/profile": () => [200, MAYA],
    "GET /api/customer/claims": () => [200, [MY_SUMMARY]],
    "GET /api/customer/policies": () => [200, [MY_POLICY]],
    "GET /api/customer/settings": () => [
      200,
      { email: "maya.patel@example.com", mobile: "", text_updates: true },
    ],
    "GET /api/customer/payid": () => [200, { payid }],
    "PUT /api/customer/payid": (body) => {
      const sent = (body as { payid: string }).payid;
      if (!sent.includes("@")) return [422, { detail: "That doesn't look like a PayID" }];
      payid = "m***@example.com";
      return [200, { payid }];
    },
  });
  render(<App fetchFn={fetchFn} />);
  await user.click(await screen.findByRole("button", { name: /Settings for Maya Patel/ }));
  const panel = await screen.findByRole("dialog", { name: "Settings" });
  await user.click(await within(panel).findByRole("button", { name: /^PayID/ }));
  const field = within(panel).getByLabelText("PayID");
  await user.type(field, "nope");
  await user.click(within(panel).getByRole("button", { name: "Save" }));
  expect(await within(panel).findByRole("alert")).toHaveTextContent("doesn't look like a PayID");
  await user.clear(field);
  await user.type(field, "maya@example.com");
  await user.click(within(panel).getByRole("button", { name: "Save" }));
  expect(await within(panel).findByText("m***@example.com")).toBeInTheDocument();
});
