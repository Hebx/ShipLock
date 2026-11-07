import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { MAINTAINER, setup, testConfig } from "./harness.ts";

describe("maintainer session and CSRF (unit)", () => {
  it("rejects state-changing maintainer requests without a GitHub session", async () => {
    const { call } = setup();
    for (const path of ["/api/world/enrollment/start", "/api/authorizations", "/api/authorizations/x/approve", "/api/merges/x/execute"]) {
      const res = await call("POST", path, { body: {} });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "no_session" });
    }
  });

  it("requires the CSRF header bound to the session and a matching Origin", async () => {
    const { call, login } = setup();
    const s = login();
    const other = login();
    expect((await call("POST", "/api/world/enrollment/start", { session: s, csrf: null })).status).toBe(403);
    expect((await call("POST", "/api/world/enrollment/start", { session: s, csrf: other.csrf })).status).toBe(403);
    expect((await call("POST", "/api/world/enrollment/start", { session: s, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("POST", "/api/world/enrollment/start", { session: s, origin: "http://localhost:3000" })).status).toBe(200);
  });

  it("rejects expired and revoked sessions", async () => {
    const { call, login, db } = setup();
    const s = login();
    db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await call("POST", "/api/world/enrollment/start", { session: s })).status).toBe(401);
    const t = login();
    expect((await call("POST", "/api/auth/logout", { session: t })).status).toBe(200);
    expect((await call("POST", "/api/world/enrollment/start", { session: t })).status).toBe(401);
  });

  it("exposes the CSRF token only to the session holder", async () => {
    const { call, login } = setup();
    expect(await (await call("GET", "/api/session")).json()).toMatchObject({ authenticated: false, githubOAuthConfigured: true });
    const s = login();
    const body = (await (await call("GET", "/api/session", { session: s })).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ authenticated: true, csrfToken: s.csrf, github: MAINTAINER, worldEnrollment: null });
    expect(JSON.stringify(body)).not.toMatch(/session_[0-9a-f]{20}/);
  });
});

describe("GitHub OAuth web flow (unit, stubbed GitHub)", () => {
  async function start(call: ReturnType<typeof setup>["call"]) {
    const res = await call("GET", "/api/auth/github/start");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    const browser = /shiplock_oauth=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")![1]!;
    return { location, state: location.searchParams.get("state")!, browser };
  }

  it("redirects with identity-only scope and a browser-bound single-use state", async () => {
    const { call, app, net, db } = setup();
    const { location, state, browser } = await start(call);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("scope")).toBe("");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/github/callback");

    const callback = (cookie: string, s = state) => app.request(`/api/auth/github/callback?code=abc&state=${s}`, { headers: { cookie: `shiplock_oauth=${cookie}` } });
    expect((await callback("wrong-browser")).headers.get("location")).toBe("http://localhost:3000/maintainer?login=invalid_state");
    const ok = await callback(browser);
    expect(ok.headers.get("location")).toBe("http://localhost:3000/maintainer?login=ok");
    expect(ok.headers.get("set-cookie")).toMatch(/shiplock_session=[^;]+;.*HttpOnly/i);
    expect(ok.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
    expect(db.prepare("SELECT github_user_id FROM sessions").get()).toMatchObject({ github_user_id: MAINTAINER.id });
    expect(net.calls.find((c) => c.url.includes("access_token"))!.body).toMatchObject({ code: "abc", client_id: "client-id" });
    // replay of the same state
    expect((await callback(browser)).headers.get("location")).toBe("http://localhost:3000/maintainer?login=invalid_state");
  });

  it("treats a cancelled GitHub consent as no login", async () => {
    const { app, db } = setup();
    const res = await app.request("/api/auth/github/callback?error=access_denied");
    expect(res.headers.get("location")).toBe("http://localhost:3000/maintainer?login=cancelled");
    expect(db.prepare("SELECT count(*) AS n FROM sessions").get()).toMatchObject({ n: 0 });
  });
});

describe("fail closed when unconfigured (unit)", () => {
  it("returns *_not_configured instead of any success", async () => {
    const { call, login, createJob, submitPaidReview } = setup(testConfig({ world: undefined, githubOAuth: undefined, paidReview: undefined }));
    const s = login();
    expect(await (await call("GET", "/api/auth/github/start")).json()).toEqual({ error: "github_oauth_not_configured" });
    const w = await call("POST", "/api/world/enrollment/start", { session: s });
    expect(w.status).toBe(503);
    expect(await w.json()).toEqual({ error: "world_not_configured" });
    expect((await call("POST", "/api/authorizations", { session: s, body: { jobId: "x" } })).status).toBe(503);
    const jobId = await createJob();
    const p = await submitPaidReview(jobId);
    expect(p.status).toBe(503);
    expect(await p.json()).toEqual({ error: "paid_review_not_configured" });
  });

  it("refuses to disable user presence in production", () => {
    const base = { GITHUB_DEMO_REPO: "a/b", WORLD_ENVIRONMENT: "production", WORLD_REQUIRE_USER_PRESENCE: "false" };
    expect(() => loadConfig(base)).toThrow(/not allowed/);
    expect(loadConfig({ GITHUB_DEMO_REPO: "a/b", WORLD_APP_ID: "REPLACE_ME" }).world).toBeUndefined();
  });
});
