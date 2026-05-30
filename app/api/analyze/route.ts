import { NextRequest, NextResponse } from "next/server";
import { analyzePrompt, chatComplete } from "@/lib/llm";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { sentence } = (await req.json()) as { sentence?: string };
    if (!sentence || typeof sentence !== "string") {
      return NextResponse.json(
        { error: "Missing `sentence` (string)." },
        { status: 400 },
      );
    }
    const content = await chatComplete(analyzePrompt(sentence), {
      temperature: 0.2,
      maxTokens: 900,
    });
    return NextResponse.json({ content });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
