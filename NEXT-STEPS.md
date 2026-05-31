# German Coach — Next Steps

> 版本：v0.3（27 篇 B1 精听已入库） · 技术栈：Next.js 16 + Supabase + DeepSeek + shadcn + Tailwind 4
> ⚠️ **模型限制：** 当前 Cursor 模型不够聪明。指令必须精确到文件路径、组件结构、数据流。不要自作主张，严格按指令做。

---

## 🆕 2026-05-31 夜：产品定位重置 + 三个 P0

### 产品定位变化（基于 Sesame.com 调研）

- **不做**：实时对话语音 / 口语练习 / 聊天语音输入（Sesame 已经做到顶级，不重复造轮子）
- **不做（短期）**：CSM 声音克隆 / paste-to-learn 流程 / chat tutor prompt 重写
- **聚焦**：把已有 27 篇 B1 精听做到"很好"、加上单词 SRS、加上 Telegram 主动提醒，让用户每天打开 App / Telegram 就有"该学什么"的明确路径

### P0-a — 精听 UX 升级（27 篇 B1）

**入口改造（`/listen` 列表 → "文库"）**
- 文章卡片网格，每张显示：
  - 进度环（已掌握句数 / 总句数）
  - 上次学习时间
  - 当前章节 / 文章 level
  - "下一句 due"的小角标
- 顶部 tab：`全部 / 进行中 / 待复习 / 已掌握`
- 卡片角落"快速复习"直接跳到该篇 due 的第一句

**文章学习页（`/listen?id=<docId>` 改造）**
- 当前句卡片显示 SRS 状态徽章（🌱 新 / 🔄 学习 / ✅ 掌握）
- **Shadow 模式**（新增）：原文默认隐藏 → 听 → 自动停顿 N 秒 → 显示原文 → 4 级评分
- 倍速记忆：`per-document` 持久化（localStorage 或 DB）
- 键盘快捷键扩展：`R` = 重听本句、`J / K` = 上 / 下句、`S` = 切 shadow、`1-4` = SRS 评分
- **句子级"加入复习"**（不止单词），下次复习推这一整句的真音 MP3
- 移动端：DictionaryPopover 用 `Portal` 提到 body，不再被 sticky 音频条遮挡

**数据层新增**
```sql
CREATE TABLE sentence_progress (
  sentence_id uuid REFERENCES sentences(id),
  user_id uuid,                         -- 单用户先填固定值
  repeat_count int default 0,
  ease real default 2.5,
  interval int default 0,
  repetitions int default 0,
  next_review timestamptz,
  last_review timestamptz,
  status text default 'new'             -- 'new' | 'learning' | 'mastered'
);
```
单词 SRS 和句子 SRS **共用同一个 SM-2 引擎**（`lib/srs.ts`），Telegram 推送统一覆盖。

文件改动估计：
- `app/listen/page.tsx`（文库网格）+ `app/listen/library-grid.tsx` 新建
- `app/listen/listen-client.tsx` 增加 shadow 模式 + 快捷键扩展
- `lib/db/listen-progress.ts` 新建
- `supabase/migrations/0002_sentence_progress.sql` 新建
- 设计稿：`docs/library-progress-design.md`（已存在）

---

### P0-b — 词表 SRS（Goethe B1 + B2 + Edge Neural TTS）

**1. 解析 Wortliste PDF（B1 + B2 都做）**

B1 PDF（`scripts/Goethe-Zertifikat_B1_Wortliste.pdf`，475 KB）：
- 文字层完整，104 页，~30 万字符
- 第 16 页起 `2 Alphabetischer Wortschatz`，**左列词条 + 右列例句**两列布局
- `scripts/wl-scout.ts` 已 confirm 数据可抽取
- 写 `scripts/wl-parse-goethe.ts`：用 `pdfjs-dist` 拿每个 text item 的 `(x, y)` 坐标，按 x 切左右列、按 y 在列内聚合成块、两列按 y 对齐配对
- 输出 `scripts/transcriptions/_wortliste-b1.json`：
  ```json
  [{"headword": "abbiegen", "pos": "verb", "inflection": "biegt ab, bog ab, ist abgebogen", "examples": ["An der nächsten Kreuzung müssen Sie links abbiegen."], "topic": "Verkehr"}]
  ```
- ~2400 条

B2 PDF（`scripts/Goethe-Zertifikat_B2_Wortliste.pdf`，6.6 MB）：
- 可能是扫描，用现成的 OCR 兜底链（`tesseract.js` 已装）走一遍
- 解析逻辑复用同一个 column-aware parser
- 输出 `_wortliste-b2.json`

**2. Edge Neural TTS 批量生成 MP3（决定使用）**

