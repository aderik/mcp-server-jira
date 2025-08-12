import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";

export const listChildIssuesDefinition = {
  name: "list-child-issues",
  description: "Get all child issues of a parent ticket",
  inputSchema: {
    type: "object",
    properties: {
      parentKey: { type: "string" },
    },
    required: ["parentKey"],
  },
};

export async function listChildIssuesHandler(
  jira: Version3Client,
  args: { parentKey: string }
): Promise<McpResponse> {
  const { parentKey } = args;

  const jql = `parent = ${parentKey} ORDER BY created ASC`;
  const issues = await jira.issueSearch.searchForIssuesUsingJql({
    jql,
    fields: ["summary", "status", "assignee", "issuetype"],
  });

  const text =
    (issues.issues || [])
      .map(
        (issue: any) =>
          `${issue.key}: ${issue.fields.summary || "No summary"} (${issue.fields.status?.name || "No status"}) [Type: ${
            issue.fields.issuetype?.name || "Unknown"
          }, Assignee: ${issue.fields.assignee?.displayName || "Unassigned"}]`
      )
      .join("\n") || "No child issues found";

  return { content: [{ type: "text", text }], _meta: {} };
}