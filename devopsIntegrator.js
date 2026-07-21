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

// ── Requirement Management — Parent-Child Hierarchy ─────────────────

/**
 * Helper to get DevOps auth config. Avoids repeating the same boilerplate.
 * @returns {{ orgUrl: string, pat: string, project: string, authHeader: string }}
 */
function getDevOpsConfig() {
  const orgUrl = (process.env.DEVOPS_ORG_URL || "").trim().replace(/\/$/, "");
  const pat = (process.env.DEVOPS_PAT || "").trim();
  const project = (process.env.DEVOPS_PROJECT || "").trim();

  if (!orgUrl || !pat || !project) {
    throw new Error("Azure DevOps credentials are not fully configured.");
  }

  const authHeader = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
  return { orgUrl, pat, project, authHeader };
}

/**
 * Query Azure DevOps for parent requirement work items (Epics) using WIQL.
 * Returns all Epics in the configured project for the parent selector dropdown.
 * @returns {Promise<Array<{id: number, title: string, state: string, createdDate: string}>>}
 */
export async function queryParentWorkItems() {
  const { orgUrl, project, authHeader } = getDevOpsConfig();
  const parentType = (process.env.DEVOPS_PARENT_WORK_ITEM_TYPE || "Epic").trim();

  const wiql = {
    query: `SELECT [System.Id], [System.Title], [System.State], [System.CreatedDate], [System.Description] 
            FROM WorkItems 
            WHERE [System.TeamProject] = '${project}' 
            AND [System.WorkItemType] = '${parentType}' 
            ORDER BY [System.CreatedDate] DESC`
  };

  const wiqlUrl = `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.1`;

  const wiqlResponse = await fetch(wiqlUrl, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(wiql)
  });

  if (!wiqlResponse.ok) {
    const errText = await wiqlResponse.text();
    throw new Error(`WIQL query failed: ${wiqlResponse.status} - ${errText}`);
  }

  const wiqlData = await wiqlResponse.json();
  const workItemIds = (wiqlData.workItems || []).map(wi => wi.id);

  if (workItemIds.length === 0) {
    return [];
  }

  // Batch fetch work item details (max 200 at a time)
  const batchIds = workItemIds.slice(0, 200);
  const detailsUrl = `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${batchIds.join(",")}&fields=System.Id,System.Title,System.State,System.CreatedDate,System.Description&api-version=7.1`;

  const detailsResponse = await fetch(detailsUrl, {
    method: "GET",
    headers: { "Authorization": authHeader }
  });

  if (!detailsResponse.ok) {
    const errText = await detailsResponse.text();
    throw new Error(`Failed to fetch work item details: ${detailsResponse.status} - ${errText}`);
  }

  const detailsData = await detailsResponse.json();
  return (detailsData.value || []).map(wi => ({
    id: wi.id,
    title: wi.fields["System.Title"] || "",
    state: wi.fields["System.State"] || "",
    createdDate: wi.fields["System.CreatedDate"] || "",
    description: wi.fields["System.Description"] || ""
  }));
}

/**
 * Fetch a work item with its relations expanded (child links, attachments).
 * @param {number|string} id - Work Item ID.
 * @returns {Promise<object>} - Full work item JSON with relations.
 */
