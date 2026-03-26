// Basic Automated Testing Template for WebSocket Relay
const WebSocket = require('ws');
const assert = require('assert');

// Note: Ensure the server (`node server.js`) is running locally on port 3001 before running this file via Node.

console.log("Running local Relay tests...\n");

const url = 'ws://localhost:3001';
const clientA = new WebSocket(url);
const clientB = new WebSocket(url);

const ROOM_ID = "test-room-123";

let bReceivedCaption = false;

clientA.on('open', () => {
    clientA.send(JSON.stringify({ type: 'JOIN', roomId: ROOM_ID, role: 'signer' }));
});

clientB.on('open', () => {
    clientB.send(JSON.stringify({ type: 'JOIN', roomId: ROOM_ID, role: 'speaker' }));
    
    // Once B joins, have A send a caption
    setTimeout(() => {
        clientA.send(JSON.stringify({ 
            type: 'CAPTION', 
            data: { text: "Hello from tests" } 
        }));
    }, 500);
});

clientB.on('message', (raw) => {
    const msg = JSON.parse(raw);
    
    if (msg.type === 'CAPTION' && msg.data.text === "Hello from tests") {
        bReceivedCaption = true;
        console.log("✅ Success: Client B received Client A's caption relay!");
        
        // Cleanup
        clientA.close();
        clientB.close();
        process.exit(0);
    }
});

// Timeout fail-safe
setTimeout(() => {
    if (!bReceivedCaption) {
        console.error("❌ Failed: Client B did not receive the caption relay in time.");
        process.exit(1);
    }
}, 3000);
