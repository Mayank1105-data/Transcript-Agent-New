import { marked } from "marked";

/**
 * Extract the first H1 or first non-empty text line as the ticket title.
 * @param {string} text - Requirements text.
 * @returns {string} - Extracted title.
 */
function extractTitle(text) {
  if (!text) return "Voice Requirements - Auto-generated";
  const lines = text.split("\n");
  for (const line of lines) {
    const s = line.trim();
    if (s.startsWith("# ")) {
      return s.slice(2).trim().substring(0, 255);
    } else if (s && !s.startsWith("#")) {
      return s.substring(0, 255);
    }
  }
  return "Voice Requirements - Auto-generated";
}

/**
 * Uploads a file attachment to Azure DevOps.
 * @param {string} content - Raw content of the attachment.
 * @param {string} fileName - File name for the attachment.
 * @returns {Promise<string>} - The attachment URL.
 */
export async function uploadAttachment(content, fileName) {
  const orgUrl = (process.env.DEVOPS_ORG_URL || "").trim().replace(/\/$/, "");
  const pat = (process.env.DEVOPS_PAT || "").trim();
  const project = (process.env.DEVOPS_PROJECT || "").trim();

  const authHeader = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
  const url = `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&api-version=7.1`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Authorization": authHeader
    },
    body: content
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to upload attachment: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  return data.url;
}

/**
 * Creates a work item in Azure DevOps using the REST API v7.1.
 * @param {string} structuredText - Structured Agile requirements in Markdown.
 * @param {string|null} attachmentUrl - Optional attachment URL.
 * @returns {Promise<{id: number, url: string, title: string}>} - Created work item.
 */
export async function createWorkItem(structuredText, attachmentUrl = null) {
  const orgUrl = (process.env.DEVOPS_ORG_URL || "").trim().replace(/\/$/, "");
  const pat = (process.env.DEVOPS_PAT || "").trim();
  const project = (process.env.DEVOPS_PROJECT || "").trim();
  const workItemType = (process.env.DEVOPS_WORK_ITEM_TYPE || "User Story").trim();

  const missing = [];
  if (!orgUrl) missing.push("DEVOPS_ORG_URL");
  if (!pat) missing.push("DEVOPS_PAT");
  if (!project) missing.push("DEVOPS_PROJECT");
  if (missing.length > 0) {
    throw new Error(`Missing Azure DevOps config: ${missing.join(", ")}`);
  }

  const title = extractTitle(structuredText);
  // Parse markdown into HTML for the Description field
  const descHtml = await marked.parse(structuredText);

  // Endpoint: Organization/Project/_apis/wit/workitems/$WorkItemType?api-version=7.1
  const url = `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/$${encodeURIComponent(workItemType)}?api-version=7.1`;

  const authHeader = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
  const payload = [
    { op: "add", path: "/fields/System.Title", value: title },
    { op: "add", path: "/fields/System.Description", value: descHtml },
    { op: "add", path: "/fields/System.Tags", value: "voice-generated; auto-created" }
  ];

  if (attachmentUrl) {
    payload.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "AttachedFile",
        url: attachmentUrl,
        attributes: {
          comment: "AI-generated technical proposed solution"
        }
      }
    });
  }

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json-patch+json",
      "Authorization": authHeader
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`DevOps API returned ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const wid = data.id;
  const webUrl = `${orgUrl}/${encodeURIComponent(project)}/_workitems/edit/${wid}`;

  return {
    id: wid,
    url: webUrl,
    title: title
  };
}