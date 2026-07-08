import { GoogleGenAI } from "@google/genai";

let aiClient = null;

function getGeminiModel() {
  const model = process.env.GEMINI_MODEL;
  if (!model) {
    throw new Error("GEMINI_MODEL is not set in environment variables. Please add it to your .env file.");
  }
  return model;
}

function getAiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in environment variables. Please add it to your .env file.");
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

// ── Citation-aware structuring prompt ────────────────────────────────
// The model receives the transcript as a list of numbered/ID'd segments
// (from transcriptionService.js) and must tag every requirement with the
// segment IDs it was derived from. This is what makes each PRD item
// traceable back to an exact timestamp + speaker in the source audio.
export const SYSTEM_PROMPT_STRUCTURE = `You are an expert Agile Business Analyst, Technical Writer, and Requirements Engineer.

## Your Task
Transform a timestamped, speaker-labeled transcript (provided as numbered segments) into a structured agile requirements document, WITH CITATIONS.

## Absolute Rules — Zero Tolerance
1. **ZERO DATA LOSS**: Preserve EVERY functional requirement, technical metric, business rule, threshold, deadline, KPI, persona, edge case, and idea from the transcript.
2. **CITE EVERYTHING**: Every requirement, user story, acceptance criterion, and technical note MUST include a "sourceSegments" array listing the exact segment ID(s) (e.g. "seg_3", "seg_7") it was derived from. If a requirement synthesizes multiple moments, cite all relevant segment IDs.
3. **NO INVENTED CITATIONS**: Only cite segment IDs that were actually provided to you. Never invent a segment ID.
4. **NO HALLUCINATION**: Do not invent requirements or details not present in the transcript.
5. **FIDELITY OVER ELEGANCE**: If forced to choose between a prettier document and preserving/citing a raw detail, always keep and cite the detail.
6. **HIGHLIGHT KEY POINTS**: Within each "text" field, wrap the single most critical fact in that item using Markdown bold syntax (**like this**) — e.g. hard numbers, thresholds, deadlines, dollar amounts, SLAs, named decisions, or explicit constraints stated by the speaker. Bold ONLY the specific word(s)/phrase that carries the critical fact, not the whole sentence. If an item has no standout critical fact, leave it unbolded — do not force it.

## Output Format — CRITICAL
Return ONLY valid JSON (no markdown fences, no commentary) matching EXACTLY this schema:

{
  "title": "One-line summary suitable as a work item title",
  "executiveSummary": "2-3 sentences capturing the core intent.",
  "userStories": [
    { "text": "As a [persona], I want [goal], so that [benefit].", "sourceSegments": ["seg_1"] }
  ],
  "functionalRequirements": [
    { "group": "Feature area name", "text": "Requirement text.", "sourceSegments": ["seg_2","seg_3"] }
  ],
  "nonFunctionalRequirements": [
    { "text": "Performance/security/scalability requirement.", "sourceSegments": ["seg_4"] }
  ],
  "acceptanceCriteria": [
    { "text": "Testable, unambiguous checklist item.", "sourceSegments": ["seg_2"] }
  ],
  "technicalNotes": [
    { "text": "Architecture, API, or integration detail.", "sourceSegments": ["seg_5"] }
  ],
  "openQuestions": [
    { "text": "Something unclear or ambiguous in the audio.", "sourceSegments": ["seg_6"] }
  ]
}

Return ONLY this JSON object.`;

