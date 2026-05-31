/**
 * Telegram reminder bot MVP.
 *
 * Local run:
 *   npm run tg:bot
 *
 * Required env in .env.local:
 *   TELEGRAM_BOT_TOKEN=...
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *   APP_BASE_URL=http://localhost:3000
 *
 * Current scope: one-way SRS reminders.
 * - /start registers the current Telegram chat in tg_subscribers.
 * - /due shows the current due count and up to three preview cards.
 * - Scheduler:
 *   - 08:00 local time: one summary message.
 *   - 12:00 / 18:00 / 21:00 local time: up to three card previews.
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { Bot, InlineKeyboard } from "grammy";
import {
  filterUnsentItems,
  getDueItems,
  listActiveSubscribers,
  markSent,
  upsertSubscriber,
  wasSent,
  type TgDueItem,
  type TgSubscriber,
} from "../lib/tg/db";
import {
  formatDueCount,
  formatMorningSummary,
  formatSinglePreview,
} from "../lib/tg/templates";

config({ path: resolve(process.cwd(), ".env.local") });

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN in .env.local");
  process.exit(1);
}

const bot = new Bot(token);

const MORNING_WINDOW = "08:00";
const PREVIEW_WINDOWS = ["12:00", "18:00", "21:00"] as const;
const ALL_WINDOWS = [MORNING_WINDOW, ...PREVIEW_WINDOWS] as const;
const MAX_PREVIEWS_PER_WINDOW = 3;

function windowKey(now: Date, hhmm: string): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}T${hhmm}`;
}

function currentHHMM(now = new Date()): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
}

function reviewKeyboard(itemOrUrl: TgDueItem | string): InlineKeyboard {
  const url =
    typeof itemOrUrl === "string" ? itemOrUrl : itemOrUrl.reviewUrl;
  return new InlineKeyboard().url("📖 Zur Wiederholung", url);
}

async function sendPreview(
  chatId: number,
  item: TgDueItem,
  key: string,
): Promise<void> {
  await bot.api.sendMessage(chatId, formatSinglePreview(item), {
    reply_markup: reviewKeyboard(item),
    link_preview_options: { is_disabled: true },
  });
  await markSent(chatId, item.type, item.id, key);
}

async function sendMorningSummary(
  subscriber: TgSubscriber,
  items: TgDueItem[],
  now: Date,
): Promise<void> {
  const key = windowKey(now, MORNING_WINDOW);
  const summaryId = now.toISOString().slice(0, 10);
  const alreadySent = await wasSent(
    subscriber.chatId,
    "summary",
    summaryId,
    key,
  );
  if (alreadySent) return;

  await bot.api.sendMessage(subscriber.chatId, formatMorningSummary(items, now), {
    reply_markup: reviewKeyboard(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/review`),
    link_preview_options: { is_disabled: true },
  });
  await markSent(subscriber.chatId, "summary", summaryId, key);
}

async function sendPreviewWindow(
  subscriber: TgSubscriber,
  items: TgDueItem[],
  now: Date,
  hhmm: string,
): Promise<void> {
  const key = windowKey(now, hhmm);
  const unsent = await filterUnsentItems(subscriber.chatId, items, key);
  for (const item of unsent.slice(0, MAX_PREVIEWS_PER_WINDOW)) {
    await sendPreview(subscriber.chatId, item, key);
  }
}

async function runScheduledWindow(hhmm: string, now = new Date()) {
  const subscribers = await listActiveSubscribers();
  if (subscribers.length === 0) return;

  const dueItems = await getDueItems(now);
  if (dueItems.length === 0) return;

  for (const subscriber of subscribers) {
    if (hhmm === MORNING_WINDOW) {
      await sendMorningSummary(subscriber, dueItems, now);
    } else {
      await sendPreviewWindow(subscriber, dueItems, now, hhmm);
    }
  }
}

bot.command("start", async (ctx) => {
  const chat = ctx.chat;
  const from = ctx.from;
  await upsertSubscriber({
    chatId: chat.id,
    username: from?.username,
    firstName: from?.first_name,
    lastName: from?.last_name,
  });
  await ctx.reply(
    [
      "Hey Yi! Endlich bin ich da.",
      "",
      "Ich erinnere dich jetzt an fällige Deutsch-Wiederholungen:",
      "08:00 Zusammenfassung",
      "12:00 / 18:00 / 21:00 Karten-Vorschau",
      "",
      "Mit /due kannst du jederzeit sehen, was gerade fällig ist.",
    ].join("\n"),
  );
});

bot.command("due", async (ctx) => {
  const chat = ctx.chat;
  const from = ctx.from;
  await upsertSubscriber({
    chatId: chat.id,
    username: from?.username,
    firstName: from?.first_name,
    lastName: from?.last_name,
  });

  const dueItems = await getDueItems();
  if (dueItems.length === 0) {
    await ctx.reply("Heute ist gerade nichts fällig. Gut gemacht.");
    return;
  }

  await ctx.reply(formatDueCount(dueItems), {
    reply_markup: reviewKeyboard(
      `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/review`,
    ),
    link_preview_options: { is_disabled: true },
  });

  for (const item of dueItems.slice(0, MAX_PREVIEWS_PER_WINDOW)) {
    await ctx.reply(formatSinglePreview(item), {
      reply_markup: reviewKeyboard(item),
      link_preview_options: { is_disabled: true },
    });
  }
});

bot.catch((err) => {
  console.error("Telegram bot error:", err);
});

async function main() {
  await bot.api.setMyCommands([
    { command: "start", description: "Bot starten" },
    { command: "due", description: "Fällige Karten anzeigen" },
  ]);

  await bot.start({
    onStart: (info) => {
      console.log(`Telegram bot @${info.username} is running.`);
      console.log(`Scheduled windows: ${ALL_WINDOWS.join(", ")} local time.`);
    },
  });
}

let lastWindowRun = "";
setInterval(() => {
  const now = new Date();
  const hhmm = currentHHMM(now);
  if (!ALL_WINDOWS.includes(hhmm as (typeof ALL_WINDOWS)[number])) return;
  const key = windowKey(now, hhmm);
  if (lastWindowRun === key) return;
  lastWindowRun = key;
  runScheduledWindow(hhmm, now).catch((err) => {
    console.error(`Scheduled window ${hhmm} failed:`, err);
  });
}, 30_000);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
