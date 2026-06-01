/**
 * Quick scout to understand the coordinate layout of Goethe B1 Wortliste PDF.
 * Uses pdfjs-dist to get individual text items with (x, y) positions.
 *
 * Run:
 *   npx tsx scripts/wl-scout-coords.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  const pdfPath = "scripts/Goethe-Zertifikat_B1_Wortliste.pdf";
  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ PDF not found: ${pdfPath}`);
    process.exit(1);
  }

  // Dynamic import because pdfjs-dist ESM/CJS interop is fragile
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data }).promise;

  console.log(`📄 PDF: ${pdfPath}`);
  console.log(`📊 Pages: ${doc.numPages}`);

  // Scout pages 16-18 (start of section 2 "Alphabetischer Wortschatz")
  for (const pageNum of [16, 17, 18]) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    console.log(`\n===== PAGE ${pageNum} =====`);
    console.log(`Viewport: ${viewport.width.toFixed(1)} x ${viewport.height.toFixed(1)}`);
    console.log(`Text items: ${textContent.items.length}`);

    // Sort items by y then x
    const items = textContent.items
      .filter((item: any) => item.str.trim().length > 0)
      .map((item: any) => ({
        x: item.transform[4],
        y: item.transform[5],
        w: item.width,
        h: item.height,
        text: item.str,
      }));

    // Print first 50 items with coordinates
    console.log(`\nFirst 50 items (x, y, text):`);
    for (const item of items.slice(0, 50)) {
      console.log(`  (${item.x.toFixed(1)}, ${item.y.toFixed(1)}) [${item.w.toFixed(1)}x${item.h.toFixed(1)}] "${item.text}"`);
    }

    // Also print the last 50 items (to see right column)
    console.log(`\nLast 50 items (x, y, text):`);
    for (const item of items.slice(-50)) {
      console.log(`  (${item.x.toFixed(1)}, ${item.y.toFixed(1)}) [${item.w.toFixed(1)}x${item.h.toFixed(1)}] "${item.text}"`);
    }

    // Show x-distribution to find column boundary
    const xs = items.map((i: any) => i.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    console.log(`\nX range: ${minX.toFixed(1)} - ${maxX.toFixed(1)}`);

    // Count items in left vs right half
    const midX = (minX + maxX) / 2;
    const left = items.filter((i: any) => i.x < midX).length;
    const right = items.filter((i: any) => i.x >= midX).length;
    console.log(`Items: left=${left}, right=${right} (split at x=${midX.toFixed(1)})`);

    if (pageNum >= 17) break; // Only do 3 pages for now
  }

  await (doc as any).destroy?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
