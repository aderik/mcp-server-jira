# JIRA MCP Server

This is a Model Context Protocol (MCP) server that provides tools for interacting with JIRA. It allows you to fetch tickets from active sprints, search issues, manage users, and get detailed ticket information through the MCP interface.

> **⚠️ Updated for 2025**: This fork includes critical fixes for Atlassian's API deprecations that caused 410 errors in the original version. All deprecated endpoints have been replaced with their modern equivalents.

## Features

The server provides the following tools:

### Issue Management
1. **`search-issues`**: Search for issues using JQL or filters
   - Optional parameter: `jql` (string) - Custom JQL query
   - Optional parameter: `projectKey` (string) - Filter by project
   - Optional parameter: `issueType` (string) - Filter by issue type (e.g., 'Bug', 'Task', 'Story')
   - Optional parameter: `statusCategory` (string) - Filter by status ('To Do', 'In Progress', 'Done')
   - Optional parameter: `maxResults` (number) - Max results to return (default: 20, max: 100)
   - Optional parameter: `startAt` (number) - Pagination offset

2. **`list-sprint-tickets`**: Gets all tickets in the active sprint for a given project
   - Required parameter: `projectKey` (string)

3. **`get-ticket-details`**: Gets detailed information about a specific ticket
   - Required parameter: `issueKey` (string)

4. **`add-comment`**: Adds a comment to a specific ticket
   - Required parameter: `issueKey` (string)
   - Required parameter: `comment` (string)

5. **`update-description`**: Updates the description of a specific ticket
   - Required parameter: `issueKey` (string)
   - Required parameter: `description` (string)

6. **`list-child-issues`**: Gets all child issues of a parent ticket
   - Required parameter: `parentKey` (string)

7. **`create-sub-ticket`**: Creates a sub-ticket (child issue) for a parent ticket
   - Required parameter: `parentKey` (string)
   - Required parameter: `summary` (string)
   - Optional parameter: `description` (string)
   - Optional parameter: `issueType` (string) - The name of the sub-task issue type (e.g., 'Sub-task')

8. **`create-ticket`**: Create a new ticket with custom fields
   - Required parameter: `projectKey` (string)
   - Required parameter: `summary` (string)
   - Optional parameter: `description` (string)
   - Optional parameter: `issueType` (string)
   - Optional parameter: `parentKey` (string) - Creates a sub-task if provided
   - Optional parameter: `fields` (object) - Additional custom fields

9. **`update-issues`**: Batch update fields on multiple tickets
   - Required parameter: `issueKeys` (array of strings)
   - Required parameter: `fields` (object) - Fields to update

10. **`add-labels`**: Add labels to multiple issues
    - Required parameter: `issueKeys` (array of strings)
    - Required parameter: `labels` (array of strings)

11. **`link-issues`**: Link multiple tickets using 'relates to' relationship
    - Required parameter: `inwardIssueKeys` (array of strings)
    - Required parameter: `outwardIssueKeys` (array of strings)

12. **`transition-issues`**: Transition multiple issues to a new status
    - Required parameter: `issueKeys` (array of strings)
    - Required parameter: `transitionId` (string)

13. **`list-issue-transitions`**: List available transitions for an issue
    - Required parameter: `issueKey` (string)

14. **`assign-issue`**: Assign issues to a user
    - Required parameter: `issueKeys` (array of strings)
    - Required parameter: `assigneeDisplayName` (string)

### User & Field Management
15. **`list-users`**: List all users in Jira
    - Optional parameter: `query` (string) - Search string to filter users
    - Optional parameter: `maxResults` (number) - Max results (default: 50, max: 1000)

16. **`list-issue-fields`**: List all available issue fields including custom fields
    - Optional parameter: `includeCustomOnly` (boolean) - Only show custom fields

17. **`list-jira-filters`**: List all Jira filters

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build the TypeScript code:

This step is only needed for Cline on Windows, which currently has an issue executing npx

   ```bash
   npm run build
   ```

