import path from "node:path";

// Read lazily so values come from the runtime environment, not build time.
export const config = {
  get publicUrl() {
    return (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/+$/, "");
  },
  get dataDir() {
    return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || path.join(process.cwd(), "data"));
  },
  get mediaDir() {
    return path.join(this.dataDir, "media");
  },
  get appPassword() {
    return process.env.APP_PASSWORD || "";
  },
  get secretKey() {
    return process.env.SECRET_KEY || "";
  },
  get maxUploadBytes() {
    return Number(process.env.MAX_UPLOAD_MB || 2048) * 1024 * 1024;
  },
  get instagram() {
    return {
      appId: process.env.INSTAGRAM_APP_ID || "",
      appSecret: process.env.INSTAGRAM_APP_SECRET || "",
      graphVersion: process.env.INSTAGRAM_GRAPH_VERSION || "v23.0",
    };
  },
  get google() {
    return {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    };
  },
  get demoAccounts() {
    return process.env.ENABLE_DEMO_ACCOUNTS === "true";
  },
  get cronSecret() {
    return process.env.CRON_SECRET || "";
  },
  get workerEnabled() {
    return process.env.DISABLE_WORKER !== "true";
  },
};

export function setupProblems(): string[] {
  const problems: string[] = [];
  if (!config.appPassword) problems.push("APP_PASSWORD is not set.");
  if (config.secretKey.length < 32) problems.push("SECRET_KEY must be at least 32 characters.");
  return problems;
}