- `npm i msedge-tts`（Node 端非官方但稳定的 Edge TTS client；输出 MP3）
- 写 `scripts/wl-tts-edge.ts`：对每个 `{headword, firstExample}` 调两次（词形 1 个 MP3、例句 1 个 MP3）
- 声音：默认 `de-DE-KatjaNeural`（女声），可选 `de-DE-ConradNeural`（男声）
- 输出：`public/audio/words/<sha1>.mp3`（避免空格 / 变音字符的文件名问题）
- 2400（B1）+ ~3000（B2 估）× 2 文件 ≈ 1 万 MP3、本地一次性 batch 30-60 分钟、**0 元成本**
- 如果文件量太大需要走 Supabase Storage，再加一步上传

**3. 接入 SRS（`/review` 卡片流改造）**

DB 新增字段（增量迁移）：
```sql
ALTER TABLE words
  ADD COLUMN audio_word_url     text,
  ADD COLUMN audio_example_url  text,
  ADD COLUMN pos                text,
  ADD COLUMN inflection         text;
```

写 `scripts/seed-wortliste.ts`：把 `_wortliste-b1.json` / `_wortliste-b2.json` 批量导入 `words` 表（`source: "wortliste-b1"` / `source: "wortliste-b2"`、`sourceRef: <topic>`、`exampleSentence: examples[0]`）。

`/review` 新卡片流：
```
[1] 自动播放 headword.mp3
[2] 用户脑里复述例句 / 联想词义
[3] 按【▶ 听例句】+【👁 显示原文】
[4] 4 级评分（再来 / 困难 / 良好 / 容易）→ SM-2 算下次时间
```

文件改动估计：
- `scripts/wl-parse-goethe.ts` 新建（~150 LOC，column-aware）
- `scripts/wl-tts-edge.ts` 新建（~80 LOC）
- `scripts/seed-wortliste.ts` 新建（~60 LOC）
- `supabase/migrations/0003_words_audio_pos.sql` 新建
- `app/review/page.tsx`（或抽 `review-client.tsx`）：卡片流改造
- `lib/db/words.ts`：`recordReview` 接受新字段

---

### P0-c — Telegram 复习提醒 bot

**设计稿**：`docs/telegram-bot-design.md`（已存在）

**MVP 切片**（先做单向推送，~2 小时）：
- `scripts/tg-bot.ts`：每天 4 个固定时间点（08:00 / 12:00 / 18:00 / 21:00）
- 查 `words` 表 + 未来的 `sentence_progress` 表里 `next_review <= now()` 的项
- 推送格式：
  ```
  📚 复习时间｜abbiegen → 转弯
  ▶️ An der nächsten Kreuzung müssen Sie links abbiegen.
  [🎧 听音] [📖 复习]
  ```
- 按钮链接 `https://<your-site>/review?card=<id>`（deeplink 到该卡片）
- `notifications_log` 表记 `(card_id, scheduled_at, sent_at)`，防重复
- 本地用 `node-telegram-bot-api` 或 `grammy`，等流程稳定后再考虑 Vercel cron / Railway 部署

**两个延后项**（P1）：
- 双向 chat（用户回复 bot → DeepSeek 评分）
- 主动推送：连续 7 天没打开复习 → 推送鼓励
- 推送时机优化：根据用户「真正打开 app 的时间」自适应

---

### 优先级建议

按 ROI：**P0-a 优先**（用户每天会用、体验提升立刻感知到），然后 P0-b（背单词闭环、可以接住 anki 用户），最后 P0-c（提醒系统在前两者数据成熟后价值最大）。

但 P0-c 实际可以在 P0-a / P0-b 任何一个做完后立刻上线（~2 小时即可推送当前 4 个 demo words），所以也可以做成 P0-a 收尾后的 quick win。

### 关键技术决定

| 决定 | 理由 |
|------|------|
| TTS 用 **Microsoft Edge Neural** | 免费 + Katja/Conrad 神经语音质量很好 + Node 一行调用 + 一次性 batch 生成 MP3 + 零运行成本 |
| Wortliste 范围：**B1 + B2 一次性做完** | 用户已在 Anki 持续背 B1，B2 早晚要做，统一 parser 一鼓作气；B2 多一天 OCR 工作量但避免分两次重写 |
| 单词 + 句子 **共用同一个 SM-2 引擎** | `lib/srs.ts` 是唯一 SM-2 实现，不要复制；只是 `next_review` 字段从 `words` 扩到 `sentence_progress` |
| Telegram 先做 **单向推送 MVP** | 双向 chat 是 P1；先用 2 小时换到「每天打开 Telegram 就知道该复习什么」的核心价值 |

