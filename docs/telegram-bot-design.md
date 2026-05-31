# German Coach — Telegram Bot 设计文档

> 版本：v1.0 · 2026-05-31
> 状态：MVP 实现中（先本地跑，稳定后上 Railway）

---

## 0. MVP 决定（2026-05-31 晚）

先做 **B+C 混合提醒**，不做 Telegram 内直接答题：

- **08:00**：摘要消息（C）。列出今日 due 总数、单词数、句子数、前几个词/句。
- **12:00 / 18:00 / 21:00**：单卡预览（B）。每次最多 3 张，显示词/句内容 + `Zur Wiederholung` 按钮跳回 App。
- **每天推送**：包括周末。
- **Bot 单独新建**：不用别的项目的 Telegram bot，避免人设/命令/上下文污染。
- **SDK**：用 `grammy`（TypeScript-native），不是旧设计里的 `node-telegram-bot-api`。
- **部署**：先本地 `npm run tg:bot` 跑 1-2 天验证体验；稳定后上 Railway，这样电脑关机也能推。
- **防重复**：`notifications_log` 用 `(chat_id, item_type, item_id, window_key)` 去重。
- **订阅方式**：用户给 bot 发 `/start`，自动把 `chat_id` 写入 `tg_subscribers`。

当前 MVP 不做：
- Telegram 内直接评分（以后可做 callback button + SM-2 写回）。
- DeepSeek 双向聊天。
- 主动教学。

---

## 1. 概述

在 Telegram 上有一个专属的 German Coach Bot，功能：
- ✅ 定时推送复习提醒（从 Supabase SRS 读到期卡片）
- ✅ 双向对话——你主动问，它用德语回复 + 纠错
- ✅ 主动教学——bot 觉得你该学什么，直接发给你
- ✅ 完全本地运行，不依赖 Docker / Vercel

## 2. 人设 Prompt

```markdown
你是我（Yi Wang）最好的朋友。你也在苏黎世——
你在苏黎世找到了 AI 相关工作，知道这有多不容易。
而我在 UZH 快毕业了，投了很多简历但还没上岸。

你的德语很好（母语者），你真心想帮我也留下来。
所以你要把我的德语练到能在瑞士工作生活的水平。

## 关于德语
我现在学的是 Standarddeutsch（Hochdeutsch）。
以后可能学瑞士德语（Schwiizerdütsch），
但第一步是 Standarddeutsch 必须过关。
你不要跟我讲瑞士德语，帮我练好 Hochdeutsch。

## 为什么你对我严格
因为你是我朋友，你为我好。
你不想看我在瑞士待了几年还张不开嘴。
所以你会毫不客气地纠正我——不是老师教学生，
而是因为你在乎，你知道我能做得更好。

## 你怎么跟我交流
- 只说德语。偶尔用英语解释复杂语法，但优先德语。
- 主动教我：你觉得"这个用法他该学"→ 直接扔过来。
- 举一反三：我学了一个词，你马上给几个日常句子让我仿写。
- 给我发消息不犹豫——该学的东西，你会直接砸过来。
```

## 3. 技术架构

```
german-coach/
├── telegram-bot/              ← 新增文件夹
│   ├── bot.js                 ← 主入口（启动 bot）
│   ├── persona.js             ← 人设 prompt（上面的内容）
│   ├── scheduler.js           ← 定时推送逻辑
│   ├── handlers/
│   │   ├── chat.js            ← 双向对话处理
│   │   └── review.js          ← 复习卡片推送
│   └── package.json           ← 只需要 `node-telegram-bot-api`
├── lib/                       ← 复用现有
│   ├── llm.ts
│   ├── srs.ts
│   └── db/
├── ...
```

### 依赖
- `node-telegram-bot-api` — Telegram Bot SDK（唯一额外依赖）
- Supabase JS client（复用现有 `lib/db/`）
- DeepSeek API（复用现有模式）

### 启动方式
```bash
node telegram-bot/bot.js
```
- 黑窗挂在后台，Ctrl+C 或关窗停止
- 试用期：桌面快捷方式双击启动
- 转长期：Windows 任务计划程序开机自启（代码不修改）

## 4. 消息类型

### 类型 A：早安推送 🌅（8:00，纯模板，零 DeepSeek）

```
Guten Morgen! ☀️

Heute hast du {dueCount} Karten zu wiederholen.
↳ {word1} | {word2} | {word3} ...

Versuch mal: "{exampleSentence}"
↳ [Antworten]
```

### 类型 B：复习推送 📝（不定时，纯模板，零 DeepSeek）

```
Hey, {dueCount} Karten sind fällig!

1/{dueCount}: {germanWord}
→ {contextHint}
↳ [Antworten]
```

你回复后 → 调 DeepSeek 判断你的回答。如果答对 → 鼓励 + 举一反三。如果答错 → 纠正 + 再问一次。

### 类型 C：你主动问 💬（随时，调 DeepSeek）

你发任何消息 → Bot 用人设 prompt 回复 + 纠错 + 举一反三。

### 类型 D：主动教学 💡（每天最多 5 次，调 DeepSeek）

```
Hey, ich hab heute ein Thema für dich:
{wichtig_phrase}

Nutzung:
{usage_1}: "{example_1}"
{usage_2}: "{example_2}"
{usage_3}: "{example_3}"

Deine Aufgabe: Schreib mir einen Satz damit!
↳ [Antworten]
```

## 5. 数据流

```
你的 Telegram ←→ bot.js ←→ Supabase DB
                     ↕
                DeepSeek API
```

- 复习推送：从 Supabase `words` 表读 due cards → 模板填充 → 发送
- 对话处理：收到消息 → 调 DeepSeek（人设 prompt + 最近 10 条历史）→ 发回复
- 主动教学：bot 从 `words` 表选近期学的词 → DeepSeek 生成教学内容 → 发送

## 6. 启动流程（用户视角）

```
步骤 1：我用 @BotFather 创建 bot → 拿到 Token
步骤 2：把 Token 放进 german-coach/.env
步骤 3：双击桌面 "🤖 German Coach Bot.bat"
步骤 4：Telegram 里发 /start
步骤 5：Bot 回复 "Hey Yi! Endlich bin ich da..."
→ 完成 ✅
```

## 7. 转自动启动

试用一周后，改成 Windows 任务计划程序：
- 开机自动运行，无窗口
- bot.js 代码不变
- 想停 → 任务管理器结束进程

## 8. 费用预估

| 项目 | 每日 | 每月 |
|------|------|------|
| DeepSeek 对话调用 | ~20,000 tokens | ~600,000 tokens |
| 模板推送（零 LLM） | 免费 | 免费 |
| **预估费用** | **~¥0.02** | **~¥0.6** |

## 9. 实现顺序

| 步骤 | 内容 | 说明 |
|------|------|------|
| 1 | 创建 Telegram Bot + 获取 Token | @BotFather，5 分钟 |
| 2 | `telegram-bot/bot.js` + `persona.js` | 基础框架 + 回复能力 |
| 3 | `handlers/chat.js` | DeepSeek 双向对话 |
| 4 | `handlers/review.js` | SRS 复习推送 |
| 5 | `scheduler.js` | 定时推送逻辑 |
| 6 | 桌面快捷方式 | 双击启动 |
| 7 | 试用一周 | 确认体验 |
| 8 | 如需 → 转开机自启 | 任务计划程序 |
