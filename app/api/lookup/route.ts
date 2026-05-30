import { NextRequest, NextResponse } from "next/server";
import { chatComplete, lookupPrompt } from "@/lib/llm";

export const runtime = "nodejs";

export interface LookupResult {
  word: string;
  pos: string;
  meaningZh: string;
  meaningEn: string;
  collocations: string[];
  examples: string[];
  inflection: string;
}

function stripJsonFence(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  return s.trim();
}

export async function POST(req: NextRequest) {
  try {
    const { word, sentence } = (await req.json()) as {
      word?: string;
      sentence?: string;
    };
    if (!word || !sentence) {
      return NextResponse.json(
        { error: "Missing `word` or `sentence`." },
        { status: 400 },
      );
    }

    const raw = await chatComplete(lookupPrompt(word, sentence), {
      temperature: 0.1,
      maxTokens: 600,
    });

    let parsed: LookupResult;
    try {
      parsed = JSON.parse(stripJsonFence(raw)) as LookupResult;
    } catch {
      return NextResponse.json(
        { error: "LLM returned non-JSON output.", raw },
        { status: 502 },
      );
    }
    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
