import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";

export const searchIssuesDefinition = {
  name: "search-issues",
  description:
    "Search for issues with optional filters for project, issue type, and status category, or using a custom JQL query",
  inputSchema: {
    type: "object",
    properties: {
      jql: {
        type: "string",
        description: "Optional custom JQL query. If provided, other filter parameters will be ignored",
      },
      projectKey: {
        type: "string",
        description: "Optional project key to filter issues by project",
      },
      issueType: {
        type: "string",
        description: "Optional issue type to filter issues (e.g., 'Bug', 'Task', 'Story')",
      },
      statusCategory: {
        type: "string",
        description: "Optional status category to filter issues. Must be one of: 'To Do', 'In Progress', 'Done'",
      },
      maxResults: {
        type: "number",
        description: "Optional maximum number of results to return (default: 20, max: 100)",
      },
      startAt: {
        type: "number",
        description: "Optional pagination offset, specifies the index of the first issue to return (0-based, default: 0)",
      },
    },
  },
};

export async function searchIssuesHandler(
  jira: Version3Client,
  args: {
    jql?: string;
    projectKey?: string;
    issueType?: string;
    statusCategory?: string;
    maxResults?: number;
    startAt?: number;
  }
): Promise<McpResponse> {
  const { jql: customJql, projectKey, issueType, statusCategory, maxResults = 20, startAt = 0 } = args || {};

  const validatedMaxResults = Math.min(Math.max(1, maxResults), 100);
  if (validatedMaxResults !== maxResults) {
    console.error(`Adjusted maxResults from ${maxResults} to ${validatedMaxResults} (valid range: 1-100)`);
  }

  const validatedStartAt = Math.max(0, startAt);
  if (validatedStartAt !== startAt) {
    console.error(`Adjusted startAt from ${startAt} to ${validatedStartAt} (must be non-negative)`);
  }

  let jql: string;
  if (customJql) {
    jql = customJql;
    console.error(`Using custom JQL query: ${jql}`);
  } else {
    const jqlParts: string[] = [];
    if (projectKey) jqlParts.push(`project = ${projectKey}`);
    if (issueType) jqlParts.push(`issuetype = "${issueType}"`);
    if (statusCategory) {
      const validStatusCategories = ["To Do", "In Progress", "Done"];
      if (!validStatusCategories.includes(statusCategory)) {
        return {
          content: [{ type: "text", text: `Error: statusCategory must be one of: ${validStatusCategories.join(", ")}` }],
          isError: true,
          _meta: {},
        };
      }
      jqlParts.push(`statusCategory = "${statusCategory}"`);
    }
    jql = jqlParts.length > 0 ? `${jqlParts.join(" AND ")} ORDER BY updated DESC` : "ORDER BY updated DESC";
  }

  console.error(`Executing JQL query: ${jql}`);

  try {
    const issues = await jira.issueSearch.searchForIssuesUsingJql({
      jql,
      maxResults: validatedMaxResults,
      startAt: validatedStartAt,
      fields: ["summary", "status", "issuetype", "assignee", "updated", "statusCategory"],
    });

    const formattedIssues = (issues.issues || []).map((issue: any) => {
      const statusCat = issue.fields.status?.statusCategory?.name || "Unknown";
      const updated = issue.fields.updated ? new Date(issue.fields.updated).toLocaleString() : "Unknown";
      return `${issue.key}: ${issue.fields.summary || "No summary"} [${issue.fields.issuetype?.name || "Unknown type"}, ${
        issue.fields.status?.name || "No status"
      } (${statusCat}), Assignee: ${issue.fields.assignee?.displayName || "Unassigned"}, Updated: ${updated}]`;
    });

    const totalResults = issues.total || 0;
    const startIndex = validatedStartAt + 1;
    const endIndex = Math.min(validatedStartAt + validatedMaxResults, totalResults);

    const paginationInfo = totalResults > 0 ? `Showing results ${startIndex}-${endIndex} of ${totalResults}` : `No results found`;

    let navigationHints = "";
    if (validatedStartAt > 0) {
      const prevStartAt = Math.max(0, validatedStartAt - validatedMaxResults);
      navigationHints += `\nPrevious page: Use startAt=${prevStartAt}`;
    }
    if (endIndex < totalResults) {
      const nextStartAt = validatedStartAt + validatedMaxResults;
      navigationHints += `\nNext page: Use startAt=${nextStartAt}`;
    }

    return {
      content: [
        {
          type: "text",
          text:
            formattedIssues.length > 0
              ? `${paginationInfo}${navigationHints}\n\n${formattedIssues.join("\n")}`
              : "No issues found matching the criteria",
        },
      ],
      _meta: {},
    };
  } catch (error: any) {
    console.error(`Error searching for issues: ${error.message}`);
    if (error.response) {
      console.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
    return {
      content: [{ type: "text", text: `Error searching for issues: ${error.message}` }],
      isError: true,
      _meta: {},
    };
  }
}