export const SYSTEM_PROMPT_REDO = `You are an expert Agile Business Analyst and Technical Writer performing a revision pass on an existing structured requirements document (JSON with citations).

## Your Task
1. Re-read the current JSON document carefully.
2. Improve clarity, fix awkward phrasing, and enhance professional tone.
3. Reorganize/regroup items if a better logical grouping is apparent.
4. Add any missing acceptance criteria or edge cases you can infer FROM THE EXISTING CITED SEGMENTS ONLY.
5. NEVER drop, remove, or alter any existing functional meaning, data point, or citation.
6. Incorporate specific user instructions/feedback if provided.
7. PRESERVE every "sourceSegments" citation array exactly as it maps to real content — do not invent new segment IDs.
8. PRESERVE and, where appropriate, extend Markdown bold (**like this**) highlighting on the single most critical fact per item (numbers, thresholds, deadlines, SLAs, named decisions). Bold only the key phrase, not the whole sentence.

## Absolute Rules
- ZERO DATA LOSS: Every detail and citation from the input must appear in the output.
- NO HALLUCINATION: Do not invent new requirements or new segment IDs not present in the input.
- Return ONLY valid JSON in the exact same schema as the input (title, executiveSummary, userStories, functionalRequirements, nonFunctionalRequirements, acceptanceCriteria, technicalNotes, openQuestions), each item retaining its "sourceSegments" array. No markdown fences, no commentary.`;

export const SYSTEM_PROMPT_SOLUTION = `You are an expert Software Architect and Technical Lead.

## Your Task
Analyze the provided Agile requirements document (JSON with citations) and write a highly detailed, professional Technical Proposed Solution in Markdown.

## Content to Include
1. **Architecture Overview**: System components, data flow, and technology choices.
2. **Implementation Steps**: Logical phases or sequence of development tasks.
3. **Database & Schema Design**: Key entities, fields, relationships, and index considerations if database changes are needed.
4. **API Design**: Endpoint structures, request/response payloads, and auth mechanisms if integrations or APIs are involved.
5. **Testing Strategy**: Unit, integration, and end-to-end testing focus areas.
6. **Risks & Mitigation**: Technical bottlenecks, security considerations, or performance risks and how to address them.

## Rules
- The output MUST be valid, well-structured Markdown (not JSON — this is a downstream document, not the citation-tracked PRD).
- Focus on practical, industry-standard modern patterns.
- Do not lose or change any requirements details.
- Avoid marketing language; keep it strictly technical and developer-focused.`;

/**
 * Render numbered/ID'd segments into a plain-text block the LLM can read
 * and cite back to, e.g.:
 *   [seg_1 | Speaker 1 | 00:00.000-00:04.200] We need real-time sync...
 */
function renderSegmentsForPrompt(segments) {
  return segments
    .map((s) => `[${s.id} | ${s.speaker} | ${s.start}-${s.end}] ${s.text}`)
    .join("\n");
}

/**
 * Convert timestamped/diarized segments into a structured, citation-tagged
 * requirements document using Google Gemini.
 *
 * @param {Array<{id:string,start:string,end:string,speaker:string,text:string}>} segments
 * @param {string} [systemPromptOverride]
 * @returns {Promise<object>} - Parsed structured JSON with citations.
 */
export async function structureTranscript(segments, systemPromptOverride) {
  if (!segments || segments.length === 0) {
    throw new Error("Cannot structure an empty transcript.");
  }

  const model = getGeminiModel();
  console.log(`[llmProcessor] Structuring transcript (citation-aware) via Google Gemini (${model})...`);
  const ai = getAiClient();

  const segmentBlock = renderSegmentsForPrompt(segments);

  const response = await ai.models.generateContent({
    model: model,
    contents: `Here is the timestamped, speaker-labeled transcript, split into segments. Structure it into a professional agile requirements document, citing the segment ID(s) for every item.\n\n---\n\n${segmentBlock}`,
    config: {
      systemInstruction: systemPromptOverride || SYSTEM_PROMPT_STRUCTURE,
      temperature: 0.2,
      responseMimeType: "application/json"
    }
  });

  if (!response.text) {
    throw new Error("Gemini API returned an empty response.");
  }

  return validateAndParseStructuredJson(response.text, segments);
}

/**
 * Re-generate/refine the structured, citation-tagged requirements document.
 *
 * @param {object} currentStructured - Current structured JSON (with citations).
 * @param {Array} segments - Original segments, used to validate citations still exist.
 * @param {string} [feedback]
 * @param {string} [systemPromptOverride]
 * @returns {Promise<object>} - Revised structured JSON with citations.
 */
