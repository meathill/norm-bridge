import { z } from 'zod';
import { PROJECT_SCHEMA_VERSION } from '../domain/project';

export const projectConfigSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  projectId: z.string().min(1),
  name: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  defaultLocale: z.string().default('en'),
  agentProfile: z.string().default('standard-index-v0.1'),
  dbPath: z.string().default('db/normbridge.sqlite'),
});

export type ProjectConfigInput = z.input<typeof projectConfigSchema>;
