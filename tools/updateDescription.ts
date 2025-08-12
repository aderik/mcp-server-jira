import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
import { buildADF } from "../utils.js";

export const updateDescriptionDefinition = {
  name: "update-description",
  description: "Update the description of a specific ticket",
  inputSchema: {
    type: "object",
    properties: {
      issueKey: { type: "string" },
      description: { type: "string" }
    },
    required: ["issueKey", "description"]
  }
};

export async function updateDescriptionHandler(
  jira: Version3Client,
  args: { issueKey: string; description: string }
): Promise<McpResponse> {
  const { issueKey, description } = args;

  await jira.issues.editIssue({
    issueIdOrKey: issueKey,
    fields: {
      description: buildADF(description)
    }
  });

  return {
    content: [{ type: "text", text: `Successfully updated description of ${issueKey}` }],
    _meta: {}
  };
}