export async function redoStructure(currentStructured, segments, feedback = "", systemPromptOverride) {
  if (!currentStructured) {
    throw new Error("Cannot re-do an empty document.");
  }

  const model = getGeminiModel();
  console.log(`[llmProcessor] Redoing structured requirements (citation-aware) via Google Gemini (${model})...`);
  const ai = getAiClient();

  let userMessage = `Here is the current structured requirements JSON (with citations). Re-generate and improve it, preserving all data and citations.\n\n---\n\n${JSON.stringify(currentStructured, null, 2)}`;
  if (feedback && feedback.trim()) {
    userMessage += `\n\nUser specific revision instructions:\n${feedback}`;
  }
  if (segments && segments.length) {
    userMessage += `\n\nValid segment IDs you may cite (do not invent others):\n${segments.map((s) => s.id).join(", ")}`;
  }

  const response = await ai.models.generateContent({
    model: model,
    contents: userMessage,
    config: {
      systemInstruction: systemPromptOverride || SYSTEM_PROMPT_REDO,
      temperature: 0.4,
      responseMimeType: "application/json"
    }
  });

  if (!response.text) {
    throw new Error("Gemini API returned an empty response during re-do.");
  }

  return validateAndParseStructuredJson(response.text, segments || []);
}

/**
 * Generate a technical proposed solution based on the approved,
 * citation-tagged requirements document.
 *
 * @param {object} structuredDoc - Approved structured JSON (with citations).
 * @param {string} [systemPromptOverride]
 * @returns {Promise<string>} - Technical solution markdown (no citations needed here).
 */
export async function generateSolution(structuredDoc, systemPromptOverride) {
  if (!structuredDoc) {
    throw new Error("Cannot generate solution for empty requirements.");
  }

  const model = getGeminiModel();
  console.log(`[llmProcessor] Generating proposed solution via Google Gemini (${model})...`);
  const ai = getAiClient();

  const response = await ai.models.generateContent({
    model: model,
    contents: `Here is the approved requirements document (JSON with citations — citations are for traceability only, ignore them for this task). Generate a comprehensive technical proposed solution.\n\n---\n\n${JSON.stringify(structuredDoc, null, 2)}`,
    config: {
      systemInstruction: systemPromptOverride || SYSTEM_PROMPT_SOLUTION,
      temperature: 0.3
    }
  });

  if (!response.text) {
    throw new Error("Gemini API returned an empty response for technical solution.");
  }

  return response.text.trim();
}

/**
 * Parse the model's JSON response and validate that every cited
 * segment ID actually exists in the original segments. Invalid/invented
 * citations are stripped (not trusted) rather than silently displayed,
 * so the UI never shows a citation that can't be verified against audio.
 */
