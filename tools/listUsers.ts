import { Version3Client, Version3Models } from "jira.js";
import type { McpResponse } from "../utils.js";

export const listUsersDefinition = {
  name: "list-users",
  description: "List all users in Jira with their account ID, email, and display name",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Optional search string to filter users (uses Jira user search).",
      },
      maxResults: {
        type: "number",
        description: "Optional maximum number of results to return (default: 50, max: 1000)",
      },
    },
  },
};

export async function listUsersHandler(
  jira: Version3Client,
  args: { query?: string; maxResults?: number } = {}
): Promise<McpResponse> {
  const { maxResults = 50, query } = args;
  const validatedMaxResults = Math.min(Math.max(1, maxResults), 1000);

  try {
    const results: Version3Models.User[] = [];
    let startAt = 0;

    while (results.length < validatedMaxResults) {
      const pageMax = Math.min(100, validatedMaxResults - results.length);
      if (pageMax <= 0) {
        break;
      }

      const trimmedQuery = query?.trim();
      const searchParams: { query?: string; startAt: number; maxResults: number } = {
        startAt,
        maxResults: pageMax,
        query: trimmedQuery || "", // Empty string returns all users
      };

      const usersPage = (await jira.userSearch.findUsers(searchParams)) as Version3Models.User[];

      if (!usersPage || usersPage.length === 0) {
        break;
      }

      results.push(...usersPage);
      if (usersPage.length < pageMax) {
        break;
      }

      startAt += usersPage.length;
    }

    if (results.length === 0) {
      return { content: [{ type: "text", text: "No users found." }], _meta: {} };
    }

    const filteredUsers = results.filter((user) => {
      return user.active !== false; // Include active users (accountType filter removed for broader compatibility)
    });

    const formattedUsers = filteredUsers
      .map(
        (user) =>
          `Account ID: ${user.accountId}\nDisplay Name: ${user.displayName || "N/A"}\nEmail: ${user.emailAddress || "N/A"}`
      )
      .join("\n\n---\n\n");

    return {
      content: [
        {
          type: "text",
          text: `Active Atlassian users found: ${filteredUsers.length} (filtered from ${results.length} total)\n\n${formattedUsers}`,
        },
      ],
      _meta: {},
    };
  } catch (error: any) {
    console.error(`Error fetching users: ${error.message}`);
    return {
      content: [{ type: "text", text: `Error fetching users: ${error.message}` }],
      isError: true,
      _meta: {},
    };
  }
}