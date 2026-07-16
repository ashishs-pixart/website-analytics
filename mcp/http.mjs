#!/usr/bin/env node
import express from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createNetworkWatchMcpServer } from './server.mjs';
import { pathToFileURL } from 'node:url';

export function startNetworkWatchHttpServer(options = {}) {
  const host = options.host || process.env.NETWORK_WATCH_MCP_HOST || '127.0.0.1';
  const port = options.port ?? Number(process.env.NETWORK_WATCH_MCP_PORT || 9232);
  const bearerToken = options.bearerToken ?? process.env.NETWORK_WATCH_MCP_TOKEN ?? '';
  const app = createMcpExpressApp({ host });
  app.use(express.json({ limit: '1mb' }));
  const authorized = request => bearerToken
    ? request.headers.authorization === `Bearer ${bearerToken}`
    : host === '127.0.0.1' || host === 'localhost';

  app.get('/health', (_request, response) => response.json({ ok: true, app: 'Network Watch MCP' }));
  app.post('/mcp', async (request, response) => {
    if (!authorized(request)) {
      response.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const server = createNetworkWatchMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error(error);
      if (!response.headersSent) response.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });

  const listener = app.listen(port, host, () => {
    const address = listener.address();
    const activePort = typeof address === 'object' && address ? address.port : port;
    console.error(`Network Watch MCP Streamable HTTP endpoint: http://${host}:${activePort}/mcp`);
  });
  return { app, listener };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startNetworkWatchHttpServer();
