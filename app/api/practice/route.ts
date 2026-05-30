import { NextRequest, NextResponse } from "next/server";
import { chatComplete, practicePrompt } from "@/lib/llm";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { sentence, grammarTag, userAnswer } = (await req.json()) as {
      sentence?: string;
      grammarTag?: string;
      userAnswer?: string;
    };
    if (!sentence || !userAnswer) {
      return NextResponse.json(
        { error: "Missing `sentence` or `userAnswer`." },
        { status: 400 },
      );
    }
    const content = await chatComplete(
      practicePrompt(sentence, grammarTag, userAnswer),
      { temperature: 0.4, maxTokens: 700 },
    );
    return NextResponse.json({ content });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
