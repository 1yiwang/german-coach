/**
 * Thin DeepSeek client (OpenAI-compatible REST).
 *
 * Server-only — never import this from a Client Component; the API key
 * must stay on the server. Used by route handlers under `app/api/`.
 *
 * Why fetch instead of the `openai` SDK: we only need two endpoints
 * (json + sse streaming), the SDK adds ~200 KB and a runtime dependency
 * for no gain at this scale.
 */

import "server-only";

const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function requireApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. Copy .env.local.example to .env.local and fill it in.",
    );
  }
  return key;
}

export async function chatComplete(
  messages: LlmMessage[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireApiKey()}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 1200,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `DeepSeek ${res.status} ${res.statusText}: ${text.slice(0, 400)}`,
    );
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

/**
 * SSE streaming. Returns a ReadableStream of plain UTF-8 text chunks
 * (already extracted from the OpenAI delta protocol). The caller can
 * pipe this straight into a Next.js `Response`.
 */
export function chatStream(
  messages: LlmMessage[],
  opts: { temperature?: number; maxTokens?: number } = {},
): ReadableStream<Uint8Array> {
  const apiKey = requireApiKey();
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      let upstream: Response;
      try {
        upstream = await fetch(`${BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: MODEL,
            messages,
            temperature: opts.temperature ?? 0.4,
            max_tokens: opts.maxTokens ?? 1200,
            stream: true,
          }),
        });
      } catch (err) {
        controller.enqueue(
          encoder.encode(`[Error: ${(err as Error).message}]`),
        );
        controller.close();
        return;
      }

      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(() => "");
        controller.enqueue(
          encoder.encode(
            `[DeepSeek ${upstream.status} ${upstream.statusText}: ${text.slice(0, 400)}]`,
          ),
        );
        controller.close();
        return;
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let lineEnd = buffer.indexOf("\n");
          while (lineEnd !== -1) {
            const rawLine = buffer.slice(0, lineEnd).trim();
            buffer = buffer.slice(lineEnd + 1);

            if (rawLine.startsWith("data:")) {
              const data = rawLine.slice(5).trim();
              if (data === "[DONE]") {
                controller.close();
                return;
              }
              try {
                const parsed = JSON.parse(data) as {
                  choices?: { delta?: { content?: string } }[];
                };
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) controller.enqueue(encoder.encode(delta));
              } catch {
                // Skip malformed SSE chunk; DeepSeek occasionally sends keepalives.
              }
            }
            lineEnd = buffer.indexOf("\n");
          }
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(`[Stream error: ${(err as Error).message}]`),
        );
      } finally {
        controller.close();
      }
    },
  });
}

// ============================================================================
// Prompt builders — one per UI action. Centralized here so the prompt
// templates from design.md "LLM 提示策略" live in exactly one place.
// ============================================================================

export function analyzePrompt(sentence: string): LlmMessage[] {
  return [
    {
      role: "system",
      content:
        "你是一位耐心的德语学习陪练，面对的是一个 B1 左右、中文母语的学习者。" +
        "你的任务是「词为主、语法为辅」地精讲单句：挑出值得学的实义词，给含义 + 用法 + 多例句举一反三；只有在句子真的有特殊语法结构时才补一节语法说明，绝不每句都讲语法。" +
        "输出风格：纯文本，禁止使用 Markdown 加粗 (** **)、标题 (#)、代码块、表格、链接；靠 emoji 章节标题 + 空行 + 缩进做层级。" +
        "中文用于解释，德语原文保留。简洁直接，不要客套话。",
    },
    {
      role: "user",
      content: `请精讲下面这句德语：

"${sentence}"

严格按以下结构输出。章节标题原样照抄（包括 emoji 和文字），不要改字、不要加粗、不要加序号：

📖 句意
用 1 句自然中文转述这句话的意思（10-30 字），不逐词直译。

🎯 难度：A1 / A2 / B1 / B2 / C1（选一个，给整句的整体水平）

🔑 重点词
────────────────────
挑 2-4 个最值得学的实义词。跳过 ich / du / das / der / und / sein / haben 这类基础词。如果句子全是基础词，就挑 2 个最值得复习的。每个词之间用一个空行分隔，按下面的模板：

[词原形]  [词性，如 v. / n. m. / n. f. / n. n. / adj. / adv. / prep.]  · [这个词的难度 A1-C1]
  含义：在本句中的具体意思（1 行）
  用法：常见搭配 / 支配的格 / 介词搭配（1 行）
  例句：
    • 例句 1（纯德语，体现最典型用法）
    • 例句 2（纯德语，换一个场景或搭配）
    • 例句 3（可选，只在词义比较多时给）

⚠️ 关于语法节：默认不要写。只有当句子包含以下结构之一时才追加一节 📐 语法：Konjunktiv II、Passiv (werden/sein-Passiv)、嵌套从句、Plusquamperfekt、Partizipialkonstruktion、特殊倒装、分离动词位置陷阱、关系从句、zu+Infinitiv 结构、间接引语。如果都没有，直接结束，不要写「无特殊语法」这种话。

📐 语法（仅在必要时出现）
用 2-3 行说清楚这个结构在本句里怎么用，不要展开成系统课。

不要写 "总结" / "结论" / "希望对你有帮助" / "如有问题请追问" 这类收尾客套。`,
    },
  ];
}

export function practicePrompt(
  sentence: string,
  grammarTag: string | undefined,
  userAnswer: string,
): LlmMessage[] {
  return [
    {
      role: "system",
      content:
        "你是耐心的德语写作教练。鼓励为主，但要直接指出错误。回答用 Markdown，保持简洁。",
    },
    {
      role: "user",
      content: `原句：「${sentence}」\n核心语法点：${grammarTag ?? "（未标注，由你判断）"}\n\n练习任务：用相同语法点造一句新的德语句子。\n\n用户的答案：\n「${userAnswer}」\n\n请按以下结构回答：\n- **判定**：✅ 正确 / ⚠️ 基本可用但有问题 / ❌ 有明显错误\n- **逐项指出错误**（如果有）：拼写 / 词序 / 时态 / 格 / 介词\n- **更地道的写法**（最多 2 种）\n- **一句鼓励**`,
    },
  ];
}

export function lookupPrompt(word: string, sentence: string): LlmMessage[] {
  return [
    {
      role: "system",
      content:
        "你是德德 + 德中双语词典助手。回答必须是有效 JSON，不要包 Markdown 代码块、不要前后多余文字。",
    },
    {
      role: "user",
      content: `单词：「${word}」\n上下文句子：「${sentence}」\n\n按下面的 JSON schema 返回（字段顺序固定，缺失字段用空字符串或空数组）：\n{\n  "word": "原形 / 词典形（动词原形 / 名词单数带冠词）",\n  "pos": "词性，例如 v. / n. m. / adj. / prep.",\n  "meaningZh": "中文释义，1-2 句",\n  "meaningEn": "English meaning, 1 short line",\n  "collocations": ["最多 3 个常见搭配"],\n  "examples": ["最多 2 个例句（德语原句 + 中文翻译用 — 分隔）"],\n  "inflection": "变格 / 变位 / 比较级，简短一行"\n}`,
    },
  ];
}

export function chatSystemPrompt(scenario: string, level: string): string {
  return `你是德语对话教练。当前用户水平：${level}，当前场景：${scenario}。\n\n规则：\n- 默认用德语对话，难句子可以附一行中文。\n- 每次用户回答后，先给一个自然的下一句对话推进，再用 \`---\` 分隔，给出一段简短的语法/表达纠正（如果回答完美就写 "Sehr gut, keine Korrekturen."）。\n- 如果用户连续 3 次回答顺畅，主动升级难度或换子话题。\n- 如果用户卡住，降级并给提示。\n- 不要说英语，除非用户先用英语提问。`;
}
