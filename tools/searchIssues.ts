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
    // Note: The new Jira enhanced search API requires bounded queries (no unbounded ORDER BY)
    // If no filters provided, we'll search across all projects with a reasonable time window
    if (jqlParts.length > 0) {
      jql = `${jqlParts.join(" AND ")} ORDER BY updated DESC`;
    } else {
      // Default: show recently updated items from last 30 days to avoid unbounded query error
      jql = "updated >= -30d ORDER BY updated DESC";
    }
  }

  console.error(`Executing JQL query: ${jql}`);

  try {
    // Use the new enhanced search API (old /rest/api/3/search is deprecated with 410)
    const issues = await jira.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
      jql,
      maxResults: validatedMaxResults,
      fields: ["summary", "status", "issuetype", "assignee", "updated", "statusCategory"],
    });
 
    const baseHost = (process.env.JIRA_HOST || "").replace(/\/+$/, "");
    const urlPattern = baseHost ? `${baseHost}/browse/{ISSUE_KEY}` : "{issue.self}";
    const formattedIssues = (issues.issues || []).map((issue: any) => {
      const statusCat = issue.fields.status?.statusCategory?.name || "Unknown";
      const updated = issue.fields.updated ? new Date(issue.fields.updated).toLocaleString() : "Unknown";
      return `${issue.key}: ${issue.fields.summary || "No summary"} [${issue.fields.issuetype?.name || "Unknown type"}, ${issue.fields.status?.name || "No status"} (${statusCat}), Assignee: ${issue.fields.assignee?.displayName || "Unassigned"}, Updated: ${updated}]`;
    });

    const resultCount = issues.issues?.length || 0;
    const hasMore = !!issues.nextPageToken;

    const paginationInfo = resultCount > 0 
      ? `Showing ${resultCount} result(s)${hasMore ? ' (more available)' : ''}`
      : `No results found`;

    let navigationHints = "";
    if (hasMore) {
      navigationHints += `\nNote: More results available. The new Jira API uses token-based pagination which is not yet fully supported in this MCP tool.`;
    }

    return {
      content: [
        {
          type: "text",
          text:
            formattedIssues.length > 0
              ? `${paginationInfo}${navigationHints}\n\nURL pattern: ${urlPattern}\n\n${formattedIssues.join("\n")}`
              : "No issues found matching the criteria",
        },
      ],
      _meta: {},
    };
  } catch (error: any) {
    console.error(`Error searching for issues: ${error.message}`);
    if (error.response) {
      console.error(`Response status: ${error.response.status}`);
      console.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
    const errorDetails = error.response?.data 
      ? `\n\nResponse (${error.response.status}): ${JSON.stringify(error.response.data, null, 2)}`
      : '';
    return {
      content: [{ type: "text", text: `Error searching for issues: ${error.message}${errorDetails}` }],
      isError: true,
      _meta: {},
    };
  }
}