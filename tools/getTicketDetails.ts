import { Version3Client } from "jira.js";
import type { Issue } from "jira.js/out/version3/models";
import type { McpResponse } from "../utils.js";

export const getTicketDetailsDefinition = {
  name: "get-ticket-details",
  description: "Get detailed information about a specific ticket",
  inputSchema: {
    type: "object",
    properties: {
      issueKey: { type: "string" },
    },
    required: ["issueKey"],
  },
};

// Local helpers copied to avoid tight coupling with jira.ts internals
function extractTextFromADF(node: any, depth: number = 0): string {
  if (!node) return "No description";

  const indent = "  ".repeat(depth);
  let result = "";

  if (typeof node === "string") {
    return indent + node;
  }

  switch (node.type) {
    case "heading":
      result += `${indent}${node.content?.[0]?.text || ""}\n`;
      break;

    case "paragraph":
      if (node.content) {
        const paragraphText = node.content
          .map((content: any) => content.text || "")
          .join("")
          .trim();
        if (paragraphText) {
          result += `${indent}${paragraphText}\n`;
        }
      }
      break;

    case "bulletList":
    case "orderedList":
      if (node.content) {
        result += node.content.map((item: any) => extractTextFromADF(item, depth)).join("");
      }
      break;

    case "listItem":
      if (node.content) {
        const itemContent = node.content
          .map((content: any) => extractTextFromADF(content, depth + 1))
          .join("")
          .trim();
        result += `${indent}• ${itemContent}\n`;
      }
      break;

    default:
      if (Array.isArray(node.content)) {
        result += node.content.map((content: any) => extractTextFromADF(content, depth)).join("");
      } else if (node.text) {
        result += indent + node.text;
      }
  }

  return result;
}

function formatFieldValue(value: any): string {
  if (value === null || value === undefined) {
    return "Not set";
  }

  if (typeof value === "object") {
    if ((value as any).type === "doc") {
      return extractTextFromADF(value);
    }
    if ((value as any).displayName) {
      return (value as any).displayName;
    }
    if (Array.isArray(value)) {
      return value.map((item) => formatFieldValue(item)).join(", ");
    }
    return JSON.stringify(value);
  }

  return String(value);
}

function hasMeaningfulValue(value: any): boolean {
  if (value === null || value === undefined) return false;

  const t = typeof value;
  if (t === "string") return value.trim().length > 0;
  if (t === "number" || t === "boolean") return true;

  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulValue(item));
  }

  if (t === "object") {
    if ((value as any).type === "doc") {
      const text = extractTextFromADF(value).trim();
      return text.length > 0;
    }

    const candidateKeys = ["value", "displayName", "name", "id", "text"];
    for (const key of candidateKeys) {
      if (hasMeaningfulValue((value as any)[key])) return true;
    }

    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key) && hasMeaningfulValue((value as any)[key])) {
        return true;
      }
    }
    return false;
  }

  return false;
}

export async function getTicketDetailsHandler(
  jira: Version3Client,
  customFieldsMap: Map<string, string>,
  args: { issueKey: string }
): Promise<McpResponse> {
  const { issueKey } = args;

  const standardFields = [
    "summary",
    "status",
    "assignee",
    "description",
    "created",
    "updated",
    "issuelinks",
    "comment",
    "parent",
    "issuetype",
    "subtasks",
    "labels",
  ];

  const fieldsToFetch = [...standardFields, ...Array.from(customFieldsMap.values())];

  const issue = (await jira.issues.getIssue({
    issueIdOrKey: issueKey,
    fields: fieldsToFetch,
  })) as Issue;

  const description = extractTextFromADF(issue.fields.description);

  const linkedIssues = (issue.fields.issuelinks || [])
    .map((link) => {
      const relatedIssue = (link as any).inwardIssue || (link as any).outwardIssue;
      if (!relatedIssue) return null;
      return `${relatedIssue.key} ${relatedIssue.fields?.summary || "No summary"} [${relatedIssue.fields?.issuetype?.name || "Unknown type"}, ${relatedIssue.fields?.status?.name || "Unknown status"}]`;
    })
    .filter(Boolean)
    .join("\n");

  const subtasks = (issue.fields.subtasks || [])
    .map(
      (subtask) =>
        `${subtask.key} ${subtask.fields?.summary || "No summary"} [${subtask.fields?.issuetype?.name || "Unknown type"}, ${subtask.fields?.status?.name || "Unknown status"}]`
    )
    .join("\n");

  const relatedIssues = [linkedIssues || "No linked issues", subtasks || "No sub-tasks"]
    .filter((section) => section)
    .join("\n\n");

  const comments = (issue.fields as any).comment?.comments || [];
  const formattedComments =
    comments.length > 0
      ? comments
          .map((comment: any) => {
            const created = comment.created ? new Date(comment.created).toLocaleString() : "Unknown date";
            const author = comment.author?.displayName || "Unknown user";
            let body = "";
            if (typeof comment.body === "string") {
              body = comment.body;
            } else if (comment.body && typeof comment.body === "object") {
              body = extractTextFromADF(comment.body);
            } else {
              body = "No content";
            }
            return `[${created}] ${author}:\n${body}`;
          })
          .join("\n\n")
      : "No comments";

  const customFieldsData: Record<string, string> = {};
  for (const [fieldName, fieldId] of customFieldsMap.entries()) {
    const raw = (issue.fields as any)[fieldId];
    if (hasMeaningfulValue(raw)) {
      customFieldsData[fieldName] = formatFieldValue(raw);
    }
  }

  const customFieldsSection =
    Object.keys(customFieldsData).length > 0
      ? `Custom Fields:
${Object.entries(customFieldsData)
  .map(([name, value]) => `${name}: ${value}`)
  .join("\n")}`
      : "";

  return {
    content: [
      {
        type: "text",
        text: `
Key: ${issue.key}
Title: ${issue.fields.summary || "No summary"}
Type: ${issue.fields.issuetype?.name || "Unknown type"}
Status: ${issue.fields.status?.name || "No status"}
Assignee: ${issue.fields.assignee?.displayName || "Unassigned"}
Labels: ${
          Array.isArray(issue.fields.labels) && issue.fields.labels.length > 0
            ? issue.fields.labels.join(", ")
            : "No labels"
        }
Parent: ${
          (issue.fields as any).parent
            ? `${(issue.fields as any).parent.key} (${
                (issue.fields as any).parent.fields?.issuetype?.name || "Unknown type"
              }) - ${(issue.fields as any).parent.fields?.summary || "No summary"}`
            : "No parent"
        }
Description:
${description}
Related Issues:
${relatedIssues}
Created: ${issue.fields.created || "Unknown"}
Updated: ${issue.fields.updated || "Unknown"}

${customFieldsSection}

Comments:
${formattedComments}
`.trim(),
      },
    ],
    _meta: {},
  };
}