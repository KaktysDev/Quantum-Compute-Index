export const PUBLIC_CONFIG = {
  productName: "QRouter",
  engineName: "QCI Engine",
  indexName: "Quantum Compute Index",
  apiBaseUrl: "https://api.qrouter.dev",
  jobsPath: "/api/v1/jobs",
  docsUrl: "/docs",
  consoleUrl: "/dashboard",
  accessUrl: "/contact",
  companyLocation: "Chicago",
  copyright: "© 2026 QRouter",
} as const;

export const PUBLIC_JOBS_ENDPOINT = `${PUBLIC_CONFIG.apiBaseUrl}${PUBLIC_CONFIG.jobsPath}`;

export const PUBLIC_FEATURE_STATUS = {
  routingEngine: "PRIVATE BETA",
  providerFailover: "IN DEVELOPMENT",
  repositoryDeploy: "AVAILABLE",
  indexFallback: "SAMPLE DATA",
} as const;
