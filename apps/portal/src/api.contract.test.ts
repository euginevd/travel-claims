// The api's real responses, captured by apps/api/tests/test_web_contract.py, parse with the
// portal's schemas: if the api changes shape, this fails before the portal does.
import { z } from "zod";
import {
  CustomerClaimSchema,
  CustomerClaimSummarySchema,
  CustomerSchema,
  PolicySchema,
  SignInSchema,
} from "./api";
import myClaim from "./fixtures/my-claim.json";
import myClaims from "./fixtures/my-claims.json";
import myPolicies from "./fixtures/my-policies.json";
import myProfile from "./fixtures/my-profile.json";
import signIn from "./fixtures/sign-in.json";

test("the customers' responses parse", () => {
  expect(SignInSchema.safeParse(signIn).success).toBe(true);
  expect(CustomerSchema.safeParse(myProfile).success).toBe(true);
  expect(z.array(PolicySchema).safeParse(myPolicies).success).toBe(true);
  expect(z.array(CustomerClaimSummarySchema).safeParse(myClaims).success).toBe(true);
  const claim = CustomerClaimSchema.parse(myClaim);
  expect(claim.receipts[0]?.media_type).toBe("image/png");
});
