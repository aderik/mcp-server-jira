#!/bin/bash
# Quick local test script
# Usage: ./test-local.sh

if [ ! -f .env ]; then
  echo "Error: .env file not found!"
  echo "Please create .env file from .env.example"
  exit 1
fi

source .env
export JIRA_HOST JIRA_EMAIL JIRA_API_TOKEN

echo "Starting MCP server with local .env configuration..."
node dist/jira.js