### 不做（明确放弃）

- ❌ Chat 语音输入 — Sesame 已做到顶级
- ❌ CSM 声音克隆 — 神奇但 P2 至少
- ⏸️ Paste-to-learn — 延后，不是完全不做
- ❌ Chat tutor prompt 重写 — 同上

---

## 当前项目结构

```
german-coach/
├── app/
│   ├── page.tsx                    # 首页（Server Component）
│   ├── layout.tsx                  # 根布局
│   ├── learn/
│   │   └── page.tsx                # 精读页面（~470行，待拆分）
│   ├── listen/                     # ← 【新】精听跟读模式
│   │   └── page.tsx
│   ├── chat/
│   │   └── page.tsx                # 对话页面（待加语音输入）
│   ├── review/
│   │   └── page.tsx                # SRS 复习
│   └── api/
│       ├── analyze/route.ts        # DeepSeek 句子解析
│       ├── practice/route.ts       # DeepSeek 练习批改
│       ├── lookup/route.ts         # DeepSeek 查词
│       ├── chat/route.ts           # DeepSeek 流式对话
│       ├── words/
│       │   ├── due/route.ts
│       │   ├── due-count/route.ts
│       │   ├── review/route.ts
│       │   └── add/route.ts
│       └── documents/              # 已写好
│           ├── create/route.ts
│           ├── [id]/route.ts
│           └── route.ts
├── lib/
│   ├── llm.ts                      # DeepSeek 客户端 + prompt 模板
│   ├── srs.ts                      # SM-2 纯函数
│   ├── sample-article.ts           # 硬编码文章（v0.3 后可删）
│   ├── supabase/server.ts          # service_role 客户端
│   └── db/
│       ├── words.ts
│       └── documents.ts
├── components/
│   └── ui/                         # shadcn 组件
└── supabase/migrations/
    └── 0001_init.sql
```

---

## 🗂️ 执行计划（Cursor 按顺序执行，每个 Step 做完再下一个）

---

### Step 1：句子评级 + SM-2 连通

**Goal：** 精听页面每句结束后，用户点评级按钮 → 写入 sentence_progress → 自动进 SRS 复习队列。

**文件清单：**
- `supabase/migrations/0002_sentence_progress.sql` **新建**
- `lib/db/listen-progress.ts` **新建**
- `app/listen/listen-client.tsx` **修改**（增加评级 UI）

**DB 迁移：**
```sql
CREATE TABLE sentence_progress (
  sentence_id uuid REFERENCES sentences(id),
  user_id uuid DEFAULT '00000000-0000-0000-0000-000000000001',
  repeat_count int default 0,
  ease real default 2.5,
  interval int default 0,
  repetitions int default 0,
  next_review timestamptz,
  last_review timestamptz,
  status text default 'new'
);
```

**评级按钮（UI）：**
```
句子播放完毕 → 显示原文后 → 出现：
  ┌────────┐  ┌────────┐  ┌────────┐
  │ 🔄 再来│  │ 😓 困难│  │ ✅ 良好│
  └────────┘  └────────┘  └────────┘
```

**SM-2 映射（复用 lib/srs.ts 的 calculateReview）：**

| 按钮 | SM-2 grade | ease 调整 | interval 初始 | status |
|------|-----------|-----------|--------------|--------|
| 🔄 再来 | 1 | ease × 1.5（下降）| 0（今天晚点） | 'learning' |
| 😓 困难 | 2 | ease 不变 | 1 天 | 'learning' |
| ✅ 良好 | 4 | ease 不变 | 3 天 | 'mastered' |

**Milestone ✅：**
- [ ] DB migration 可运行
- [ ] 精听页面每句结束后显示三个评级按钮
- [ ] 点击任意按钮 → 写入 sentence_progress 表
- [ ] 写入后按钮变灰 + sonner toast "已记录"
- [ ] lib/srs.ts 未被修改

### 数据流（已有精听模式保持不变）

```
1. page.tsx: 从 Supabase 读取文章列表（SELECT * FROM documents）
   → 显示文章列表让用户选择

2. 用户选一篇文章 → listen-client.tsx 拿到这篇文章的所有句子
   → 从 seed 数据或 documents/[id] API 获取

3. 用户进入逐句精听模式：
   句子索引 0 → 显示 🔊播放按钮
   → 用户点击 → SpeechSynthesisUtterance(lang="de-DE") 播放
   → 原文隐藏（显示 "👂 听录音，尝试复述"）
   → 用户可反复点击重播
   → 用户点击 "👁️ 显示原文" → 文字出现
   → 用户点击 "🔍 DeepSeek 分析" → 调 /api/analyze 解析
   → 用户双击选中词 → 弹出 DictionaryPopover（复用现有组件）
   → 用户点击 "➕ 加入复习" → 调 /api/words/add
   → 用户点击 "下一句" → 索引 +1
```

