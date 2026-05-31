/**
 * Transcribe all Audacity-exported wav chunks for a slug using local Whisper.
 *
 * Output:
 *   scripts/transcriptions/<slug>.json
 *
 * This is intentionally cache-friendly: if a transcription JSON already exists,
 * chunks with a non-empty `speech` are skipped on rerun.
 */

import * as fs from "node:fs";
import * as path from "node:path";

process.env.WHISPER_NODE_LOG_LEVEL = process.env.WHISPER_NODE_LOG_LEVEL ?? "ERROR";

interface ChunkTranscription {
  audioFile: string;
  duration: number;
  speech: string;
}

function readWavDuration(filePath: string): number {
  const buf = fs.readFileSync(filePath);
  if (buf.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error(`Not RIFF: ${filePath}`);
  }
  if (buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Not WAVE: ${filePath}`);
  }
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset < buf.length - 8) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "fmt ") {
      byteRate = buf.readUInt32LE(offset + 8 + 8);
    } else if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset += 1;
  }
  if (!byteRate || !dataSize) throw new Error(`No fmt/data chunk: ${filePath}`);
  return dataSize / byteRate;
}

async function main() {
  const slug = process.argv[2] ?? "b1-track-48";
  const audioDir = path.join(process.cwd(), "public", "audio", slug);
  const outputPath = path.join(
    process.cwd(),
    "scripts",
    "transcriptions",
    `${slug}.json`,
  );
  const wavFiles = fs
    .readdirSync(audioDir)
    .filter(
      (f) =>
        f.toLowerCase().endsWith(".wav") &&
        !f.toLowerCase().endsWith(".wav16k.wav"),
    )
    .sort();

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const existing: ChunkTranscription[] = fs.existsSync(outputPath)
    ? (JSON.parse(fs.readFileSync(outputPath, "utf-8")) as ChunkTranscription[])
    : [];
  const byName = new Map(existing.map((x) => [x.audioFile, x]));

  const { whisper } = await import("@lumen-labs-dev/whisper-node");
  const out: ChunkTranscription[] = [];

  for (let i = 0; i < wavFiles.length; i++) {
    const audioFile = wavFiles[i];
    const filePath = path.join(audioDir, audioFile);
    const cached = byName.get(audioFile);
    if (cached?.speech) {
      out.push(cached);
      console.log(
        `${String(i + 1).padStart(2)}/${wavFiles.length} cached ${audioFile}: ${cached.speech}`,
      );
      continue;
    }

    console.log(`${String(i + 1).padStart(2)}/${wavFiles.length} transcribing ${audioFile}...`);
    const result = await whisper(filePath, {
      modelName: "base",
      whisperOptions: {
        language: "de",
        word_timestamps: false,
      },
      shellOptions: {
        silent: true,
        async: false,
      },
    });
    const speech = result
      .map((line) => line.speech.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    const row = {
      audioFile,
      duration: +readWavDuration(filePath).toFixed(2),
      speech,
    };
    out.push(row);
    fs.writeFileSync(outputPath, JSON.stringify(out, null, 2), "utf-8");
    console.log(`   → ${speech || "(empty)"}`);
  }

  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2), "utf-8");
  console.log(`\nWrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
