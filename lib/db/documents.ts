import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

export interface Document {
  id: string;
  title: string;
  source?: string;
  level?: string;
  totalSentences: number;
  progress: number;
  createdAt: number;
}

export interface Sentence {
  id: string;
  documentId: string;
  index: number;
  original: string;
  translation?: string;
  grammar?: string;
  vocab?: { word: string; meaning: string }[];
  explanation?: string;
  audioUrl?: string;
  mastery: number;
}

interface DbDocument {
  id: string;
  title: string;
  source: string | null;
  level: string | null;
  total_sentences: number;
  progress: number;
  created_at: string;
}

interface DbSentence {
  id: string;
  document_id: string;
  index: number;
  original: string;
  translation: string | null;
  grammar: string | null;
  vocab: { word: string; meaning: string }[] | null;
  explanation: string | null;
  audio_url: string | null;
  mastery: number;
}

function fromDocRow(row: DbDocument): Document {
  return {
    id: row.id,
    title: row.title,
    source: row.source ?? undefined,
    level: row.level ?? undefined,
    totalSentences: row.total_sentences,
    progress: row.progress,
    createdAt: new Date(row.created_at).getTime(),
  };
}

function fromSentenceRow(row: DbSentence): Sentence {
  return {
    id: row.id,
    documentId: row.document_id,
    index: row.index,
    original: row.original,
    translation: row.translation ?? undefined,
    grammar: row.grammar ?? undefined,
    vocab: row.vocab ?? undefined,
    explanation: row.explanation ?? undefined,
    audioUrl: row.audio_url ?? undefined,
    mastery: row.mastery,
  };
}

export async function listDocuments(): Promise<Document[]> {
  const { data, error } = await supabaseAdmin()
    .from("documents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as DbDocument[]).map(fromDocRow);
}

export async function getDocumentWithSentences(
  documentId: string,
): Promise<{ doc: Document; sentences: Sentence[] } | null> {
  const sb = supabaseAdmin();
  const { data: docRow, error: docErr } = await sb
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr) throw docErr;
  if (!docRow) return null;
  const { data: sentenceRows, error: sErr } = await sb
    .from("sentences")
    .select("*")
    .eq("document_id", documentId)
    .order("index", { ascending: true });
  if (sErr) throw sErr;
  return {
    doc: fromDocRow(docRow as DbDocument),
    sentences: (sentenceRows as DbSentence[]).map(fromSentenceRow),
  };
}

export interface CreateDocumentInput {
  title: string;
  source?: string;
  level?: string;
  sentences: {
    original: string;
    translation?: string;
    grammar?: string;
    audioUrl?: string;
  }[];
}

export async function createDocument(
  input: CreateDocumentInput,
): Promise<string> {
  const sb = supabaseAdmin();
  const { data: docRow, error: docErr } = await sb
    .from("documents")
    .insert({
      title: input.title,
      source: input.source ?? null,
      level: input.level ?? null,
      total_sentences: input.sentences.length,
      progress: 0,
    })
    .select("id")
    .single();
  if (docErr) throw docErr;
  const documentId = docRow.id as string;

  if (input.sentences.length > 0) {
    const rows = input.sentences.map((s, i) => ({
      document_id: documentId,
      index: i,
      original: s.original,
      translation: s.translation ?? null,
      grammar: s.grammar ?? null,
      audio_url: s.audioUrl ?? null,
      mastery: 0,
    }));
    const { error: sErr } = await sb.from("sentences").insert(rows);
    if (sErr) throw sErr;
  }

  return documentId;
}
