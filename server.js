import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

import { transcribeAudio } from "./transcriptionService.js";
import { structureTranscript, redoStructure, generateSolution, structuredDocToMarkdown } from "./llmProcessor.js";
import { createWorkItem, uploadAttachment } from "./devopsIntegrator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage config to preserve original audio file extensions
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || ".webm";
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({ storage: storage });

// Serve uploads folder statically so audio files can be fetched later
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Serve static React files in production
app.use(express.static(path.join(__dirname, "dist")));

/**
 * Step 1+2+3: Ingest audio, transcribe it, structure it, and return results.
 */
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file provided." });
  }

  const filePath = req.file.path;
  const promptOverride = req.body.prompt_override;
  console.log(`[Server] Received audio: ${req.file.originalname} -> saved to ${filePath} (${req.file.size} bytes)`);

  try {
    // Step 2: Transcribe via Whisper
    const { segments, fullText } = await transcribeAudio(filePath);

    if (!fullText || !fullText.trim()) {
      return res.status(422).json({
        error: "Transcription yielded empty text. Please record a clearer audio sample."
      });
    }

    console.log(`[Server] Transcription complete. Length: ${fullText.length}`);

    // Step 3: Structure via GPT-4o / Gemini
    const structuredTextObj = await structureTranscript(segments, promptOverride);
    const structuredText = structuredDocToMarkdown(structuredTextObj, segments);
    console.log(`[Server] Structuring complete. Returning structured document.`);

    res.json({
      raw_transcript: fullText,
      segments: segments,
      structured_text: structuredText,
      audio_url: `/uploads/${req.file.filename}`
    });
  } catch (error) {
    console.error("[Server] Error in transcribe pipeline:", error);
    res.status(500).json({ error: error.message || "Audio processing failed." });
  }
});

/**
 * Step 4 (Option B): Refine the requirements document again.
 */
app.post("/api/redo", async (req, res) => {
  const { current_text, feedback, segments, prompt_override } = req.body;

  if (!current_text) {
    return res.status(400).json({ error: "No current_text provided." });
  }

  console.log(`[Server] Redo requested. Feedback: "${feedback || "none"}"`);

  try {
    const revisedTextObj = await redoStructure(current_text, feedback, segments || [], prompt_override);
    const revisedText = structuredDocToMarkdown(revisedTextObj, segments || []);
    res.json({ structured_text: revisedText });
  } catch (error) {
    console.error("[Server] Error in LLM redo:", error);
    res.status(500).json({ error: error.message || "Re-generation failed." });
  }
});

/**
 * Reframe/restructure raw transcript.
 */
app.post("/api/structure", async (req, res) => {
  const { raw_transcript, prompt_override } = req.body;

  if (!raw_transcript) {
    return res.status(400).json({ error: "No raw_transcript provided." });
  }

  console.log(`[Server] Re-structured raw transcript...`);

  try {
    const structuredTextObj = await structureTranscript(raw_transcript, prompt_override);
    const synthesizedSegments = [
      {
        id: "seg_1",
        start: "00:00.000",
        end: "00:00.000",
        speaker: "User",
        text: raw_transcript.trim()
      }
    ];
    const structuredText = structuredDocToMarkdown(structuredTextObj, synthesizedSegments);
    res.json({
      structured_text: structuredText,
      segments: synthesizedSegments
    });
  } catch (error) {
    console.error("[Server] Error in LLM structuring:", error);
    res.status(500).json({ error: error.message || "Structuring failed." });
  }
});

/**
 * Generate technical proposed solution.
 */
app.post("/api/generate-solution", async (req, res) => {
  const { approved_text, prompt_override } = req.body;

  if (!approved_text) {
    return res.status(400).json({ error: "No approved_text provided." });
  }

  console.log(`[Server] Generating proposed solution...`);

  try {
    const solution = await generateSolution(approved_text, prompt_override);
    res.json({ proposed_solution: solution });
  } catch (error) {
    console.error("[Server] Error in LLM solution generation:", error);
    res.status(500).json({ error: error.message || "Solution generation failed." });
  }
});

/**
 * Step 4 (Option A): Approve and create the Azure DevOps Ticket.
 */
app.post("/api/approve", async (req, res) => {
  const { approved_text, proposed_solution } = req.body;

  if (!approved_text) {
    return res.status(400).json({ error: "No approved_text provided." });
  }

  console.log(`[Server] Approval requested. Pushing to Azure DevOps...`);

  let attachmentUrl = null;
  let warningMessage = null;

  if (proposed_solution) {
    try {
      console.log(`[Server] Uploading technical proposed solution to Azure DevOps...`);
      attachmentUrl = await uploadAttachment(proposed_solution, "technical_proposed_solution.md");
    } catch (error) {
      console.error("[Server] Warning: Failed to upload attachment:", error);
      warningMessage = "Failed to upload proposed solution attachment, but work item creation proceeded.";
    }
  }

  try {
    const result = await createWorkItem(approved_text, attachmentUrl);
    console.log(`[Server] Work Item #${result.id} successfully created: ${result.url}`);

    res.json({
      work_item_id: result.id,
      work_item_url: result.url,
      title: result.title,
      message: `Work Item #${result.id} created successfully!`,
      warning: warningMessage
    });
  } catch (error) {
    console.error("[Server] Azure DevOps integration failed:", error);
    res.status(500).json({ error: error.message || "Failed to create Azure DevOps ticket." });
  }
});

// For any other routes, serve React index.html in production
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log("=========================================");
  console.log(` Audio-to-DevOps Node Server Running`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log("=========================================");
});