import type { TgDueItem, TgDueSentence, TgDueWord } from "./db";

function truncate(text: string, max = 220): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function itemName(item: TgDueItem): string {
  if (item.type === "word") return item.title;
  return `${item.documentTitle} · Satz ${item.sentenceIndex + 1}`;
}

export function formatMorningSummary(items: TgDueItem[], today = new Date()) {
  const words = items.filter((i) => i.type === "word") as TgDueWord[];
  const sentences = items.filter((i) => i.type === "sentence") as TgDueSentence[];
  const date = today.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });
  const topWords = words.slice(0, 8).map((w) => `• ${w.title}`).join("\n");
  const topSentences = sentences
    .slice(0, 4)
    .map((s) => `• ${s.documentTitle} · Satz ${s.sentenceIndex + 1}`)
    .join("\n");

  return [
    `Guten Morgen! ☀️`,
    ``,
    `Heute ist ${date}.`,
    `Du hast ${items.length} fällige Karten:`,
    `🔤 Wörter: ${words.length}`,
    `🎧 Sätze: ${sentences.length}`,
    topWords ? `\nWörter:\n${topWords}` : "",
    topSentences ? `\nSätze:\n${topSentences}` : "",
    ``,
    `👉 Starte mit /due oder öffne die App.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatDueCount(items: TgDueItem[]) {
  const preview = items
    .slice(0, 10)
    .map((item, i) => `${i + 1}. ${itemName(item)}`)
    .join("\n");
  return [
    `Du hast gerade ${items.length} fällige Karten.`,
    preview ? `\n${preview}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatSinglePreview(item: TgDueItem): string {
  if (item.type === "word") {
    return [
      `📚 ${item.title}`,
      `→ ${truncate(item.definition, 120)}`,
      item.example ? `\n💬 ${truncate(item.example)}` : "",
      item.sourceRef ? `\nQuelle: ${item.sourceRef}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `🎧 ${item.documentTitle}`,
    `Satz ${item.sentenceIndex + 1}`,
    ``,
    truncate(item.sentence),
  ].join("\n");
}
