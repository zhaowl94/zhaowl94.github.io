import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  chromeFlagsForEnvironment,
  isWslEnvironment,
  stopProcessAndWait,
} from "../../scripts/lighthouse-runtime.mjs";

test("keeps the Chromium sandbox enabled for local Linux runs", () => {
  assert.deepEqual(chromeFlagsForEnvironment({}, "linux"), [
    "--headless=new",
    "--disable-gpu",
  ]);
});

test("adds constrained-runner flags only for Linux CI", () => {
  assert.deepEqual(chromeFlagsForEnvironment({ CI: "true" }, "linux"), [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
  ]);
});

test("does not disable the Chromium sandbox on Windows CI", () => {
  assert.deepEqual(chromeFlagsForEnvironment({ CI: "true" }, "win32"), [
    "--headless=new",
    "--disable-gpu",
  ]);
});

test("distinguishes native Linux from WSL", () => {
  assert.equal(isWslEnvironment({}, "linux"), false);
  assert.equal(isWslEnvironment({ WSL_DISTRO_NAME: "Ubuntu" }, "linux"), true);
});

test("does not classify Windows as WSL from inherited variables", () => {
  assert.equal(isWslEnvironment({ WSL_DISTRO_NAME: "Ubuntu" }, "win32"), false);
});

test("waits for a running child process to close after stopping it", async () => {
  const childProcess = new EventEmitter();
  childProcess.exitCode = null;
  childProcess.signalCode = null;
  let stopped = false;

  await stopProcessAndWait(childProcess, () => {
    stopped = true;
    childProcess.signalCode = "SIGKILL";
    childProcess.emit("close");
  });

  assert.equal(stopped, true);
  assert.equal(childProcess.listenerCount("close"), 0);
});

test("still runs cleanup for a child process that already exited", async () => {
  const childProcess = new EventEmitter();
  childProcess.exitCode = 0;
  childProcess.signalCode = null;
  let stopped = false;

  await stopProcessAndWait(childProcess, () => {
    stopped = true;
  });

  assert.equal(stopped, true);
});
