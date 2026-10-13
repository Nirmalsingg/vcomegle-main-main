const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATA_FILE = process.env.AUTH_DATA_FILE || path.join(__dirname, 'data', 'accounts.json');
const TOKEN_TTL_MS = Number(process.env.AUTH_TOKEN_TTL_MS || 1000 * 60 * 60 * 24 * 14);
const RESET_TTL_MS = 1000 * 60 * 30;
const VERIFICATION_TTL_MS = Number(process.env.EMAIL_VERIFICATION_TTL_MS || 1000 * 60 * 60 * 24);
const VERIFICATION_RESEND_COOLDOWN_MS = Number(process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_MS || 1000 * 60);
const secret = process.env.AUTH_TOKEN_SECRET;
if (!secret && process.env.NODE_ENV === 'production') throw new Error('AUTH_TOKEN_SECRET is required in production.');
const signingSecret = secret || 'development-only-change-me';
const attempts = new Map();

function readStore() {
    try {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return { accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [], reports: Array.isArray(parsed.reports) ? parsed.reports : [] };
    } catch (error) {
        if (error.code === 'ENOENT') return { accounts: [], reports: [] };
        throw error;
    }
}
let store = readStore();
function persist() {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const temp = `${DATA_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
    fs.renameSync(temp, DATA_FILE);
}
function now() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }
function b64(value) { return Buffer.from(value).toString('base64url'); }
function unb64(value) { return Buffer.from(value, 'base64url').toString('utf8'); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => {
        if (err) reject(err); else resolve(`${salt}:${key.toString('hex')}`);
    }));
}
async function passwordsMatch(password, stored) {
    const [salt, expected] = String(stored || '').split(':');
    if (!salt || !expected) return false;
    const actual = await hashPassword(password, salt);
    return crypto.timingSafeEqual(Buffer.from(actual.split(':')[1], 'hex'), Buffer.from(expected, 'hex'));
}
function sign(payload) {
    const body = b64(JSON.stringify(payload));
    const signature = crypto.createHmac('sha256', signingSecret).update(body).digest('base64url');
    return `${body}.${signature}`;
}
function verify(token) {
    const [body, signature] = String(token || '').split('.');
    if (!body || !signature) return null;
    const expected = crypto.createHmac('sha256', signingSecret).update(body).digest('base64url');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
        const value = JSON.parse(unb64(body));
        return value.exp > Date.now() ? value : null;
    } catch (_) { return null; }
}
function issue(account) {
    return sign({ sub: account.id, sv: Number(account.sessionVersion || 0), sid: id(), exp: Date.now() + TOKEN_TTL_MS });
}
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function appBaseUrl() {
    const value = String(process.env.APP_BASE_URL || '').replace(/\/$/, '');
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) return '';
        if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') return '';
        return url.origin;
    } catch (_) { return ''; }
}
function mailConfigIsValid() {
    return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && appBaseUrl());
}
if (!mailConfigIsValid() && process.env.NODE_ENV === 'production') {
    throw new Error('RESEND_API_KEY, EMAIL_FROM, and APP_BASE_URL are required in production.');
}
async function sendEmail({ to, subject, text, html }) {
    if (!mailConfigIsValid()) throw new Error('EMAIL_NOT_CONFIGURED');
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text, html })
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const error = new Error(`Resend rejected the email (${response.status}).`);
        error.detail = detail.slice(0, 500);
        throw error;
    }
}
async function sendVerificationEmail(account, { force = false } = {}) {
    if (!mailConfigIsValid()) throw new Error('EMAIL_NOT_CONFIGURED');
    const lastSent = Date.parse(account.verificationLastSentAt || '');
    if (!force && Number.isFinite(lastSent) && Date.now() - lastSent < VERIFICATION_RESEND_COOLDOWN_MS) {
        const error = new Error('VERIFICATION_COOLDOWN');
        error.retryAfterMs = VERIFICATION_RESEND_COOLDOWN_MS - (Date.now() - lastSent);
        throw error;
    }
    const previous = {
        hash: account.emailVerificationTokenHash,
        expires: account.emailVerificationExpiresAt,
        sent: account.verificationLastSentAt,
        updated: account.updatedAt
    };
    const token = crypto.randomBytes(32).toString('hex');
    account.emailVerificationTokenHash = tokenHash(token);
    account.emailVerificationExpiresAt = Date.now() + VERIFICATION_TTL_MS;
    account.verificationLastSentAt = now();
    account.updatedAt = now();
    const link = `${appBaseUrl()}/verify-email#token=${encodeURIComponent(token)}`;
    try {
        await sendEmail({
            to: account.email,
            subject: 'Verify your VComingle email',
            text: `Verify your email within ${Math.floor(VERIFICATION_TTL_MS / 3600000)} hours: ${link}`,
            html: `<p>Verify your VComingle email address within ${Math.floor(VERIFICATION_TTL_MS / 3600000)} hours.</p><p><a href="${link}">Verify email</a></p>`
        });
        persist();
    } catch (error) {
        account.emailVerificationTokenHash = previous.hash;
        account.emailVerificationExpiresAt = previous.expires;
        account.verificationLastSentAt = previous.sent;
        account.updatedAt = previous.updated;
        for (const [property, value] of Object.entries({
            emailVerificationTokenHash: previous.hash,
            emailVerificationExpiresAt: previous.expires,
            verificationLastSentAt: previous.sent
        })) if (value === undefined) delete account[property];
        throw error;
    }
}
async function sendPasswordResetEmail(account) {
    if (!mailConfigIsValid()) throw new Error('EMAIL_NOT_CONFIGURED');
    const resetToken = crypto.randomBytes(32).toString('hex');
    account.resetTokenHash = tokenHash(resetToken);
    account.resetExpiresAt = Date.now() + RESET_TTL_MS;
    account.updatedAt = now();
    persist();
    const link = `${appBaseUrl()}/reset-password#token=${encodeURIComponent(resetToken)}`;
    await sendEmail({
        to: account.email,
        subject: 'Reset your VComingle password',
        text: `Reset your password within 30 minutes: ${link}`,
        html: `<p>Reset your VComingle password within 30 minutes.</p><p><a href="${link}">Reset password</a></p>`
    });
}
function isAdmin(account) {
    const allowed = String(process.env.ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
    return allowed.includes(String(account?.email || '').toLowerCase());
}
function publicAccount(account) {
    return { id: account.id, name: account.name, email: account.email, emailVerified: Boolean(account.emailVerifiedAt), ageEligible: Boolean(account.ageConfirmedAt), isAdmin: isAdmin(account), moderationStatus: account.moderationStatus || 'active' };
}
function rateLimit(req, res, next) {
    const key = `${req.ip}:${req.path}`;
    const state = attempts.get(key) || { count: 0, reset: Date.now() + 15 * 60 * 1000 };
    if (Date.now() > state.reset) { state.count = 0; state.reset = Date.now() + 15 * 60 * 1000; }
    state.count += 1; attempts.set(key, state);
    if (state.count > 20) return res.status(429).json({ success: false, message: 'Too many attempts. Please try again later.' });
    next();
}
function tokenFrom(req) {
    const value = req.get('Authorization') || '';
    return value.startsWith('Bearer ') ? value.slice(7) : '';
}
function authenticate(req, res, next) {
    const payload = verify(tokenFrom(req));
    const account = payload && store.accounts.find((item) => item.id === payload.sub && !item.deletedAt && Number(payload.sv || 0) === Number(item.sessionVersion || 0));
    if (!account) return res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
    if (!account.emailVerifiedAt) return res.status(403).json({ success: false, code: 'EMAIL_VERIFICATION_REQUIRED', message: 'Verify your email address before continuing.' });
    req.account = account; next();
}
function requireAdult(req, res, next) {
    if (!req.account.ageConfirmedAt) return res.status(403).json({ success: false, code: 'AGE_CONFIRMATION_REQUIRED', message: 'Confirm that you are 18 or older before using chat.' });
    next();
}
function requireAdmin(req, res, next) {
    if (!isAdmin(req.account)) return res.status(403).json({ success: false, message: 'Administrator access is required.' });
    next();
}
function accountCanChat(account) {
    return Boolean(account && !account.bannedAt && !(account.suspendedUntil && new Date(account.suspendedUntil) > new Date()));
}
function blockAccount(blockerId, blockedId) {
    if (!blockerId || !blockedId || blockerId === blockedId) return false;
    const blocker = store.accounts.find((account) => account.id === blockerId);
    const blocked = store.accounts.find((account) => account.id === blockedId);
    if (!blocker || !blocked) return false;
    blocker.blockedAccounts = Array.isArray(blocker.blockedAccounts) ? blocker.blockedAccounts : [];
    if (blocker.blockedAccounts.some((entry) => entry.accountId === blockedId)) return true;
    blocker.blockedAccounts.push({ accountId: blockedId, createdAt: now() }); blocker.updatedAt = now(); persist(); return true;
}
function accountsAreBlocked(a, b) {
    return Boolean(a?.blockedAccounts?.some((entry) => entry.accountId === b?.id) || b?.blockedAccounts?.some((entry) => entry.accountId === a?.id));
}
function createReport({ reporterId, reportedId, roomId, reason, details }) {
    const report = { id: id(), reporterId, reportedId, roomId: String(roomId || '').slice(0, 100), reason, details: String(details || '').slice(0, 500), status: 'open', createdAt: now() };
    store.reports.push(report); if (store.reports.length > 10000) store.reports.shift(); persist(); return report;
}
function register(app, { onAccountAction } = {}) {
    app.post('/api/auth/register', rateLimit, async (req, res, next) => {
        try {
            const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
            const email = String(req.body?.email || '').trim().toLowerCase();
            const password = String(req.body?.password || '');
            if (name.length < 2 || name.length > 80) return res.status(400).json({ success: false, message: 'Enter a name between 2 and 80 characters.' });
            if (!EMAIL.test(email) || email.length > 254) return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
            if (password.length < 10 || password.length > 256) return res.status(400).json({ success: false, message: 'Password must be between 10 and 256 characters.' });
            if (req.body?.ageConfirmed !== true) return res.status(400).json({ success: false, message: 'You must confirm that you are 18 or older.' });
            if (store.accounts.some((account) => account.email === email && !account.deletedAt)) return res.status(409).json({ success: false, message: 'An account already exists for this email.' });
            const account = { id: id(), name, email, passwordHash: await hashPassword(password), sessionVersion: 0, ageConfirmedAt: now(), blockedAccounts: [], moderationStatus: 'active', createdAt: now(), updatedAt: now() };
            store.accounts.push(account); persist();
            await sendVerificationEmail(account);
            return res.status(201).json({ success: true, message: 'Check your email for a verification link before signing in.' });
        } catch (error) { next(error); }
    });
    app.post('/api/auth/login', rateLimit, async (req, res, next) => {
        try {
            const email = String(req.body?.email || '').trim().toLowerCase();
            const account = store.accounts.find((item) => item.email === email && !item.deletedAt);
            if (!account || !(await passwordsMatch(String(req.body?.password || ''), account.passwordHash))) return res.status(401).json({ success: false, message: 'Email or password is incorrect.' });
            if (!account.emailVerifiedAt) {
                try { await sendVerificationEmail(account); } catch (error) {
                    if (error.message !== 'VERIFICATION_COOLDOWN') return next(error);
                }
                return res.status(403).json({ success: false, code: 'EMAIL_VERIFICATION_REQUIRED', message: 'Verify your email before signing in. A new link is sent when available.' });
            }
            return res.json({ success: true, token: issue(account), account: publicAccount(account) });
        } catch (error) { next(error); }
    });
    app.post('/api/auth/resend-verification', rateLimit, async (req, res, next) => {
        try {
            const email = String(req.body?.email || '').trim().toLowerCase();
            const account = store.accounts.find((item) => item.email === email && !item.deletedAt);
            if (account && !account.emailVerifiedAt) {
                try { await sendVerificationEmail(account); }
                catch (error) {
                    if (error.message === 'VERIFICATION_COOLDOWN') return res.status(429).json({ success: false, message: 'A verification email was sent recently. Please wait a minute before trying again.' });
                    throw error;
                }
            }
            return res.json({ success: true, message: 'If an unverified account exists, a verification email has been sent.' });
        } catch (error) { next(error); }
    });
    app.post('/api/auth/verify-email', rateLimit, (req, res) => {
        const verificationToken = String(req.body?.token || '');
        const account = store.accounts.find((item) => item.emailVerificationTokenHash === tokenHash(verificationToken) && item.emailVerificationExpiresAt > Date.now() && !item.deletedAt);
        if (!account) return res.status(400).json({ success: false, message: 'This verification link is invalid or has expired. Request a new one.' });
        account.emailVerifiedAt = now();
        delete account.emailVerificationTokenHash;
        delete account.emailVerificationExpiresAt;
        delete account.verificationLastSentAt;
        account.updatedAt = now();
        persist();
        return res.json({ success: true, message: 'Email verified. You can now sign in.' });
    });
    app.get('/api/auth/me', authenticate, (req, res) => res.json({ success: true, account: publicAccount(req.account) }));
    app.post('/api/auth/age-confirmation', authenticate, (req, res) => {
        if (req.body?.ageConfirmed !== true) return res.status(400).json({ success: false, message: 'Age confirmation is required.' });
        if (!req.account.ageConfirmedAt) { req.account.ageConfirmedAt = now(); req.account.updatedAt = now(); persist(); }
        return res.json({ success: true, account: publicAccount(req.account) });
    });
    app.post('/api/auth/forgot-password', rateLimit, async (req, res, next) => {
        const account = store.accounts.find((item) => item.email === String(req.body?.email || '').trim().toLowerCase() && !item.deletedAt);
        try {
            if (!mailConfigIsValid()) {
                return res.status(503).json({ success: false, message: 'Password recovery is not configured yet. Please contact support.' });
            }
            if (account) {
                await sendPasswordResetEmail(account);
            }
            return res.json({ success: true, message: 'If an account exists, password reset instructions will be emailed.' });
        } catch (error) { next(error); }
    });
    app.post('/api/auth/reset-password', rateLimit, async (req, res, next) => {
        try {
            const resetToken = String(req.body?.token || '');
            const password = String(req.body?.password || '');
            const hashedToken = tokenHash(resetToken);
            const account = store.accounts.find((item) => item.resetTokenHash === hashedToken && item.resetExpiresAt > Date.now() && !item.deletedAt);
            if (!account) return res.status(400).json({ success: false, message: 'This password reset link is invalid or has expired.' });
            if (password.length < 10 || password.length > 256) return res.status(400).json({ success: false, message: 'Password must be between 10 and 256 characters.' });
            account.passwordHash = await hashPassword(password);
            account.sessionVersion = Number(account.sessionVersion || 0) + 1;
            delete account.resetTokenHash;
            delete account.resetExpiresAt;
            account.updatedAt = now();
            persist();
            return res.json({ success: true, message: 'Password updated. You can now sign in.' });
        } catch (error) { next(error); }
    });
    app.delete('/api/auth/account', authenticate, (req, res) => {
        store.accounts = store.accounts.filter((account) => account.id !== req.account.id); persist();
        return res.status(204).end();
    });
    app.get('/api/blocks', authenticate, (req, res) => {
        const entries = (req.account.blockedAccounts || []).map((entry) => {
            const account = store.accounts.find((item) => item.id === entry.accountId);
            return account && { id: account.id, name: account.name, blockedAt: entry.createdAt };
        }).filter(Boolean);
        res.json({ success: true, blockedUsers: entries });
    });
    app.post('/api/blocks/:accountId', authenticate, (req, res) => {
        if (!blockAccount(req.account.id, req.params.accountId)) return res.status(404).json({ success: false, message: 'Account not found.' });
        res.status(201).json({ success: true });
    });
    app.delete('/api/blocks/:accountId', authenticate, (req, res) => {
        req.account.blockedAccounts = (req.account.blockedAccounts || []).filter((entry) => entry.accountId !== req.params.accountId); req.account.updatedAt = now(); persist(); res.status(204).end();
    });
    app.get('/api/admin/reports', authenticate, requireAdmin, (req, res) => {
        const reports = store.reports.slice().reverse().map((report) => ({ ...report, reporter: publicAccount(store.accounts.find((a) => a.id === report.reporterId) || {}), reported: publicAccount(store.accounts.find((a) => a.id === report.reportedId) || {}) }));
        res.json({ success: true, reports });
    });
    app.post('/api/admin/accounts/:accountId/action', authenticate, requireAdmin, (req, res) => {
        const action = String(req.body?.action || ''); const account = store.accounts.find((item) => item.id === req.params.accountId);
        if (!account || isAdmin(account)) return res.status(404).json({ success: false, message: 'Account not found or cannot be moderated.' });
        if (action === 'warn') { account.warnings = Array.isArray(account.warnings) ? account.warnings : []; account.warnings.push({ createdAt: now(), note: String(req.body?.note || '').slice(0, 500) }); account.moderationStatus = 'warned'; }
        else if (action === 'suspend') { const days = Math.max(1, Math.min(365, Number(req.body?.days) || 7)); account.suspendedUntil = new Date(Date.now() + days * 86400000).toISOString(); account.moderationStatus = 'suspended'; }
        else if (action === 'ban') { account.bannedAt = now(); account.moderationStatus = 'banned'; }
        else return res.status(400).json({ success: false, message: 'Unknown moderation action.' });
        store.reports.forEach((report) => { if (report.reportedId === account.id && report.status === 'open') { report.status = 'reviewed'; report.reviewAction = action; report.reviewedAt = now(); report.reviewedBy = req.account.id; } });
        account.updatedAt = now(); persist(); if (onAccountAction) onAccountAction(account, action); res.json({ success: true, account: publicAccount(account) });
    });
}
function socketAccount(token) {
    const payload = verify(token);
    return payload && store.accounts.find((account) => account.id === payload.sub && account.emailVerifiedAt && !account.deletedAt && Number(payload.sv || 0) === Number(account.sessionVersion || 0));
}
module.exports = { register, authenticate, requireAdult, socketAccount, publicAccount, accountCanChat, blockAccount, accountsAreBlocked, createReport };
