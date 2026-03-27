# SignFlow WebSocket API Contract

This document outlines the exact JSON schemas accepted and emitted by the `server.js` WebSocket relay. Extension developers (Person 3) must conform to these structures to interact with the backend.

## Client -> Server Messages

### 1. JOIN
Sent when a participant wants to join a meeting room.
```json
{
  "type": "JOIN",
  "roomId": "string (Required)",
  "role": "signer | speaker (Optional)"
}
```

### 2. LEAVE
Sent when a participant manually disconnects (closing the window will implicitly leave and clean up automatically).
```json
{
  "type": "LEAVE"
}
```

### 3. CAPTION
Sent by a Signer to broadcast translations, or a Speaker to broadcast speech-to-text.
```json
{
  "type": "CAPTION",
  "data": {
    "text": "string (Required)",
    "isFinal": "boolean (Optional)"
  }
}
```

## Server -> Client Messages

### 1. ROOM_INFO
Sent to the client immediately after successfully joining.
```json
{
  "type": "ROOM_INFO",
  "data": {
    "roomId": "string",
    "peers": "number (count of others currently in the room)"
  }
}
```

### 2. PEER_JOINED / PEER_LEFT
Broadcasted to all members of the room when someone enters or leaves.
```json
{
  "type": "PEER_JOINED | PEER_LEFT",
  "data": {
    "id": "number",
    "role": "string (if joined)",
    "count": "number (total members now in room)"
  }
}
```

### 3. ERROR
Sent directly to the offending client if they send bad data, miss a required field, or if the room is over capacity.
```json
{
  "type": "ERROR",
  "message": "string (reason for error)"
}
```
