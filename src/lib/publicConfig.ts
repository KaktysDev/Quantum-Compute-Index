export const PUBLIC_CONFIG = {
  productName: "QRouter",
  engineName: "Execution planner",
  indexName: "Quantum Compute Index",
  apiBaseUrl: "https://qrouter.app",
  jobsPath: "/api/v1/jobs",
  docsUrl: "/docs",
  consoleUrl: "/dashboard",
  accessUrl: "/signin",
  copyright: "© 2026 QRouter",
} as const;

export const PUBLIC_JOBS_ENDPOINT = `${PUBLIC_CONFIG.apiBaseUrl}${PUBLIC_CONFIG.jobsPath}`;

export const PUBLIC_FEATURE_STATUS = {
  routingEngine: "PRIVATE BETA",
  providerFailover: "IN DEVELOPMENT",
  repositoryDeploy: "AVAILABLE",
  indexFallback: "SAMPLE DATA",
} as const;