### 关键实现细节

#### `app/listen/page.tsx` (Server Component)

```tsx
// 从 URL params 读取文档 ID
// 有 ID → 从 Supabase 查文档
// 无 ID → 从 lib/sample-article.ts 读默认文章
// 把句子列表作为 props 传给 listen-client.tsx
```

#### `app/listen/listen-client.tsx`

必须包含以下 state：
```tsx
const [sentences, setSentences] = useState<SampleSentence[]>([])
const [currentIndex, setCurrentIndex] = useState(0)
const [showText, setShowText] = useState(false)
const [isPlaying, setIsPlaying] = useState(false)
const [analysis, setAnalysis] = useState<string | null>(null)
const [isAnalyzing, setIsAnalyzing] = useState(false)
const [addedWords, setAddedWords] = useState<Set<string>>(new Set())
```

UI 布局（精确描述）：

```
┌──────────────────────────────────────────────┐
│  ← 返回文章列表                               │
│                                              │
│  第 3/9 句                                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│                                              │
│  ┌──────────────────────────────────────┐     │
│  │                                      │     │
│  │        🔊 [播放]  🔄 [重播]          │     │
│  │                                      │     │
│  │  ┌────────────────────────────┐       │     │
│  │  │                            │       │     │
│  │  │   👂 尝试复述这句话         │       │     │
│  │  │                            │       │     │
│  │  │   [👁️ 显示原文]            │       │     │
│  │  │                            │       │     │
│  │  └────────────────────────────┘       │     │
│  │                                      │     │
│  │  [🔍 DeepSeek 分析这句話]            │     │
│  │  [➕ 加入复习队列]                    │     │
│  │                                      │     │
│  └──────────────────────────────────────┘     │
│                                              │
│  ← 上一句                        下一句 →     │
│                                              │
│  ┌─ 分析结果 ───────────────────────────────┐ │
│  │  语法：...                               │ │
│  │  词汇：...                               │ │
│  │  例句：...                               │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

#### 关键逻辑

1. **TTS 播放：** 使用 Web Speech API
```tsx
const speak = (text: string) => {
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = "de-DE"
  utterance.rate = 0.8  // 稍慢，适合学习
  speechSynthesis.speak(utterance)
}
```

2. **显示/隐藏原文：** `showText` state 控制。初始 false，点击按钮变 true。

3. **DeepSeek 分析：** 复用已有的 `POST /api/analyze` 路由（`lib/llm.ts` 中的 `analyzeSentence`）。
```
调用方式：fetch("/api/analyze", { method: "POST", body: JSON.stringify({ sentence: currentSentence.german }) })
```

4. **加入复习队列：** 复用已有的 `POST /api/words/add` 路由。

5. **双击查词：** 复用已有的 DictionaryPopover 组件。从 learn/page.tsx 中提取 DictionaryPopover 到独立组件文件 `components/dictionary-popover.tsx`。

### 成功标准

- [ ] /listen 页面打开显示文章列表
- [ ] 点击文章进入逐句精听模式
- [ ] TTS 播放德语，原文隐藏
- [ ] 点击显示原文能看到文字
- [ ] DeepSeek 分析正常返回
- [ ] 加入复习队列成功（sonner toast 提示）
- [ ] 双击查词弹窗可用
- [ ] 上一句/下一句切换正常
- [ ] 移动端 480px 断点正常工作

### ⚠️ 不要做的事

- ❌ 不要改动 `lib/llm.ts`（prompt 模板不动）
- ❌ 不要改动 `lib/srs.ts`（SM-2 算法不动）
- ❌ 不要改动 `lib/db/*` 的查询逻辑
- ❌ 不要改动现有页面的功能
- ❌ 不要添加新数据库表（复用现有的 sentences, words 表）

---

### Step 2：文库网格

**Goal：** 27 篇文章以卡片网格展示，每张显示进度环、上次学习时间、状态标签。

**文件清单：**
- `app/listen/page.tsx` **重写**
- `app/listen/library-grid.tsx` **新建**
- 复用 `GET /api/documents` 拿文章列表
- 从 `sentence_progress` 按 document_id 聚合统计进度

**卡片设计：**
```
┌──────────────────────┐
│  📘 Lektion 3        │
│  "Im Restaurant"     │
│                      │
│      ╭─────╮         │
│      │ 8/20│  ← 进度环│
│      ╰─────╯         │
│  🕐 上次: 昨天       │
│  🔵 进行中            │
└──────────────────────┘
```

**顶部 tab 筛选：** 全部 / 进行中 / 待复习 / 已掌握

**点击文章 →** `/listen?id=xxx`（进入精听）

**Milestone ✅：**
- [ ] 打开 /listen 显示 27 张文章卡片
- [ ] 每张卡片显示正确的进度环（来自 sentence_progress）
- [ ] 顶部 tab 筛选正常工作
- [ ] 点击卡片进入精听模式
- [ ] 移动端 480px 断点正常

---

### Step 3：Shadow 模式 + 快捷键

**Goal：** 精听体验升级——原文默认隐藏 + 自动停顿 + 键盘快捷键。

**Shadow 模式流程：**
```
1. 进入句子 → 原文隐藏
2. 自动播放 TTS（rate=0.8）
3. 播放完后停顿 3 秒（让你默默复述）
4. 自动显示原文
5. 出现评级按钮
```

**快捷键：**

| 键 | 功能 |
|----|------|
| R | 重听本句 |
| J | 上一句 |
| K | 下一句 |
| S | 切换 Shadow 模式 on/off |
| 1 / 2 / 3 | 评级：再来 / 困难 / 良好 |

**Milestone ✅：**
- [ ] Shadow 模式 toggle 正常工作
- [ ] 自动停顿 3 秒后显示原文
- [ ] 5 个快捷键都可用
- [ ] 快捷键不与浏览器默认行为冲突

---

### Step 4：Goethe Wortliste 解析（P0-b）

**Goal：** 解析 Goethe B1/B2 官方词汇表 PDF，提取 ~5400 条词条 + 例句。

**文件清单：**
- `scripts/wl-parse-goethe.ts` **新建**
- `scripts/transcriptions/_wortliste-b1.json` **输出**
- `scripts/transcriptions/_wortliste-b2.json` **输出**
- B1 PDF 已放 `scripts/Goethe-Zertifikat_B1_Wortliste.pdf`
- B2 PDF 已放 `scripts/Goethe-Zertifikat_B2_Wortliste.pdf`

**方法：** `pdfjs-dist` 读坐标 → 按 x 切左右列 → 配对词条 + 例句

**输出格式：**
```json
{"headword": "abbiegen", "pos": "verb", "inflection": "biegt ab, bog ab, ist abgebogen", "examples": ["An der nächsten Kreuzung müssen Sie links abbiegen."], "topic": "Verkehr"}
```

**Milestone ✅：**
- [ ] B1 PDF 解析完成，输出 ~2400 条
- [ ] 每条有 headword + examples
- [ ] B2 PDF 解析完成（文字层有问题则用 tesseract.js OCR 兜底）
- [ ] JSON 格式正确，可直接导入

---

### Step 5：Edge TTS 批量生成 MP3

**Goal：** Microsoft Edge Neural TTS 免费生成词条 + 例句 MP3。

**文件清单：**
- `scripts/wl-tts-edge.ts` **新建**
- `scripts/seed-wortliste.ts` **新建**
- `supabase/migrations/0003_words_audio_pos.sql` **新建**

**DB 迁移：**
```sql
ALTER TABLE words
  ADD COLUMN audio_word_url     text,
  ADD COLUMN audio_example_url  text,
  ADD COLUMN pos                text,
  ADD COLUMN inflection         text;
```

**TTS：** `npm i msedge-tts` → `de-DE-KatjaNeural` 女声 → 每个 headword + 第一个 example 分别生成 MP3 → 存 `public/audio/words/<sha1>.mp3`

**/review 新卡片流：**
```
[1] 自动播放 headword.mp3
[2] 用户脑里复述例句 / 联想词义
[3] 按【▶ 听例句】+【👁 显示原文】
[4] 4 级评分（再来 / 困难 / 良好 / 容易）→ SM-2
```

