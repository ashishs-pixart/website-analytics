#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createNetworkWatchMcpServer } from './server.mjs';

const server = createNetworkWatchMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Network Watch MCP server is running over stdio.');
