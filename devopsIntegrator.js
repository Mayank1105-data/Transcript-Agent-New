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

/**
 * Test credentials and access to Azure DevOps Project.
 * @param {string} orgUrl - DevOps Organization URL.
 * @param {string} pat - Personal Access Token.
 * @param {string} project - DevOps Project name.
 */
export async function testDevOpsConnection(orgUrl, pat, project) {
  const cleanOrg = orgUrl.trim().replace(/\/$/, "");
  const cleanProject = project.trim();
  const cleanPat = pat.trim();

  if (!cleanOrg) throw new Error("Organization URL is required.");
  if (!cleanPat) throw new Error("Personal Access Token (PAT) is required.");
  if (!cleanProject) throw new Error("Project name is required.");

  const authHeader = `Basic ${Buffer.from(`:${cleanPat}`).toString("base64")}`;
  const url = `${cleanOrg}/_apis/projects/${encodeURIComponent(cleanProject)}?api-version=7.1`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": authHeader
    }
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`DevOps connection test failed: API returned status ${response.status} (${response.statusText})`);
  }

  return true;
}

/**
 * Fetches comments for a specific DevOps Work Item.
 * @param {number|string} workItemId - DevOps Work Item ID.
 */
export async function getWorkItemComments(workItemId) {
  const orgUrl = (process.env.DEVOPS_ORG_URL || "").trim().replace(/\/$/, "");
  const pat = (process.env.DEVOPS_PAT || "").trim();
  const project = (process.env.DEVOPS_PROJECT || "").trim();

  if (!orgUrl || !pat || !project) {
    throw new Error("Azure DevOps credentials are not fully configured.");
  }

  const authHeader = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
  const url = `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${workItemId}/comments?api-version=7.1-preview.3`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": authHeader
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to fetch DevOps comments: ${response.statusText} - ${errText}`);
  }

  const data = await response.json();
  return data.comments || [];
}

/**
 * Posts a comment to a DevOps Work Item.
 * @param {number|string} workItemId - DevOps Work Item ID.
 * @param {string} text - Comment text.
 */
export async function postWorkItemComment(workItemId, text) {
  const orgUrl = (process.env.DEVOPS_ORG_URL || "").trim().replace(/\/$/, "");
  const pat = (process.env.DEVOPS_PAT || "").trim();
  const project = (process.env.DEVOPS_PROJECT || "").trim();

  if (!orgUrl || !pat || !project) {
    throw new Error("Azure DevOps credentials are not fully configured.");
  }

  const authHeader = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
  const url = `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${workItemId}/comments?api-version=7.1-preview.3`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to post DevOps comment: ${response.statusText} - ${errText}`);
  }

  return await response.json();
}

/**
 * Updates an existing comment on a DevOps Work Item.
 * @param {number|string} workItemId - DevOps Work Item ID.
 * @param {number|string} commentId - DevOps Comment ID.
 * @param {string} text - Updated comment text.
 */
export async function updateWorkItemComment(workItemId, commentId, text) {
  const orgUrl = (process.env.DEVOPS_ORG_URL || "").trim().replace(/\/$/, "");
  const pat = (process.env.DEVOPS_PAT || "").trim();
  const project = (process.env.DEVOPS_PROJECT || "").trim();

  if (!orgUrl || !pat || !project) {
    throw new Error("Azure DevOps credentials are not fully configured.");
  }

  const authHeader = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
  const url = `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${workItemId}/comments/${commentId}?api-version=7.1-preview.3`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to update DevOps comment: ${response.statusText} - ${errText}`);
  }

  return await response.json();
}

/**
 * Fetches a work item's current fields (title, description, state) from Azure DevOps.
 * @param {number|string} id - DevOps Work Item ID.
 */
export async function getWorkItem(id) {
  const orgUrl = (process.env.DEVOPS_ORG_URL || "").trim().replace(/\/$/, "");
  const pat = (process.env.DEVOPS_PAT || "").trim();
  const project = (process.env.DEVOPS_PROJECT || "").trim();

  if (!orgUrl || !pat || !project) {
    throw new Error("Azure DevOps credentials are not fully configured.");
  }

  const authHeader = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
  const url = `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${id}?api-version=7.1`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": authHeader
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch work item ${id}: ${response.status}`);
  }

  return await response.json();
}