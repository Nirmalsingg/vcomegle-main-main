const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const RewardedEntitlements = require('./rewarded-entitlements');

let PaymentAPI = null;
try {
    PaymentAPI = require('./payment-api');
} catch (err) {
    console.warn('Payment API module not loaded:', err.message);
}

const app = express();
const server = http.createServer(app);
const freeGenderFilterEnabled = process.env.VCOMINGLE_FREE_GENDER_FILTER !== 'false';
const genderEntitlements = new RewardedEntitlements();
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

const PUBLIC_PAGES = [
    { path: '/', changefreq: 'weekly', priority: '1.0' },
    { path: '/random-video-chat', changefreq: 'weekly', priority: '0.9' },
    { path: '/anonymous-chat', changefreq: 'weekly', priority: '0.9' },
    { path: '/text-chat', changefreq: 'weekly', priority: '0.9' },
    { path: '/meet-new-people-online', changefreq: 'weekly', priority: '0.9' },
    { path: '/premium-features.html', changefreq: 'monthly', priority: '0.8' },
    { path: '/about.html', changefreq: 'monthly', priority: '0.7' },
    { path: '/contact.html', changefreq: 'monthly', priority: '0.7' },
    { path: '/privacy.html', changefreq: 'monthly', priority: '0.8' },
    { path: '/terms.html', changefreq: 'monthly', priority: '0.8' },
    { path: '/content-policy.html', changefreq: 'monthly', priority: '0.8' }
];

// Middleware
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(cors());
app.use(morgan('combined'));

let paymentAPI = null;
if (PaymentAPI) {
    paymentAPI = new PaymentAPI();
}

app.use('/api/rewarded-ads', express.json({
    limit: '100kb',
    verify: (req, res, buf) => {
        req.rawBody = buf.toString('utf8');
    }
}));

app.get('/api/gender-filter/access', (req, res) => {
    const userId = normalizeUserId(req.query.userId);
    const entitlementToken = String(req.query.entitlementToken || '');
    const hasPremium = hasServerVerifiedPremium(userId);
    const hasReward = genderEntitlements.hasGenderFilterAccess({
        userId,
        token: entitlementToken,
        hasPremium: false,
        freeOverride: false
    });

    return res.json({
        success: true,
        free: freeGenderFilterEnabled,
        premium: hasPremium,
        rewarded: hasReward,
        hasGenderFilter: freeGenderFilterEnabled || hasPremium || hasReward,
        rewardDurationSeconds: RewardedEntitlements.GENDER_FILTER_REWARD_MS / 1000
    });
});

app.post('/api/rewarded-ads/session', (req, res) => {
    const session = genderEntitlements.createRewardedAdSession(req.body && req.body.userId);
    return res.status(201).json({
        success: true,
        session,
        message: 'Rewarded-ad session created. Gender entitlement is granted only after provider completion confirmation.'
    });
});

app.get('/api/rewarded-ads/:sessionId/status', (req, res) => {
    const session = genderEntitlements.getRewardedAdSession(
        req.params.sessionId,
        req.query.userId
    );

    if (!session) {
        return res.status(404).json({
            success: false,
            message: 'Rewarded-ad session not found.'
        });
    }

    return res.json({ success: true, session });
});

app.post('/api/rewarded-ads/provider-confirmation', (req, res) => {
    const result = genderEntitlements.confirmRewardedAdCompletion(
        req.body,
        req.get('X-Rewarded-Ad-Signature'),
        req.rawBody
    );

    if (!result.ok) {
        return res.status(result.statusCode || 400).json({
            success: false,
            message: result.message
        });
    }

    return res.json({
        success: true,
        session: result.session,
        replayed: Boolean(result.replayed)
    });
});

if (paymentAPI) {
    app.use((req, res, next) => {
        if (req.path === '/api' || req.path.startsWith('/api/')) {
            return paymentAPI.app(req, res, next);
        }
        return next();
    });
}

app.get('/robots.txt', (req, res) => {
    const base = publicBaseUrl(req);
    res.type('text/plain').send(
        `User-agent: *\n` +
            `Allow: /\n\n` +
            `Sitemap: ${base}/sitemap.xml\n`
    );
});

app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml').send(generateSitemapXml(publicBaseUrl(req)));
});

