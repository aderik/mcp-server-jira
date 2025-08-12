import { listChildIssuesDefinition, listChildIssuesHandler } from "./tools/listChildIssues.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Version3Client, Version3Models } from "jira.js";
import { respond, fail, validateArray, validateString, withJiraError } from "./utils.js";
import { listJiraFiltersDefinition, listJiraFiltersHandler } from "./tools/listJiraFilters.js";
import { listUsersDefinition, listUsersHandler } from "./tools/listUsers.js";
import { searchIssuesDefinition, searchIssuesHandler } from "./tools/searchIssues.js";
import { listSprintTicketsDefinition, listSprintTicketsHandler } from "./tools/listSprintTickets.js";
import { getTicketDetailsDefinition, getTicketDetailsHandler } from "./tools/getTicketDetails.js";
import { addCommentDefinition, addCommentHandler } from "./tools/addComment.js";
import { updateDescriptionDefinition, updateDescriptionHandler } from "./tools/updateDescription.js";
import { createSubTicketDefinition, createSubTicketHandler, createSubTicketCore } from "./tools/createSubTicket.js";
import { createTicketDefinition, createTicketHandler } from "./tools/createTicket.js";
import { updateIssueDefinition, updateIssueHandler } from "./tools/updateIssue.js";

// Map to store custom field information (name to ID mapping)
const customFieldsMap = new Map<string, string>();

const { JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;

if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN) {
  console.error("Missing required environment variables. Required: JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN");
  process.exit(1);
}

const jira = new Version3Client({
  host: JIRA_HOST,
  authentication: {
    basic: {
      email: JIRA_EMAIL,
      apiToken: JIRA_API_TOKEN
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
  } catch (error: any) {
    console.error(`Error initializing custom fields: ${error.message}`);
  }
}

// Helper function to format field values for display
function formatFieldValue(value: any): string {
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
// Determine if a field value is meaningfully set (not null/empty)
function hasMeaningfulValue(value: any): boolean {
  if (value === null || value === undefined) return false;

  const t = typeof value;
  if (t === 'string') return value.trim().length > 0;
  if (t === 'number' || t === 'boolean') return true;

  if (Array.isArray(value)) {
    return value.some(item => hasMeaningfulValue(item));
  }

  if (t === 'object') {
    // Consider Atlassian Document Format meaningful only if it yields non-empty text
    if ((value as any).type === 'doc') {
      const text = extractTextFromADF(value).trim();
      return text.length > 0;
    }

    // Common Jira shapes (option, user, named objects)
    const candidateKeys = ['value', 'displayName', 'name', 'id', 'text'];
    for (const key of candidateKeys) {
      if (hasMeaningfulValue((value as any)[key])) return true;
    }

    // Fallback: any own property with a meaningful value
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key) && hasMeaningfulValue((value as any)[key])) {
        return true;
      }
    }
    return false;
  }

  return false;
}

