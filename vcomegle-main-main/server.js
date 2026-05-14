const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

let PaymentAPI = null;
try {
    PaymentAPI = require('./payment-api');
} catch (err) {
    console.warn('Payment API module not loaded:', err.message);
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

// Middleware
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(cors());
app.use(morgan('combined'));
app.use(express.static(path.join(__dirname)));

// Store connected users and rooms
const users = new Map();
const rooms = new Map();
const waitingUsers = [];

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('✅ User connected:', socket.id);
    console.log('📊 Current users online:', users.size);
    console.log('⏳ Users waiting:', waitingUsers.length);
    console.log('🏠 Active rooms:', rooms.size);

    // User looking for a match
    socket.on('find-match', (data) => {
        const { textOnly, interests } = data;
        const user = {
            id: socket.id,
            textOnly,
            interests: interests ? interests.split(',').map(i => i.trim()) : [],
            socket: socket
        };

        users.set(socket.id, user);

        const dup = waitingUsers.findIndex((w) => w.id === socket.id);
        if (dup !== -1) waitingUsers.splice(dup, 1);

        // Find a matching user
        const match = findMatch(user);
        
        if (match) {
            pairUsersInRoom(user, match, socket, match.socket);
        } else {
            const othersWaiting = waitingUsers.filter(
                (w) => w.textOnly === user.textOnly && w.id !== user.id
            ).length;
            user.addedTime = Date.now();
            waitingUsers.push(user);
            socket.emit('waiting', { othersWaiting });
            console.log(`⏳ User ${socket.id} added to waiting list (Total: ${waitingUsers.length}, same-mode ahead: ${othersWaiting})`);
        }
    });

    // WebRTC signaling
    socket.on('offer', (data) => {
        const { roomId, offer } = data;
        const room = rooms.get(roomId);
        
        if (room) {
            const otherUser = room.users.find(u => u.id !== socket.id);
            if (otherUser) {
                console.log(`📤 Forwarding offer from ${socket.id} to ${otherUser.id}`);
                otherUser.socket.emit('offer', { offer, from: socket.id });
            } else {
                console.log(`❌ No other user found in room ${roomId} for offer from ${socket.id}`);
            }
        } else {
            console.log(`❌ Room ${roomId} not found for offer from ${socket.id}`);
        }
    });

    socket.on('answer', (data) => {
        const { roomId, answer } = data;
        const room = rooms.get(roomId);
        
        if (room) {
            const otherUser = room.users.find(u => u.id !== socket.id);
            if (otherUser) {
                console.log(`Forwarding answer from ${socket.id} to ${otherUser.id}`);
                otherUser.socket.emit('answer', { answer, from: socket.id });
            } else {
                console.log('No other user found in room for answer');
            }
        } else {
            console.log('Room not found for answer:', roomId);
        }
    });

    socket.on('ice-candidate', (data) => {
        const { roomId, candidate } = data;
        const room = rooms.get(roomId);
        
        if (room) {
            const otherUser = room.users.find(u => u.id !== socket.id);
            if (otherUser) {
                console.log(`🧊 Forwarding ICE candidate from ${socket.id} to ${otherUser.id}`);
                otherUser.socket.emit('ice-candidate', { candidate, from: socket.id });
            } else {
                console.log(`❌ No other user found in room ${roomId} for ICE candidate from ${socket.id}`);
            }
        } else {
            console.log(`❌ Room ${roomId} not found for ICE candidate from ${socket.id}`);
        }
    });

    // Chat messages
    socket.on('chat-message', (data) => {
        const { roomId, message } = data;
        const room = rooms.get(roomId);
        
        if (room) {
            const otherUser = room.users.find(u => u.id !== socket.id);
            if (otherUser) {
                otherUser.socket.emit('chat-message', { message, from: socket.id });
            }
        }
    });

    // User actions
    socket.on('next', () => {
        leaveRoom(socket.id);

        const user = users.get(socket.id);
        if (!user) return;

        const match = findMatch(user);
        if (match) {
            pairUsersInRoom(user, match, socket, match.socket);
            console.log(`Re-matched users ${user.id} and ${match.id}`);
        } else {
            const othersWaiting = waitingUsers.filter(
                (w) => w.textOnly === user.textOnly && w.id !== user.id
            ).length;
            user.addedTime = Date.now();
            waitingUsers.push(user);
            socket.emit('waiting', { othersWaiting });
        }
    });

    socket.on('stop', () => {
        leaveRoom(socket.id);
        socket.emit('disconnected');
    });

    socket.on('report', (data) => {
        const { roomId } = data;
        const room = rooms.get(roomId);
        
        if (room) {
            const otherUser = room.users.find(u => u.id !== socket.id);
            if (otherUser) {
                console.log(`User ${socket.id} reported user ${otherUser.id}`);
                // In production, you'd log this for moderation
            }
        }
        
        leaveRoom(socket.id);
        socket.emit('disconnected');
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        const user = users.get(socket.id);
        if (user) {
            leaveRoom(socket.id);
            
            // Remove from waiting list
            const waitingIndex = waitingUsers.indexOf(user);
            if (waitingIndex > -1) {
                waitingUsers.splice(waitingIndex, 1);
            }
            
            users.delete(socket.id);
        }
    });
});

