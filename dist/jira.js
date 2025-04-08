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
            name: "link-tickets",
            description: "Link two tickets with a 'relates to' relationship",
            inputSchema: {
                type: "object",
                properties: {
                    sourceIssueKey: { type: "string" },
                    targetIssueKey: { type: "string" }
                },
                required: ["sourceIssueKey", "targetIssueKey"]
            }
        },
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
        },
        {
            name: "create-ticket",
            description: "Create a new ticket (regular issue or sub-task)",
            inputSchema: {
                type: "object",
                properties: {
                    projectKey: { type: "string" },
                    summary: { type: "string" },
                    description: { type: "string" },
                    issueType: {
                        type: "string",
                        description: "The name of the issue type (e.g., 'Task', 'Bug', etc.)"
                    },
                    parentKey: {
                        type: "string",
                        description: "Optional parent issue key. If provided, creates a sub-task."
                    }
                },
                required: ["projectKey", "summary"]
            }
        }
    ]
}));
// Function to extract text content from Atlassian Document Format with preserved formatting
function extractTextFromADF(node, depth = 0) {
    if (!node)
        return 'No description';
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
                    .map((content) => content.text || '')
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
                    .map((item) => extractTextFromADF(item, depth))
                    .join('');
            }
            break;
        case 'listItem':
            if (node.content) {
                const itemContent = node.content
                    .map((content) => extractTextFromADF(content, depth + 1))
                    .join('')
                    .trim();
                result += `${indent}• ${itemContent}\n`;
            }
            break;
        default:
            // Handle nested content
            if (Array.isArray(node.content)) {
                result += node.content
                    .map((content) => extractTextFromADF(content, depth))
                    .join('');
            }
            else if (node.text) {
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
                    }],
                _meta: {}
            };
        }
        case "get-ticket-details": {
            const { issueKey } = args;
            const issue = await jira.issues.getIssue({
                issueIdOrKey: issueKey,
                fields: ['summary', 'status', 'assignee', 'description', 'created', 'updated', 'issuelinks', 'comment', 'parent', 'issuetype', 'subtasks']
            });
            const description = extractTextFromADF(issue.fields.description);
            // Format linked issues and subtasks
            const linkedIssues = (issue.fields.issuelinks || []).map(link => {
                if (link.inwardIssue && link.type?.inward) {
                    return `- ${link.type.inward}: ${link.inwardIssue.key} [${link.inwardIssue.fields?.issuetype?.name || 'Unknown type'}] (${link.inwardIssue.fields?.summary || 'No summary'})`;
                }
                else if (link.outwardIssue && link.type?.outward) {
                    return `- ${link.type.outward}: ${link.outwardIssue.key} [${link.outwardIssue.fields?.issuetype?.name || 'Unknown type'}] (${link.outwardIssue.fields?.summary || 'No summary'})`;
                }
                return null;
            }).filter(Boolean).join('\n');
            // Format subtasks
            const subtasks = (issue.fields.subtasks || []).map(subtask => `- Sub-task: ${subtask.key} [${subtask.fields?.issuetype?.name || 'Unknown type'}] (${subtask.fields?.summary || 'No summary'})`).join('\n');
            // Combine linked issues and subtasks
            const relatedIssues = [
                linkedIssues || 'No linked issues',
                subtasks || 'No sub-tasks'
            ].filter(section => section).join('\n\n');
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
                    }
                    else if (comment.body && typeof comment.body === 'object') {
                        // Try to extract text from ADF format
                        body = extractTextFromADF(comment.body);
                    }
                    else {
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
Type: ${issue.fields.issuetype?.name || 'Unknown type'}
Status: ${issue.fields.status?.name || 'No status'}
Assignee: ${issue.fields.assignee?.displayName || 'Unassigned'}
Parent: ${issue.fields.parent ? `${issue.fields.parent.key} (${issue.fields.parent.fields?.issuetype?.name || 'Unknown type'}) - ${issue.fields.parent.fields?.summary || 'No summary'}` : 'No parent'}
Description:
${description}
Related Issues:
${relatedIssues}
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
            const { issueKey, comment } = args;
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
            const { issueKey, description } = args;
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
            const { parentKey } = args;
            // Search for issues that have the specified parent
            const jql = `parent = ${parentKey} ORDER BY created ASC`;
            const issues = await jira.issueSearch.searchForIssuesUsingJql({
                jql,
                fields: ['summary', 'status', 'assignee', 'issuetype']
            });
            return {
                content: [{
                        type: "text",
                        text: (issues.issues || []).map((issue) => `${issue.key}: ${issue.fields.summary || 'No summary'} (${issue.fields.status?.name || 'No status'}) [Type: ${issue.fields.issuetype?.name || 'Unknown'}, Assignee: ${issue.fields.assignee?.displayName || 'Unassigned'}]`).join("\n") || 'No child issues found'
                    }],
                _meta: {}
            };
        }
        case "create-sub-ticket": {
            const { parentKey, summary, description = "", issueType = "Sub-task" } = args;
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
                const subtaskTypes = createMeta.projects?.[0]?.issuetypes?.filter((it) => it.subtask) || [];
                const availableIssueTypes = subtaskTypes.map((it) => it.name);
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
            }
            catch (error) {
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
        case "link-tickets": {
            const { sourceIssueKey, targetIssueKey } = args;
            try {
                // Get all issue link types
                const linkTypes = await jira.issueLinkTypes.getIssueLinkTypes();
                // Find the "relates to" link type
                const relatesTo = linkTypes.issueLinkTypes?.find(linkType => linkType.name?.toLowerCase() === "relates to" ||
                    linkType.inward?.toLowerCase() === "relates to" ||
                    linkType.outward?.toLowerCase() === "relates to");
                if (!relatesTo) {
                    throw new Error("Could not find 'relates to' link type");
                }
                // Create the link between the issues
                await jira.issueLinks.linkIssues({
                    type: {
                        name: relatesTo.name || "Relates"
                    },
                    inwardIssue: {
                        key: targetIssueKey
                    },
                    outwardIssue: {
                        key: sourceIssueKey
                    }
                });
                return {
                    content: [{
                            type: "text",
                            text: `🤖 Successfully linked ${sourceIssueKey} to ${targetIssueKey} with relationship "${relatesTo.name || "Relates"}"`
                        }],
                    _meta: {}
                };
            }
            catch (error) {
                // Only log errors to stderr, not stdout
                console.error(`Error linking tickets: ${error.message}`);
                if (error.response) {
                    console.error(`Response data: ${JSON.stringify(error.response.data)}`);
                }
                return {
                    content: [{
                            type: "text",
                            text: `Error linking tickets: ${error.message}`
                        }],
                    isError: true,
                    _meta: {}
                };
            }
        }
        case "create-ticket": {
            const { projectKey, summary, description = "", issueType = "Task", parentKey } = args;
            try {
                // If parentKey is provided, reuse sub-ticket creation logic
                if (parentKey) {
                    const subTicketArgs = {
                        parentKey,
                        summary,
                        description,
                        issueType
                    };
                    return await handleSubTicketCreation(subTicketArgs);
                }
                // Get available issue types for the project
                const createMeta = await jira.issues.getCreateIssueMeta({
                    projectKeys: [projectKey],
                    expand: "projects.issuetypes"
                });
                const project = createMeta.projects?.[0];
                if (!project) {
                    throw new Error(`Project ${projectKey} not found`);
                }
                // Filter for non-subtask issue types
                const standardTypes = project.issuetypes?.filter((it) => !it.subtask) || [];
                const availableIssueTypes = standardTypes.map((it) => it.name);
                console.error(`Available issue types: ${availableIssueTypes.join(', ')}`);
                // Use the first available type if the requested one doesn't exist
                const finalIssueType = availableIssueTypes.includes(issueType)
                    ? issueType
                    : (availableIssueTypes[0] || "Task");
                console.error(`Using issue type: ${finalIssueType}`);
                // Create the issue
                const createIssuePayload = {
                    fields: {
                        summary: summary,
                        project: {
                            key: projectKey
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
                            text: `🤖 Successfully created ticket ${createdIssue.key} in project ${projectKey}`
                        }],
                    _meta: {}
                };
            }
            catch (error) {
                console.error(`Error creating ticket: ${error.message}`);
                if (error.response) {
                    console.error(`Response data: ${JSON.stringify(error.response.data)}`);
                }
                // Prepare a detailed error message
                let errorDetails = `Error creating ticket: ${error.message}`;
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
// Helper function to handle sub-ticket creation
async function handleSubTicketCreation(args) {
    const { parentKey, summary, description = "", issueType = "Sub-task" } = args;
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
        const subtaskTypes = createMeta.projects?.[0]?.issuetypes?.filter((it) => it.subtask) || [];
        const availableIssueTypes = subtaskTypes.map((it) => it.name);
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
    }
    catch (error) {
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
// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