function validateAndParseStructuredJson(rawText, segments) {
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  let data;
  try {
    data = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse structured JSON from Gemini: ${err.message}`);
  }

  const validIds = new Set((segments || []).map((s) => s.id));
  const sections = [
    "userStories",
    "functionalRequirements",
    "nonFunctionalRequirements",
    "acceptanceCriteria",
    "technicalNotes",
    "openQuestions"
  ];

  for (const section of sections) {
    if (!Array.isArray(data[section])) {
      data[section] = [];
      continue;
    }
    data[section] = data[section].map((item) => {
      const cited = Array.isArray(item.sourceSegments) ? item.sourceSegments : [];
      const verified = validIds.size > 0 ? cited.filter((id) => validIds.has(id)) : cited;
      if (validIds.size > 0 && verified.length < cited.length) {
        console.warn(`[llmProcessor] Dropped ${cited.length - verified.length} invalid citation(s) in "${section}"`);
      }
      return { ...item, sourceSegments: verified };
    });
  }

  data.title = data.title || "Voice Requirements - Auto-generated";
  data.executiveSummary = data.executiveSummary || "";

  return data;
}

export function structuredDocToMarkdown(doc, segments = []) {
  if (!doc) return "";
  
  if (typeof doc === "string") {
    return doc;
  }
  
  // Map segment ID -> clean timestamp (e.g. "00:15.300" -> "00:15")
  const segTimeMap = {};
  if (Array.isArray(segments)) {
    segments.forEach(s => {
      if (s.id && s.start) {
        const cleanTime = s.start.split(".")[0];
        segTimeMap[s.id] = cleanTime;
      }
    });
  }

  const formatCitations = (sourceSegments) => {
    if (Array.isArray(sourceSegments) && sourceSegments.length > 0) {
      const times = sourceSegments.map(id => {
        return segTimeMap[id] || id; // Fallback to segment ID if not found
      });
      return ` (${times.join(", ")})`;
    }
    return "";
  };

  let md = "";

  if (doc.title) {
    md += `# ${doc.title}\n\n`;
  } else {
    md += `# Structured Requirements Document\n\n`;
  }

  if (doc.executiveSummary) {
    md += `## Executive Summary\n${doc.executiveSummary}\n\n`;
  }

  if (Array.isArray(doc.userStories) && doc.userStories.length > 0) {
    md += `## User Stories\n`;
    doc.userStories.forEach((us) => {
      md += `- ${us.text}${formatCitations(us.sourceSegments)}\n`;
    });
    md += `\n`;
  }

  if (Array.isArray(doc.functionalRequirements) && doc.functionalRequirements.length > 0) {
    md += `## Functional Requirements\n`;
    const groups = {};
    doc.functionalRequirements.forEach((fr) => {
      const gName = fr.group || "General Requirements";
      if (!groups[gName]) {
        groups[gName] = [];
      }
      groups[gName].push(fr);
    });

    for (const [groupName, reqs] of Object.entries(groups)) {
      md += `### ${groupName}\n`;
      reqs.forEach((fr) => {
        md += `- ${fr.text}${formatCitations(fr.sourceSegments)}\n`;
      });
      md += `\n`;
    }
  }

  if (Array.isArray(doc.nonFunctionalRequirements) && doc.nonFunctionalRequirements.length > 0) {
    md += `## Non-Functional Requirements\n`;
    doc.nonFunctionalRequirements.forEach((nfr) => {
      md += `- ${nfr.text}${formatCitations(nfr.sourceSegments)}\n`;
    });
    md += `\n`;
  }

  if (Array.isArray(doc.acceptanceCriteria) && doc.acceptanceCriteria.length > 0) {
    md += `## Acceptance Criteria\n`;
    doc.acceptanceCriteria.forEach((ac) => {
      md += `- ${ac.text}${formatCitations(ac.sourceSegments)}\n`;
    });
    md += `\n`;
  }

  if (Array.isArray(doc.technicalNotes) && doc.technicalNotes.length > 0) {
    md += `## Technical Notes\n`;
    doc.technicalNotes.forEach((tn) => {
      md += `- ${tn.text}${formatCitations(tn.sourceSegments)}\n`;
    });
    md += `\n`;
  }

  if (Array.isArray(doc.openQuestions) && doc.openQuestions.length > 0) {
    md += `## Open Questions\n`;
    doc.openQuestions.forEach((oq) => {
      md += `- ${oq.text}${formatCitations(oq.sourceSegments)}\n`;
    });
    md += `\n`;
  }

  return md.trim();
}

/**
 * Test Google Gemini connection and model availability.
 * @param {string} apiKey - Gemini API Key.
 * @param {string} model - Gemini model name.
 */
export async function testGeminiConnection(apiKey, model) {
  const cleanKey = (apiKey || "").trim();
  const cleanModel = (model || "").trim();

  if (!cleanKey) throw new Error("GEMINI_API_KEY is required.");
  if (!cleanModel) throw new Error("GEMINI_MODEL is required.");

  try {
    const client = new GoogleGenAI({ apiKey: cleanKey });
    const response = await client.models.generateContent({
      model: cleanModel,
      contents: "Hello, connection test. Reply with 'OK'.",
      config: { maxOutputTokens: 5 }
    });
    if (!response || !response.text) {
      throw new Error("No response text returned from Gemini API.");
    }
    return true;
  } catch (error) {
    throw new Error(`Gemini connection test failed: ${error.message || error}`);
  }
}