import { NextResponse } from "next/server";
import { toFile } from "openai/uploads";
import { getOpenAIClient } from "../../../../src/openaiClient";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    const form = await req.formData();
    const entry = form.get("audio");
    if (!entry || typeof entry === "string") {
      return NextResponse.json({ error: "Missing audio file field" }, { status: 400 });
    }

    const file = entry as File;
    if (file.size === 0) {
      return NextResponse.json({ error: "Empty audio" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Audio too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const name = file.name?.trim() ? file.name : "recording.webm";
    const openaiFile = await toFile(buf, name, {
      type: file.type || "application/octet-stream",
    });

    const client = getOpenAIClient();
    const model = process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "whisper-1";
    const transcription = await client.audio.transcriptions.create({
      file: openaiFile,
      model,
    });

    const text =
      typeof transcription === "string"
        ? transcription
        : "text" in transcription
          ? transcription.text
          : "";

    return NextResponse.json({ text: text.trim() });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Transcription failed";
    const isConfig = message.includes("OPENAI_API_KEY");
    return NextResponse.json(
      { error: message },
      { status: isConfig ? 503 : 500 },
    );
  }
}
