import assert from "node:assert/strict";
import { test } from "node:test";
import { deployPages } from "../../.github/actions/publish-pages/deploy.mjs";

function deploymentFixture(status) {
  const calls = [];
  const outputs = {};
  const context = { repo: { owner: "demo", repo: "site" }, sha: "build-sha" };
  const core = {
    getIDToken: async () => "test-oidc-token",
    setOutput: (name, value) => {
      outputs[name] = value;
    },
    info: () => {},
  };
  const github = {
    request: async (route, params) => {
      calls.push({ route, params });
      if (route === "POST /repos/{owner}/{repo}/pages/deployments") {
        return {
          data: { id: "deployment-id", page_url: "https://example.test/" },
        };
      }
      return { data: { status } };
    },
  };
  return {
    calls,
    outputs,
    input: { core, github, context, artifactId: "321" },
  };
}

test("creates a Pages deployment directly from the uploaded artifact ID", async () => {
  const { calls, outputs, input } = deploymentFixture("succeed");
  await deployPages(input);
  assert.deepEqual(calls[0], {
    route: "POST /repos/{owner}/{repo}/pages/deployments",
    params: {
      owner: "demo",
      repo: "site",
      artifact_id: 321,
      pages_build_version: "build-sha",
      oidc_token: "test-oidc-token",
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(
    calls[1].route,
    "GET /repos/{owner}/{repo}/pages/deployments/{pages_deployment_id}",
  );
  assert.equal(calls[1].params.pages_deployment_id, "deployment-id");
  assert.deepEqual(outputs, { page_url: "https://example.test/" });
});

test("fails the workflow when Pages rejects the deployment content", async () => {
  const { calls, outputs, input } = deploymentFixture(
    "deployment_content_failed",
  );
  await assert.rejects(() => deployPages(input), /deployment_content_failed/);
  assert.equal(calls.length, 2);
  assert.deepEqual(outputs, {});
});
