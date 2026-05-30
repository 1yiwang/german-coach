"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Message {
  role: "ai" | "user";
  content: string;
  correction?: string;
}

const seedMessages: Message[] = [
  {
    role: "ai",
    content: `Hallo! Heute üben wir das Thema \u201Esich vorstellen\u201C. Stell dich bitte kurz vor — Name, Wohnort, Beruf, Hobbys.`,
  },
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>(seedMessages);
  const [input, setInput] = useState("");

  const send = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setMessages((m) => [
      ...m,
      { role: "user", content: trimmed },
      {
        role: "ai",
        content:
          "(v0.1 占位：接 LLM 后这里会给出地道回复、纠正、并把生词送入 SRS 队列。)",
      },
    ]);
    setInput("");
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            对话教练
          </h1>
          <Badge variant="secondary">B1 · sich vorstellen</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          每天一个场景。AI 会用德语和你聊，纠正你的语法，把生词推进复习队列。
        </p>
      </header>

      <Card className="flex-1 min-h-[420px]">
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            场景：自我介绍
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm"
                }`}
              >
                {m.content}
                {m.correction && (
                  <div className="mt-2 pt-2 border-t border-border/40 text-xs italic opacity-80">
                    {m.correction}
                  </div>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

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
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <Button onClick={send} disabled={!input.trim()} size="lg">
          发送
        </Button>
      </div>
    </div>
  );
}
