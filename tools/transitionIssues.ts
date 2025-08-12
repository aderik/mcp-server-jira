import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
import { respond, validateArray, validateString, withJiraError } from "../utils.js";

export const transitionIssuesDefinition = {
  name: "transition-issues",
  description: "Transition multiple issues to a new status using a transition ID",
  inputSchema: {
    type: "object",
    properties: {
      issueKeys: {
        type: "array",
        items: { type: "string" },
        description: "List of issue keys to transition",
      },
      transitionId: {
        type: "string",
        description: "The ID of the transition to perform (e.g., '5' or 'Resolve Issue')",
      },
    },
    required: ["issueKeys", "transitionId"],
  },
};

export async function transitionIssuesHandler(
  jira: Version3Client,
  args: { issueKeys: string[]; transitionId: string }
): Promise<McpResponse> {
  const { issueKeys, transitionId } = args;

  const issuesErr = validateArray("issueKeys", issueKeys);
  if (issuesErr) return respond(issuesErr.replace("array", "array of issue keys"));
  const transitionErr = validateString("transitionId", transitionId);
  if (transitionErr) return respond(transitionErr);

  return withJiraError(async () => {
    const results: string[] = [];
    const errors: string[] = [];

    for (const issueKey of issueKeys) {
      try {
        await jira.issues.doTransition({
          issueIdOrKey: issueKey,
          transition: { id: transitionId },
        } as any);
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