**Milestone ✅：**
- [ ] B1 词条 MP3 全部生成完毕
- [ ] 导入 words 表（source='wortliste-b1'）
- [ ] /review 新卡片流：自动播放 → 听例句 → 4 级评分
- [ ] 音频播放无卡顿

---

### Step 6：Telegram 推送 MVP（P0-c）

**Goal：** 每天 08:00 / 12:00 / 18:00 / 21:00 推送到期卡片到 Telegram。

**文件清单：**
- `scripts/tg-bot.ts` **新建**
- `notifications_log` 表 **新建**
- 依赖：`npm i node-telegram-bot-api`

**推送格式：**
```
📚 复习时间｜abbiegen → 转弯
▶️ An der nächsten Kreuzung müssen Sie links abbiegen.
[🎧 听音] [📖 复习]
```
按钮 deeplink → `https://<your-site>/review?card=<id>`

**防重复：** `notifications_log` 表记录 `(card_id, scheduled_at, sent_at)`，同张卡片同轮不重复推。

**Milestone ✅：**
- [ ] 首次启动 /start 回复 "Hey Yi! Endlich bin ich da."
- [ ] 定时推送到期卡片（同时覆盖 sentence_progress 和 words）
- [ ] 卡片链接可点击跳转到 /review
- [ ] 不重复推送同一张卡片

