import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("waits for the uploaded Pages artifact using the Actions wire format", () => {
  const script = fileURLToPath(
    new URL(
      "../../.github/actions/publish-pages/wait-for-artifact/index.mjs",
      import.meta.url,
    ),
  );
  const claims = Buffer.from(
    JSON.stringify({ scp: "Actions.Results:demo-run:demo-job" }),
  ).toString("base64url");
  const stub = `
    import timers from "node:timers/promises";
    import { syncBuiltinESMExports } from "node:module";
    timers.setTimeout = async () => {};
    syncBuiltinESMExports();
    let attempts = 0;
    globalThis.fetch = async (url, options) => {
      const request = JSON.parse(options.body);
      if (request.workflow_run_backend_id !== "demo-run" ||
          request.workflow_job_run_backend_id !== "demo-job") {
        return Response.json({});
      }
      const artifacts = ++attempts === 1 ? [] : [{ database_id: "10" }];
      return Response.json({ artifacts });
    };
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", `data:text/javascript,${encodeURIComponent(stub)}`, script],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        INPUT_ARTIFACT_ID: "10",
        ACTIONS_RUNTIME_TOKEN: `header.${claims}.signature`,
        ACTIONS_RESULTS_URL: "https://actions.example.test/",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /artifact 10 is still missing/);
  assert.match(result.stdout, /artifact 10 is visible to deploy-pages/);
});
