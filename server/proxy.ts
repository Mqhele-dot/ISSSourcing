import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { parse } from 'url';
import type { RawData } from 'ws';

type StreamingRequestInit = RequestInit & { duplex?: 'half' };

// Simple proxy to forward HTTP requests from port 5000 to port 3000
const httpProxy = createServer(async (req, res) => {
  const targetUrl = `http://localhost:3000${req.url}`;
  console.log(`Forwarding request from port 5000 to ${targetUrl}`);
  
  try {
    const method = req.method?.toUpperCase() ?? 'GET';
    const canHaveBody = !['GET', 'HEAD'].includes(method);
    const requestInit: StreamingRequestInit = {
      method,
      headers: req.headers as HeadersInit,
      body: canHaveBody ? (req as unknown as BodyInit) : undefined,
      duplex: canHaveBody ? 'half' : undefined,
      redirect: 'manual',
    };
    const targetReq = await fetch(targetUrl, requestInit);
    
    // Copy status and headers
    res.statusCode = targetReq.status;
    targetReq.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    
    // Stream the response body
    const responseBody = await targetReq.arrayBuffer();
    res.end(Buffer.from(responseBody));
  } catch (error) {
      console.error('Proxy error:', error);
      res.statusCode = 502; // Bad Gateway
      res.end('Proxy error: ' + (error instanceof Error ? error.message : String(error)));
  }
});

// Create a WebSocket proxy
const wsServer = new WebSocketServer({ noServer: true });

// Handle HTTP server upgrade (WebSocket handshake)
httpProxy.on('upgrade', (request, socket, head) => {
  const pathname = parse(request.url || '').pathname || '';
  
  if (pathname === '/ws') {
    console.log('Forwarding WebSocket connection to port 3000');
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      // Create a new WebSocket connection to the target server
      const targetWs = new WebSocket('ws://localhost:3000/ws');
      
      // Forward messages from client to target
      ws.on('message', (message: RawData) => {
        if (targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(typeof message === 'string' ? message : Buffer.isBuffer(message) ? message : String(message));
        }
      });
      
      // Forward messages from target to client
      targetWs.on('message', (message: RawData) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(typeof message === 'string' ? message : Buffer.isBuffer(message) ? message : String(message));
        }
      });
      
      // Handle connection close on either end
      ws.on('close', () => {
        if (targetWs.readyState === WebSocket.OPEN) {
          targetWs.close();
        }
      });
      
      targetWs.on('close', () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });
      
      // Handle errors
      ws.on('error', (error: Error) => {
        console.error('WebSocket proxy client error:', error);
      });
      
      targetWs.on('error', (error: Error) => {
        console.error('WebSocket proxy target error:', error);
      });
    });
  }
});

// Start the proxy server
httpProxy.listen(5000, '0.0.0.0', () => {
  console.log('Proxy server running on port 5000, forwarding to port 3000');
});
