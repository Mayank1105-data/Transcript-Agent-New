import { GoogleGenAI } from "@google/genai";

let aiClient = null;
let currentApiKey = null;

function getGeminiModel() {
  const model = process.env.GEMINI_MODEL;
  if (!model) {
    throw new Error("GEMINI_MODEL is not set in environment variables.");
  }
  return model;
}

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in environment variables.");
  }
  if (!aiClient || currentApiKey !== apiKey) {
    aiClient = new GoogleGenAI({ apiKey });
    currentApiKey = apiKey;
  }
  return aiClient;
}

// ── Consolidation System Prompt ─────────────────────────────────────
const SYSTEM_PROMPT_CONSOLIDATE = `You are a senior requirements consolidation engineer with deep expertise in Agile project management.

## Your Task
You are given:
1. An EXISTING Requirement.md — the current state of all project requirements (from prior transcripts)
2. An EXISTING TechnicalDesign.md — the current technical architecture and design
3. A NEW structured requirements document from a fresh transcript/discussion

Your job is to produce updated documents that represent the complete, consolidated state of the project AND generate a concise, specific Agile work item title (Task Title) summarizing the key feature or change discussed in the new transcript.

## Output Format — CRITICAL
Return ONLY valid JSON (no markdown fences, no commentary) matching EXACTLY this schema:

{
  "taskTitle": "Concise, specific Agile work item title summarizing the new feature/change (e.g. 'Implement Leave Balance API & Carry Forward Policy')",
  "consolidatedRequirementMd": "Full consolidated Requirement.md content in Markdown",
  "consolidatedTechnicalDesignMd": "Full consolidated TechnicalDesign.md content in Markdown",
  "changesSummary": {
    "newFeatures": ["List of newly added features"],
    "enhancements": ["List of enhancements to existing features"],
    "requirementChanges": ["List of modified/updated requirements"],
    "technicalChanges": ["List of technical architecture changes"],
    "bugFixes": ["List of bug fixes or corrections"]
  }
}

## Rules — Zero Tolerance
1. **TASK TITLE**: Must be short (5-10 words), actionable, and specifically summarize the new requirement/feature in the latest transcript. Avoid generic titles like "Update" or "Task".
2. **INCLUDE EVERYTHING**: The consolidated Requirement.md must contain ALL existing valid requirements PLUS all newly discussed requirements. Never drop existing items.
3. **MARK NEW ITEMS**: Prefix newly added requirement sections or items with [NEW] so reviewers can see what changed.
4. **MARK UPDATES**: Prefix modified/updated items with [UPDATED] to flag changes from the new transcript.
5. **NEVER OVERWRITE HISTORY**: If the new transcript contradicts an existing requirement, keep BOTH — mark the old one as [SUPERSEDED] and add the new one as [UPDATED].
6. **MAINTAIN STRUCTURE**: Keep the same professional Agile/PRD format with proper headings, user stories, functional requirements, acceptance criteria, etc.
7. **TECHNICAL DESIGN**: Update the TechnicalDesign.md to reflect any new technical implications — new modules, API changes, database schema updates, integration points.
8. **CHANGES SUMMARY**: Accurately categorize all detected changes for the summary. Be specific — reference feature names, not vague descriptions.
9. **NO HALLUCINATION**: Do not invent requirements or changes not present in either the existing documents or the new transcript.

Return ONLY the JSON object.`;

// ── Transcript Summary Prompt ───────────────────────────────────────
const SYSTEM_PROMPT_SUMMARY = `You are a professional meeting summarizer.

## Task
Given a structured requirements document (derived from a transcript), write a concise 3-5 sentence executive summary of what was discussed.

## Rules
- Focus on KEY decisions, features discussed, and action items
- Be specific — mention actual feature names, not generic statements
- Keep it under 5 sentences
- Write in past tense ("The team discussed...", "It was decided that...")
- Return ONLY the plain text summary, no JSON, no markdown fences`;

// ── Change Analysis Prompt ──────────────────────────────────────────
const SYSTEM_PROMPT_ANALYZE_CHANGES = `You are a requirements analyst specializing in change impact analysis.

## Task
Compare an EXISTING Requirement.md with a NEW structured requirements document from a fresh transcript. Identify and categorize all changes.

## Output Format — CRITICAL
Return ONLY valid JSON matching this schema:

{
  "newFeatures": [{"name": "Feature name", "description": "Brief description"}],
  "enhancements": [{"name": "Feature name", "description": "What changed"}],
  "requirementChanges": [{"name": "Requirement", "description": "How it changed"}],
  "technicalChanges": [{"name": "Technical area", "description": "What changed"}],
  "bugFixes": [{"name": "Bug/Issue", "description": "Fix description"}]
}

## Rules
- Be specific — use actual feature/module names from the documents
- Only report REAL changes detected between the two documents
- An empty array is fine if no changes exist in a category
- Do NOT invent changes not supported by the documents

Return ONLY the JSON object.`;

