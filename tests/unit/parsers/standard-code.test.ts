import { describe, expect, it } from 'vitest';
import { csiDivision, normalizeStandardCode, parseIssuingBody } from '@main/parsers/standard-code';

describe('standard-code', () => {
  it('normalizes whitespace', () => {
    expect(normalizeStandardCode('  ISO   19650-1 ')).toBe('ISO 19650-1');
  });

  it('parses issuing bodies', () => {
    expect(parseIssuingBody('ISO 19650-1:2018')).toBe('ISO');
    expect(parseIssuingBody('IEC 60898-1')).toBe('IEC');
    expect(parseIssuingBody('EN 1991')).toBe('EN');
    expect(parseIssuingBody('GB/T 14048.2')).toBe('GB');
    expect(parseIssuingBody('ASTM C150')).toBe('ASTM');
  });

  it('treats CSI section numbers as CSI', () => {
    expect(parseIssuingBody('01 74 19')).toBe('CSI');
    expect(parseIssuingBody('03 30 00')).toBe('CSI');
  });

  it('returns undefined for unrecognized codes', () => {
    expect(parseIssuingBody('Project Memo 7')).toBeUndefined();
    expect(parseIssuingBody('random text')).toBeUndefined();
  });

  it('extracts CSI division + label', () => {
    expect(csiDivision('01 74 19')).toEqual({ code: '01', name: '01 General Requirements' });
    expect(csiDivision('03 30 00')).toEqual({ code: '03', name: '03 Concrete' });
    expect(csiDivision('99 99 99')).toEqual({ code: '99', name: '99 Division' });
  });

  it('returns null csiDivision for non-CSI codes', () => {
    expect(csiDivision('ISO 19650')).toBeNull();
  });
});
