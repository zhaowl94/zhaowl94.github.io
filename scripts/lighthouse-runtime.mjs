const baseChromeFlags = Object.freeze(["--headless=new", "--disable-gpu"]);
const linuxCiChromeFlags = Object.freeze([
  "--no-sandbox",
  "--disable-dev-shm-usage",
]);

export function chromeFlagsForEnvironment(
  environment = process.env,
  platform = process.platform,
) {
  const flags = [...baseChromeFlags];

  if (platform === "linux" && environment.CI === "true") {
    flags.push(...linuxCiChromeFlags);
  }

  return flags;
}

export function isWslEnvironment(
  environment = process.env,
  platform = process.platform,
) {
  return (
    platform === "linux" &&
    Boolean(environment.WSL_DISTRO_NAME || environment.WSL_INTEROP)
  );
}

export async function stopProcessAndWait(
  childProcess,
  stop,
  timeoutMilliseconds = 5_000,
) {
  if (!childProcess) {
    return;
  }

  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    stop();
    return;
  }

  await new Promise((resolve, reject) => {
    let timeoutHandle;
    const finish = () => {
      clearTimeout(timeoutHandle);
      childProcess.off("close", finish);
      resolve();
    };

    childProcess.once("close", finish);
    timeoutHandle = setTimeout(finish, timeoutMilliseconds);

    try {
      stop();
    } catch (error) {
      clearTimeout(timeoutHandle);
      childProcess.off("close", finish);
      reject(error);
    }
  });
}
