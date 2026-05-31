/**
 * Quick OCR proof-of-concept: run Tesseract.js (German) on a single rendered
 * PDF page and dump the output so we can judge quality before committing to
 * a full 138-page OCR run.
 */

import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  const pagePath =
    process.argv[2] ??
    path.join("scripts", "transcriptions", "_renders", "page-100.png");
  if (!fs.existsSync(pagePath)) {
    console.error(`❌ Missing ${pagePath}`);
    process.exit(1);
  }
  console.log(`🔍 OCR'ing ${pagePath}…`);

  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("deu", undefined, {
    logger: (m: { status?: string; progress?: number }) => {
      if (m.status === "recognizing text" && (m.progress ?? 0) > 0) {
        process.stdout.write(
          `\r   recognizing: ${Math.round((m.progress ?? 0) * 100)}%`,
        );
      }
    },
  });
  const start = Date.now();
  const { data } = await worker.recognize(pagePath);
  await worker.terminate();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n⏱  ${elapsed}s`);
  console.log(`📏 ${data.text.length} chars`);
  console.log(`📊 Mean confidence: ${data.confidence?.toFixed(1) ?? "—"}`);
  console.log(`\n========== OCR OUTPUT ==========`);
  console.log(data.text);
  console.log(`========== END ==========`);

  const outPath = pagePath.replace(/\.png$/i, ".ocr.txt");
  fs.writeFileSync(outPath, data.text, "utf-8");
  console.log(`📁 Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