---

## 执行顺序总表

| 顺序 | Step | 预估 | Cursor Session |
|------|------|------|----------------|
| 1️⃣ | 句子评级 + SM-2 连通 | 1-1.5h | 第 1 个 session |
| 2️⃣ | 文库网格 | 1h | 第 1 个 session（做完 Step 1 继续）|
| 3️⃣ | Shadow 模式 + 快捷键 | 1h | 第 2 个 session |
| 4️⃣ | Goethe Wortliste 解析 | 2-3h | 第 2-3 个 session |
| 5️⃣ | Edge TTS 批量 MP3 | 1h | 第 3 个 session |
| 6️⃣ | Telegram 推送 MVP | 2h | 第 4 个 session |

---

## 🎮 游戏化皮肤 · 库洛洛设计（2026-05-31 新增）

### 设计理念

**不做重游戏**（没有 XP 升级、没有天赋树、没有排行榜），只做 **视觉换皮 + 数据可视化**。让现有的 SRS 进度数据显示得更有趣。

```
三层结构：
╔════════════════════════════════════════╗
║  📊 首页 Dashboard                     ║
║     GitHub 热力图 · 里程碑 · 连击日历    ║
║     → "我的付出每一天都被看见了"         ║
╠════════════════════════════════════════╣
║  🏰 文库 = 世界地图                     ║
║     每篇文章 = 一个 BOSS 关卡            ║
║     BOSS 血条 = 进度条                  ║
║     BOSS 大招 = 你之前标记"困难"的句子    ║
╠════════════════════════════════════════╣
║  ⚔️ 精听 = BOSS 战                     ║
║     实时数据：HP 变动 · 破招计数         ║
║     结算页：战斗报告 + 徽章              ║
╚════════════════════════════════════════╝
```

### 1. 📊 首页：GitHub 热力图

在首页（`/` 或 `/dashboard`）新增一个贡献热力图：

```
📊 学习热力图 — 今天还没学？🔥

  3月        4月        5月
  ┌─────────────────────────────┐
  │  ⬜⬜🟩🟩🟩⬜⬜  │ 第 1 周
  │  🟩🟩🟩🟩⬜🟩🟩  │ 第 2 周
  │  🟩⬜🟩🟩🟩⬜🟩  │ 第 3 周
  │  🟩🟩🟩🟩🟩🟩⬜  │ 第 4 周 ← 昨天断了一天…
  │                     今天：🟩🟩⬜⬜⬜⬜⬜
  └─────────────────────────────┘

  最长连击：14 天（2026-05-18 ~ 2026-05-31）
  本月总句数：247 句
```

**颜色规则（effort 分值）：**

| 颜色 | 含义 | 当日得分 |
|------|------|---------|
| ⬜ 灰色 | 没学 | 0 |
| 🟩 浅绿 | 摸了一点 | 1-5 |
| 🟩 中绿 | 正常学习 | 6-15 |
| 🟩 深绿 | 用功了 | 16-25 |
| 🟩 最深 | 今天学炸了 | 25+ |

**effort 分值计算（复合分）：**

| 行为 | 分值 |
|------|------|
| 学了 1 句 | +1 |
| 首次打开 App | +2 |
| 复习了"困难"句子 | 每句 +2（比学新句更有价值） |
| 完成一整篇文章 | +5 |
| 标记"良好"的句子 | 每句 +1 |

**数据来源：** 需新增 `study_log` 表，每天一条：

```sql
CREATE TABLE study_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid DEFAULT '00000000-0000-0000-0000-000000000001',
  log_date date NOT NULL DEFAULT CURRENT_DATE,
  effort_score int NOT NULL DEFAULT 0,
  sentences_studied int NOT NULL DEFAULT 0,
  sentences_mastered int NOT NULL DEFAULT 0,
  articles_completed int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, log_date)
);
```

**提示：** 断了一天不要惩罚，只显示灰色。不是"断了就完了"，而是"断了也没事，明天补上"。

---

### 2. 🏰 文库 = BOSS 世界地图

文库页面（`/listen` 列表）改造为"关卡地图"风格：