app.use(express.static(path.join(__dirname), {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.js') {
            res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
        } else if (['.css', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.woff', '.woff2'].includes(ext)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        } else if (ext === '.html' || ext === '.xml' || ext === '.txt') {
            res.setHeader('Cache-Control', 'public, max-age=300');
        }
    }
}));

// Store connected users and rooms
const users = new Map();
const rooms = new Map();
const waitingUsers = [];
const moderationReports = [];
const REPORT_REASONS = new Set([
    'sexual-content',
    'child-safety',
    'harassment',
    'violence',
    'scam',
    'privacy',
    'other'
]);
const MODERATION_REPORT_THRESHOLD = 3;
const MAX_MODERATION_REPORTS = 1000;
const moderationReportFile = process.env.MODERATION_REPORT_FILE || path.join(__dirname, 'data', 'moderation-reports.ndjson');

app.get('/api/moderation/reports', (req, res) => {
    const moderationKey = process.env.MODERATION_API_KEY;
    if (!moderationKey || req.get('X-Moderation-Key') !== moderationKey) {
        return res.status(403).json({ success: false, message: 'Forbidden.' });
    }
    return res.json({ success: true, reports: moderationReports });
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('✅ User connected:', socket.id);
    console.log('📊 Current users online:', users.size);
    console.log('⏳ Users waiting:', waitingUsers.length);
    console.log('🏠 Active rooms:', rooms.size);

    // User looking for a match
    socket.on('find-match', (data) => {
        const { textOnly, interests, selfGender, partnerGender, tier, userId, genderEntitlementToken } = data || {};
        const existingUser = users.get(socket.id);
        if (existingUser && existingUser.moderationRestricted) {
            socket.emit('moderation-action', {
                message: 'This session is unavailable while moderation reviews reports.'
            });
            return;
        }
        const normalizedUserId = normalizeUserId(userId);
        const verifiedPremium = hasServerVerifiedPremium(normalizedUserId);
        const requestedPartnerGender = normalizePartnerGender(partnerGender);
        removeWaitingUser(socket.id);
        const user = {
            id: socket.id,
            userId: normalizedUserId,
            textOnly: !!textOnly,
            interests: interests ? interests.split(',').map(i => i.trim()) : [],
            selfGender: normalizeSelfGender(selfGender),
            requestedPartnerGender,
            partnerGender: requestedPartnerGender,
            genderEntitlementToken: String(genderEntitlementToken || ''),
            tier: verifiedPremium && (tier === 'premium' || tier === 'vip') ? tier : 'free',
            blockedUsers: new Set(existingUser ? existingUser.blockedUsers : []),
            reporterIds: new Set(existingUser ? existingUser.reporterIds : []),
            moderationRestricted: Boolean(existingUser && existingUser.moderationRestricted),
            socket: socket
        };
        refreshGenderFilterAccess(user);

        users.set(socket.id, user);

        // Find a matching user
        const match = findMatch(user);
        
        if (match) {
            pairUsersInRoom(user, match, socket, match.socket);
        } else {
            const othersWaiting = waitingUsers.filter(
                (w) => w.textOnly === user.textOnly && w.id !== user.id
            ).length;
            queueUser(user);
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

    socket.on('virtual-gift', (data) => {
        const { roomId, giftType } = data;
        const room = rooms.get(roomId);

        if (room) {
            const otherUser = room.users.find(u => u.id !== socket.id);
            if (otherUser) {
                otherUser.socket.emit('virtual-gift', { giftType, from: socket.id });
            }
        }
    });

    // User actions
    socket.on('next', (data = {}) => {
        leaveRoom(socket.id);
        removeWaitingUser(socket.id);

        const user = users.get(socket.id);
        if (!user) return;
        if (Object.prototype.hasOwnProperty.call(data, 'selfGender')) {
            user.selfGender = normalizeSelfGender(data.selfGender);
        }
        if (Object.prototype.hasOwnProperty.call(data, 'partnerGender')) {
            user.requestedPartnerGender = normalizePartnerGender(data.partnerGender);
        }
        if (data.genderEntitlementToken) {
            user.genderEntitlementToken = String(data.genderEntitlementToken);
        }
        refreshGenderFilterAccess(user);

        const match = findMatch(user);
        if (match) {
            pairUsersInRoom(user, match, socket, match.socket);
            console.log(`Re-matched users ${user.id} and ${match.id}`);
        } else {
            const othersWaiting = waitingUsers.filter(
                (w) => w.textOnly === user.textOnly && w.id !== user.id
            ).length;
            queueUser(user);
            socket.emit('waiting', { othersWaiting });
        }
    });

    socket.on('cancel-search', () => {
        const removed = removeWaitingUser(socket.id);
        console.log(`Search cancelled by ${socket.id}; removedFromQueue=${removed}; waiting=${waitingUsers.length}`);
        socket.emit('search-cancelled');
    });

    socket.on('stop', () => {
        leaveRoom(socket.id);
        socket.emit('disconnected');
    });

    socket.on('report', (data = {}) => {
        const { roomId } = data;
        const room = rooms.get(roomId);
        const reporter = users.get(socket.id);

        if (room && reporter && isRoomParticipant(room, socket.id)) {
            const otherUser = room.users.find(u => u.id !== socket.id);
            if (otherUser) {
                const reason = REPORT_REASONS.has(data.reason) ? data.reason : 'other';
                const details = normalizeReportDetails(data.details);
                if (data.blockUser !== false) reporter.blockedUsers.add(otherUser.id);

                const isNewReporter = !otherUser.reporterIds.has(socket.id);
                otherUser.reporterIds.add(socket.id);
                recordModerationReport({
                    roomId,
                    reporterId: socket.id,
                    reportedUserId: otherUser.id,
                    reason,
                    details,
                    createdAt: new Date().toISOString()
                });
                console.log(`User ${socket.id} reported user ${otherUser.id}: ${reason}`);

                if (isNewReporter && otherUser.reporterIds.size >= MODERATION_REPORT_THRESHOLD) {
                    otherUser.moderationRestricted = true;
                    otherUser.socket.emit('moderation-action', {
                        message: 'This session is unavailable while moderation reviews reports.'
                    });
                    leaveRoom(otherUser.id);
                }
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
            removeWaitingUser(socket.id);
            
            users.delete(socket.id);
        }
    });
});

function normalizeUserId(value) {
    const userId = String(value || '').trim();
    return /^[A-Za-z0-9._-]{3,80}$/.test(userId) ? userId : 'anonymous';
}

function normalizeGenderValue(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeSelfGender(value) {
    const gender = normalizeGenderValue(value);
    return gender === 'male' || gender === 'female' ? gender : 'unspecified';
}

function normalizePartnerGender(value) {
    const gender = normalizeGenderValue(value);
    return gender === 'male' || gender === 'female' ? gender : 'random';
}

function normalizeReportDetails(value) {
    return String(value || '')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .trim()
        .slice(0, 500);
}

function recordModerationReport(report) {
    moderationReports.push(report);
    if (moderationReports.length > MAX_MODERATION_REPORTS) moderationReports.shift();

    fs.mkdir(path.dirname(moderationReportFile), { recursive: true }, (directoryError) => {
        if (directoryError) {
            console.error('Could not create moderation report directory:', directoryError.message);
            return;
        }
        fs.appendFile(moderationReportFile, `${JSON.stringify(report)}\n`, 'utf8', (writeError) => {
            if (writeError) {
                console.error('Could not persist moderation report:', writeError.message);
            }
        });
    });
}

function hasServerVerifiedPremium(userId) {
    return Boolean(
        paymentAPI &&
        typeof paymentAPI.hasActiveSubscription === 'function' &&
        paymentAPI.hasActiveSubscription(userId, 'premium')
    );
}

function refreshGenderFilterAccess(user) {
    if (!user) return false;

    const hasGenderFilter = genderEntitlements.hasGenderFilterAccess({
        userId: user.userId,
        token: user.genderEntitlementToken,
        hasPremium: hasServerVerifiedPremium(user.userId),
        freeOverride: freeGenderFilterEnabled
    });

    user.partnerGender = hasGenderFilter ? user.requestedPartnerGender : 'random';
    return hasGenderFilter;
}

function gendersCompatible(a, b) {
    refreshGenderFilterAccess(a);
    refreshGenderFilterAccess(b);

    return matchesRequestedGender(a, b) && matchesRequestedGender(b, a);
}

function matchesRequestedGender(requester, candidate) {
    const requestedGender = normalizePartnerGender(requester && requester.partnerGender);
    if (requestedGender === 'random') return true;

    return normalizeSelfGender(candidate && candidate.selfGender) === requestedGender;
}

const findMatch = (user) => {
    console.log(
        `Finding match for ${user.id}: own=${user.selfGender}, wants=${user.partnerGender}, textOnly=${user.textOnly}, queue=${waitingUsers.length}`
    );
    pruneWaitingUsers();

    const idx = waitingUsers.findIndex((w) => {
        const sameMode = w.textOnly === user.textOnly;
        const available = w.id !== user.id && w.socket.connected && !isUserInRoom(w.id);
        const notBlocked = !user.blockedUsers.has(w.id) && !w.blockedUsers.has(user.id);
        const compatible = available && sameMode && notBlocked && gendersCompatible(user, w);

        console.log(
            `Candidate ${w.id} for ${user.id}: own=${w.selfGender}, wants=${w.partnerGender}, sameMode=${sameMode}, available=${available}, compatible=${compatible}`
        );

        return compatible;
    });

    if (idx === -1) {
        console.log(`No compatible peer waiting for ${user.id}`);
        return null;
    }

    const [match] = waitingUsers.splice(idx, 1);
    console.log(`Matched ${user.id} with ${match.id}`);
    return match;
};

function queueUser(user) {
    if (!user || !user.socket.connected || isUserInRoom(user.id)) return;
    removeWaitingUser(user.id);
    user.addedTime = Date.now();
    if (user.tier === 'premium' || user.tier === 'vip') {
        waitingUsers.unshift(user);
    } else {
        waitingUsers.push(user);
    }
}

function removeWaitingUser(userId) {
    let removed = 0;
    let idx = waitingUsers.findIndex((w) => w.id === userId);
    while (idx !== -1) {
        waitingUsers.splice(idx, 1);
        removed += 1;
        idx = waitingUsers.findIndex((w) => w.id === userId);
    }
    return removed;
}

function pruneWaitingUsers() {
    for (let i = waitingUsers.length - 1; i >= 0; i--) {
        const user = waitingUsers[i];
        if (!user.socket.connected || isUserInRoom(user.id)) {
            waitingUsers.splice(i, 1);
        }
    }
}

function isUserInRoom(userId) {
    for (const room of rooms.values()) {
        if (room.users.some((u) => u.id === userId)) return true;
    }
    return false;
}

function isRoomParticipant(room, userId) {
    return Boolean(room && room.users.some((user) => user.id === userId));
}

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
    removeWaitingUser(userId);
    // Find and remove user from any room
    for (const [roomId, room] of rooms.entries()) {
        const userIndex = room.users.findIndex(u => u.id === userId);
        
        if (userIndex > -1) {
            const otherUser = room.users.find(u => u.id !== userId);
            
            if (otherUser) {
                otherUser.socket.emit('stranger-disconnected');
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

function generateSitemapXml(base) {
    const urls = PUBLIC_PAGES.map((page) => {
        const loc = page.path === '/' ? `${base}/` : `${base}${page.path}`;
        return (
            `<url>` +
            `<loc>${loc}</loc>` +
            `<changefreq>${page.changefreq}</changefreq>` +
            `<priority>${page.priority}</priority>` +
            `</url>`
        );
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve policy pages
app.get('/privacy.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'privacy.html'));
});

app.get('/terms.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'terms.html'));
});

app.get('/content-policy.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'content-policy.html'));
});

app.get('/contact.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'contact.html'));
});

app.get('/about.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'about.html'));
});

app.get('/premium-features.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'premium-features.html'));
});

app.get('/random-video-chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'random-video-chat.html'));
});

app.get('/anonymous-chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'anonymous-chat.html'));
});

app.get('/text-chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'text-chat.html'));
});

app.get('/meet-new-people-online', (req, res) => {
    res.sendFile(path.join(__dirname, 'meet-new-people-online.html'));
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
        new PaymentAPI().start(paymentPort);
        console.log(`Payment API server running on port ${paymentPort}`);
    } else if (paymentAPI) {
        console.log('Payment API mounted on the main server.');
    }
});
