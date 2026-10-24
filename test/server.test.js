"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

process.env.DOTJAR_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "dotjar-web-"));

const server = require("../src/server");

// A session that never touches the machine's transcripts.
function fakeSession() {
  const calls = [];
  const view = { day: "2026-06-10", candidates: [], kept: [], settled: [] };
  return {
    calls,
    config: { wording: "落库", language: "auto" },
    engine: () => ({ engine: "claude-cli", engineModel: "", engines: [] }),
    setEngine: (id) => (calls.push(["engine", id]), { engine: id, engineModel: "", engines: [] }),
    today: async () => view,
    isDistilling: () => false,
    distill: async () => ({ view, found: 0 }),
    keep: async (id) => (calls.push(["keep", id]), view),
    skip: async (id) => (calls.push(["skip", id]), view),
    reopen: async (id) => (calls.push(["reopen", id]), view),
    capture: async (text, from) => {
      if (!text) throw new Error("没有可存的文字");
      calls.push(["capture", text, from]);
      return view;
    },
    setDepositDir: async (dir) => (calls.push(["dir", dir]), view),
    library: () => {
      const file = path.join(process.env.DOTJAR_HOME, "library.html");
      fs.writeFileSync(file, "<h1>库存</h1>");
      return file;
    },
  };
}

function request(port, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, ...options }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("the browser interface is only reachable with the token, from this machine", async (t) => {
  const session = fakeSession();
  const token = "a".repeat(48);
  const srv = server.createServer({ session, token });
  const port = await server.listen(srv, 0);
  t.after(() => srv.close());
  const cookie = `${server.COOKIE}=${token}`;
  const post = (name, args, headers = {}) =>
    request(port, { method: "POST", path: `/api/${name}`, headers: { cookie, "content-type": "application/json", "x-dotjar": "1", ...headers } }, JSON.stringify({ args }));

  // No token: nothing is served, not even the page.
  assert.equal((await request(port, { path: "/" })).status, 403);
  assert.equal((await request(port, { path: "/overlay.js" })).status, 403);
  assert.equal((await request(port, { path: "/?t=wrong" })).status, 403);

  // The token in the address is traded for a cookie and dropped from the address.
  const first = await request(port, { path: `/?t=${token}&view=settled` });
  assert.equal(first.status, 302);
  assert.equal(first.headers.location, "/?view=settled");
  assert.match(first.headers["set-cookie"][0], /^dotjar_token=a+; HttpOnly; SameSite=Strict/);

  const page = await request(port, { path: "/", headers: { cookie } });
  assert.equal(page.status, 200);
  assert.ok(page.body.includes('<script src="web-bridge.js"></script>'));
  assert.equal((await request(port, { path: "/overlay.css", headers: { cookie } })).status, 200);
  assert.equal((await request(port, { path: "/library", headers: { cookie } })).body, "<h1>库存</h1>");

  // Only the listed files exist; there is no path to anything else on disk.
  for (const p of ["/main.js", "/../package.json", "/%2e%2e/package.json", "/overlay/overlay.js", "/core/config.js"]) {
    assert.equal((await request(port, { path: p, headers: { cookie } })).status, 404, p);
  }

  // A name that resolves here from another site is turned away.
  assert.equal((await request(port, { path: "/", headers: { cookie, host: "evil.example:4747" } })).status, 403);

  // The calls the page makes.
  assert.deepEqual(JSON.parse((await post("meta", [])).body).value.web, true);
  assert.deepEqual(JSON.parse((await post("keep", ["abc"])).body), { ok: true, value: await session.today() });
  await post("capture", ["一段文字"]);
  await post("setDepositDir", ["~/笔记"]);
  assert.deepEqual(session.calls, [["keep", "abc"], ["capture", "一段文字", "网页"], ["dir", "~/笔记"]]);
  assert.deepEqual(JSON.parse((await post("capture", [""])).body), { ok: false, error: "没有可存的文字" });

  // What another page could send is refused: no custom header, a foreign origin, an unknown or inherited name.
  assert.equal((await post("keep", ["x"], { "x-dotjar": "" })).status, 403);
  assert.equal((await post("keep", ["x"], { origin: "https://evil.example" })).status, 403);
  assert.equal((await post("constructor", [])).status, 404);
  assert.equal((await post("nope", [])).status, 404);
  assert.equal((await request(port, { method: "POST", path: "/api/keep", headers: { "x-dotjar": "1" } }, "{}")).status, 403);
  assert.equal(session.calls.length, 3);
});

test("the token is created once and kept private", () => {
  const a = server.loadToken();
  assert.match(a, /^[0-9a-f]{48}$/);
  assert.equal(server.loadToken(), a);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(process.env.DOTJAR_HOME, "web-token")).mode & 0o777, 0o600);
});

test("a second start finds the server already running instead of failing", async (t) => {
  const first = await server.start({ port: 0 });
  t.after(() => first.server.close());
  assert.equal(first.reused, false);
  const again = await server.start({ port: first.port });
  assert.equal(again.reused, true);
  assert.equal(again.server, null);
  assert.equal(again.url, first.url);
});

test("a server says how old its code is, and only a restartable one offers to restart", async (t) => {
  const token = "b".repeat(48);
  const srv = server.createServer({ session: fakeSession(), token });
  const port = await server.listen(srv, 0);
  t.after(() => srv.close());
  const cookie = `${server.COOKIE}=${token}`;
  const post = async (name) =>
    JSON.parse((await request(port, { method: "POST", path: `/api/${name}`, headers: { cookie, "content-type": "application/json", "x-dotjar": "1" } }, JSON.stringify({ args: [] }))).body);

  const page = await request(port, { path: "/", headers: { cookie } });
  assert.equal(Number(page.headers["x-dotjar-code"]), server.codeStamp());
  assert.equal((await post("meta")).value.stale, false);
  const restart = await post("restart");
  assert.equal(restart.ok, false); // a server started by the tests cannot be replaced from the page
});

test("a desktop companion can ask for a pulse without rescanning", async (t) => {
  const token = "c".repeat(48);
  const session = { ...fakeSession(), pulse: () => ({ day: "2026-06-10", dots: [{ id: "a", kind: "note", status: "open" }], open: 1, kept: 0, turnsSince: 0, distilling: false }) };
  const srv = server.createServer({ session, token });
  const port = await server.listen(srv, 0);
  t.after(() => srv.close());
  const res = await request(port, { method: "POST", path: "/api/pulse", headers: { cookie: `${server.COOKIE}=${token}`, "content-type": "application/json", "x-dotjar": "1" } }, "{}");
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.value.open, 1);
});
