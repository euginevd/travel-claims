// The api's real responses, captured by apps/api/tests/test_web_contract.py, parse with the
// dashboard's schemas: if the api changes shape, this fails before the dashboard does.
import { z } from "zod";
import {
  ClaimSchema,
  ClaimSummarySchema,
  HandlerSchema,
  SettingsSchema,
  SignInSchema,
  StepSchema,
} from "./api";
import claimHeld from "./fixtures/claim-held.json";
import claimInProgress from "./fixtures/claim-in-progress.json";
import claimPaid from "./fixtures/claim-paid.json";
import claimScreened from "./fixtures/claim-screened.json";
import claimSentBack from "./fixtures/claim-sent-back.json";
import claimWaiting from "./fixtures/claim-waiting.json";
import claims from "./fixtures/claims.json";
import me from "./fixtures/me.json";
import settings from "./fixtures/settings.json";
import signIn from "./fixtures/sign-in.json";
import steps from "./fixtures/steps.json";

test.each([
  ["waiting", claimWaiting],
  ["in progress", claimInProgress],
  ["paid", claimPaid],
  ["held", claimHeld],
  ["sent back", claimSentBack],
  ["screened", claimScreened],
])("a %s claim parses", (_, fixture) => {
  expect(ClaimSchema.safeParse(fixture).success).toBe(true);
});

test("the other responses parse", () => {
  expect(z.array(ClaimSummarySchema).safeParse(claims).success).toBe(true);
  expect(z.array(StepSchema).safeParse(steps).success).toBe(true);
  expect(HandlerSchema.safeParse(me).success).toBe(true);
  expect(SignInSchema.safeParse(signIn).success).toBe(true);
  expect(SettingsSchema.safeParse(settings).success).toBe(true);
});

test("the screened claim is flagged and the paid one has its calculation", () => {
  expect(ClaimSchema.parse(claimScreened).decision?.by_screening).toBe(true);
  expect(ClaimSchema.parse(claimPaid).decision?.calculation?.lines.length).toBeGreaterThan(0);
});
