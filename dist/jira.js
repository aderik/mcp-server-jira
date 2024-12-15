import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Version3Client } from "jira.js";
const jira = new Version3Client({
    host: process.env.JIRA_HOST,
    authentication: {
        basic: {
            email: process.env.JIRA_EMAIL,
            apiToken: process.env.JIRA_API_TOKEN
        }
    }
});
const server = new Server({ name: "jira-server", version: "1.0.0" }, { capabilities: { tools: {}, resources: {} } });
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
        }
    ]
}));
// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
        case "list-sprint-tickets": {
            const { projectKey } = args;
            // Search for issues in active sprints for the project
            const jql = `project = ${projectKey} AND sprint in openSprints()`;
            const issues = await jira.issueSearch.searchForIssuesUsingJql({
                jql,
                fields: ['summary', 'status', 'assignee']
            });
            return {
                content: [{
                        type: "text",
                        text: (issues.issues || []).map((issue) => `${issue.key}: ${issue.fields.summary || 'No summary'} (${issue.fields.status?.name || 'No status'}) [Assignee: ${issue.fields.assignee?.displayName || 'Unassigned'}]`).join("\n") || 'No issues found'
                    }]
            };
        }
        case "get-ticket-details": {
            const { issueKey } = args;
            const issue = await jira.issues.getIssue({
                issueIdOrKey: issueKey,
                fields: ['summary', 'status', 'assignee', 'description', 'created', 'updated']
            });
            return {
                content: [{
                        type: "text",
                        text: `
Key: ${issue.key}
Title: ${issue.fields.summary || 'No summary'}
Status: ${issue.fields.status?.name || 'No status'}
Assignee: ${issue.fields.assignee?.displayName || 'Unassigned'}
Description: ${issue.fields.description?.toString() || 'No description'}
Created: ${issue.fields.created || 'Unknown'}
Updated: ${issue.fields.updated || 'Unknown'}
`.trim()
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