/**
 * Consolidate existing requirements with newly structured transcript data.
 * Produces consolidated Requirement.md, TechnicalDesign.md, and a changes summary.
 *
 * @param {string} existingReqMd - Previous consolidated Requirement.md content
 * @param {string} existingTechMd - Previous consolidated TechnicalDesign.md content
 * @param {string} newStructuredText - New structured requirements (markdown from current transcript)
 * @returns {Promise<{consolidatedReqMd: string, consolidatedTechMd: string, changesSummary: object}>}
 */
export async function consolidateRequirements(existingReqMd, existingTechMd, newStructuredText) {
  if (!newStructuredText) {
    throw new Error("Cannot consolidate without new structured requirements.");
  }

  const model = getGeminiModel();
  console.log(`[requirementConsolidator] Consolidating requirements via Gemini (${model})...`);
  const ai = getAiClient();

  let userMessage = "Consolidate the following documents:\n\n";
  userMessage += "## EXISTING Requirement.md\n\n";
  userMessage += existingReqMd || "(No existing requirements — this is the first version)";
  userMessage += "\n\n---\n\n## EXISTING TechnicalDesign.md\n\n";
  userMessage += existingTechMd || "(No existing technical design — this is the first version)";
  userMessage += "\n\n---\n\n## NEW Structured Requirements (from latest transcript)\n\n";
  userMessage += newStructuredText;

  const response = await ai.models.generateContent({
    model: model,
    contents: userMessage,
    config: {
      systemInstruction: SYSTEM_PROMPT_CONSOLIDATE,
      temperature: 0.2,
      responseMimeType: "application/json"
    }
  });

  if (!response.text) {
    throw new Error("Gemini API returned an empty consolidation response.");
  }

  let cleaned = response.text.trim();
  cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  let data;
  try {
    data = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse consolidation JSON: ${err.message}`);
  }

  console.log(`[requirementConsolidator] Consolidation complete. Changes detected:`,
    `${(data.changesSummary?.newFeatures || []).length} new features,`,
    `${(data.changesSummary?.enhancements || []).length} enhancements,`,
    `${(data.changesSummary?.requirementChanges || []).length} requirement changes`
  );

  return {
    taskTitle: data.taskTitle || "",
    consolidatedReqMd: data.consolidatedRequirementMd || "",
    consolidatedTechMd: data.consolidatedTechnicalDesignMd || "",
    changesSummary: data.changesSummary || {
      newFeatures: [],
      enhancements: [],
      requirementChanges: [],
      technicalChanges: [],
      bugFixes: []
    }
  };
}

/**
 * Generate a concise transcript summary (3-5 sentences).
 * @param {string} structuredText - The structured requirements markdown.
 * @returns {Promise<string>} - Plain text summary.
 */
export async function generateTranscriptSummary(structuredText) {
  if (!structuredText) {
    return "No transcript content available for summarization.";
  }

  const model = getGeminiModel();
  console.log(`[requirementConsolidator] Generating transcript summary via Gemini (${model})...`);
  const ai = getAiClient();

  const response = await ai.models.generateContent({
    model: model,
    contents: `Summarize the following structured requirements document:\n\n${structuredText}`,
    config: {
      systemInstruction: SYSTEM_PROMPT_SUMMARY,
      temperature: 0.3
    }
  });

  if (!response.text) {
    return "Summary generation failed — empty response from AI.";
  }

  return response.text.trim();
}

/**
 * Analyze changes between existing requirements and new transcript requirements.
 * @param {string} existingReqMd - Previous Requirement.md content.
 * @param {string} newStructuredText - New structured requirements markdown.
 * @returns {Promise<object>} - Categorized changes summary.
 */
export async function analyzeTranscriptChanges(existingReqMd, newStructuredText) {
  if (!existingReqMd || !newStructuredText) {
    return {
      newFeatures: [],
      enhancements: [],
      requirementChanges: [],
      technicalChanges: [],
      bugFixes: []
    };
  }

  const model = getGeminiModel();
  console.log(`[requirementConsolidator] Analyzing transcript changes via Gemini (${model})...`);
  const ai = getAiClient();

  const userMessage = `Compare these two documents and identify all changes:\n\n## EXISTING Requirement.md\n\n${existingReqMd}\n\n---\n\n## NEW Structured Requirements\n\n${newStructuredText}`;

  const response = await ai.models.generateContent({
    model: model,
    contents: userMessage,
    config: {
      systemInstruction: SYSTEM_PROMPT_ANALYZE_CHANGES,
      temperature: 0.2,
      responseMimeType: "application/json"
    }
  });

  if (!response.text) {
    return {
      newFeatures: [],
      enhancements: [],
      requirementChanges: [],
      technicalChanges: [],
      bugFixes: []
    };
  }

  let cleaned = response.text.trim();
  cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error(`[requirementConsolidator] Failed to parse changes JSON: ${err.message}`);
    return {
      newFeatures: [],
      enhancements: [],
      requirementChanges: [],
      technicalChanges: [],
      bugFixes: []
    };
  }
}
