// Test helpers: data shaped like the api's responses, and a fake fetch that answers by route.
import type { Engineer } from "./api";

export const SAM: Engineer = {
  engineer_id: "ENG-01",
  name: "Sam Carter",
  role: "AI Engineer",
  email: "sam.carter@undercover.example",
};

type Answer = [status: number, body: unknown];
export type Routes = Record<string, (body: unknown) => Answer>;

export interface FakeFetch {
  (input: string, init?: RequestInit): Promise<Response>;
  calls: { method: string; path: string; body: unknown; auth: string | null }[];
}

// Answers `${method} ${path}` from the routes; anything else is a 404.
export function fakeFetch(routes: Routes): FakeFetch {
  const calls: FakeFetch["calls"] = [];
  const fetchFn = (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : (init?.body ?? undefined);
    const headers = new Headers(init?.headers);
    calls.push({ method, path: input, body, auth: headers.get("Authorization") });
    const route = routes[`${method} ${input}`];
    const [status, answer] = route ? route(body) : [404, { detail: "Not found" }];
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return Object.assign(fetchFn, { calls });
}
