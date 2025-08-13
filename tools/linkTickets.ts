import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
import { respond, withJiraError } from "../utils.js";

export const linkTicketsDefinition = {
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
};

export async function linkTicketsHandler(
    jira: Version3Client,
    args: { sourceIssueKey: string; targetIssueKey: string; }
): Promise<McpResponse> {
    const { sourceIssueKey, targetIssueKey } = args;

    return withJiraError(async () => {
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

        return respond(`Successfully linked ${sourceIssueKey} to ${targetIssueKey} with relationship "${relatesTo.name || "Relates"}"`);
    }, "Error linking tickets");
}