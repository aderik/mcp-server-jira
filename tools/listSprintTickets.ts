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
  // Use the new enhanced search API (old /rest/api/3/search is deprecated with 410)
  const issues = await jira.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
    jql,
    maxResults: 100, // Get up to 100 sprint issues
    fields: ["summary", "status", "assignee"],
  });

  const baseHost = (process.env.JIRA_HOST || "").replace(/\/+$/, "");
  const urlPattern = baseHost ? `${baseHost}/browse/{ISSUE_KEY}` : "{issue.self}";
  const lines =
    (issues.issues || [])
      .map((issue: any) =>
        `${issue.key}: ${issue.fields.summary || "No summary"} (${issue.fields.status?.name || "No status"}) [Assignee: ${issue.fields.assignee?.displayName || "Unassigned"}]`
      );
  const text = (lines.length > 0)
    ? `URL pattern: ${urlPattern}\n\n${lines.join("\n")}`
    : "No issues found";
 
  return { content: [{ type: "text", text }], _meta: {} };
}