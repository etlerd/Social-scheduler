export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { config, setupProblems } = await import("./lib/config");
  if (setupProblems().length || !config.workerEnabled) {
    console.warn("[worker] not started:", setupProblems().join(" ") || "DISABLE_WORKER=true");
    return;
  }
  const { startWorker } = await import("./lib/worker");
  startWorker();
}
