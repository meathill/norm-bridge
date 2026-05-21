import { randomUUID } from 'node:crypto';

export const ID_PREFIX = {
  project: 'proj',
  source: 'src',
  standard: 'std',
  clause: 'cls',
  requirement: 'req',
  citation: 'cit',
  reference: 'ref',
  product: 'prd',
  productAttribute: 'pra',
  evidence: 'evi',
  matchResult: 'mat',
  job: 'job',
  auditEvent: 'aud',
  catalog: 'cat',
  category: 'cgy',
  productRequiredStandard: 'prs',
} as const;

export type IdKind = keyof typeof ID_PREFIX;

export function newId(kind: IdKind): string {
  return `${ID_PREFIX[kind]}_${randomUUID().replace(/-/g, '')}`;
}
