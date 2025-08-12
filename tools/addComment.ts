import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";

export const addCommentDefinition = {
  name: "add-comment",
  description: "Add a comment to a specific ticket",
  inputSchema: {
    type: "object",
    properties: {
      issueKey: { type: "string" },
      comment: { type: "string" },
    },
    required: ["issueKey", "comment"],
  },
};

export async function addCommentHandler(
  jira: Version3Client,
  args: { issueKey: string; comment: string }
): Promise<McpResponse> {
  const { issueKey, comment } = args;

  await jira.issueComments.addComment({
    issueIdOrKey: issueKey,
    comment,
  });

  return {
    content: [
      {
        type: "text",
        text: `Successfully added comment to ${issueKey}`,
      },
    ],
    _meta: {},
  };
}