import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { parse } from 'url';

// Simple proxy to forward HTTP requests from port 5000 to port 3000
const httpProxy = createServer(async (req, res) => {
  const targetUrl = `http://localhost:3000${req.url}`;
  console.log(`Forwarding request from port 5000 to ${targetUrl}`);
  
  try {
    const targetReq = await fetch(targetUrl, {
      method: req.method,
      headers: req.headers as any,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined,
      redirect: 'manual',
    });
    
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
    res.end('Proxy error: ' + error);
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
      ws.on('message', (message) => {
        if (targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(message.toString());
        }
      });
      
      // Forward messages from target to client
      targetWs.on('message', (message) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message.toString());
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
      ws.on('error', (error) => {
        console.error('WebSocket proxy client error:', error);
      });
      
      targetWs.on('error', (error) => {
        console.error('WebSocket proxy target error:', error);
      });
    });
  }
});

// Start the proxy server
httpProxy.listen(5000, '0.0.0.0', () => {
  console.log('Proxy server running on port 5000, forwarding to port 3000');
});

// Ensure we have WebSocket available
declare const WebSocket: any;