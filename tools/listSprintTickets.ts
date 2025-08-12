import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";

export const listSprintTicketsDefinition = {
  name: "list-sprint-tickets",
  description: "Get all tickets in the active sprint",
  inputSchema: {
    type: "object",
    properties: {
      projectKey: { type: "string" },
    },
    required: ["projectKey"],
  },
};

export async function listSprintTicketsHandler(
  jira: Version3Client,
  args: { projectKey: string }
): Promise<McpResponse> {
  const { projectKey } = args;

  const jql = `project = ${projectKey} AND sprint in openSprints()`;
  const issues = await jira.issueSearch.searchForIssuesUsingJql({
    jql,
    fields: ["summary", "status", "assignee"],
  });

  const text =
    (issues.issues || [])
      .map(
        (issue: any) =>
          `${issue.key}: ${issue.fields.summary || "No summary"} (${issue.fields.status?.name || "No status"}) [Assignee: ${
            issue.fields.assignee?.displayName || "Unassigned"
          }]`
      )
      .join("\n") || "No issues found";

  return { content: [{ type: "text", text }], _meta: {} };
}