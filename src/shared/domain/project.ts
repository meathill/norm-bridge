export const PROJECT_SCHEMA_VERSION = '0.1' as const;

export type ProjectConfig = {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  defaultLocale: string;
  agentProfile: string;
  dbPath: string;
};

export type ProjectInfo = {
  config: ProjectConfig;
  directory: string;
};

export type ProjectStatus = {
  hasOpenProject: boolean;
  project: ProjectInfo | null;
  counts: {
    standards: number;
    inputs: number;
    evidence: number;
    jobs: number;
  };
};
