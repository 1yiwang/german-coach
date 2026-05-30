"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Message {
  role: "ai" | "user";
  content: string;
}

const SCENARIO = "自我介绍";
const LEVEL = "B1";

const seedMessages: Message[] = [
  {
    role: "ai",
    content: `Hallo! Heute üben wir das Thema \u201Esich vorstellen\u201C. Stell dich bitte kurz vor — Name, Wohnort, Beruf, Hobbys.`,
  },
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>(seedMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages, streaming]);

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    const next: Message[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setStreaming(true);
    setError(null);

    const history = next.map((m) => ({
      role: m.role === "ai" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));

    setMessages((m) => [...m, { role: "ai", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: SCENARIO, level: LEVEL, history }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last && last.role === "ai") {
            copy[copy.length - 1] = { ...last, content: last.content + chunk };
          }
          return copy;
        });
      }
    } catch (err) {
      setError((err as Error).message);
      setMessages((m) => {
        const copy = [...m];
        if (copy[copy.length - 1]?.role === "ai" && copy[copy.length - 1].content === "") {
          copy.pop();
        }
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            对话教练
          </h1>
          <Badge variant="secondary">{LEVEL} · sich vorstellen</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          每天一个场景。DeepSeek 用德语和你聊，每轮回答后用 <code>---</code> 分隔给出语法纠正。
        </p>
      </header>

      <Card className="flex-1 min-h-[420px]">
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            场景：{SCENARIO}
          </CardTitle>
        </CardHeader>
        <CardContent ref={scrollerRef} className="space-y-3 max-h-[60vh] overflow-y-auto">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm"
                }`}
              >
                {m.content || (
                  <span className="italic opacity-60">…</span>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {error && (
        <div className="text-xs text-destructive">
          请求失败：{error}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="用德语回答…… (Enter 发送, Shift+Enter 换行)"
          disabled={streaming}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
        />
        <Button onClick={send} disabled={!input.trim() || streaming} size="lg">
          {streaming ? "回复中…" : "发送"}
        </Button>
      </div>
    </div>
  );
}
