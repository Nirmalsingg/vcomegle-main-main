const crypto = require('crypto');

const GENDER_FILTER_REWARD_MS = 5 * 60 * 1000;

class RewardedEntitlements {
    constructor(options = {}) {
        this.signingSecret = options.signingSecret ||
            process.env.ENTITLEMENT_TOKEN_SECRET ||
            process.env.PAYMENT_WEBHOOK_SECRET ||
            crypto.randomBytes(32).toString('hex');
        this.providerWebhookSecret = options.providerWebhookSecret ||
            process.env.REWARDED_AD_WEBHOOK_SECRET ||
            '';
        this.sessions = new Map();
        this.providerEvents = new Map();
    }

    createRewardedAdSession(userId) {
        const normalizedUserId = this.normalizeUserId(userId);
        const session = {
            sessionId: `rad_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`,
            userId: normalizedUserId,
            status: 'pending',
            entitlementToken: null,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            createdAt: new Date().toISOString()
        };

        this.sessions.set(session.sessionId, session);
        return this.serializeSession(session);
    }

    getRewardedAdSession(sessionId, userId) {
        const session = this.sessions.get(String(sessionId || ''));
        if (!session || session.userId !== this.normalizeUserId(userId)) return null;
        return this.serializeSession(session);
    }

    confirmRewardedAdCompletion(payload, signature, rawBody) {
        if (!this.verifyProviderSignature(rawBody || JSON.stringify(payload || {}), signature)) {
            return { ok: false, statusCode: 401, message: 'Invalid rewarded-ad provider signature.' };
        }

        const providerEventId = this.normalizeProviderEventId(payload && payload.providerEventId);
        if (!providerEventId) {
            return { ok: false, statusCode: 400, message: 'Missing rewarded-ad provider event ID.' };
        }

        if (this.providerEvents.has(providerEventId)) {
            const sessionId = this.providerEvents.get(providerEventId);
            const session = this.sessions.get(sessionId);
            return { ok: true, session: this.serializeSession(session), replayed: true };
        }

        const session = this.sessions.get(String(payload && payload.sessionId || ''));
        if (!session) {
            return { ok: false, statusCode: 404, message: 'Rewarded-ad session not found.' };
        }

        if (new Date(session.expiresAt).getTime() < Date.now()) {
            session.status = 'expired';
            return { ok: false, statusCode: 410, message: 'Rewarded-ad session expired.' };
        }

        const completed = ['completed', 'rewarded', 'success'].includes(
            String(payload && payload.status || '').toLowerCase()
        );

        if (!completed) {
            session.status = 'not_completed';
            return { ok: true, session: this.serializeSession(session) };
        }

        const entitlementExpiresAt = new Date(Date.now() + GENDER_FILTER_REWARD_MS).toISOString();
        session.status = 'completed';
        session.completedAt = new Date().toISOString();
        session.providerEventId = providerEventId;
        session.entitlementExpiresAt = entitlementExpiresAt;
        session.entitlementToken = this.createEntitlementToken(session.userId, entitlementExpiresAt);
        this.providerEvents.set(providerEventId, session.sessionId);

        return { ok: true, session: this.serializeSession(session) };
    }

    hasGenderFilterAccess({ userId, token, hasPremium = false, freeOverride = false }) {
        if (freeOverride || hasPremium) return true;
        const entitlement = this.verifyEntitlementToken(token);
        return Boolean(entitlement && entitlement.userId === this.normalizeUserId(userId));
    }

    createEntitlementToken(userId, expiresAt) {
        const payload = {
            feature: 'gender_filter',
            userId: this.normalizeUserId(userId),
            expiresAt
        };
        const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const signature = this.sign(encodedPayload);
        return `${encodedPayload}.${signature}`;
    }

    verifyEntitlementToken(token) {
        const parts = String(token || '').split('.');
        if (parts.length !== 2) return null;

        const [encodedPayload, signature] = parts;
        if (!this.safeEqual(signature, this.sign(encodedPayload))) return null;

        try {
            const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
            if (payload.feature !== 'gender_filter') return null;
            if (new Date(payload.expiresAt).getTime() <= Date.now()) return null;
            return payload;
        } catch (_) {
            return null;
        }
    }

    verifyProviderSignature(rawBody, signature) {
        if (!this.providerWebhookSecret) {
            console.warn('REWARDED_AD_WEBHOOK_SECRET is not configured; refusing rewarded-ad completion.');
            return false;
        }

        const provided = String(signature || '').replace(/^sha256=/, '');
        const expected = crypto
            .createHmac('sha256', this.providerWebhookSecret)
            .update(rawBody || '')
            .digest('hex');

        return this.safeEqual(provided, expected);
    }

    sign(value) {
        return crypto
            .createHmac('sha256', this.signingSecret)
            .update(String(value))
            .digest('base64url');
    }

    safeEqual(a, b) {
        const aBuffer = Buffer.from(String(a || ''));
        const bBuffer = Buffer.from(String(b || ''));
        return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
    }

    normalizeUserId(value) {
        const userId = String(value || '').trim();
        if (/^[A-Za-z0-9._-]{3,80}$/.test(userId)) return userId;
        return 'anonymous';
    }

    normalizeProviderEventId(value) {
        const eventId = String(value || '').trim();
        return /^[A-Za-z0-9._:-]{6,120}$/.test(eventId) ? eventId : '';
    }

    serializeSession(session) {
        if (!session) return null;
        return {
            sessionId: session.sessionId,
            status: session.status,
            expiresAt: session.expiresAt,
            entitlementExpiresAt: session.entitlementExpiresAt || null,
            entitlementToken: session.entitlementToken || null
        };
    }
}

RewardedEntitlements.GENDER_FILTER_REWARD_MS = GENDER_FILTER_REWARD_MS;

module.exports = RewardedEntitlements;
