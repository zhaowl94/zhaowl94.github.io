import { setTimeout as sleep } from "node:timers/promises";

const artifactId = process.env.INPUT_ARTIFACT_ID;
const runtimeToken = process.env.ACTIONS_RUNTIME_TOKEN;
const resultsUrl = process.env.ACTIONS_RESULTS_URL;
if (!artifactId || !runtimeToken || !resultsUrl) {
  throw new Error("Artifact ID and Actions runtime credentials are required");
}

// deploy-pages uses this Actions results endpoint for its artifact list.
// The public REST artifact listing can see the upload sooner.
const claims = JSON.parse(
  Buffer.from(runtimeToken.split(".")[1], "base64url").toString("utf8"),
);
const scope = claims.scp
  ?.split(" ")
  .find((claim) => claim.startsWith("Actions.Results:"));
const [, workflowRunBackendId, workflowJobRunBackendId] =
  scope?.split(":") ?? [];
if (!workflowRunBackendId || !workflowJobRunBackendId) {
  throw new Error("Actions runtime token is missing the artifact scope");
}

const url = new URL(
  "/twirp/github.actions.results.api.v1.ArtifactService/ListArtifacts",
  resultsUrl,
);

async function waitForArtifact() {
  for (const delay of [0, 1000, 2000, 4000, 8000, 15000, 30000]) {
    if (delay) await sleep(delay);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${runtimeToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workflow_run_backend_id: workflowRunBackendId,
        workflow_job_run_backend_id: workflowJobRunBackendId,
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    if (response?.ok) {
      const { artifacts = [] } = await response.json();
      if (
        artifacts.some(
          (artifact) =>
            String(artifact.database_id ?? artifact.databaseId) === artifactId,
        )
      ) {
        console.log(`Pages artifact ${artifactId} is visible to deploy-pages`);
        return;
      }
      console.log(
        `Pages artifact ${artifactId} is still missing from the list`,
      );
    } else {
      const status = response ? `HTTP ${response.status}` : "network error";
      if (response && response.status !== 429 && response.status < 500) {
        throw new Error(`Unable to list Pages artifacts (${status})`);
      }
      console.log(`Retrying Pages artifact lookup after ${status}`);
    }
  }
  throw new Error(
    `Pages artifact ${artifactId} did not appear in the artifact list`,
  );
}

await waitForArtifact();