```
📚 27 篇 B1 · 世界地图 🔥 7 天连击

  🎉 🏰 Lektion 1 "Hallo!"        ✅ 已征服
  🎉 🏰 Lektion 2 "Familie"       ✅ 已征服
  ⚔️ 🏰 Lektion 3 "Restaurant"    ◀ 战斗中
        ████████░░░░░░░░░░ 8/20 HP
        ⚡ BOSS 技能：「Die Tatsache, dass...」
  🏚️ 🏰 Lektion 4 "Einkaufen"    ❓ 未探索
  🏚️ 🏰 Lektion 5 "Wohnung"     ❓ 未探索
  ...
```

**状态映射：**

| 游戏状态 | 实际含义 | Emoji | 卡面色 |
|---------|---------|-------|--------|
| 🎉 已征服 | 文章所有句 status=mastered | 🎉 | 绿色 |
| ⚔️ 战斗中 | status=learning 的句子 | ⚔️ | 蓝色 |
| 🏚️ 未探索 | 还没打开过 | 🏚️ | 灰色 |
| 🔒 锁定 |（可选）完成上一篇才解锁 | 🔒 | 灰+锁 |

**BOSS 技能显示规则：** 从 `sentence_progress` 读该文章里 `play_count` 最高或标记 "learning" 次数最多的句子，显示一句作为"BOSS 的神技"。

---

### 3. ⚔️ 精听页面 = BOSS 战

进入文章就是进入 BOSS 战。**纯 CSS 换皮肤，不改功能逻辑：**

```
┌──────────────────────────────────┐
│ ⚔️ Lektion 3                     │
│ HP ████████░░░░░░ 8/20           │
│                        🔥 7 天连击 │
│                                  │
│ 第 9/20 句                       │
│ ┌───────────────────────────┐    │
│ │  🔊 [播放]  🔄 [重播]     │    │
│ │  [👁️ 显示原文]            │    │
│ │                            │    │
│ │  ⚔️ 本场战斗               │    │
│ │  已击败: 8 句              │    │
│ │  重听: 12 次               │    │
│ │  破解大招: 2 次 💥         │    │
│ └───────────────────────────┘    │
│                                  │
│  ── ⚡ BOSS 的特殊攻击 ───────── │
│  「Die Tatsache, dass...」       │
│  （你之前在这句花了 6 遍！）      │
│      这次能一次过吗？            │
│                                  │
│ [🔴 再来一次] [😓 困难] [✅ 良好] │
└──────────────────────────────────┘
```

**BOSS 特殊攻击：** 之前标记过"困难"或播放 6+ 次的句子 → 进入时这句底色闪一下红色，边框发光，文案显示 "⚡ BOSS 放大招了！"。你如果这次一次过了 → 特别爽，因为 "你破解了 BOSS 的招式"。

**实时战斗数据（右侧/下方）：**
- 已击败句数（就是 currentIndex）
- 重听次数（累加当前会话的播放次数）
- 破解大招次数（标记困难的句子一次过的次数）
- 当前连击（来自 study_log）

**不需要新数据表，数据来源：**
- HP = 当前句数 / 总句数
- BOSS 大招 = `sentence_progress.play_count` + `status`
- 重听次数 = 会话内累加（前端 state 就行）

---

### 4. 🎉 文章完成结算页

每篇文章所有句子过完后 → 弹出结算页：

```
🎉  Lektion 3 "Im Restaurant" besiegt!  🎉

╔══════════════════════════════════════╗
║  ⚔️ 战斗报告                         ║
║                                      ║
║  20 句全部通关 ✅                    ║
║  耗时：3 天（3 场战斗）              ║
║  总重听次数：47 次                    ║
║  破解 BOSS 大招：5 次 💥             ║
║                                      ║
║  🔥 最难句子 Top 3：                  ║
║    1. "Die Tatsache, dass..." 11 次  ║
║    2. "bestellen" 8 次               ║
║    3. "obwohl" 7 次                  ║
║                                      ║
║  对比第一轮：你的重听次数            ║
║  从平均每句 4.2 次 → 2.1 次 📉        ║
║                                      ║
║  🏆 解锁徽章：「Im Restaurant 征服者」 ║
║  📊 总体进度：3/27 篇 · 11%          ║
║                                      ║
║       [⏩ 下一篇：Lektion 4]          ║
╚══════════════════════════════════════╝
```

**徽章列表（硬编码，每篇独立）：**

| 徽章 | 条件 |
|------|------|
| 🏆 Lektion N 征服者 | 该文章所有句子 mastered |
| 💥 破招达人 | 一篇文章里 5+ 次"特殊攻击"一次过 |
| 🔥 连击王 | 连击 7 天 |
| 🐢 但行好事 | 标记"再来一次"后 24h 内复习了 |
| 🏆 27 篇全通 | 所有文章 mastered（终极大奖） |

