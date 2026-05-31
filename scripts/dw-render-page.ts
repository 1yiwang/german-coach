/**
 * Render specific PDF pages as PNGs so we can eyeball whether OCR is needed
 * and how readable the scans are.
 *
 * Run:
 *   npx tsx scripts/dw-render-page.ts <pageNum> [<pageNum> ...]
 */

import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  const pagesArg = process.argv.slice(2).map((n) => Number(n)).filter(Boolean);
  const pages = pagesArg.length > 0 ? pagesArg : [1, 5, 50, 100];
  const pdfPath = path.join("scripts", "B1 listening.pdf");
  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ PDF not found: ${pdfPath}`);
    process.exit(1);
  }
  const outDir = path.join("scripts", "transcriptions", "_renders");
  fs.mkdirSync(outDir, { recursive: true });

  const { PDFParse } = await import("pdf-parse");
  const buf = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const result = await parser.getScreenshot({
    partial: pages,
    scale: 2,
    imageDataUrl: false,
  });
  await parser.destroy();

  for (const p of result.pages) {
    const out = path.join(outDir, `page-${String(p.pageNumber).padStart(3, "0")}.png`);
    fs.writeFileSync(out, Buffer.from(p.data));
    console.log(
      `📁 ${out}  (${p.width}x${p.height}, ${Math.round((p.data.length ?? 0) / 1024)} KB)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
