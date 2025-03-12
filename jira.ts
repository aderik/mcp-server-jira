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
    },
    {
      name: "list-child-issues",
      description: "Get all child issues of a parent ticket",
      inputSchema: {
        type: "object",
        properties: {
          parentKey: { type: "string" }
        },
        required: ["parentKey"]
      }
    },
    {
      name: "create-sub-ticket",
      description: "Create a sub-ticket (child issue) for a parent ticket",
      inputSchema: {
        type: "object",
        properties: {
          parentKey: { type: "string" },
          summary: { type: "string" },
          description: { type: "string" },
          issueType: { 
            type: "string", 
            description: "The name of the sub-task issue type (e.g., 'Sub-task')" 
          }
        },
        required: ["parentKey", "summary"]
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
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
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
        }],
        _meta: {}
      };
    }

    case "get-ticket-details": {
      const { issueKey } = args as { issueKey: string };
      const issue = await jira.issues.getIssue({
        issueIdOrKey: issueKey,
        fields: ['summary', 'status', 'assignee', 'description', 'created', 'updated', 'issuelinks', 'comment']
      }) as Issue;

      const description = extractTextFromADF(issue.fields.description);

      // Format linked issues
      const linkedIssues = (issue.fields.issuelinks || []).map(link => {
        if (link.inwardIssue && link.type?.inward) {
          return `- ${link.type.inward}: ${link.inwardIssue.key} (${link.inwardIssue.fields?.summary || 'No summary'})`;
        } else if (link.outwardIssue && link.type?.outward) {
          return `- ${link.type.outward}: ${link.outwardIssue.key} (${link.outwardIssue.fields?.summary || 'No summary'})`;
        }
        return null;
      }).filter(Boolean).join('\n');

      // Format comments
      const comments = issue.fields.comment?.comments || [];
      const formattedComments = comments.length > 0 
        ? comments.map(comment => {
            const created = comment.created ? new Date(comment.created).toLocaleString() : 'Unknown date';
            const author = comment.author?.displayName || 'Unknown user';
            
            // Handle comment body which might be in Atlassian Document Format
            let body = '';
            if (typeof comment.body === 'string') {
              body = comment.body;
            } else if (comment.body && typeof comment.body === 'object') {
              // Try to extract text from ADF format
              body = extractTextFromADF(comment.body);
            } else {
              body = 'No content';
            }
            
            return `[${created}] ${author}:\n${body}`;
          }).join('\n\n')
        : 'No comments';

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
Linked Issues:
${linkedIssues || 'No linked issues'}
Created: ${issue.fields.created || 'Unknown'}
Updated: ${issue.fields.updated || 'Unknown'}

Comments:
${formattedComments}
`.trim()
        }],
        _meta: {}
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
        }],
        _meta: {}
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
        }],
        _meta: {}
      };
    }

    case "list-child-issues": {
      const { parentKey } = args as { parentKey: string };

      // Search for issues that have the specified parent
      const jql = `parent = ${parentKey} ORDER BY created ASC`;
      const issues = await jira.issueSearch.searchForIssuesUsingJql({
        jql,
        fields: ['summary', 'status', 'assignee', 'issuetype']
      });

      return {
        content: [{
          type: "text",
          text: (issues.issues || []).map((issue: Issue) =>
            `${issue.key}: ${issue.fields.summary || 'No summary'} (${issue.fields.status?.name || 'No status'}) [Type: ${issue.fields.issuetype?.name || 'Unknown'}, Assignee: ${issue.fields.assignee?.displayName || 'Unassigned'}]`
          ).join("\n") || 'No child issues found'
        }],
        _meta: {}
      };
    }

    case "create-sub-ticket": {
      const { parentKey, summary, description = "", issueType = "Sub-task" } = args as { 
        parentKey: string; 
        summary: string; 
        description?: string;
        issueType?: string;
      };

      try {
        // First, get the parent issue to determine the project
        const parentIssue = await jira.issues.getIssue({
          issueIdOrKey: parentKey,
          fields: ['project', 'issuetype']
        });

        if (!parentIssue || !parentIssue.fields.project) {
          throw new Error(`Parent issue ${parentKey} not found or has no project`);
        }

        console.error(`Creating sub-task for ${parentKey} in project ${parentIssue.fields.project.key}`);
        
        // Get available issue types to verify the requested type exists
        const createMeta = await jira.issues.getCreateIssueMeta({
          projectIds: [parentIssue.fields.project.id],
          expand: "projects.issuetypes"
        });
        
        // Filter for subtask issue types
        const subtaskTypes = createMeta.projects?.[0]?.issuetypes?.filter((it: any) => it.subtask) || [];
        const availableIssueTypes = subtaskTypes.map((it: any) => it.name);
        console.error(`Available subtask types: ${availableIssueTypes.join(', ')}`);
        
        // Use the first available subtask type if the requested one doesn't exist
        const finalIssueType = availableIssueTypes.includes(issueType) 
          ? issueType 
          : (availableIssueTypes[0] || "Sub-task");
        
        console.error(`Using issue type: ${finalIssueType}`);

        // Create the sub-task
        const createIssuePayload = {
          fields: {
            summary: summary,
            parent: {
              key: parentKey
            },
            project: {
              id: parentIssue.fields.project.id
            },
            issuetype: {
              name: finalIssueType
            },
            description: description ? {
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
            } : undefined
          }
        };
        
        console.error(`Create issue payload: ${JSON.stringify(createIssuePayload)}`);
        
        const createdIssue = await jira.issues.createIssue(createIssuePayload);

        return {
          content: [{
            type: "text",
            text: `🤖 Successfully created sub-ticket ${createdIssue.key} for parent ${parentKey}`
          }],
          _meta: {}
        };
      } catch (error: any) {
        console.error(`Error creating sub-ticket: ${error.message}`);
        if (error.response) {
          console.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
        
        // Prepare a detailed error message
        let errorDetails = `Error creating sub-ticket: ${error.message}`;
        
        if (error.response && error.response.data) {
          const responseData = typeof error.response.data === 'object' 
            ? JSON.stringify(error.response.data, null, 2) 
            : error.response.data.toString();
          
          errorDetails += `\n\nResponse data:\n${responseData}`;
        }
        
        return {
          content: [{
            type: "text",
            text: errorDetails
          }],
          isError: true,
          _meta: {}
        };
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
