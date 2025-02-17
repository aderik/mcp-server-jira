import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Version3Client, Version3Models } from "jira.js";
import { Issue } from "jira.js/out/version3/models";

const jira = new Version3Client({
  host: process.env.JIRA_HOST!,
  authentication: {
    basic: {
      email: process.env.JIRA_EMAIL!,
      apiToken: process.env.JIRA_API_TOKEN!
    }
  }
});

const server = new Server(
  { name: "jira-server", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list-sprint-tickets",
      description: "Get all tickets in the active sprint",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: { type: "string" }
        },
        required: ["projectKey"]
      }
    },
    {
      name: "get-ticket-details",
      description: "Get detailed information about a specific ticket",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" }
        },
        required: ["issueKey"]
      }
    },
    {
      name: "add-comment",
      description: "Add a comment to a specific ticket",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          comment: { type: "string" }
        },
        required: ["issueKey", "comment"]
      }
    },
    {
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
    }
  ]
}));

// Function to extract text content from Atlassian Document Format with preserved formatting
function extractTextFromADF(node: any, depth: number = 0): string {
  if (!node) return 'No description';

  const indent = '  '.repeat(depth);
  let result = '';

  if (typeof node === 'string') {
    return indent + node;
  }

  // Handle different node types
  switch (node.type) {
    case 'heading':
      result += `${indent}${node.content?.[0]?.text || ''}\n`;
      break;

    case 'paragraph':
      if (node.content) {
        const paragraphText = node.content
          .map((content: any) => content.text || '')
          .join('')
          .trim();
        if (paragraphText) {
          result += `${indent}${paragraphText}\n`;
        }
      }
      break;

    case 'bulletList':
    case 'orderedList':
      if (node.content) {
        result += node.content
          .map((item: any) => extractTextFromADF(item, depth))
          .join('');
      }
      break;

    case 'listItem':
      if (node.content) {
        const itemContent = node.content
          .map((content: any) => extractTextFromADF(content, depth + 1))
          .join('')
          .trim();
        result += `${indent}• ${itemContent}\n`;
      }
      break;

    default:
      // Handle nested content
      if (Array.isArray(node.content)) {
        result += node.content
          .map((content: any) => extractTextFromADF(content, depth))
          .join('');
      } else if (node.text) {
        result += indent + node.text;
      }
  }

  return result;
}

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "list-sprint-tickets": {
      const { projectKey } = args as { projectKey: string };

      // Search for issues in active sprints for the project
      const jql = `project = ${projectKey} AND sprint in openSprints()`;
      const issues = await jira.issueSearch.searchForIssuesUsingJql({
        jql,
        fields: ['summary', 'status', 'assignee']
      });

      return {
        content: [{
          type: "text",
          text: (issues.issues || []).map((issue: Issue) =>
            `${issue.key}: ${issue.fields.summary || 'No summary'} (${issue.fields.status?.name || 'No status'}) [Assignee: ${issue.fields.assignee?.displayName || 'Unassigned'}]`
          ).join("\n") || 'No issues found'
        }]
      };
    }

    case "get-ticket-details": {
      const { issueKey } = args as { issueKey: string };
      const issue = await jira.issues.getIssue({
        issueIdOrKey: issueKey,
        fields: ['summary', 'status', 'assignee', 'description', 'created', 'updated']
      }) as Issue;

      const description = extractTextFromADF(issue.fields.description);

      return {
        content: [{
          type: "text",
          text: `
Key: ${issue.key}
Title: ${issue.fields.summary || 'No summary'}
Status: ${issue.fields.status?.name || 'No status'}
Assignee: ${issue.fields.assignee?.displayName || 'Unassigned'}
Description:
${description}
Created: ${issue.fields.created || 'Unknown'}
Updated: ${issue.fields.updated || 'Unknown'}
`.trim()
        }]
      };
    }

    case "add-comment": {
      const { issueKey, comment } = args as { issueKey: string; comment: string };

      await jira.issueComments.addComment({
        issueIdOrKey: issueKey,
        comment,
      });

      return {
        content: [{
          type: "text",
          text: `Successfully added comment to ${issueKey}`
        }]
      };
    }

    case "update-description": {
      const { issueKey, description } = args as { issueKey: string; description: string };

      await jira.issues.editIssue({
        issueIdOrKey: issueKey,
        fields: {
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: description
                  }
                ]
              }
            ]
          }
        }
      });

      return {
        content: [{
          type: "text",
          text: `Successfully updated description of ${issueKey}`
        }]
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
