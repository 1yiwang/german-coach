# Goethe B1 Wortliste — S8 解析 + 预览

> 日期：2026-06-01
> 状态：✅ B1 完成 / ❌ B2 无词汇表

---

## 一、概述

从 Goethe-Zertifikat B1 Wortliste PDF（104 页）提取结构化词汇数据，生成 JSON 并在 Next.js 管理后台提供预览页面。

---

## 二、解析器 `scripts/wl-parse-goethe.ts`

### 核心技术方案

| 问题 | 方案 |
|------|------|
| PDF 文本提取 | `pdfjs-dist` 读取 text items 坐标 `(x, y)` |
| 词头/例句分离 | Sorted-gap x-split：在 x 坐标排序后找到最大空隙，以此为分界线 |
| 词头条目分组 | y 坐标差值 `> 18px` 视为新条目 |
| 例句分配 | `entryY >= exItem.y - 15` 容差，最近距离匹配 |
| POS 识别 | 正则匹配：名词（der/die/das）、动词（逗号分隔变位 + hat/ist）、反身动词、形容词等 |
| 地区变体 | 提取 `(A)`, `(CH)`, `(D)` 标记 |
| 去重合并 | `postProcess()`：同 headword 合并，优先保留有例句/POS 更好的版本 |

### 迭代历程（v1 → v9）

- **v1-v4**：基础框架，2-means 聚类分列
- **v5-v6**：修复例句偏移 bug（例句错配到下一个词条）
- **v7-v8**：修复 "abhängig" 被误判为例句（x=96.7 落在例句簇）
- **v9（最终版）**：用 sorted-gap 替代 2-means，natural gap 在 x≈114 处，精准分离

### 关键过滤

```typescript
// 过滤页码残留 "2.", "3."
if (/^\d+\.$/.test(pos.headword)) return null;
// 过滤章节字母、纯数字、箭头等
function isBadEntryText(text: string): boolean { ... }
```

### 运行方式

```bash
npx tsx scripts/wl-parse-goethe.ts
```

---

## 三、输出数据

**文件**：`scripts/transcriptions/_wortliste-b1.json`

| 指标 | 数值 |
|------|------|
| 总词条 | 2580 |
| 有例句 | 2575 |
| 动词 | 600 |
| 阴性名词 | 594 |
| 阳性名词 | 472 |
| 中性名词 | 285 |
| 形容词 | 178 |
| 副词 | 40 |
| 介词 | 32 |
| 连词 | 27 |
| 其他 | 310 |
| 未知 | 42 |
| 常用动词覆盖 | 53/57（4 个跳过：kaufen, treffen, verstehen, waschen） |

### 数据结构

```typescript
interface WordEntry {
  headword: string;    // "ab", "abbiegen", "Abbildung"
  pos: string;         // "verb", "noun:f", "noun:m", "adj", "adv", ...
  inflection: string;  // "fährt ab, fuhr ab, ist abgefahren"
  examples: string[];  // ["1. Die Fahrt kostet ...", ...]
  topic: null;         // 预留，待后续推断
  regional: string | null; // "A", "CH", "D"
}
```

---

## 四、预览页面 `app/admin/wortliste/page.tsx`

### 技术选型

**Server Component** 直接 `readFileSync` 读取 JSON，无需 API route（因为所有 API route 因缺少 Supabase 环境变量而 404）。

### 功能

- URL 参数驱动：`?q=<搜索>&pos=<词性>&page=<页码>`
- 搜索：按 headword 或 inflection 匹配
- 筛选：按 POS 大类（verb, noun:m, noun:f, noun:n, adj...）
- 分页：每页 50 条
- 卡片展示：headword + POS badge + 地区 badg​e + 变位 + 例句

### 访问

```
http://localhost:3000/admin/wortliste
```

### 备用 API Route

`app/api/wortliste/route.ts` 已创建但未使用（因 Supabase env 缺失导致全部 API route 404，Server Component 方案更直接）。

---

## 五、B2 PDF 探查

**文件**：`scripts/Goethe-Zertifikat_B2_Wortliste.pdf`（6.3 MB, 47 页）

**结论**：❌ 此 PDF 不是单词表，是 **Modellsatz Erwachsene**（B2 模拟考试卷）。

内容为：阅读理解、听力、写作、口语考试题 + 答题卡 + 评分标准。**Goethe 官方不在 B2+ 级别发布 Wortliste。**

探查脚本：`scripts/wl-scout-b2.ts`

---

## 六、辅助脚本

| 文件 | 用途 |
|------|------|
| `scripts/wl-scout.ts` | 初始 PDF 探查（页数、文本层检测） |
| `scripts/wl-scout-coords.ts` | PDF 坐标结构初探 |
| `scripts/wl-debug-page.ts` | 输出 PDF 单页全部 text item 坐标，用于定位分列参数 |
| `scripts/wl-debug-missing.ts` | 搜索指定词汇在 PDF 中出现位置，调试漏词问题 |
| `scripts/wl-scout-b2.ts` | 探查 B2 PDF 结构（确认无词汇表） |

---

## 七、已知问题

1. **42 个 "unknown" POS**：多为不匹配正则的特殊词条（`Abgase (Pl.)`, `anstrengend` 等）
2. **topic 字段全为 null**：需后续推断（按主题分类）
3. **数据库未入库**：JSON 仅在本地文件系统

---

## 八、相关文件清单

```
scripts/
  wl-parse-goethe.ts          # B1 解析器主程序
  wl-scout.ts                 # 初始探查
  wl-scout-coords.ts          # 坐标初探
  wl-debug-page.ts            # PDF 坐标调试
  wl-debug-missing.ts         # 漏词调试
  wl-scout-b2.ts              # B2 探查
  transcriptions/
    _wortliste-b1.json        # 解析输出（2580 条）

app/
  admin/wortliste/
    page.tsx                  # 预览页面（Server Component）
  api/wortliste/
    route.ts                  # API 备用（404，未使用）
```