export async function getWorkItemWithRelations(id) {
  const { orgUrl, project, authHeader } = getDevOpsConfig();

  const url = `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${id}?$expand=relations&api-version=7.1`;

  const response = await fetch(url, {
    method: "GET",
    headers: { "Authorization": authHeader }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch work item ${id} with relations: ${response.status}`);
  }

  return await response.json();
}

/**
 * Download the content of an Azure DevOps attachment as UTF-8 text.
 * @param {string} attachmentUrl - The attachment download URL from the work item relations.
 * @returns {Promise<string>} - Attachment content as text.
 */
export async function getWorkItemAttachmentContent(attachmentUrl) {
  const { authHeader } = getDevOpsConfig();

  const response = await fetch(attachmentUrl, {
    method: "GET",
    headers: { "Authorization": authHeader }
  });

  if (!response.ok) {
    throw new Error(`Failed to download attachment: ${response.status}`);
  }

  return await response.text();
}

/**
 * Create a new Parent (Epic) work item in Azure DevOps with attachments.
 * @param {string} title - Work item title.
 * @param {string} descriptionHtml - HTML description.
 * @param {Array<{url: string, comment: string}>} attachments - Pre-uploaded attachment URLs.
 * @returns {Promise<{id: number, url: string, title: string}>}
 */
export async function createParentWorkItem(title, descriptionHtml, attachments = []) {
  const { orgUrl, project, authHeader } = getDevOpsConfig();
  const parentType = (process.env.DEVOPS_PARENT_WORK_ITEM_TYPE || "Epic").trim();

  const apiUrl = `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/$${encodeURIComponent(parentType)}?api-version=7.1`;

  const payload = [
    { op: "add", path: "/fields/System.Title", value: title.substring(0, 255) },
    { op: "add", path: "/fields/System.Description", value: descriptionHtml },
    { op: "add", path: "/fields/System.Tags", value: "requirement-parent; voice-generated; auto-created" }
  ];

  for (const att of attachments) {
    payload.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "AttachedFile",
        url: att.url,
        attributes: { comment: att.comment || "AI-generated document" }
      }
    });
  }

  const response = await fetch(apiUrl, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json-patch+json",
      "Authorization": authHeader
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to create parent work item: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  const webUrl = `${orgUrl}/${encodeURIComponent(project)}/_workitems/edit/${data.id}`;

  return { id: data.id, url: webUrl, title: title.substring(0, 255) };
}

/**
 * Create a Child (Task) work item linked to a parent Epic.
 * @param {number} parentId - Parent work item ID (Epic).
 * @param {string} title - Child work item title.
 * @param {string} descriptionHtml - HTML description.
 * @param {Array<{url: string, comment: string}>} attachments - Pre-uploaded attachment URLs.
 * @param {number} [version=1] - Version number for tagging.
 * @returns {Promise<{id: number, url: string, title: string, parentId: number}>}
 */
export async function createChildWorkItem(parentId, title, descriptionHtml, attachments = [], version = 1) {
  const { orgUrl, project, authHeader } = getDevOpsConfig();
  const childType = (process.env.DEVOPS_WORK_ITEM_TYPE || "Task").trim();

  const apiUrl = `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/$${encodeURIComponent(childType)}?api-version=7.1`;

  const payload = [
    { op: "add", path: "/fields/System.Title", value: title.substring(0, 255) },
    { op: "add", path: "/fields/System.Description", value: descriptionHtml },
    { op: "add", path: "/fields/System.Tags", value: `requirement-child; voice-generated; auto-created; version-${version}` },
    {
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `${orgUrl}/_apis/wit/workitems/${parentId}`,
        attributes: { comment: "Auto-linked by AI Requirement Management Agent" }
      }
    }
  ];

  for (const att of attachments) {
    payload.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "AttachedFile",
        url: att.url,
        attributes: { comment: att.comment || "AI-generated document" }
      }
    });
  }

  const response = await fetch(apiUrl, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json-patch+json",
      "Authorization": authHeader
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to create child work item: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  const webUrl = `${orgUrl}/${encodeURIComponent(project)}/_workitems/edit/${data.id}`;

  return { id: data.id, url: webUrl, title: title.substring(0, 255), parentId };
}

/**
 * Get all child work items linked to a parent via hierarchy relations.
 * @param {number|string} parentId - Parent work item ID.
 * @returns {Promise<Array<{id: number, title: string, state: string, createdDate: string}>>}
 */
export async function getChildWorkItems(parentId) {
  const { orgUrl, project, authHeader } = getDevOpsConfig();

  // First, get the parent with relations
  const parentItem = await getWorkItemWithRelations(parentId);
  const relations = parentItem.relations || [];

  // Filter for forward hierarchy links (parent → child)
  const childLinks = relations.filter(
    r => r.rel === "System.LinkTypes.Hierarchy-Forward"
  );

  if (childLinks.length === 0) {
    return [];
  }

  // Extract child IDs from the relation URLs
  const childIds = childLinks.map(link => {
    const parts = link.url.split("/");
    return parseInt(parts[parts.length - 1]);
  }).filter(id => !isNaN(id));

  if (childIds.length === 0) {
    return [];
  }

  // Batch fetch child work item details
  const batchIds = childIds.slice(0, 200);
  const detailsUrl = `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${batchIds.join(",")}&fields=System.Id,System.Title,System.State,System.CreatedDate&api-version=7.1`;

  const response = await fetch(detailsUrl, {
    method: "GET",
    headers: { "Authorization": authHeader }
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to fetch child work items: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return (data.value || []).map(wi => ({
    id: wi.id,
    title: wi.fields["System.Title"] || "",
    state: wi.fields["System.State"] || "",
    createdDate: wi.fields["System.CreatedDate"] || ""
  }));
}

/**
 * Update an existing Work Item's System.Description field in Azure DevOps.
 * @param {number|string} workItemId - Work Item ID.
 * @param {string} descriptionHtml - Updated HTML description.
 * @returns {Promise<object>} - Updated work item JSON.
 */
export async function updateWorkItemDescription(workItemId, descriptionHtml) {
  const { orgUrl, project, authHeader } = getDevOpsConfig();

  const url = `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${workItemId}?api-version=7.1`;

  const payload = [
    { op: "add", path: "/fields/System.Description", value: descriptionHtml }
  ];

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json-patch+json",
      "Authorization": authHeader
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to update parent work item description #${workItemId}: ${response.status} - ${errText}`);
  }

  return await response.json();
}