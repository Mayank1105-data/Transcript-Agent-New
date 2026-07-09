import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

import { transcribeAudio } from "./transcriptionService.js";
import { structureTranscript, redoStructure, generateSolution, structuredDocToMarkdown, testGeminiConnection } from "./llmProcessor.js";
import { createWorkItem, uploadAttachment, testDevOpsConnection, getWorkItemComments, postWorkItemComment, updateWorkItemComment } from "./devopsIntegrator.js";

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
    const revisedTextObj = await redoStructure(current_text, segments || [], feedback, prompt_override);
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

// ── Discussions / Comments Sync Endpoints ───────────────────────────
const DISCUSSIONS_FILE = path.join(__dirname, "discussions.json");

// Helper to read discussions database
function readDiscussions() {
  try {
    if (!fs.existsSync(DISCUSSIONS_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(DISCUSSIONS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    console.error("[Server] Error reading discussions.json:", error);
    return [];
  }
}

// Helper to write discussions database
function writeDiscussions(data) {
  try {
    fs.writeFileSync(DISCUSSIONS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("[Server] Error writing discussions.json:", error);
  }
}

/**
 * Fetch and sync comments for a specific Work Item.
 */
app.get("/api/workitems/:id/comments", async (req, res) => {
  const workItemId = req.params.id;

  try {
    // 1. Fetch live comments from DevOps
    let devopsComments = [];
    try {
      devopsComments = await getWorkItemComments(workItemId);
    } catch (apiErr) {
      console.warn(`[Server] Warning: Failed to fetch live comments from DevOps for #${workItemId}:`, apiErr.message);
    }

    // 2. Read local discussions list
    const localDiscussions = readDiscussions();

    // 3. Merge: loop through devopsComments and insert/update local cache
    let updated = false;
    for (const dc of devopsComments) {
      const localIndex = localDiscussions.findIndex(
        (ld) => ld.workItemId == workItemId && ld.commentId == dc.id
      );

      const cleanText = (dc.text || "").replace(/<[^>]*>/g, "").trim();

      if (localIndex === -1) {
        localDiscussions.push({
          id: `devops-${dc.id}`,
          workItemId: parseInt(workItemId),
          commentId: dc.id,
          comment: cleanText || dc.text || "",
          author: dc.createdBy?.displayName || "Azure DevOps",
          source: "Azure DevOps",
          createdDate: dc.createdDate || new Date().toISOString(),
          syncStatus: "Synced",
          lastUpdated: dc.createdDate || new Date().toISOString()
        });
        updated = true;
      } else {
        const existingComment = localDiscussions[localIndex];
        if (existingComment.comment !== cleanText) {
          existingComment.comment = cleanText;
          existingComment.lastUpdated = dc.modifiedDate || new Date().toISOString();
          updated = true;
          console.log(`[Server] Updated comment #${dc.id} text to match live DevOps edit: "${cleanText}"`);
        }
      }
    }

    if (updated) {
      writeDiscussions(localDiscussions);
    }

    // Filter comments for this work item and sort chronologically
    const itemComments = localDiscussions
      .filter((ld) => ld.workItemId == workItemId)
      .sort((a, b) => new Date(a.createdDate) - new Date(b.createdDate));

    res.json(itemComments);
  } catch (error) {
    console.error(`[Server] Error in GET comments for #${workItemId}:`, error);
    res.status(500).json({ error: error.message || "Failed to retrieve comments." });
  }
});

/**
 * Add a new comment to a Work Item from the application UI and sync to DevOps.
 */
app.post("/api/workitems/:id/comments", async (req, res) => {
  const workItemId = req.params.id;
  const { comment, author } = req.body;

  if (!comment || !comment.trim()) {
    return res.status(400).json({ error: "Comment text cannot be empty." });
  }

  const localAuthor = author || "Application User";

  try {
    // 1. Post to Azure DevOps REST API
    let devopsResult = null;
    try {
      devopsResult = await postWorkItemComment(workItemId, comment.trim());
    } catch (apiErr) {
      console.error(`[Server] Failed to sync comment to DevOps for #${workItemId}:`, apiErr);
      throw new Error(`Azure DevOps sync failed: ${apiErr.message}`);
    }

    // 2. Read local discussions list
    const localDiscussions = readDiscussions();

    // 3. Save the successfully synced comment locally
    const newComment = {
      id: `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      workItemId: parseInt(workItemId),
      commentId: devopsResult ? devopsResult.id : null,
      comment: comment.trim(),
      author: localAuthor,
      source: "UI",
      createdDate: devopsResult ? devopsResult.createdDate : new Date().toISOString(),
      syncStatus: "Synced",
      lastUpdated: new Date().toISOString()
    };

    localDiscussions.push(newComment);
    writeDiscussions(localDiscussions);

    res.json(newComment);
  } catch (error) {
    console.error(`[Server] Error in POST comment for #${workItemId}:`, error);
    res.status(500).json({ error: error.message || "Failed to post comment." });
  }
});

/**
 * Update an existing comment for a Work Item from the application UI and sync to DevOps.
 */
app.patch("/api/workitems/:id/comments/:commentDbId", async (req, res) => {
  const workItemId = req.params.id;
  const commentDbId = req.params.commentDbId;
  const { comment } = req.body;

  if (!comment || !comment.trim()) {
    return res.status(400).json({ error: "Comment text cannot be empty." });
  }

  try {
    const localDiscussions = readDiscussions();
    const commentIndex = localDiscussions.findIndex(
      (ld) => ld.workItemId == workItemId && ld.id === commentDbId
    );

    if (commentIndex === -1) {
      return res.status(404).json({ error: "Comment not found." });
    }

    const targetComment = localDiscussions[commentIndex];

    // If it has a DevOps commentId, sync the update to Azure DevOps
    if (targetComment.commentId) {
      try {
        await updateWorkItemComment(workItemId, targetComment.commentId, comment.trim());
      } catch (apiErr) {
        console.error(`[Server] Failed to sync comment update to DevOps for #${workItemId}:`, apiErr);
        throw new Error(`Azure DevOps update failed: ${apiErr.message}`);
      }
    }

    // Update locally
    targetComment.comment = comment.trim();
    targetComment.lastUpdated = new Date().toISOString();

    writeDiscussions(localDiscussions);

    res.json(targetComment);
  } catch (error) {
    console.error(`[Server] Error in PATCH comment update for #${workItemId}:`, error);
    res.status(500).json({ error: error.message || "Failed to update comment." });
  }
});

/**
 * DevOps Webhook service hook endpoint.
 */
app.post("/api/webhook/devops", (req, res) => {
  const payload = req.body;
  
  if (!payload || !payload.eventType) {
    return res.status(400).json({ error: "Invalid webhook payload." });
  }

  console.log(`[Webhook] Received Azure DevOps event: ${payload.eventType}`);

  if (payload.eventType === "workitem.commented" || payload.eventType === "workitem.updated") {
    const resource = payload.resource;
    const workItemId = resource.workItemId || resource.id;
    const commentId = resource.id;
    const commentText = resource.text || (resource.fields && resource.fields["System.History"]);

    if (workItemId && commentId && commentText) {
      const cleanText = commentText.replace(/<[^>]*>/g, "").trim();
      const author = resource.createdByKey || (resource.fields && resource.fields["System.ChangedBy"]) || "Azure DevOps User";
      const createdDate = resource.createdDate || new Date().toISOString();

      const localDiscussions = readDiscussions();

      const existingIndex = localDiscussions.findIndex(
        (ld) => ld.workItemId == workItemId && ld.commentId == commentId
      );

      if (existingIndex === -1) {
        localDiscussions.push({
          id: `devops-${commentId}`,
          workItemId: parseInt(workItemId),
          commentId: commentId,
          comment: cleanText,
          author: author,
          source: "Azure DevOps",
          createdDate: createdDate,
          syncStatus: "Synced",
          lastUpdated: createdDate
        });
        writeDiscussions(localDiscussions);
        console.log(`[Webhook] Synchronized new comment #${commentId} for Work Item #${workItemId}`);
      } else {
        const existingComment = localDiscussions[existingIndex];
        if (existingComment.comment !== cleanText) {
          existingComment.comment = cleanText;
          existingComment.lastUpdated = resource.modifiedDate || new Date().toISOString();
          writeDiscussions(localDiscussions);
          console.log(`[Webhook] Updated comment #${commentId} for Work Item #${workItemId} to: "${cleanText}"`);
        } else {
          console.log(`[Webhook] Ignored duplicate comment #${commentId} for Work Item #${workItemId}`);
        }
      }
    }
  }

  res.status(200).json({ success: true });
});

// Helper to update keys in .env file
function updateEnvFile(updates) {
  const envPath = path.join(__dirname, ".env");
  let content = "";
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf-8");
  }

  let lines = content.split(/\r?\n/);
  for (const [key, value] of Object.entries(updates)) {
    let found = false;
    lines = lines.map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith(`${key}=`) || trimmed.startsWith(`${key} `)) {
        found = true;
        // Keep comments or formatting if simple, otherwise replace line
        return `${key}=${value}`;
      }
      return line;
    });

    if (!found) {
      lines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(envPath, lines.join("\n"), "utf-8");
}

app.get("/api/settings", (req, res) => {
  const geminiApiKey = process.env.GEMINI_API_KEY || "";
  const geminiModel = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const devopsOrgUrl = process.env.DEVOPS_ORG_URL || "";
  const devopsPat = process.env.DEVOPS_PAT || "";
  const devopsProject = process.env.DEVOPS_PROJECT || "";
  const devopsWorkItemType = process.env.DEVOPS_WORK_ITEM_TYPE || "Task";

  res.json({
    geminiApiKey,
    geminiModel,
    devopsOrgUrl,
    devopsPat,
    devopsProject,
    devopsWorkItemType
  });
});

app.post("/api/settings", async (req, res) => {
  const {
    geminiApiKey,
    geminiModel,
    devopsOrgUrl,
    devopsPat,
    devopsProject,
    devopsWorkItemType
  } = req.body;

  if (!geminiApiKey) {
    return res.status(400).json({ error: "Gemini API Key is required." });
  }
  if (!geminiModel) {
    return res.status(400).json({ error: "Gemini Model is required." });
  }
  if (!devopsOrgUrl) {
    return res.status(400).json({ error: "DevOps Organization URL is required." });
  }
  if (!devopsPat) {
    return res.status(400).json({ error: "DevOps Personal Access Token (PAT) is required." });
  }
  if (!devopsProject) {
    return res.status(400).json({ error: "DevOps Project Name is required." });
  }
  if (!devopsWorkItemType) {
    return res.status(400).json({ error: "DevOps Work Item Type is required." });
  }

  let targetOrgUrl = devopsOrgUrl.trim();
  if (!targetOrgUrl.startsWith("http://") && !targetOrgUrl.startsWith("https://")) {
    targetOrgUrl = `https://${targetOrgUrl}`;
  }

  try {
    // 1. Connection testing
    // Test Gemini connection using the provided API key and model
    await testGeminiConnection(geminiApiKey, geminiModel);

    // Test DevOps connection using the provided PAT, Org URL and Project name
    await testDevOpsConnection(targetOrgUrl, devopsPat, devopsProject);

    // 2. Save settings to .env file
    updateEnvFile({
      GEMINI_API_KEY: geminiApiKey.trim(),
      GEMINI_MODEL: geminiModel.trim(),
      DEVOPS_ORG_URL: targetOrgUrl,
      DEVOPS_PAT: devopsPat.trim(),
      DEVOPS_PROJECT: devopsProject.trim(),
      DEVOPS_WORK_ITEM_TYPE: devopsWorkItemType.trim()
    });

    // 3. Update active environment variables in process.env so the server uses them immediately
    process.env.GEMINI_API_KEY = geminiApiKey.trim();
    process.env.GEMINI_MODEL = geminiModel.trim();
    process.env.DEVOPS_ORG_URL = targetOrgUrl;
    process.env.DEVOPS_PAT = devopsPat.trim();
    process.env.DEVOPS_PROJECT = devopsProject.trim();
    process.env.DEVOPS_WORK_ITEM_TYPE = devopsWorkItemType.trim();

    res.json({
      success: true,
      message: "Settings saved successfully and connections verified!"
    });
  } catch (error) {
    console.error("[Server] Settings save/test failed:", error);
    res.status(422).json({
      error: error.message || "Failed to verify connection with the new settings."
    });
  }
});

/**
 * Authentication login endpoint.
 */
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !username.trim()) {
    return res.status(400).json({ error: "Username is required." });
  }
  if (!password) {
    return res.status(400).json({ error: "Password is required." });
  }

  // Simple credential validation (allows any username with "admin123" or "password")
  if (password === "admin123" || password === "password") {
    res.json({
      success: true,
      user: {
        username: username.trim(),
        displayName: username.trim(),
        role: "Administrator"
      }
    });
  } else {
    res.status(401).json({ error: "Invalid username or password. (Tip: Use 'admin123' as password)" });
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