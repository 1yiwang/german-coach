import { NextRequest } from "next/server";
import { chatStream, chatSystemPrompt, type LlmMessage } from "@/lib/llm";

export const runtime = "nodejs";

interface ChatRequestBody {
  scenario?: string;
  level?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response("Invalid JSON body.", { status: 400 });
  }

  const scenario = body.scenario ?? "自我介绍";
  const level = body.level ?? "B1";
  const history = body.history ?? [];

  if (history.length === 0) {
    return new Response("Empty history.", { status: 400 });
  }

  const messages: LlmMessage[] = [
    { role: "system", content: chatSystemPrompt(scenario, level) },
    ...history,
  ];

  const stream = chatStream(messages, { temperature: 0.6, maxTokens: 600 });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
