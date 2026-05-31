/**
 * One-off recon for Goethe-Zertifikat Wortliste PDFs.
 *
 * Dumps full text + the first N chars of each page so we can eyeball whether
 * the PDF has a text layer and what the entry shape of section 2
 * "Alphabetischer Wortschatz" looks like.
 *
 * Run:
 *   npx tsx scripts/wl-scout.ts scripts/Goethe-Zertifikat_B1_Wortliste.pdf
 */

import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  const pdfPath =
    process.argv[2] ?? "scripts/Goethe-Zertifikat_B1_Wortliste.pdf";
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

  const tag = path
    .basename(pdfPath, ".pdf")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  const fullPath = path.join(outDir, `_wl-${tag}-full.txt`);
  const jsonPath = path.join(outDir, `_wl-${tag}-pages.json`);
  const dump = result.pages
    .map((p) => `\n===== PAGE ${p.num} =====\n${p.text.trim()}\n`)
    .join("\n");
  fs.writeFileSync(fullPath, dump, "utf-8");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(result.pages, null, 2),
    "utf-8",
  );

  console.log(`📄 PDF:         ${pdfPath}`);
  console.log(`📊 Pages:       ${result.total}`);
  console.log(`📊 Total chars: ${result.text.length}`);
  console.log(`📁 Wrote        ${fullPath}`);

  for (const sample of [1, 2, 5, 10, 15]) {
    const page = result.pages[sample - 1];
    if (!page) continue;
    console.log(`\n--- Page ${sample}: first 600 chars ---`);
    console.log(page.text.slice(0, 600));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
