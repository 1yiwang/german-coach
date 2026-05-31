/**
 * One-off PDF reconnaissance: extract every page of the source PDF as plain
 * text + an aggregate dump, so we can eyeball the structure before writing a
 * real parser.
 *
 * Output (gitignored under scripts/transcriptions/):
 *   _scout-full.txt    — entire PDF as one stream, separated by ===== PAGE N =====
 *   _scout-pages.json  — per-page array {num, text}
 *
 * Run:
 *   npx tsx scripts/dw-scout-pdf.ts "scripts/B1 listening.pdf"
 */

import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  const pdfPath =
    process.argv[2] ?? path.join("scripts", "B1 listening.pdf");
  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ PDF not found: ${pdfPath}`);
    process.exit(1);
  }
  const outDir = path.join("scripts", "transcriptions");
  fs.mkdirSync(outDir, { recursive: true });

  const { PDFParse } = await import("pdf-parse");
  const buf = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const result = await parser.getText();
  await parser.destroy();

  const fullPath = path.join(outDir, "_scout-full.txt");
  const jsonPath = path.join(outDir, "_scout-pages.json");
  const dump = result.pages
    .map((p) => `\n===== PAGE ${p.num} =====\n${p.text.trim()}\n`)
    .join("\n");
  fs.writeFileSync(fullPath, dump, "utf-8");
  fs.writeFileSync(jsonPath, JSON.stringify(result.pages, null, 2), "utf-8");

  console.log(`📄 PDF:        ${pdfPath}`);
  console.log(`📊 Pages:      ${result.total}`);
  console.log(`📊 Total chars: ${result.text.length}`);
  console.log(`📁 Wrote ${fullPath}`);
  console.log(`📁 Wrote ${jsonPath}`);
  console.log(`\n--- First 1800 chars of page 1 ---`);
  console.log(result.pages[0]?.text.slice(0, 1800) ?? "(empty)");
  console.log(`\n--- First 1800 chars of page 2 ---`);
  console.log(result.pages[1]?.text.slice(0, 1800) ?? "(empty)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
