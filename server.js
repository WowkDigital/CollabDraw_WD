import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

// Resolve directory paths in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// MIME types dictionary for static file serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

// 1. Create HTTP Server for static files
const server = http.createServer((req, res) => {
  // Prevent path traversal attacks
  let safePath = req.url.split('?')[0];
  if (safePath === '/') {
    safePath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, safePath);

  // Validate the file path remains inside the public directory
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Set client caching headers for PWA assets:
    // Service Worker and Manifest should not be aggressively cached
    if (safePath === '/sw.js' || safePath === '/manifest.json') {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      });
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600' // 1 hour browser cache
      });
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', (streamErr) => {
      console.error(`Stream error: ${streamErr.message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
    });
    stream.pipe(res);
  });
});

// 2. Initialize WebSocket Signaling Server
const wss = new WebSocketServer({ noServer: true });

// Map of topic/room names to sets of WebSocket connections
const topics = new Map();

wss.on('connection', (ws) => {
  // Set to keep track of topics this client is subscribed to
  const clientSubscribedTopics = new Set();

  ws.on('message', (message) => {
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(message.toString());
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
      return;
    }

    const { type, topics: msgTopics, topic, ...rest } = parsedMessage;

    switch (type) {
      case 'subscribe':
        if (Array.isArray(msgTopics)) {
          msgTopics.forEach((topicName) => {
            if (typeof topicName !== 'string') return;
            
            if (!topics.has(topicName)) {
              topics.set(topicName, new Set());
            }
            topics.get(topicName).add(ws);
            clientSubscribedTopics.add(topicName);
          });
        }
        break;

      case 'unsubscribe':
        if (Array.isArray(msgTopics)) {
          msgTopics.forEach((topicName) => {
            if (typeof topicName !== 'string') return;

            const subscribers = topics.get(topicName);
            if (subscribers) {
              subscribers.delete(ws);
              if (subscribers.size === 0) {
                topics.delete(topicName);
              }
            }
            clientSubscribedTopics.delete(topicName);
          });
        }
        break;

      case 'publish':
        if (typeof topic === 'string') {
          const subscribers = topics.get(topic);
          if (subscribers) {
            const rawMessage = JSON.stringify({ type, topic, ...rest });
            subscribers.forEach((client) => {
              if (client !== ws && client.readyState === 1) { // 1 = OPEN
                client.send(rawMessage);
              }
            });
          }
        }
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      default:
        console.warn('Unknown message type received:', type);
        break;
    }
  });

  ws.on('close', () => {
    // Clean up subscriptions when connection closes
    clientSubscribedTopics.forEach((topicName) => {
      const subscribers = topics.get(topicName);
      if (subscribers) {
        subscribers.delete(ws);
        if (subscribers.size === 0) {
          topics.delete(topicName);
        }
      }
    });
    clientSubscribedTopics.clear();
  });

  ws.on('error', (err) => {
    console.error('WebSocket connection error:', err);
  });
});

// Upgrade HTTP server connections to WebSockets when requested
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Start Server listening
server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`WebSocket signaling broker active.`);
});