**徽章存在哪里：** 新增 `badges` 表或直接存在 `study_log` / 用户元数据里，不做复杂成就系统。

```sql
CREATE TABLE user_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid DEFAULT '00000000-0000-0000-0000-000000000001',
  badge_key text NOT NULL,         -- 'conqueror_3', 'combo_7', 'all_27'
  unlocked_at timestamptz DEFAULT now(),
  UNIQUE(user_id, badge_key)
);
```

---

### 5. 📈 独立统计页面

导航新增入口 "📊 统计"，打开后展示全局数据：

```
📊 德语学习统计

🔥 连击
   ┌─────────────────────────────┐
   │ 一 二 三 四 五 六 日         │
   │ 8  12 5  0  15 10 7   ← 句数 │
   │ ✅ ✅ ✅ ❌ ✅ ✅ ✅  ← 当天  │
   │         ↑ 昨天断了 😢       │
   └─────────────────────────────┘
   最长连击：14 天（2026-05-18 ~ 2026-05-31）

📚 文库总览
   27 篇中：3 篇 ✅ · 1 篇 ⚔️ · 23 篇 🏚️
   总句数：120/540 句（22%）

📈 本周趋势（折线图或柱状简图）
   周一  周二  周三  周四  周五  周六  周日
   12句   8句   15句   —    5句    10句   7句
                         ↑ 休息日          ↑ 今天

🎨 热力图（同上第 1 节）

🏅 徽章墙
   🏆 征服者 · Lektion 1  ✅
   🏆 征服者 · Lektion 2  ✅
   🏆 征服者 · Lektion 3  ✅  2026-05-31
   💥 破招达人                 🔒 再 2 篇
   🔥 连击王                   🔒 再 7 天
   🏆 27 篇全通               🔒 再 24 篇

🎯 下一步里程碑
   □ 第 1 篇文章完成  → ✅ 2026-05-29
   □ 第 5 篇文章完成  → 🔒 再 2 篇
   □ 连击 30 天       → 🔒 再 23 天
   □ 全部 27 篇完成   → 🔒 再 24 篇
```

---

### 6. 实现建议

**最小可行（跟 Step 1-3 一起做）：**

| 优先级 | 功能 | 工作量 | 建议在 Step |
|--------|------|--------|------------|
| 🔴 P0 | 热力图 + `study_log` 表 | ~2h | **Step 1 之后单独做，或 Step 2 顺便** |
| 🔴 P0 | 文库 BOSS 皮肤（血条 + emoji 状态）| ~1h | **Step 2 文库网格时一起做** |
| 🔴 P0 | 战斗实时数据（已击败/重听/破招）| ~0.5h | **Step 1 句子评级做完后** |
| 🟡 P1 | 结算页（战斗报告 + 对比）| ~2h | Step 3 之后 |
| 🟡 P1 | BOSS 特殊攻击特效 | ~1h | Step 3 之后 |
| 🟢 P2 | 徽章系统 + `user_badges` 表 | ~1.5h | 所有 Step 完成后 | 
| 🟢 P2 | 独立统计页面 | ~2h | 所有 Step 完成后 |

**核心原则：** 不修改 SRS 算法、不新增 API 路由、纯前端 + 一张 `study_log` 表 + 一张 `user_badges` 表。游戏化 = 皮肤，不是功能。

---

### 7. 数据流

```
句子评级（Step 1） → sentence_progress 表更新
                        ↓
                    study_log 表 → 每天汇总结 effort_score
                        ↓
                    文库 BOSS 血条 ← 读 sentence_progress 按 document_id 聚合
                    精听战斗数据  ← 前端 state 实时累加
                    结算页        ← 读 sentence_progress 全量统计
                    热力图        ← 读 study_log 里近 365 天
                    徽章系统      ← 读 user_badges + sentence_progress 条件检查
```

**唯一新增的表：** `study_log`（热力图 + 连击）+ `user_badges`（徽章）

---

## 架构约定（Cursor 必须遵守）

| 约定 | 说明 |
|------|------|
| **`lib/srs.ts` 是唯一 SM-2 实现** | 其他地方不要直接算间隔 |
| **所有 DeepSeek 调用走 `lib/llm.ts`** | 不要 inline fetch |
| **所有 Supabase 访问走 `lib/db/*`** | 组件里不要直接 `createClient()` |
| **`service_role` 只在 `lib/supabase/server.ts`** | `import "server-only"` 保护 |
| **时间格式** | DB: `timestamptz`，JS: `millis`，在 `lib/db/*` 边界转换 |