3. Configure the MCP settings in your Claude app settings file (usually located at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` on Windows):

Settings for Claude:

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["path/to/this/repo/jira.ts"],
      "env": {
        "JIRA_HOST": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

Settings for Cline:

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["path/to/this/repo/dist/jira.js"],
      "env": {
        "JIRA_HOST": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

## Configuration

### Option 1: Local Development with .env file

For local development and testing, you can use a `.env` file:

1. Copy the example file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your credentials:
   ```
   JIRA_HOST=https://your-domain.atlassian.net
   JIRA_EMAIL=your-email@example.com
   JIRA_API_TOKEN=your-api-token
   ```

3. Run the server:
   ```bash
   npm start
   ```

### Option 2: MCP Configuration

You'll need to set up the following environment variables in your MCP settings:

1. `JIRA_HOST`: Your Atlassian domain URL (e.g., `https://your-company.atlassian.net`)
2. `JIRA_EMAIL`: Your JIRA account email
3. `JIRA_API_TOKEN`: Your JIRA API token
   - You can generate an API token from your [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)

## Usage

Once configured, you can use the tools through the MCP interface in Claude:

### List Sprint Tickets

To get all tickets in the active sprint for a project:

```typescript
<use_mcp_tool>
<server_name>jira</server_name>
<tool_name>list-sprint-tickets</tool_name>
<arguments>
{
  "projectKey": "YOUR_PROJECT_KEY"
}
</arguments>
</use_mcp_tool>
```

### Get Ticket Details

To get detailed information about a specific ticket:

```typescript
<use_mcp_tool>
<server_name>jira</server_name>
<tool_name>get-ticket-details</tool_name>
<arguments>
{
  "issueKey": "PROJECT-123"
}
</arguments>
</use_mcp_tool>
```

## Development

The server is written in TypeScript and uses:

- `@modelcontextprotocol/sdk` for MCP server implementation
- `jira.js` for JIRA API integration

Recommended scripts:

- Build once: `npm run build`
- Build and watch: `npm run build:watch`
- Type-check only: `npm run typecheck`
- Dev run with watch: `npm run start:dev`
- Run compiled server: `npm start`
- Format check: `npm run fmt:check`
- Format write: `npm run fmt`

Typical workflow:

1. Make changes to [`jira.ts`](jira.ts)
2. Run `npm run start:dev` during development, or `npm run build` then `npm start` for compiled run
3. Restart your MCP client if needed to pick up changes

## Recent Updates (2025)

### Critical Fixes for Atlassian API Deprecations

This fork includes fixes for the following deprecated endpoints that were causing 410 Gone errors:

1. **`/rest/api/3/users/search`** → Migrated to `/rest/api/3/user/search`
   - Affects: `list-users` tool
   - Fixed: Updated to use `userSearch.findUsers()` with proper pagination

2. **`/rest/api/3/search`** → Migrated to `/rest/api/3/search/jql`
   - Affects: `search-issues` and `list-sprint-tickets` tools
   - Fixed: Updated to use `searchForIssuesUsingJqlEnhancedSearch()` with token-based pagination
   - Note: The new API requires bounded JQL queries (unbounded queries now default to last 30 days)

### Other Improvements

- Updated `jira.js` dependency from 4.1.3 to 5.2.2
- Added `.env` file support for local development with `dotenv`
- Enhanced error messages with full response details for easier debugging
- Added test script (`test-local.sh`) for local development
- Improved pagination handling with new token-based system

## Error Handling

The server includes error handling for:

- Invalid JIRA credentials
- Missing active sprints
- Invalid project keys or issue keys
- Network errors
- Deprecated API endpoints (with automatic migration to new endpoints)

Error messages will be returned in the tool response with detailed information.

## Migration from Original Version

If you're migrating from the original `boukeversteegh/mcp-server-jira`:

1. Update your local repository:
   ```bash
   git pull
   npm install
   npm run build
   ```

2. Restart your MCP client (Cursor/Claude)

3. All tools should now work without 410 errors

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

Apache-2.0 License

## Credits

- Original version by [boukeversteegh](https://github.com/boukeversteegh/mcp-server-jira)
- 2025 updates and fixes by [aderik](https://github.com/aderik)
