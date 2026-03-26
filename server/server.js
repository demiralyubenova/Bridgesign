// BridgeSign WebSocket Relay Server
// Lightweight room-based relay for syncing captions between participants

const { WebSocketServer } = require('ws');
const http = require('http');

const HOST = process.env.HOST || '172.20.10.8';
const PORT = process.env.PORT || 3001;
const MAX_ROOM_SIZE = parseInt(process.env.MAX_ROOM_SIZE || "2", 10);
const MAX_MSG_SIZE = 4096;
const RATE_LIMIT_SEC = 60;

// Room management: roomId -> Set of { ws, role, id }
const rooms = new Map();
const clientRooms = new Map(); // ws -> roomId for O(1) lookup
let clientId = 0;
const rateLimits = new Map(); // id -> { count, start }

// HTTP server for health checks
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size, clients: clientId }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, maxPayload: MAX_MSG_SIZE });
server.listen(PORT, HOST, () => {
  console.log(`\n  🤟 BridgeSign Relay Server\n  ───────────────────────\n  Host: ${HOST}\n  Port: ${PORT}\n  Status: Ready\n`);
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const id = ++clientId;
  let currentRoom = null;
  let currentRole = null;

  console.log(`[+] Client ${id} connected`);

  ws.on('message', (raw) => {
    // Rate limiting
    const now = Date.now();
    let limit = rateLimits.get(id) || { count: 0, start: now };
    if (now - limit.start > 1000) {
      limit = { count: 0, start: now };
    }
    limit.count++;
    rateLimits.set(id, limit);

    if (limit.count > RATE_LIMIT_SEC) {
      console.warn(`[!] Client ${id} rate limited. Disconnecting.`);
      ws.close(1008, "Rate limit exceeded");
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      console.error(`[!] Client ${id}: Invalid JSON`);
      return ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid JSON' }));
    }

    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      console.error(`[!] Client ${id}: Payload must be a JSON object`);
      return ws.send(JSON.stringify({ type: 'ERROR', message: 'Payload must be a JSON object' }));
    }

    if (typeof msg.type !== 'string') {
      console.error(`[!] Client ${id}: Missing or invalid message type`);
      return ws.send(JSON.stringify({ type: 'ERROR', message: 'Missing or invalid message type' }));
    }

    switch (msg.type) {
      case 'JOIN': {
        const { roomId, role } = msg;
        if (typeof roomId !== 'string' || roomId.trim() === '') {
          return ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid or missing roomId' }));
        }
        if (role && typeof role !== 'string') {
          return ws.send(JSON.stringify({ type: 'ERROR', message: 'Role must be a string' }));
        }

        // Check room size limit
        const existingRoom = rooms.get(roomId);
        if (existingRoom && existingRoom.size >= MAX_ROOM_SIZE) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Room is full' }));
          console.warn(`[x] Client ${id} rejected from full room "${roomId}"`);
          return;
        }

        // Leave previous room if any
        leaveRoom(ws, id);

        // Join new room
        currentRoom = roomId;
        currentRole = role || 'unknown';
        clientRooms.set(ws, roomId);

        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Set());
        }

        const room = rooms.get(roomId);
        room.add({ ws, role: currentRole, id });

        console.log(`[>] Client ${id} joined room "${roomId}" as ${currentRole} (${room.size} in room)`);

        // Notify others in room
        broadcastToRoom(roomId, ws, {
          type: 'PEER_JOINED',
          data: { id, role: currentRole, count: room.size },
        });

        // Send current room info back
        ws.send(JSON.stringify({
          type: 'ROOM_INFO',
          data: { roomId, peers: room.size - 1 },
        }));
        break;
      }

      case 'LEAVE': {
        leaveRoom(ws, id);
        break;
      }

      case 'PING': {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: msg.timestamp }));
        break;
      }

      case 'CAPTION': {
        if (!currentRoom) return;

        if (!msg.data || typeof msg.data !== 'object' || Array.isArray(msg.data)) {
           return ws.send(JSON.stringify({ type: 'ERROR', message: 'CAPTION requires a data object' }));
        }
        if (typeof msg.data.text !== 'string') {
           return ws.send(JSON.stringify({ type: 'ERROR', message: 'CAPTION data.text must be a string' }));
        }

        // Relay caption to all others in room
        broadcastToRoom(currentRoom, ws, {
          type: 'CAPTION',
          data: {
            ...msg.data,
            senderId: id,
            senderRole: currentRole,
          },
        });
        break;
      }

      case 'SIGN_PLAN': {
        if (!currentRoom) return;

        broadcastToRoom(currentRoom, ws, {
          type: 'SIGN_PLAN',
          data: {
            ...msg.data,
            senderId: id,
            senderRole: currentRole,
          },
        });
        break;
      }

      default:
        console.log(`[?] Client ${id}: Unknown message type "${msg.type}"`);
    }
  });

  ws.on('close', () => {
    console.log(`[-] Client ${id} disconnected`);
    rateLimits.delete(id);
    leaveRoom(ws, id);
  });

  ws.on('error', (err) => {
    console.error(`[!] Client ${id} error:`, err.message);
  });
});

function leaveRoom(ws, id) {
  const roomId = clientRooms.get(ws);
  if (!roomId) return;

  const members = rooms.get(roomId);
  if (members) {
    for (const member of members) {
      if (member.ws === ws) {
        members.delete(member);
        console.log(`[<] Client ${id} left room "${roomId}" (${members.size} remaining)`);

        // Notify others
        broadcastToRoom(roomId, ws, {
          type: 'PEER_LEFT',
          data: { id, count: members.size },
        });

        // Clean up empty rooms
        if (members.size === 0) {
          rooms.delete(roomId);
          console.log(`[x] Room "${roomId}" deleted (empty)`);
        }
        break;
      }
    }
  }
  clientRooms.delete(ws);
}

function broadcastToRoom(roomId, senderWs, msg) {
  const room = rooms.get(roomId);
  if (!room) return;

  const data = JSON.stringify(msg);
  for (const member of room) {
    if (member.ws !== senderWs && member.ws.readyState === 1) {
      member.ws.send(data);
    }
  }
}

// Periodic room stats
setInterval(() => {
  if (rooms.size > 0) {
    let total = 0;
    for (const members of rooms.values()) total += members.size;
    console.log(`[i] Active: ${rooms.size} rooms, ${total} clients`);
  }
}, 30000);

// Heartbeat (Ping/Pong) to prevent idle timeouts
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log(`[!] Client terminated due to inactivity heartbeat`);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(interval));
