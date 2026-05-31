# German Coach — Next Steps

> 版本：v0.2.5 · 技术栈：Next.js 16 + Supabase + DeepSeek + shadcn + Tailwind 4
> ⚠️ **模型限制：** 当前 Cursor 模型不够聪明。指令必须精确到文件路径、组件结构、数据流。不要自作主张，严格按指令做。

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

## 任务 1：🔴 P0 精听跟读模式（Intensive Listening）

### 用户故事

用户打开 /listen → 看到一篇文章的句子列表 → 点一个句子 → TTS 播放德语 → 原文隐藏 → 用户尝试复述/跟读 → 实在听不出来可以显示原文 → 点击 DeepSeek 分析 → 点击加入复习队列。

### 文件清单

**新建：**
1. `app/listen/page.tsx` — 主页面（Server Component 外壳）
2. `app/listen/listen-client.tsx` — 交互组件（useState + 所有逻辑）
3. `app/api/listen/analyze/route.ts` — DeepSeek 分析单句（可选，复用 /api/analyze 也行）

### 数据流

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

## 任务 2：🔴 P0 v0.3 paste-to-learn 收尾

### 现状

3 个 API 路由已写好：`POST /api/documents/create`、`GET /api/documents`、`GET /api/documents/[id]`。
`app/learn/page.tsx` 之前拆分到一半被中断，`git checkout HEAD` 恢复到了可工作状态。

### 需要做的事

#### (a) 拆分 app/learn/page.tsx

**app/learn/page.tsx** → 变成 Server Component：

```tsx
// 读取 searchParams.id
// 有 id → fetch(`/api/documents/${id}`) 拿文档数据
// 无 id → import { sampleArticle } from "@/lib/sample-article"
// 把句子列表传给 LearnClient
```

**app/learn/learn-client.tsx** → 新建，从原 page.tsx 搬过来：

搬以下内容：
- 所有 `useState` / `useEffect` 调用
- 所有事件处理函数（onAnalyze, onPractice, onLookup 等）
- DictionaryPopover 的内联实现
- sonner toast 调用
- session-level dedup set

不要搬：
- 直接读取 DB 的逻辑（留在 server component）
- `force-dynamic` 导出

#### (b) 添加「+ 粘贴新文本」按钮

- 在 learn page 的 header 区域添加一个按钮
- 点击弹出 Dialog（shadcn Dialog 组件）
- Dialog 内容：标题输入框 + 文本域（textarea）+ "德语"级别选择（A1/A2/B1/B2）
- 提交 → `POST /api/documents/create` → `router.push("/learn?id=" + newId)`

#### (c) Supabase 字段映射

`sentences` 表的 `grammar` 字段 → 在前端映射为 `SampleSentence.grammarTag`
`sentences` 表的 `translation` 字段 → 在前端映射为 `SampleSentence.translationHint`
在 fetch 边界做转换，不改 DB 结构。

### 成功标准

- [ ] 用户能粘贴文本生成新文章
- [ ] 新文章可在 learn 页面学习（解析/练习/TTS/查词）
- [ ] 旧文章（seed 数据）仍然可学
- [ ] 所有交互功能正常运行

---

## 任务 3：🟡 P1 Chat + 语音输入

### 现状

Chat 页面已有流式对话功能。用户打字 → DeepSeek 流式返回。现在要加麦克风输入。

### 需要做的事

在 `app/chat/page.tsx` 的输入框旁边添加 🎤 按钮。

**语音识别逻辑：**

```tsx
// 检查浏览器是否支持 SpeechRecognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
if (!SpeechRecognition) { /* 显示不支持提示，隐藏麦克风按钮 */ }

const recognition = new SpeechRecognition()
recognition.lang = "de-DE"
recognition.continuous = false
recognition.interimResults = true
```

**用户流程：**

```
点击 🎤 → 开始录音 → 你说德语
  → 实时显示转写文本（灰色，不断更新）
  → 再次点击 🎤 → 停止录音
  → 转写结果出现在输入框（可编辑）
  → 不满意 → 点击 🎤 重录
  → 满意 → Enter 发送 → DeepSeek 回复 + 语法纠正
```

**UI 改动：**
- 输入框左边加一个 🎤 麦克风按钮
- 录音时按钮变红 + 脉冲动画
- 录音中转写文本显示在输入框（interim + final）
- 停止后文本固定在输入框，用户可编辑

### 成功标准

- [ ] 麦克风按钮在 Chrome/Edge 可见可用
- [ ] 录音→转写→可编辑→发送 完整链路
- [ ] 不支持语音识别的浏览器优雅降级（隐藏按钮）
- [ ] 不破坏现有打字聊天功能

---

## 执行顺序

| 顺序 | 任务 | 预估 | 说明 |
|------|------|------|------|
| 顺序 | 任务 | 预估 | 说明 |
|------|------|------|------|
| **1** | **精听跟读模式** | 2-3h | **必须优先**，逐句精听 + 播放计数 + 倒计时 + 随机鼓励 |
| **2** | **文库 + 进度系统** | 1-2h | 27 篇文章列表、首页连击日历、进度可视化（见 `docs/library-progress-design.md`） |
| 3 | v0.3 paste-to-learn | 1-1.5h | 完善精读链路，把教材文章加进来 |
| 4 | Telegram Bot（设计已就绪） | — | 推送复习 + 双向对话 + 主动教学，见 `docs/telegram-bot-design.md` |
| ⏸️ | Chat 语音输入 | 暂缓 | Sesame 做得更好，不重复造轮子 |

## 架构约定（必须遵守）

| 约定 | 说明 |
|------|------|
| **`lib/srs.ts` 是唯一 SM-2 实现** | 其他地方不要直接算间隔 |
| **所有 DeepSeek 调用走 `lib/llm.ts`** | 不要 inline fetch |
| **所有 Supabase 访问走 `lib/db/*`** | 组件里不要直接 `createClient()` |
| **`service_role` 只在 `lib/supabase/server.ts`** | `import "server-only"` 保护 |
| **时间格式** | DB: `timestamptz`，JS: `millis`，在 `lib/db/*` 边界转换 |