const findMatch = (user) => {
    console.log(`Finding match for user ${user.id}, textOnly: ${user.textOnly}`);

    const idx = waitingUsers.findIndex(
        (w) => w.id !== user.id && w.textOnly === user.textOnly
    );

    if (idx === -1) {
        console.log(`No compatible peer waiting for ${user.id}`);
        return null;
    }

    const [match] = waitingUsers.splice(idx, 1);
    console.log(`Matched ${user.id} with ${match.id}`);
    return match;
};

function pairUsersInRoom(userA, userB, socketA, socketB) {
    const roomId = generateRoomId();
    const room = {
        id: roomId,
        users: [userA, userB],
        createdAt: new Date()
    };

    rooms.set(roomId, room);

    const userAIsInitiator = Math.random() < 0.5;
    socketA.emit('match-found', {
        roomId,
        strangerId: userB.id,
        isInitiator: userAIsInitiator
    });
    socketB.emit('match-found', {
        roomId,
        strangerId: userA.id,
        isInitiator: !userAIsInitiator
    });

    console.log(`Room ${roomId}: ${userA.id} initiator=${userAIsInitiator}, peer ${userB.id}`);
}

function generateRoomId() {
    return Math.random().toString(36).substr(2, 9);
}

function leaveRoom(userId) {
    // Find and remove user from any room
    for (const [roomId, room] of rooms.entries()) {
        const userIndex = room.users.findIndex(u => u.id === userId);
        
        if (userIndex > -1) {
            const otherUser = room.users.find(u => u.id !== userId);
            
            if (otherUser) {
                otherUser.socket.emit('stranger-disconnected');
                otherUser.addedTime = Date.now();
                waitingUsers.push(otherUser);
            }
            
            rooms.delete(roomId);
            console.log(`User ${userId} left room ${roomId}`);
            break;
        }
    }
}

// Clean up old rooms periodically
setInterval(() => {
    const now = new Date();
    for (const [roomId, room] of rooms.entries()) {
        // Remove rooms older than 1 hour
        if (now - room.createdAt > 3600000) {
            rooms.delete(roomId);
            console.log(`Cleaned up old room ${roomId}`);
        }
    }
}, 300000); // Check every 5 minutes

function publicBaseUrl(req) {
    const fromEnv = process.env.PUBLIC_URL && process.env.PUBLIC_URL.replace(/\/$/, '');
    if (fromEnv) return fromEnv;
    const host = req.get('host') || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    return `${proto}://${host}`;
}

app.get('/robots.txt', (req, res) => {
    const base = publicBaseUrl(req);
    res.type('text/plain').send(
        ['User-agent: *', 'Allow: /', '', `Sitemap: ${base}/sitemap.xml`].join('\n')
    );
});

app.get('/sitemap.xml', (req, res) => {
    const base = publicBaseUrl(req);
    const home = `${base}/`;
    res.type('application/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>` +
            `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
            `<url><loc>${home}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>` +
            `</urlset>`
    );
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        users: users.size,
        rooms: rooms.size,
        waiting: waitingUsers.length
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`VComingle server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);

    if (process.env.ENABLE_PAYMENT_API === 'true' && PaymentAPI) {
        const paymentPort = parseInt(process.env.PAYMENT_PORT || '3001', 10);
        const paymentAPI = new PaymentAPI();
        paymentAPI.start(paymentPort);
        console.log(`Payment API server running on port ${paymentPort}`);
    } else if (PaymentAPI) {
        console.log('Payment API available but not started (set ENABLE_PAYMENT_API=true to enable).');
    }
});
