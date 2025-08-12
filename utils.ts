export type McpText = { type: "text"; text: string };
export type McpResponse = {
  content: McpText[];
  _meta?: Record<string, unknown>;
  isError?: boolean;
};

export function respond(text: string): McpResponse {
  return { content: [{ type: "text", text }], _meta: {} };
}

export function fail(text: string): McpResponse {
  return { content: [{ type: "text", text }], isError: true, _meta: {} };
}

export function validateArray(name: string, value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return `Error: ${name} must be a non-empty array`;
  }
  return null;
}

export function validateString(name: string, value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return `Error: ${name} must be a non-empty string`;
  }
  return null;
}

// Uniform Jira error rendering (includes axios-like response.data if present)
export function formatJiraError(prefix: string, error: any): string {
  const base = `${prefix}: ${error?.message ?? String(error)}`;
  const data =
    error?.response?.data
      ? typeof error.response.data === "object"
        ? JSON.stringify(error.response.data, null, 2)
        : String(error.response.data)
      : null;
  return data ? `${base}\n\nResponse data:\n${data}` : base;
}

// Helper wrapper to simplify try/catch in handlers
export async function withJiraError(
  action: () => Promise<McpResponse>,
  prefix = "Error"
): Promise<McpResponse> {
  try {
    return await action();
  } catch (e: any) {
    return fail(formatJiraError(prefix, e));
  }
}

// Minimal ADF builder for plain text paragraphs
export function buildADF(text: string) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}