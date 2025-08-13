import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
import { respond, validateArray, withJiraError } from "../utils.js";

export const addLabelsDefinition = {
  name: "add-labels",
  description: "Add labels to multiple issues without replacing existing ones",
  inputSchema: {
    type: "object",
    properties: {
      issueKeys: {
        type: "array",
        items: { type: "string" },
        description: "List of issue keys to add labels to"
      },
      labels: {
        type: "array",
        items: { type: "string" },
        description: "List of labels to add to the issues"
      }
    },
    required: ["issueKeys", "labels"]
  }
};

export async function addLabelsHandler(
  jira: Version3Client,
  args: { issueKeys: string[]; labels: string[] }
): Promise<McpResponse> {
  const { issueKeys, labels } = args;

  const issuesErr = validateArray("issueKeys", issueKeys);
  if (issuesErr) return respond(issuesErr.replace("array", "array of issue keys"));
  const labelsErr = validateArray("labels", labels);
  if (labelsErr) return respond(labelsErr.replace("array", "array of label strings"));

  return withJiraError(async () => {
    const results: string[] = [];
    const errors: string[] = [];

    for (const issueKey of issueKeys) {
      try {
        const issue = await jira.issues.getIssue({ issueIdOrKey: issueKey, fields: ["labels"] });
        const existing = Array.isArray(issue.fields.labels) ? issue.fields.labels : [];
        const combined = [...new Set([...existing, ...labels])];

        await jira.issues.editIssue({
          issueIdOrKey: issueKey,
          fields: { labels: combined },
        });

        results.push(`${issueKey}: labels => [${combined.join(", ")}]`);
      } catch (e: any) {
        errors.push(`${issueKey}: ${e?.message ?? String(e)}`);
      }
    }

    let msg = "";
    if (results.length > 0) {
      msg += `Updated ${results.length} of ${issueKeys.length} issues.\n` + results.join("\n");
    }
    if (errors.length > 0) {
      if (msg) msg += "\n\n";
      msg += `Failed ${errors.length} issues:\n` + errors.join("\n");
    }

    const response = respond(msg || "No issues processed.");
    if (errors.length === issueKeys.length) response.isError = true;
    return response;
  }, "Error adding labels");
}