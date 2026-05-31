/**
 * Render every page of the source PDF as a PNG, then OCR each page with
 * Tesseract.js (German). Both phases are cache-friendly so an interrupted
 * run just resumes.
 *
 * Outputs (gitignored under scripts/transcriptions/):
 *   _renders/page-NNN.png       — high-DPI rendering of each PDF page
 *   _ocr/page-NNN.txt           — OCR'd text for each page
 *   _ocr/_index.json            — { totalPages, perPage:[{n, chars, confidence, durationMs}] }
 *
 * Run:
 *   npx tsx scripts/dw-pdf-extract.ts
 *   npx tsx scripts/dw-pdf-extract.ts --skip-render   # already rendered
 *   npx tsx scripts/dw-pdf-extract.ts --pages 1,5,100 # limit
 *
 * Why split render + OCR:
 *   Rendering is expensive (memory + CPU spike per page), OCR is mostly idle
 *   CPU per page. We may want to re-render at a different DPI without
 *   re-OCR'ing, or vice versa.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const baseDir = process.cwd();
const pdfPath = path.join(baseDir, "scripts", "B1 listening.pdf");
const rendersDir = path.join(baseDir, "scripts", "transcriptions", "_renders");
const ocrDir = path.join(baseDir, "scripts", "transcriptions", "_ocr");
const indexPath = path.join(ocrDir, "_index.json");

const skipRender = process.argv.includes("--skip-render");
const skipOcr = process.argv.includes("--skip-ocr");
const pagesArgIdx = process.argv.indexOf("--pages");
const pagesArg =
  pagesArgIdx >= 0
    ? process.argv[pagesArgIdx + 1]
        ?.split(",")
        .map((s) => Number(s.trim()))
        .filter(Boolean)
    : undefined;

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

async function renderPages(allPages: number[]): Promise<void> {
  const { PDFParse } = await import("pdf-parse");
  const buf = fs.readFileSync(pdfPath);
  // Render in batches of 10 to keep memory bounded — full 138-page pass at
  // scale 2 otherwise spikes ~3 GB and risks OOM.
  const batch = 10;
  fs.mkdirSync(rendersDir, { recursive: true });
  for (let i = 0; i < allPages.length; i += batch) {
    const slice = allPages.slice(i, i + batch);
    const todo = slice.filter(
      (n) => !fs.existsSync(path.join(rendersDir, `page-${pad(n)}.png`)),
    );
    if (todo.length === 0) {
      console.log(`   render [${slice[0]}..${slice.at(-1)}] cached`);
      continue;
    }
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getScreenshot({
      partial: todo,
      scale: 2,
      imageDataUrl: false,
    });
    await parser.destroy();
    for (const p of result.pages) {
      const out = path.join(rendersDir, `page-${pad(p.pageNumber)}.png`);
      fs.writeFileSync(out, Buffer.from(p.data));
    }
    console.log(
      `   render [${slice[0]}..${slice.at(-1)}]: ${todo.length} new, ${
        slice.length - todo.length
      } cached`,
    );
  }
}

interface PageOcr {
  n: number;
  chars: number;
  confidence: number;
  durationMs: number;
}

async function ocrPages(allPages: number[]): Promise<PageOcr[]> {
  fs.mkdirSync(ocrDir, { recursive: true });
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("deu", undefined, { logger: () => {} });
  const summary: PageOcr[] = [];
  for (let i = 0; i < allPages.length; i++) {
    const n = allPages[i];
    const png = path.join(rendersDir, `page-${pad(n)}.png`);
    const out = path.join(ocrDir, `page-${pad(n)}.txt`);
    if (fs.existsSync(out)) {
      const text = fs.readFileSync(out, "utf-8");
      summary.push({ n, chars: text.length, confidence: -1, durationMs: 0 });
      process.stdout.write(
        `\rocr ${i + 1}/${allPages.length} page ${n} cached     `,
      );
      continue;
    }
    if (!fs.existsSync(png)) {
      console.warn(`\n⚠️  Missing render for page ${n}, skipping.`);
      continue;
    }
    const start = Date.now();
    const { data } = await worker.recognize(png);
    const elapsed = Date.now() - start;
    fs.writeFileSync(out, data.text, "utf-8");
    summary.push({
      n,
      chars: data.text.length,
      confidence: +(data.confidence ?? 0).toFixed(1),
      durationMs: elapsed,
    });
    process.stdout.write(
      `\rocr ${i + 1}/${allPages.length} page ${n}: ${data.text.length} chars, ` +
        `conf ${(data.confidence ?? 0).toFixed(1)}, ${(elapsed / 1000).toFixed(1)}s     `,
    );
  }
  await worker.terminate();
  process.stdout.write("\n");
  return summary;
}

async function main() {
  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ PDF not found: ${pdfPath}`);
    process.exit(1);
  }

  // Determine the page list.
  let allPages: number[];
  if (pagesArg && pagesArg.length > 0) {
    allPages = pagesArg;
    console.log(`🎯 Limiting to pages: ${allPages.join(",")}`);
  } else {
    // Get total via a cheap getInfo() call.
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({
      data: new Uint8Array(fs.readFileSync(pdfPath)),
    });
    const info = await parser.getInfo();
    await parser.destroy();
    allPages = Array.from({ length: info.total }, (_, i) => i + 1);
    console.log(`📊 Total pages: ${info.total}`);
  }

  if (!skipRender) {
    console.log(`\n🖼  Rendering pages…`);
    await renderPages(allPages);
  } else {
    console.log(`\n⏭  Skipping render`);
  }

  if (!skipOcr) {
    console.log(`\n🔍 OCR'ing pages…`);
    const summary = await ocrPages(allPages);
    fs.writeFileSync(
      indexPath,
      JSON.stringify(
        { totalPages: allPages.length, perPage: summary },
        null,
        2,
      ),
      "utf-8",
    );
    const totalChars = summary.reduce((a, b) => a + b.chars, 0);
    const validConf = summary.filter((p) => p.confidence > 0);
    const avgConf =
      validConf.length > 0
        ? validConf.reduce((a, b) => a + b.confidence, 0) / validConf.length
        : 0;
    const totalMs = summary.reduce((a, b) => a + b.durationMs, 0);
    console.log(
      `\n✅ OCR done: ${summary.length} pages, ${totalChars} chars total,` +
        ` mean confidence ${avgConf.toFixed(1)}, ${(totalMs / 1000).toFixed(1)}s spent`,
    );
    console.log(`📁 Index: ${indexPath}`);
  } else {
    console.log(`\n⏭  Skipping OCR`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
