import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Version3Client } from "jira.js";
// Custom fields configuration - read from environment variable
const customFields = process.env.JIRA_CUSTOM_FIELDS
    ? process.env.JIRA_CUSTOM_FIELDS.split(',').map(field => field.trim())
    : [];
// Map to store custom field information (name to ID mapping)
const customFieldsMap = new Map();
const jira = new Version3Client({
    host: process.env.JIRA_HOST,
    authentication: {
        basic: {
            email: process.env.JIRA_EMAIL,
            apiToken: process.env.JIRA_API_TOKEN
        }
    }
});
// Initialize custom fields mapping
async function initializeCustomFields() {
    try {
        // Fetch all fields from Jira
        const fieldsResponse = await jira.issueFields.getFields();
        // First, map all custom fields automatically
        const allCustomFields = fieldsResponse.filter(f => f.custom && f.name && f.id);
        for (const field of allCustomFields) {
            if (field.name && field.id) {
                customFieldsMap.set(field.name, field.id);
            }
        }
        console.error(`Mapped ${customFieldsMap.size} custom fields automatically`);
        // Then, log the specifically configured fields for visibility
        if (customFields.length > 0) {
            console.error(`Configured custom fields: ${customFields.join(', ')}`);
            for (const fieldName of customFields) {
                if (customFieldsMap.has(fieldName)) {
                    console.error(`Configured field "${fieldName}" is mapped to ID "${customFieldsMap.get(fieldName)}"`);
                }
                else {
                    console.error(`Warning: Configured field "${fieldName}" not found in Jira`);
                }
            }
        }
    }
    catch (error) {
        console.error(`Error initializing custom fields: ${error.message}`);
    }
}
// Helper function to format field values for display
function formatFieldValue(value) {
    if (value === null || value === undefined) {
        return 'Not set';
    }
    if (typeof value === 'object') {
        // Handle Atlassian Document Format
        if (value.type === 'doc') {
            return extractTextFromADF(value);
        }
        // Handle user objects
        if (value.displayName) {
            return value.displayName;
        }
        // Handle array values
        if (Array.isArray(value)) {
            return value.map(item => formatFieldValue(item)).join(', ');
        }
        // Default object handling
        return JSON.stringify(value);
    }
    // Simple values
    return String(value);
}
const server = new Server({ name: "jira-server", version: "1.0.0" }, { capabilities: { tools: {}, resources: {} } });
// Simple update-issue schema
const updateIssueSchema = {
    type: "object",
    properties: {
        issueKey: { type: "string" },
        fields: {
            type: "object",
            description: "Object containing field names and their new values. Can include both standard fields (summary, description) and custom fields."
        }
    },
    required: ["issueKey", "fields"]
};
// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "search-issues",
            description: "Search for issues with optional filters for project, issue type, and status category, or using a custom JQL query",
            inputSchema: {
                type: "object",
                properties: {
                    jql: {
                        type: "string",
                        description: "Optional custom JQL query. If provided, other filter parameters will be ignored"
                    },
                    projectKey: {
                        type: "string",
                        description: "Optional project key to filter issues by project"
                    },
                    issueType: {
                        type: "string",
                        description: "Optional issue type to filter issues (e.g., 'Bug', 'Task', 'Story')"
                    },
                    statusCategory: {
                        type: "string",
                        description: "Optional status category to filter issues. Must be one of: 'To Do', 'In Progress', 'Done'"
                    },
                    maxResults: {
                        type: "number",
                        description: "Optional maximum number of results to return (default: 20, max: 100)"
                    },
                    startAt: {
                        type: "number",
                        description: "Optional pagination offset, specifies the index of the first issue to return (0-based, default: 0)"
                    }
                }
            }
        },
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
        },
        {
            name: "update-issue",
            description: "Update fields of a specific ticket, including custom fields",
            inputSchema: updateIssueSchema
        },
        {
            name: "list-issue-fields",
            description: "List all available issue fields in Jira, including custom fields",
            inputSchema: {
                type: "object",
                properties: {
                    includeCustomOnly: {
                        type: "boolean",
                        description: "Optional. If true, only custom fields will be returned. Default: false"
                    }
                }
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
        case "search-issues": {
            const { jql: customJql, projectKey, issueType, statusCategory, maxResults = 20, startAt = 0 } = args;
            // Validate maxResults (must be between 1 and 100)
            const validatedMaxResults = Math.min(Math.max(1, maxResults), 100);
            if (validatedMaxResults !== maxResults) {
                console.error(`Adjusted maxResults from ${maxResults} to ${validatedMaxResults} (valid range: 1-100)`);
            }
            // Validate startAt (must be non-negative)
            const validatedStartAt = Math.max(0, startAt);
            if (validatedStartAt !== startAt) {
                console.error(`Adjusted startAt from ${startAt} to ${validatedStartAt} (must be non-negative)`);
            }
            // Use custom JQL if provided, otherwise build from filters
            let jql;
            if (customJql) {
                // Use the custom JQL query directly
                jql = customJql;
                console.error(`Using custom JQL query: ${jql}`);
            }
            else {
                // Build JQL query based on provided filters
                let jqlParts = [];
                if (projectKey) {
                    jqlParts.push(`project = ${projectKey}`);
                }
                if (issueType) {
                    jqlParts.push(`issuetype = "${issueType}"`);
                }
                if (statusCategory) {
                    // Validate status category is one of the allowed values
                    const validStatusCategories = ['To Do', 'In Progress', 'Done'];
                    if (!validStatusCategories.includes(statusCategory)) {
                        return {
                            content: [{
                                    type: "text",
                                    text: `Error: statusCategory must be one of: ${validStatusCategories.join(', ')}`
                                }],
                            isError: true,
                            _meta: {}
                        };
                    }
                    jqlParts.push(`statusCategory = "${statusCategory}"`);
                }
                // Default ordering by updated date if no filters provided
                jql = jqlParts.length > 0
                    ? `${jqlParts.join(' AND ')} ORDER BY updated DESC`
                    : 'ORDER BY updated DESC';
            }
            console.error(`Executing JQL query: ${jql}`);
            try {
                const issues = await jira.issueSearch.searchForIssuesUsingJql({
                    jql,
                    maxResults: validatedMaxResults,
                    startAt: validatedStartAt,
                    fields: ['summary', 'status', 'issuetype', 'assignee', 'updated', 'statusCategory']
                });
                // Format the results
                const formattedIssues = (issues.issues || []).map((issue) => {
                    const statusCat = issue.fields.status?.statusCategory?.name || 'Unknown';
                    const updated = issue.fields.updated
                        ? new Date(issue.fields.updated).toLocaleString()
                        : 'Unknown';
                    return `${issue.key}: ${issue.fields.summary || 'No summary'} [${issue.fields.issuetype?.name || 'Unknown type'}, ${issue.fields.status?.name || 'No status'} (${statusCat}), Assignee: ${issue.fields.assignee?.displayName || 'Unassigned'}, Updated: ${updated}]`;
                });
                const totalResults = issues.total || 0;
                const startIndex = validatedStartAt + 1;
                const endIndex = Math.min(validatedStartAt + validatedMaxResults, totalResults);
                // Create pagination information
                const paginationInfo = totalResults > 0
                    ? `Showing results ${startIndex}-${endIndex} of ${totalResults}`
                    : `No results found`;
                // Add pagination navigation hints if there are more results
                let navigationHints = '';
                if (validatedStartAt > 0) {
                    const prevStartAt = Math.max(0, validatedStartAt - validatedMaxResults);
                    navigationHints += `\nPrevious page: Use startAt=${prevStartAt}`;
                }
                if (endIndex < totalResults) {
                    const nextStartAt = validatedStartAt + validatedMaxResults;
                    navigationHints += `\nNext page: Use startAt=${nextStartAt}`;
                }
                return {
                    content: [{
                            type: "text",
                            text: formattedIssues.length > 0
                                ? `${paginationInfo}${navigationHints}\n\n${formattedIssues.join('\n')}`
                                : 'No issues found matching the criteria'
                        }],
                    _meta: {}
                };
            }
            catch (error) {
                console.error(`Error searching for issues: ${error.message}`);
                if (error.response) {
                    console.error(`Response data: ${JSON.stringify(error.response.data)}`);
                }
                return {
                    content: [{
                            type: "text",
                            text: `Error searching for issues: ${error.message}`
                        }],
                    isError: true,
                    _meta: {}
                };
            }
        }
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
            // Standard fields to fetch
            const standardFields = ['summary', 'status', 'assignee', 'description', 'created', 'updated', 'issuelinks', 'comment', 'parent', 'issuetype', 'subtasks', 'labels'];
            // Add custom fields to the fields list
            const fieldsToFetch = [...standardFields, ...Array.from(customFieldsMap.values())];
            const issue = await jira.issues.getIssue({
                issueIdOrKey: issueKey,
                fields: fieldsToFetch
            });
            const description = extractTextFromADF(issue.fields.description);
            // Format linked issues
            const linkedIssues = (issue.fields.issuelinks || []).map(link => {
                const relatedIssue = link.inwardIssue || link.outwardIssue;
                if (!relatedIssue)
                    return null;
                return `${relatedIssue.key} ${relatedIssue.fields?.summary || 'No summary'} [${relatedIssue.fields?.issuetype?.name || 'Unknown type'}, ${relatedIssue.fields?.status?.name || 'Unknown status'}]`;
            }).filter(Boolean).join('\n');
            // Format subtasks
            const subtasks = (issue.fields.subtasks || []).map(subtask => `${subtask.key} ${subtask.fields?.summary || 'No summary'} [${subtask.fields?.issuetype?.name || 'Unknown type'}, ${subtask.fields?.status?.name || 'Unknown status'}]`).join('\n');
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
            // Process custom fields
            const customFieldsData = {};
            for (const [fieldName, fieldId] of customFieldsMap.entries()) {
                if (issue.fields[fieldId] !== undefined) {
                    customFieldsData[fieldName] = formatFieldValue(issue.fields[fieldId]);
                }
            }
            // Format custom fields for display
            const customFieldsSection = Object.keys(customFieldsData).length > 0
                ? `Custom Fields:
${Object.entries(customFieldsData).map(([name, value]) => `${name}: ${value}`).join('\n')}`
                : 'No custom fields configured';
            return {
                content: [{
                        type: "text",
                        text: `
Key: ${issue.key}
Title: ${issue.fields.summary || 'No summary'}
Type: ${issue.fields.issuetype?.name || 'Unknown type'}
Status: ${issue.fields.status?.name || 'No status'}
Assignee: ${issue.fields.assignee?.displayName || 'Unassigned'}
Labels: ${Array.isArray(issue.fields.labels) && issue.fields.labels.length > 0 ? issue.fields.labels.join(', ') : 'No labels'}
Parent: ${issue.fields.parent ? `${issue.fields.parent.key} (${issue.fields.parent.fields?.issuetype?.name || 'Unknown type'}) - ${issue.fields.parent.fields?.summary || 'No summary'}` : 'No parent'}
Description:
${description}
Related Issues:
${relatedIssues}
Created: ${issue.fields.created || 'Unknown'}
Updated: ${issue.fields.updated || 'Unknown'}

${customFieldsSection}

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
        case "update-issue": {
            const { issueKey, fields } = args;
            try {
                // Check if description is included - it should be handled by the separate update-description method
                if (fields.description !== undefined) {
                    return {
                        content: [{
                                type: "text",
                                text: "Error: The 'description' field cannot be updated using this method. Please use the 'update-description' method instead."
                            }],
                        isError: true,
                        _meta: {}
                    };
                }
                // Log the current custom field mappings for debugging
                console.error(`Current customFieldsMap: ${JSON.stringify(Array.from(customFieldsMap.entries()))}`);
                // Prepare the fields object for the Jira API
                const jiraFields = {};
                const fieldMappings = {}; // To track field name to ID mappings
                // Process each field
                for (const [key, value] of Object.entries(fields)) {
                    // First check if we have a mapping for this field name
                    if (customFieldsMap.has(key)) {
                        const fieldId = customFieldsMap.get(key);
                        jiraFields[fieldId] = value;
                        fieldMappings[key] = fieldId; // Track the mapping
                        console.error(`Mapped field name "${key}" to ID "${fieldId}"`);
                    }
                    // If it's already a field ID or we don't have a mapping, use it directly
                    else {
                        jiraFields[key] = value;
                        fieldMappings[key] = key; // No mapping needed
                        console.error(`Using field key directly: "${key}"`);
                    }
                }
                // Log the fields being updated
                console.error(`Updating issue ${issueKey} with fields: ${JSON.stringify(jiraFields)}`);
                // Update the issue
                await jira.issues.editIssue({
                    issueIdOrKey: issueKey,
                    fields: jiraFields
                });
                // Format the field mappings for the response
                const fieldTexts = Object.entries(fieldMappings).map(([name, id]) => {
                    return name === id ? name : `${name} (${id})`;
                });
                const fieldsText = fieldTexts.length > 0
                    ? fieldTexts.join(', ')
                    : 'No fields were updated';
                return {
                    content: [{
                            type: "text",
                            text: `Request sent to Jira to update issue ${issueKey}. Fields in request: ${fieldsText}`
                        }],
                    _meta: {}
                };
            }
            catch (error) {
                console.error(`Error updating issue: ${error.message}`);
                if (error.response) {
                    console.error(`Response data: ${JSON.stringify(error.response.data)}`);
                }
                // Prepare a detailed error message
                let errorDetails = `Error updating issue: ${error.message}`;
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
        case "list-issue-fields": {
            const { includeCustomOnly = false } = args;
            try {
                // Fetch all fields from Jira
                const fieldsResponse = await jira.issueFields.getFields();
                // Filter fields based on the includeCustomOnly parameter
                const filteredFields = includeCustomOnly
                    ? fieldsResponse.filter(field => field.custom)
                    : fieldsResponse;
                // Format the fields for display
                const formattedFields = filteredFields.map(field => {
                    const isConfigured = field.name ? customFieldsMap.has(field.name) : false;
                    return {
                        id: field.id || '',
                        name: field.name || 'Unnamed Field',
                        custom: field.custom || false,
                        configuredForAutoFetch: isConfigured,
                        // Use schema type as description if available, otherwise a default message
                        description: field.schema?.type ? `Type: ${field.schema.type}` : 'No description available'
                    };
                });
                // Group fields by whether they are custom or not
                const standardFields = formattedFields.filter(field => !field.custom);
                const customFields = formattedFields.filter(field => field.custom);
                // Create the response text
                let responseText = '';
                if (!includeCustomOnly && standardFields.length > 0) {
                    responseText += `Standard Fields (${standardFields.length}):\n`;
                    responseText += standardFields.map(field => `${field.name} (${field.id}): ${field.description}`).join('\n');
                }
                if (customFields.length > 0) {
                    if (responseText)
                        responseText += '\n\n';
                    responseText += `Custom Fields (${customFields.length}):\n`;
                    responseText += customFields.map(field => {
                        const configuredMark = field.configuredForAutoFetch ? ' ✓' : '';
                        return `${field.name}${configuredMark} (${field.id}): ${field.description}`;
                    }).join('\n');
                    responseText += '\n\n✓ = Configured for automatic fetching with issue details';
                }
                if (!responseText) {
                    responseText = 'No fields found';
                }
                return {
                    content: [{
                            type: "text",
                            text: responseText
                        }],
                    _meta: {}
                };
            }
            catch (error) {
                console.error(`Error listing issue fields: ${error.message}`);
                if (error.response) {
                    console.error(`Response data: ${JSON.stringify(error.response.data)}`);
                }
                return {
                    content: [{
                            type: "text",
                            text: `Error listing issue fields: ${error.message}`
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
(async () => {
    try {
        // Initialize custom fields mapping
        console.error('Initializing custom fields...');
        await initializeCustomFields();
        console.error(`Initialized ${customFieldsMap.size} custom fields`);
        // Start the server
        const transport = new StdioServerTransport();
        await server.connect(transport);
    }
    catch (error) {
        console.error(`Error starting server: ${error.message}`);
        process.exit(1);
    }
})();
