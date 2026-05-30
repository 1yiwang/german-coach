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
        "你是德语语法专家。回答用 Markdown，结构紧凑、不啰嗦，必要时混合德文术语和中文解释。",
    },
    {
      role: "user",
      content: `请解析这句德语：\n\n"${sentence}"\n\n按以下五个小节回答：\n1. **语法结构**（句子成分 / 时态 / 语态，必要时画一行成分树）\n2. **词汇**（每个实义词的词性、词形变化、含义）\n3. **常见搭配**（动词支配什么格 / 介词搭配）\n4. **类似表达对比**（如果有近义词，给一对，否则跳过）\n5. **难度评级**：A1 / A2 / B1 / B2 / C1`,
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
