/**
 * Parse and normalize standard codes so the registry can classify them.
 * Pure functions, unit-tested without a PDF.
 */

const ISSUING_BODIES = [
  'ISO',
  'IEC',
  'EN',
  'BS',
  'DIN',
  'ASTM',
  'ASHRAE',
  'UL',
  'JIS',
  'ANSI',
  'NFPA',
  'ACI',
  'AASHTO',
  'AWS',
  'AISC',
  'BSI',
  'GB',
] as const;

const CSI_SECTION_RE = /^\d{2}\s+\d{2}\s+\d{2}$/;

/** Collapse whitespace and trim; leave the body text otherwise intact. */
export function normalizeStandardCode(code: string): string {
  return code.replace(/\s+/g, ' ').trim();
}

/**
 * Infer the issuing body / standard family from a code.
 *   "ISO 19650-1:2018" → "ISO"
 *   "GB/T 14048"       → "GB"
 *   "01 74 19"         → "CSI"   (MasterFormat section)
 *   "Foo Bar"          → undefined
 */
export function parseIssuingBody(code: string): string | undefined {
  const normalized = normalizeStandardCode(code);
  if (CSI_SECTION_RE.test(normalized)) return 'CSI';
  const head = normalized.toUpperCase().match(/^([A-Z]+)(?:\/[A-Z]+)?\b/)?.[1];
  if (head && (ISSUING_BODIES as readonly string[]).includes(head)) return head;
  return undefined;
}

/**
 * For CSI MasterFormat codes ("01 74 19"), return the division ("01") and a
 * human label. Returns null for non-CSI codes.
 */
export function csiDivision(code: string): { code: string; name: string } | null {
  const normalized = normalizeStandardCode(code);
  if (!CSI_SECTION_RE.test(normalized)) return null;
  const division = normalized.slice(0, 2);
  return { code: division, name: `${division} ${CSI_DIVISION_NAMES[division] ?? 'Division'}` };
}

/** A subset of CSI MasterFormat division names (enough to label what we see). */
const CSI_DIVISION_NAMES: Record<string, string> = {
  '00': 'Procurement and Contracting Requirements',
  '01': 'General Requirements',
  '02': 'Existing Conditions',
  '03': 'Concrete',
  '04': 'Masonry',
  '05': 'Metals',
  '06': 'Wood, Plastics, and Composites',
  '07': 'Thermal and Moisture Protection',
  '08': 'Openings',
  '09': 'Finishes',
  '10': 'Specialties',
  '11': 'Equipment',
  '12': 'Furnishings',
  '13': 'Special Construction',
  '14': 'Conveying Equipment',
  '21': 'Fire Suppression',
  '22': 'Plumbing',
  '23': 'Heating, Ventilating, and Air Conditioning (HVAC)',
  '25': 'Integrated Automation',
  '26': 'Electrical',
  '27': 'Communications',
  '28': 'Electronic Safety and Security',
  '31': 'Earthwork',
  '32': 'Exterior Improvements',
  '33': 'Utilities',
  '34': 'Transportation',
  '40': 'Process Interconnections',
  '41': 'Material Processing and Handling Equipment',
};
