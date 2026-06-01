/**
 * Debug script: dump all text items for page 16 (first alphabet page)
 * to understand the headword/example layout.
 *
 * Run:
 *   npx tsx scripts/wl-debug-page.ts
 */

import * as fs from "node:fs";

async function main() {
  const pdfPath = "scripts/Goethe-Zertifikat_B1_Wortliste.pdf";
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data }).promise;

  // Pages 16-20 should have "ab", "abbiegen", "Abbildung" etc.
  for (const pageNum of [16, 17]) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = textContent.items
      .filter((item: any) => item.str.trim().length > 0)
      .map((item: any) => ({
        x: item.transform[4],
        y: item.transform[5],
        w: item.width,
        h: item.height,
        text: item.str.trim(),
      }))
      .filter((item: any) => item.y > 40 && item.y < 805);

    console.log(`\n===== PAGE ${pageNum} =====`);
    console.log(`Total items: ${items.length}`);

    // Sort by y descending (top to bottom), then x ascending
    items.sort((a: any, b: any) => b.y - a.y || a.x - b.x);

    const COLUMN_GAP = 230;
    const leftItems = items.filter((i: any) => i.x < COLUMN_GAP);
    const rightItems = items.filter((i: any) => i.x >= COLUMN_GAP);

    for (const [label, colItems] of [["LEFT", leftItems], ["RIGHT", rightItems]] as [string, any[]][]) {
      console.log(`\n--- ${label} COLUMN (${colItems.length} items) ---`);

      // Compute x-split for this column
      let c1 = 0, c2 = 0;
      if (colItems.length >= 4) {
        const xs = colItems.map((i: any) => i.x);
        const sorted = [...xs].sort((a: number, b: number) => a - b);
        c1 = sorted[0];
        c2 = sorted[sorted.length - 1];
        for (let iter = 0; iter < 5; iter++) {
          const g1: number[] = [];
          const g2: number[] = [];
          for (const x of xs) {
            if (Math.abs(x - c1) <= Math.abs(x - c2)) g1.push(x);
            else g2.push(x);
          }
          if (g1.length > 0) c1 = g1.reduce((a: number, b: number) => a + b, 0) / g1.length;
          if (g2.length > 0) c2 = g2.reduce((a: number, b: number) => a + b, 0) / g2.length;
        }
        const split = (c1 + c2) / 2;
        console.log(`X-split: ${split.toFixed(1)} (left cluster center: ${c1.toFixed(1)}, right cluster center: ${c2.toFixed(1)})`);
      }

      for (const item of colItems.slice(0, 100)) {
        const split = (c1 + c2) / 2;
        const side = item.x < split ? "HW" : "EX";
        console.log(`  ${side} (${item.x.toFixed(1)}, ${item.y.toFixed(1)}) "${item.text}"`);
      }
    }
  }

  await (doc as any).destroy?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
