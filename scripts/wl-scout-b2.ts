/**
 * Deep scout: find the word-list section in the B2 PDF
 */

import * as fs from "node:fs";

async function main() {
  const pdfPath = "scripts/Goethe-Zertifikat_B2_Wortliste.pdf";
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data }).promise;

  // Scan all pages: find any that mention "Wortliste" or have word-entry patterns
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const tc = await page.getTextContent();
    const texts = tc.items
      .filter((i: any) => i.str.trim().length > 0)
      .map((i: any) => ({
        x: i.transform[4],
        y: i.transform[5],
        text: i.str.trim(),
      }));

    if (texts.length === 0) continue;

    // Check for "Wortliste" or "Wortschatz" keywords
    const pageText = texts.map((t: any) => t.text).join(" ");
    const hasWortliste = /Wortliste|Wortschatz|Vocabulary/i.test(pageText);

    if (hasWortliste || pageNum <= 5 || pageNum >= doc.numPages - 2) {
      console.log(`\n=== Page ${pageNum} (${texts.length} items) ${hasWortliste ? "🌟 WORTLISTE" : ""} ===`);
      // Show text structure - group by y
      const byY: Record<number, string[]> = {};
      for (const t of texts) {
        const yBucket = Math.round(t.y / 15) * 15;
        if (!byY[yBucket]) byY[yBucket] = [];
        byY[yBucket].push(`(x:${t.x.toFixed(0)}) ${t.text}`);
      }
      const yKeys = Object.keys(byY).map(Number).sort((a, b) => b - a);
      for (const y of yKeys.slice(0, 20)) {
        console.log(`  y≈${y}: ${byY[y].join(" | ")}`);
      }

      if (hasWortliste) {
        // Dump more detail for this page
        console.log("  --- Full text dump ---");
        const sorted = [...texts].sort((a: any, b: any) => b.y - a.y || a.x - b.x);
        for (const t of sorted) {
          console.log(`  (${t.x.toFixed(0)},${t.y.toFixed(0)}) "${t.text}"`);
        }
      }
    }

    // Check if this page has two-column word-list layout (entries + examples)
    const leftItems = texts.filter((t: any) => t.x < 230);
    const rightItems = texts.filter((t: any) => t.x >= 230);
    if (leftItems.length > 10 && rightItems.length > 5) {
      // Check if items look like word entries
      const wordLike = leftItems.filter((t: any) =>
        /^[a-zäöüß]/.test(t.text) && t.text.length > 3
      );
      if (wordLike.length > 5 && !hasWortliste) {
        console.log(`\n=== Page ${pageNum} (${texts.length} items) — possible word-list page ===`);
        const sorted = [...texts].sort((a: any, b: any) => b.y - a.y || a.x - b.x);
        for (const t of sorted.slice(0, 15)) {
          console.log(`  (${t.x.toFixed(0)},${t.y.toFixed(0)}) "${t.text}"`);
        }
        console.log("  ...");
      }
    }
  }

  await (doc as any).destroy?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
