import { ApiError } from "./api";
import { createCopilot } from "./copilot";

const reply = (status: number, body: string) =>
  Promise.resolve(new Response(body, { status, headers: { "Content-Type": "application/json" } }));

test("the Copilot client says what went wrong in plain words", async () => {
  const withDetail = createCopilot(
    () => reply(403, '{"detail":"Only senior handlers"}'),
    () => "t",
  );
  await expect(withDetail.list()).rejects.toThrow("Only senior handlers");

  const notJson = createCopilot(
    () => reply(502, "<html>bad gateway</html>"),
    () => null,
  );
  await expect(notJson.list()).rejects.toThrow("The Copilot couldn't answer");

  const odd = createCopilot(
    () => reply(200, '{"unexpected":true}'),
    () => "t",
  );
  await expect(odd.start()).rejects.toBeInstanceOf(ApiError);
});
