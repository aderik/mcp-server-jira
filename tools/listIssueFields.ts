import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";

export const listIssueFieldsDefinition = {
  name: "list-issue-fields",
  description: "List all available issue fields in Jira, including custom fields",
  inputSchema: {
    type: "object",
    properties: {
      includeCustomOnly: {
        type: "boolean",
        description: "Optional. If true, only custom fields will be returned. Default: false",
      },
    },
  },
};

export async function listIssueFieldsHandler(
  jira: Version3Client,
  customFieldsMap: Map<string, string>,
  args: { includeCustomOnly?: boolean }
): Promise<McpResponse> {
  const { includeCustomOnly = false } = args || {};

  try {
    const fieldsResponse = await jira.issueFields.getFields();

    const filteredFields = includeCustomOnly ? fieldsResponse.filter((field: any) => field.custom) : fieldsResponse;

    const formattedFields = filteredFields.map((field: any) => {
      const isConfigured = field.name ? customFieldsMap.has(field.name) : false;
      return {
        id: field.id || "",
        name: field.name || "Unnamed Field",
        custom: field.custom || false,
        configuredForAutoFetch: isConfigured,
        description: field.schema?.type ? `Type: ${field.schema.type}` : "No description available",
      };
    });

    const standardFields = formattedFields.filter((field: any) => !field.custom);
    const customFields = formattedFields.filter((field: any) => field.custom);

    let responseText = "";

    if (!includeCustomOnly && standardFields.length > 0) {
      responseText += `Standard Fields (${standardFields.length}):\n`;
      responseText += standardFields.map((field: any) => `${field.name} (${field.id}): ${field.description}`).join("\n");
    }

    if (customFields.length > 0) {
      if (responseText) responseText += "\n\n";
      responseText += `Custom Fields (${customFields.length}):\n`;
      responseText += customFields
        .map((field: any) => {
          const configuredMark = field.configuredForAutoFetch ? " ✓" : "";
          return `${field.name}${configuredMark} (${field.id}): ${field.description}`;
        })
        .join("\n");

      responseText += "\n\n✓ = Configured for automatic fetching with issue details";
    }

    if (!responseText) {
      responseText = "No fields found";
    }

    return {
      content: [{ type: "text", text: responseText }],
      _meta: {},
    };
  } catch (error: any) {
    console.error(`Error listing issue fields: ${error.message}`);
    if (error.response) {
      console.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }

    return {
      content: [{ type: "text", text: `Error listing issue fields: ${error.message}` }],
      isError: true,
      _meta: {},
    };
  }
}