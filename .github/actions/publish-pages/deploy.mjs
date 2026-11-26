import { setTimeout as sleep } from "node:timers/promises";

const deployments = "/repos/{owner}/{repo}/pages/deployments";
const deployment = `${deployments}/{pages_deployment_id}`;
const failedStatuses = new Set([
  "deployment_failed",
  "deployment_content_failed",
  "deployment_cancelled",
  "deployment_lost",
]);

export async function deployPages({ github, core, context, artifactId }) {
  const id = Number(artifactId);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error("The Pages upload did not return a valid artifact ID");
  }

  const { data } = await github.request(`POST ${deployments}`, {
    ...context.repo,
    artifact_id: id,
    pages_build_version: context.sha,
    oidc_token: await core.getIDToken(),
  });
  const params = {
    ...context.repo,
    pages_deployment_id: data.id || context.sha,
  };
  core.info(
    `Created Pages deployment ${params.pages_deployment_id} for artifact ${id}`,
  );

  let pending = true;
  async function cancel() {
    if (!pending) return;
    pending = false;
    try {
      await github.request(`POST ${deployment}/cancel`, {
        ...params,
        request: { signal: AbortSignal.timeout(5000) },
      });
    } catch (error) {
      core.warning(`Unable to cancel Pages deployment: ${error.message}`);
    }
  }

  async function onSignal() {
    await cancel();
    process.exit(1);
  }

  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const deadline = Date.now() + 10 * 60 * 1000;
    let statusErrors = 0;
    while (Date.now() < deadline) {
      let status;
      try {
        const progress = await github.request(`GET ${deployment}`, {
          ...params,
          request: { signal: AbortSignal.timeout(10000) },
        });
        status = progress.data.status;
        statusErrors = 0;
      } catch (error) {
        statusErrors++;
        if (
          statusErrors >= 10 ||
          error.status === 401 ||
          error.status === 403
        ) {
          throw error;
        }
        core.warning(
          `Unable to read Pages deployment status: ${error.message}`,
        );
      }

      if (status === "succeed") {
        pending = false;
        core.setOutput("page_url", data.page_url);
        core.info(`Published ${data.page_url}`);
        return;
      }
      if (failedStatuses.has(status)) {
        pending = false;
        throw new Error(`Pages deployment ended with status ${status}`);
      }
      if (status) core.info(`Pages deployment status: ${status}`);
      await sleep(5000);
    }
    throw new Error("Pages deployment did not finish within 10 minutes");
  } finally {
    await cancel();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
