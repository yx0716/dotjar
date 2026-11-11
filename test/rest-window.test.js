"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createRestWindow } = require("../src/rest-window");

function fixture() {
  const launches = [];
  const host = createRestWindow({ platform: "darwin", spawn(cmd, args, options) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = 0;
    child.kill = () => child.killed++;
    launches.push({ cmd, args, options, child });
    return child;
  } });
  return { host, launches };
}

test("one native window per rest, closed on skip, new rest, and shutdown", (t) => {
  const { host, launches } = fixture();
  t.after(() => host.close());
  const status = { phase: "resting", startedAt: Date.now(), endsAt: Date.now() + 60000 };
  const url = "http://127.0.0.1:4747/?nativeRest=1&t=secret";
  host.show(url, status);
  host.show(url, status);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].options.env.DOTJAR_REST_URL, url);
  assert.ok(!launches[0].args.join(" ").includes("secret"));
  launches[0].child.stdout.write("rea");
  launches[0].child.stdout.write("dy\n");
  host.sync({ phase: "idle" });
  assert.equal(launches[0].child.killed, 1);
  host.show(url, status);
  host.sync({ ...status, startedAt: status.startedAt + 1 });
  assert.equal(launches[1].child.killed, 1);
  host.show(url, status);
  host.close();
  assert.equal(launches[2].child.killed, 1);
});

test("a failed launch falls back once; intentional or ready-window exits do not", (t) => {
  const { host, launches } = fixture();
  t.after(() => host.close());
  const status = { startedAt: 1, endsAt: Date.now() + 60000 };
  let fallbacks = 0;
  const show = () => host.show("http://127.0.0.1:4747/", status, () => fallbacks++);
  show();
  launches[0].child.emit("error", new Error("launch failed"));
  launches[0].child.emit("exit", 1);
  assert.equal(fallbacks, 1);
  show();
  host.close();
  launches[1].child.emit("exit", null);
  assert.equal(fallbacks, 1);
  show();
  launches[2].child.stdout.write("ready\n");
  launches[2].child.emit("exit", 0);
  assert.equal(fallbacks, 1);
  createRestWindow({ platform: "linux" }).show("http://127.0.0.1:4747/", status, () => fallbacks++);
  assert.equal(fallbacks, 2);
});
