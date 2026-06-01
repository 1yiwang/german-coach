/**
 * Debug: find where "kaufen" and "treffen" etc. appear in the PDF
 * and why they're not being extracted.
 *
 * Run:
 *   npx tsx scripts/wl-debug-missing.ts
 */

import * as fs from "node:fs";

async function main() {
  const pdfPath = "scripts/Goethe-Zertifikat_B1_Wortliste.pdf";
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data }).promise;

  const targetWords = ["kaufen", "treffen", "verstehen", "waschen"];
  const foundPages = new Map<string, number[]>();

  for (let pageNum = 16; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items: any[] = textContent.items
      .filter((item: any) => item.str.trim().length > 0);

    const pageText = items.map((i: any) => i.str).join(" ");

    for (const word of targetWords) {
      if (pageText.toLowerCase().includes(word.toLowerCase())) {
        if (!foundPages.has(word)) foundPages.set(word, []);
        foundPages.get(word)!.push(pageNum);
      }
    }
  }

  for (const word of targetWords) {
    const pages = foundPages.get(word);
    console.log(`\n${word}: ${pages ? `pages ${pages.join(", ")}` : "NOT FOUND"}`);
  }

  // Now dump the coordinates for the pages where these words appear
  const allPages = new Set<number>();
  for (const [, pages] of foundPages) {
    for (const p of pages) allPages.add(p);
  }

  for (const pageNum of [...allPages].sort((a, b) => a - b)) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = textContent.items
      .filter((item: any) => item.str.trim().length > 0)
      .map((item: any) => ({
        x: item.transform[4],
        y: item.transform[5],
        text: item.str.trim(),
      }))
      .filter((item: any) => item.y > 40 && item.y < 805);

    // Find rows that contain any target word
    const relevant = items.filter((item: any) =>
      targetWords.some((w) => item.text.toLowerCase().includes(w.toLowerCase()))
    );

    if (relevant.length === 0) continue;

    // Show context: all items near the relevant ones (within 50 y-units)
    const ys = relevant.map((r: any) => r.y);
    const yMin = Math.min(...ys) - 50;
    const yMax = Math.max(...ys) + 50;

    const context = items.filter((i: any) => i.y >= yMin && i.y <= yMax);
    context.sort((a: any, b: any) => b.y - a.y || a.x - b.x);

    console.log(`\n===== PAGE ${pageNum} (y range ${yMin.toFixed(0)}-${yMax.toFixed(0)}) =====`);
    const COL = 230;
    const col = context[0]?.x < COL ? "LEFT" : "RIGHT";
    console.log(`Column: ${col}`);
    for (const item of context) {
      console.log(`  (${item.x.toFixed(1)}, ${item.y.toFixed(1)}) "${item.text}"`);
    }
  }

  await (doc as any).destroy?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
