/**
 * Generate a tiny valid PDF entirely in code so tests can run without binary fixtures.
 *
 * The xref table is built from actual byte offsets so pdfjs accepts it without
 * warnings. Multi-line content is drawn at 12pt, one text line per visual row,
 * so each line stays on-page and extracts cleanly (a single long line overflows
 * the page width and pdfjs drops the overflow).
 */
export function makeMinimalPdf(options: { text?: string; lines?: string[] } = {}): Buffer {
  const lines = options.lines ?? [options.text ?? 'Hello NormBridge'];
  const contentStream = buildContentStream(lines);

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(contentStream, 'latin1')} >>\nstream\n${contentStream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  const header = '%PDF-1.4\n%âãÏÓ\n';
  let cursor = Buffer.byteLength(header, 'latin1');
  const offsets: number[] = [0]; // index 0 = the free header slot
  let body = '';

  for (let i = 0; i < objects.length; i++) {
    offsets.push(cursor);
    const block = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    body += block;
    cursor += Buffer.byteLength(block, 'latin1');
  }

  const xrefOffset = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(header + body + xref + trailer, 'latin1');
}

function buildContentStream(lines: string[]): string {
  const rows = lines.map((line, i) => {
    const y = 740 - i * 16;
    return `1 0 0 1 72 ${y} Tm\n(${escapePdfText(line)}) Tj`;
  });
  return `BT\n/F1 12 Tf\n${rows.join('\n')}\nET\n`;
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Generate a PDF that pdfjs will reject as malformed (used to test error paths).
 */
export function makeBrokenPdf(): Buffer {
  return Buffer.from('%PDF-1.4\nthis is not a valid PDF body\n%%EOF\n', 'latin1');
}