const server = new Server(
  { name: "jira-server", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

// Reusable fields schema for both create and update operations
const fieldsSchema = {
  type: "object",
  description: "Object containing field names and their values. Can include both standard fields and custom fields. For user fields (like assignee, refiners), use objects with accountId: {\"accountId\": \"user-account-id\"}. For arrays of users, use [{\"accountId\": \"id1\"}, {\"accountId\": \"id2\"}]. For option fields, use {\"value\": \"option-name\"} or {\"id\": \"option-id\"}.",
  additionalProperties: {
    oneOf: [
      { type: "string", description: "Simple text value" },
      { type: "number", description: "Numeric value" },
      { type: "boolean", description: "Boolean value" },
      {
        type: "object",
        description: "Complex field value",
        examples: [
          { "accountId": "628b83c6c65b72006960dafc" },
          { "value": "High" },
          { "id": "10001" }
        ]
      },
      {
        type: "array",
        description: "Array of values (e.g., multiple users, labels)",
        items: {
          oneOf: [
            { type: "string" },
            {
              type: "object",
              description: "User reference",
              properties: {
                accountId: { type: "string", description: "Jira user account ID" }
              },
              required: ["accountId"]
            }
          ]
        }
      }
    ]
  }
};


// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    searchIssuesDefinition,
    {
      name: "add-labels",
      description: "Add labels to multiple issues without replacing existing ones",
      inputSchema: {
        type: "object",
        properties: {
          issueKeys: {
            type: "array",
            items: { type: "string" },
            description: "List of issue keys to add labels to"
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "List of labels to add to the issues"
          }
        },
        required: ["issueKeys", "labels"]
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
    listSprintTicketsDefinition,
    getTicketDetailsDefinition,
    addCommentDefinition,
    updateDescriptionDefinition,
    listChildIssuesDefinition,
    createSubTicketDefinition,
    createTicketDefinition,
    {
      name: "update-issue",
      description: "Update fields of a specific ticket, including custom fields. For user fields (assignee, refiners, etc.), use {\"accountId\": \"user-account-id\"} format. For arrays of users, use [{\"accountId\": \"id1\"}, {\"accountId\": \"id2\"}]. Use the list-users tool to find account IDs.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          fields: fieldsSchema
        },
        required: ["issueKey", "fields"]
      }
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
    },
    {
      name: "transition-issues",
      description: "Transition multiple issues to a new status using a transition ID",
      inputSchema: {
        type: "object",
        properties: {
          issueKeys: {
            type: "array",
            items: { type: "string" },
            description: "List of issue keys to transition"
          },
          transitionId: {
            type: "string",
            description: "The ID of the transition to perform (e.g., '5' or 'Resolve Issue')"
          }
        },
        required: ["issueKeys", "transitionId"]
      }
    },
    {
      name: "list-issue-transitions",
      description: "List available transitions for a specific issue.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" }
        },
        required: ["issueKey"]
      }
    },
    {
      name: "assign-issue",
      description: "Assign an issue to a user by their display name.",
      inputSchema: {
        type: "object",
        properties: {
          issueKeys: {
            type: "array",
            items: { type: "string" },
            description: "List of issue keys to assign (e.g., ['EDU-123', 'EDU-124'])."
          },
          assigneeDisplayName: {
            type: "string",
            description: "The display name of the user to assign the issues to (e.g., 'John Doe')."
          }
        },
        required: ["issueKeys", "assigneeDisplayName"]
      }
    },
    listJiraFiltersDefinition,
    listUsersDefinition
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
    case "search-issues": {
      return await searchIssuesHandler(jira, args as {
        jql?: string;
        projectKey?: string;
        issueType?: string;
        statusCategory?: string;
        maxResults?: number;
        startAt?: number;
      });
    }
    
    case "list-sprint-tickets": {
      return await listSprintTicketsHandler(jira, args as { projectKey: string });
    }

    case "get-ticket-details": {
      return await getTicketDetailsHandler(jira, customFieldsMap, args as { issueKey: string });
    }

    case "add-comment": {
      return await addCommentHandler(jira, args as { issueKey: string; comment: string });
    }

    case "update-description": {
      return await updateDescriptionHandler(jira, args as { issueKey: string; description: string });
    }

    case "list-child-issues": {
      return await listChildIssuesHandler(jira, args as { parentKey: string });
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
          text: (issues.issues || []).map((issue: any) =>
            `${issue.key}: ${issue.fields.summary || 'No summary'} (${issue.fields.status?.name || 'No status'}) [Type: ${issue.fields.issuetype?.name || 'Unknown'}, Assignee: ${issue.fields.assignee?.displayName || 'Unassigned'}]`
          ).join("\n") || 'No child issues found'
        }],
        _meta: {}
      };
    }

    case "create-sub-ticket": {
      return await createSubTicketHandler(jira, args as { parentKey: string; summary: string; description?: string; issueType?: string });
    }

    case "link-tickets": {
      const { sourceIssueKey, targetIssueKey } = args as { 
        sourceIssueKey: string; 
        targetIssueKey: string;
      };

      try {
        // Get all issue link types
        const linkTypes = await jira.issueLinkTypes.getIssueLinkTypes();
        
        // Find the "relates to" link type
        const relatesTo = linkTypes.issueLinkTypes?.find(
          linkType => 
            linkType.name?.toLowerCase() === "relates to" || 
            linkType.inward?.toLowerCase() === "relates to" || 
            linkType.outward?.toLowerCase() === "relates to"
        );
        
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
      } catch (error: any) {
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
      return await createTicketHandler(jira, customFieldsMap, args as {
        projectKey: string;
        summary: string;
        description?: string;
        issueType?: string;
        parentKey?: string;
        fields?: Record<string, any>;
      });
    }

    case "update-issue": {
      const { issueKey, fields } = args as {
        issueKey: string;
        fields: Record<string, any>;
      };
      
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
        
        // Prepare the fields object, starting with a copy of the input.
        const processedFields: Record<string, any> = { ...fields };
        const fieldMappings: Record<string, string> = {}; // To track field name to ID mappings

        // Handle assignee conversion if provided by name
        if (processedFields.assignee && typeof processedFields.assignee === 'object' && processedFields.assignee.name && !processedFields.assignee.accountId) {
          const assigneeDisplayName = processedFields.assignee.name;
          console.error(`Attempting to resolve assignee by display name: "${assigneeDisplayName}" for update-issue`);
          try {
            const usersFound = await jira.userSearch.findUsers({ query: assigneeDisplayName });
            if (!usersFound || usersFound.length === 0) {
              return {
                content: [{ type: "text", text: `Error: Assignee lookup failed. No user found with display name "${assigneeDisplayName}".` }],
                isError: true, _meta: {}
              };
            }
            if (usersFound.length > 1) {
              const matchingUsers = usersFound.map(u => `${u.displayName} (AccountId: ${u.accountId})`).join('\n - ');
              return {
                content: [{ type: "text", text: `Error: Assignee lookup failed. Multiple users found with display name "${assigneeDisplayName}":\n - ${matchingUsers}\nPlease use accountId for assignee.` }],
                isError: true, _meta: {}
              };
            }
            const userToAssign = usersFound[0];
            if (!userToAssign.accountId) {
              return {
                content: [{ type: "text", text: `Error: Assignee lookup failed. User "${userToAssign.displayName}" does not have an accountId.` }],
                isError: true, _meta: {}
              };
            }
            processedFields.assignee = { accountId: userToAssign.accountId }; // Replace with accountId object
            console.error(`Successfully resolved assignee "${assigneeDisplayName}" to accountId "${userToAssign.accountId}" for update-issue`);
          } catch (userSearchError: any) {
            console.error(`Error during assignee lookup for "${assigneeDisplayName}" in update-issue: ${userSearchError.message}`);
            return {
              content: [{ type: "text", text: `Error during assignee lookup: ${userSearchError.message}` }],
              isError: true, _meta: {}
            };
          }
        } else if (processedFields.assignee && typeof processedFields.assignee === 'object' && processedFields.assignee.name && processedFields.assignee.accountId) {
          // If both name and accountId are provided for assignee, prefer accountId and remove name.
          console.warn(`Assignee provided with both name and accountId in update-issue. Using accountId: "${processedFields.assignee.accountId}" and removing name field.`);
          delete processedFields.assignee.name;
        }

        // Now, map custom field names to IDs for all fields in processedFields
        const finalJiraFields: Record<string, any> = {};
        for (const [key, value] of Object.entries(processedFields)) {
          if (customFieldsMap.has(key)) {
            const fieldId = customFieldsMap.get(key)!;
            finalJiraFields[fieldId] = value;
            fieldMappings[key] = fieldId;
            console.error(`Mapped field name "${key}" to ID "${fieldId}" in update-issue`);
          } else {
            finalJiraFields[key] = value; // Use key directly if not a custom field name or already an ID (like 'assignee')
            fieldMappings[key] = key;
            console.error(`Using field key directly: "${key}" in update-issue`);
          }
        }
        
        // Log the fields being updated
        console.error(`Updating issue ${issueKey} with final fields: ${JSON.stringify(finalJiraFields)}`);
        
        // Update the issue
        await jira.issues.editIssue({
          issueIdOrKey: issueKey,
          fields: finalJiraFields
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
      } catch (error: any) {
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
      const { includeCustomOnly = false } = args as { includeCustomOnly?: boolean };
      
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
          responseText += standardFields.map(field =>
            `${field.name} (${field.id}): ${field.description}`
          ).join('\n');
        }
        
        if (customFields.length > 0) {
          if (responseText) responseText += '\n\n';
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
      } catch (error: any) {
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

    case "add-labels": {
      const { issueKeys, labels } = args as { issueKeys: string[]; labels: string[] };

      const issuesErr = validateArray("issueKeys", issueKeys);
      if (issuesErr) return fail(issuesErr.replace("array", "array of issue keys"));
      const labelsErr = validateArray("labels", labels);
      if (labelsErr) return fail(labelsErr.replace("array", "array of label strings"));

      return withJiraError(async () => {
        const results: string[] = [];
        const errors: string[] = [];

        for (const issueKey of issueKeys) {
          try {
            const issue = await jira.issues.getIssue({ issueIdOrKey: issueKey, fields: ["labels"] });
            const existing = Array.isArray(issue.fields.labels) ? issue.fields.labels : [];
            const combined = [...new Set([...existing, ...labels])];

            await jira.issues.editIssue({
              issueIdOrKey: issueKey,
              fields: { labels: combined },
            });

            results.push(`${issueKey}: labels => [${combined.join(", ")}]`);
          } catch (e: any) {
            errors.push(`${issueKey}: ${e?.message ?? String(e)}`);
          }
        }

        let msg = "";
        if (results.length > 0) {
          msg += `Updated ${results.length} of ${issueKeys.length} issues.\n` + results.join("\n");
        }
        if (errors.length > 0) {
          if (msg) msg += "\n\n";
          msg += `Failed ${errors.length} issues:\n` + errors.join("\n");
        }

        const response = respond(msg || "No issues processed.");
        if (errors.length === issueKeys.length) response.isError = true;
        return response;
      }, "Error adding labels");
    }

    case "transition-issues": {
      const { issueKeys, transitionId } = args as { issueKeys: string[]; transitionId: string };

      const issuesErr = validateArray("issueKeys", issueKeys);
      if (issuesErr) return fail(issuesErr.replace("array", "array of issue keys"));
      const transitionErr = validateString("transitionId", transitionId);
      if (transitionErr) return fail(transitionErr);

      return withJiraError(async () => {
        const results: string[] = [];
        const errors: string[] = [];

        for (const issueKey of issueKeys) {
          try {
            await jira.issues.doTransition({
              issueIdOrKey: issueKey,
              transition: { id: transitionId },
            });
            results.push(`${issueKey}: transitioned -> ${transitionId}`);
          } catch (e: any) {
            errors.push(`${issueKey}: ${e?.message ?? String(e)}`);
          }
        }

        let msg = "";
        if (results.length > 0) {
          msg += `Transitioned ${results.length} of ${issueKeys.length} issues:\n` + results.join("\n");
        }
        if (errors.length > 0) {
          if (msg) msg += "\n\n";
          msg += `Failed ${errors.length} issues:\n` + errors.join("\n");
        }

        const response = respond(msg || "No issues processed.");
        if (errors.length === issueKeys.length) response.isError = true;
        return response;
      }, "Error transitioning issues");
    }

    case "list-issue-transitions": {
      const { issueKey } = args as { issueKey: string };

      if (!issueKey || typeof issueKey !== 'string') {
        return {
          content: [{
            type: "text",
            text: "Error: issueKey must be a non-empty string"
          }],
          isError: true,
          _meta: {}
        };
      }

      try {
        const transitionsResponse = await jira.issues.getTransitions({ issueIdOrKey: issueKey });
        const availableTransitions = (transitionsResponse.transitions || []).map(t => ({
          id: t.id,
          name: t.name,
          toStatus: t.to?.name,
          toStatusCategory: t.to?.statusCategory?.name
        }));

        if (availableTransitions.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No available transitions found for issue ${issueKey}.`
            }],
            _meta: {}
          };
        }

        const formattedTransitions = availableTransitions.map(
          t => `ID: ${t.id}, Name: "${t.name}" (To Status: ${t.toStatus || 'N/A'} - ${t.toStatusCategory || 'N/A'})`
        ).join('\n');

        return {
          content: [{
            type: "text",
            text: `Available transitions for ${issueKey}:\n${formattedTransitions}`
          }],
          _meta: {}
        };
      } catch (error: any) {
        console.error(`Error listing transitions for issue ${issueKey}: ${error.message}`);
        if (error.response) {
          console.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
        return {
          content: [{
            type: "text",
            text: `Error listing transitions for ${issueKey}: ${error.message}`
          }],
          isError: true,
          _meta: {}
        };
      }
    }

    case "assign-issue": {
      const { issueKeys, assigneeDisplayName } = args as { issueKeys: string[]; assigneeDisplayName: string };

      const issuesErr = validateArray("issueKeys", issueKeys);
      if (issuesErr) return fail(issuesErr.replace("array", "array of issue keys"));
      const nameErr = validateString("assigneeDisplayName", assigneeDisplayName);
      if (nameErr) return fail(nameErr);

      return withJiraError(async () => {
        const usersFound = await jira.userSearch.findUsers({ query: assigneeDisplayName });
        if (!usersFound || usersFound.length === 0) {
          return fail(`Error: No user found with display name "${assigneeDisplayName}".`);
        }
        if (usersFound.length > 1) {
          const matching = usersFound.map(u => `${u.displayName} (AccountId: ${u.accountId})`).join("\n - ");
          return fail(`Error: Multiple users found with display name "${assigneeDisplayName}":\n - ${matching}\nPlease be more specific or use the accountId.`);
        }

        const user = usersFound[0];
        if (!user.accountId) {
          return fail(`Error: User "${user.displayName}" does not have an accountId.`);
        }

        const results: string[] = [];
        const errors: string[] = [];

        for (const issueKey of issueKeys) {
          try {
            await jira.issues.assignIssue({ issueIdOrKey: issueKey, accountId: user.accountId });
            results.push(`${issueKey}: assigned to ${user.displayName}`);
          } catch (e: any) {
            errors.push(`${issueKey}: ${e?.message ?? String(e)}`);
          }
        }

        let msg = "";
        if (results.length > 0) {
          msg += `Assigned ${results.length} of ${issueKeys.length} issues to ${user.displayName}:\n` + results.join("\n");
        }
        if (errors.length > 0) {
          if (msg) msg += "\n\n";
          msg += `Failed to assign ${errors.length} issues:\n` + errors.join("\n");
        }

        const response = respond(msg || "No issues processed.");
        if (errors.length === issueKeys.length) response.isError = true;
        return response;
      }, `Error during assignment process for display name "${assigneeDisplayName}"`);
    }

    case "list-users": {
      return await listUsersHandler(jira, args as { maxResults?: number });
    }

    case "list-jira-filters": {
      return await listJiraFiltersHandler(jira);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Helper function to handle sub-ticket creation
async function handleSubTicketCreation(args: { 
  parentKey: string; 
  summary: string; 
  description?: string;
  issueType?: string;
}) {
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
        ...(description ? {
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
        } : {})
      }
    };
    
    console.error(`Create issue payload: ${JSON.stringify(createIssuePayload)}`);
    
    await jira.issues.createIssue(createIssuePayload);

    return {
      content: [{
        type: "text",
        text: `🤖 Sub-ticket creation request sent for parent ${parentKey}`
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
  } catch (error: any) {
    console.error(`Error starting server: ${error.message}`);
    process.exit(1);
  }
})();
