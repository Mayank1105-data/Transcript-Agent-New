import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";

let aiClient = null;

function getGeminiModel() {
  const model = process.env.GEMINI_MODEL;
  if (!model) {
    throw new Error("GEMINI_MODEL is not set in environment variables. Please add it to your .env file.");
  }
  return model;
}

let currentApiKey = null;

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in environment variables. Please add it to your .env file.");
  }
  if (!aiClient || currentApiKey !== apiKey) {
    aiClient = new GoogleGenAI({ apiKey });
    currentApiKey = apiKey;
  }
  return aiClient;
}

// ── Citation-aware transcription prompt ─────────────────────────────
// Instead of returning plain text, Gemini returns a segmented JSON
// structure with timestamps + speaker labels. This is what makes
// "citations" (timestamp + speaker links back to the audio) possible
// downstream in the structuring step and in the UI.
const SEGMENT_PROMPT = `You are a professional audio transcription engine with speaker diarization.

## Task
Transcribe the provided audio file completely and accurately.

## Output Format — CRITICAL
Return ONLY valid JSON (no markdown code fences, no commentary, no leading/trailing text) matching EXACTLY this schema:

{
  "segments": [
    {
      "id": "seg_1",
      "start": "MM:SS.mmm",
      "end": "MM:SS.mmm",
      "speaker": "Speaker 1",
      "text": "Exact transcribed words for this segment."
    }
  ]
}

## Rules
1. Break the transcript into natural segments — roughly one segment per sentence or per continuous thought (do not make segments longer than ~15 seconds of audio).
2. "start" and "end" must reflect the actual elapsed time within the audio file, in MM:SS.mmm format (e.g. "01:23.450").
3. Assign consistent speaker labels ("Speaker 1", "Speaker 2", etc.) based on voice/acoustic changes. If you genuinely cannot distinguish speakers, label everything "Speaker 1".
4. "id" must be sequential: seg_1, seg_2, seg_3, ...
5. Do NOT skip, summarize, or paraphrase any spoken content — this must be a complete, verbatim transcript split across segments.
6. Do NOT invent words that were not said. If audio is unclear, transcribe your best-effort interpretation rather than omitting the segment.
7. Return ONLY the JSON object. No \`\`\`json fences, no explanation.`;

/**
 * Transcribe audio file using Google Gemini API, returning timestamped,
 * speaker-diarized segments (citation-ready) instead of a flat string.
 *
 * @param {string} filePath - Absolute path to audio file on disk.
 * @returns {Promise<{ segments: Array<{id:string,start:string,end:string,speaker:string,text:string}>, fullText: string }>}
 */
export async function transcribeAudio(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file not found at: ${filePath}`);
  }

  const model = getGeminiModel();
  console.log(`[transcriptionService] Transcribing audio (with segments/citations) via Google Gemini (${model})...`);

  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    ".webm": "audio/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".mp4": "audio/mp4"
  };
  const mimeType = mimeMap[ext] || "audio/mpeg";

  const fileBuffer = fs.readFileSync(filePath);
  const base64Audio = fileBuffer.toString("base64");

  const ai = getAiClient();

  const response = await ai.models.generateContent({
    model: model,
    contents: [
      {
        role: "user",
        parts: [
          { text: SEGMENT_PROMPT },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Audio
            }
          }
        ]
      }
    ],
    config: {
      temperature: 0,
      responseMimeType: "application/json"
    }
  });

  if (!response.text) {
    throw new Error("Gemini API returned an empty transcription response.");
  }

  const parsed = parseSegmentResponse(response.text);

  const fullText = parsed.segments.map((s) => s.text).join(" ").trim();
  console.log(
    `[transcriptionService] Transcription completed. ${parsed.segments.length} segments, ${fullText.length} chars.`
  );

  return { segments: parsed.segments, fullText };
}

/**
 * Safely parse Gemini's JSON segment response, stripping accidental
 * markdown fences and validating the shape. Falls back to a single
 * unsegmented block (with placeholder timestamps) if parsing fails,
 * so the pipeline never hard-crashes on a malformed response.
 */
function parseSegmentResponse(rawText) {
  let cleaned = rawText.trim();
  // Defensive: strip ```json ... ``` fences if the model added them anyway
  cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    const data = JSON.parse(cleaned);
    if (!Array.isArray(data.segments) || data.segments.length === 0) {
      throw new Error("No segments array in parsed response.");
    }
    // Normalize/validate each segment, fill in safe defaults if a field is missing
    const segments = data.segments.map((seg, idx) => ({
      id: seg.id || `seg_${idx + 1}`,
      start: seg.start || "00:00.000",
      end: seg.end || "00:00.000",
      speaker: seg.speaker || "Speaker 1",
      text: (seg.text || "").trim()
    }));
    return { segments };
  } catch (err) {
    console.error("[transcriptionService] Failed to parse segmented JSON, falling back to single block:", err.message);
    return {
      segments: [
        {
          id: "seg_1",
          start: "00:00.000",
          end: "00:00.000",
          speaker: "Speaker 1",
          text: cleaned
        }
      ]
    };
  }
}

/**
 * Convert an "MM:SS.mmm" or "HH:MM:SS.mmm" timestamp string into total seconds.
 * Used by the frontend/audio player to seek to a citation's start time.
 */
export function timestampToSeconds(ts) {
  if (!ts) return 0;
  const parts = ts.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  return Number(ts) || 0;
}