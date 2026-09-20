// Payment API Backend for VComingle
const express = require('express');
const crypto = require('crypto');

const PREMIUM_PLAN = Object.freeze({
    tier: 'premium',
    label: 'Premium Plan',
    amount: '99.00',
    currency: 'INR',
    interval: 'month'
});

class PaymentAPI {
    constructor() {
        this.app = express();
        this.payeeUpiId = process.env.UPI_PAYEE_ID || '7042427579@ptsbi';
        this.merchantName = process.env.UPI_MERCHANT_NAME || 'VComingle';
        this.webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || '';
        this.orders = new Map();
        this.transactions = new Map();
        this.subscriptions = new Map();

        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(express.json({ limit: '100kb' }));
        this.app.use(express.urlencoded({ extended: true }));
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Payment-Signature');
            if (req.method === 'OPTIONS') return res.sendStatus(204);
            return next();
        });
    }

    setupRoutes() {
        this.app.get('/api/deployment-info', this.getDeploymentInfo.bind(this));
        this.app.get('/api/payment-config', this.getPaymentConfig.bind(this));
        this.app.post('/api/payments/upi-order', this.createUPIOrder.bind(this));
        this.app.get('/api/payments/:referenceId/status', this.getPaymentStatus.bind(this));
        this.app.post('/api/payment-webhook', this.paymentWebhook.bind(this));

        // Never trust a browser assertion, transaction ID, or "I paid" button.
        this.app.post('/api/verify-payment', this.rejectClientSideVerification.bind(this));
        this.app.post('/api/verify-upi', this.rejectClientSideVerification.bind(this));
    }

    getDeploymentInfo(req, res) {
        return res.json({
            success: true,
            commit: process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || 'unknown',
            service: process.env.RENDER_SERVICE_NAME ? 'render' : process.env.VERCEL ? 'vercel' : 'unknown',
            assetVersion: 'upi-premium-99-20260920',
            paymentEnvironment: {
                UPI_PAYEE_ID: Boolean(process.env.UPI_PAYEE_ID),
                UPI_MERCHANT_NAME: Boolean(process.env.UPI_MERCHANT_NAME),
                PAYMENT_WEBHOOK_SECRET: Boolean(process.env.PAYMENT_WEBHOOK_SECRET)
            },
            verification: {
                mode: 'signed-provider-webhook',
                configured: Boolean(this.webhookSecret),
                message: this.verificationMessage()
            }
        });
    }

    getPaymentConfig(req, res) {
        return res.json({
            success: true,
            plan: PREMIUM_PLAN,
            merchantName: this.merchantName,
            payeeUpiId: this.payeeUpiId,
            verification: {
                mode: 'signed-provider-webhook',
                configured: Boolean(this.webhookSecret),
                message: this.verificationMessage()
            }
        });
    }

    createUPIOrder(req, res) {
        try {
            const requestedTier = req.body && req.body.tier;
            const userId = this.normalizeUserId(req.body && req.body.userId);
            if (requestedTier !== PREMIUM_PLAN.tier) {
                return res.status(400).json({ success: false, message: 'Only the Premium plan can be purchased from this checkout.' });
            }

            const referenceId = this.createReferenceId();
            const order = {
                referenceId,
                userId,
                tier: PREMIUM_PLAN.tier,
                amount: PREMIUM_PLAN.amount,
                currency: PREMIUM_PLAN.currency,
                status: 'pending',
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
            };
            order.upiUri = this.buildUPIUri(order);
            this.orders.set(referenceId, order);

            return res.status(201).json({
                success: true,
                order: {
                    referenceId: order.referenceId,
                    tier: order.tier,
                    planLabel: PREMIUM_PLAN.label,
                    amount: order.amount,
                    currency: order.currency,
                    merchantName: this.merchantName,
                    payeeUpiId: this.payeeUpiId,
                    upiUri: order.upiUri,
                    status: order.status,
                    expiresAt: order.expiresAt,
                    verificationAvailable: Boolean(this.webhookSecret)
                }
            });
        } catch (error) {
            console.error('Create UPI order error:', error);
            return res.status(500).json({ success: false, message: 'Unable to create payment order.' });
        }
    }

    getPaymentStatus(req, res) {
        const referenceId = this.normalizeReferenceId(req.params.referenceId);
        const order = this.orders.get(referenceId);
        if (!order) return res.status(404).json({ success: false, message: 'Payment order not found.' });
        return res.json({ success: true, payment: this.serializePaymentStatus(order) });
    }

    rejectClientSideVerification(req, res) {
        return res.status(202).json({
            success: false,
            status: 'pending',
            message: 'Payment is awaiting backend/provider verification. Premium was not activated.'
        });
    }

    paymentWebhook(req, res) {
        try {
            if (!this.verifyWebhookSignature(req.body, req.get('X-Payment-Signature'))) {
                return res.status(401).json({ success: false, message: 'Invalid payment webhook signature.' });
            }

            const payload = req.body || {};
            const referenceId = this.normalizeReferenceId(payload.referenceId);
            const transactionId = this.normalizeTransactionId(payload.transactionId);
            const order = this.orders.get(referenceId);
            if (!order) return res.status(404).json({ success: false, message: 'Payment order not found.' });
            if (!transactionId) return res.status(400).json({ success: false, message: 'Missing payment provider transaction ID.' });

            if (this.transactions.has(transactionId)) {
                const existingReferenceId = this.transactions.get(transactionId);
                if (existingReferenceId !== referenceId) return res.status(409).json({ success: false, message: 'Duplicate transaction ID.' });
                return res.json({ success: true, payment: this.serializePaymentStatus(order) });
            }
            if (order.status === 'verified') return res.status(409).json({ success: false, message: 'Payment order is already verified.' });

            const providerStatus = String(payload.status || '').toLowerCase();
            const amount = this.normalizeAmount(payload.amount);
            const currency = String(payload.currency || '').toUpperCase();
            const tier = String(payload.tier || '').toLowerCase();

            if (!['success', 'verified', 'completed'].includes(providerStatus)) {
                order.status = providerStatus === 'failed' ? 'failed' : 'pending';
                order.providerStatus = providerStatus || 'unknown';
                return res.json({ success: true, payment: this.serializePaymentStatus(order) });
            }
            if (tier !== PREMIUM_PLAN.tier || amount !== PREMIUM_PLAN.amount || currency !== PREMIUM_PLAN.currency) {
                order.status = 'failed';
                order.failureReason = 'Payment details did not match the server-side Premium plan.';
                return res.status(400).json({ success: false, message: order.failureReason });
            }

            order.status = 'verified';
            order.transactionId = transactionId;
            order.verifiedAt = new Date().toISOString();
            order.providerStatus = providerStatus;
            this.transactions.set(transactionId, referenceId);
            this.subscriptions.set(order.userId, {
                userId: order.userId,
                tier: order.tier,
                referenceId,
                transactionId,
                amount: order.amount,
                currency: order.currency,
                activatedAt: order.verifiedAt
            });
            return res.json({ success: true, payment: this.serializePaymentStatus(order) });
        } catch (error) {
            console.error('Payment webhook error:', error);
            return res.status(500).json({ success: false, message: 'Webhook processing failed.' });
        }
    }

    buildUPIUri(order) {
        const params = new URLSearchParams({
            pa: this.payeeUpiId,
            pn: this.merchantName,
            am: PREMIUM_PLAN.amount,
            cu: PREMIUM_PLAN.currency,
            tr: order.referenceId,
            tn: `${PREMIUM_PLAN.label} ${order.referenceId}`
        });
        return `upi://pay?${params.toString()}`;
    }

    serializePaymentStatus(order) {
        return {
            referenceId: order.referenceId,
            tier: order.tier,
            amount: order.amount,
            currency: order.currency,
            status: order.status,
            verified: order.status === 'verified',
            transactionId: order.transactionId || null,
            verifiedAt: order.verifiedAt || null,
            expiresAt: order.expiresAt,
            verificationMessage: order.status === 'verified'
                ? 'Payment was verified by the signed provider webhook.'
                : this.verificationMessage()
        };
    }

    verificationMessage() {
        return this.webhookSecret
            ? 'Waiting for a signed payment-provider confirmation.'
            : 'Automatic verification is not configured for this QR payment. Premium cannot be activated until a payment provider webhook is configured.';
    }

    verifyWebhookSignature(payload, signature) {
        if (!this.webhookSecret) {
            console.warn('PAYMENT_WEBHOOK_SECRET is not configured; refusing payment activation.');
            return false;
        }
        if (!signature) return false;
        const expected = crypto.createHmac('sha256', this.webhookSecret).update(JSON.stringify(payload)).digest('hex');
        const provided = String(signature).replace(/^sha256=/, '');
        const expectedBuffer = Buffer.from(expected, 'hex');
        const providedBuffer = Buffer.from(provided, 'hex');
        return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
    }

    createReferenceId() {
        return `VCM-${Date.now()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    }

    normalizeReferenceId(value) {
        return String(value || '').trim().slice(0, 80);
    }

    normalizeTransactionId(value) {
        const normalized = String(value || '').trim();
        return /^[A-Za-z0-9._-]{6,80}$/.test(normalized) ? normalized : '';
    }

    normalizeAmount(value) {
        const amount = Number(value);
        return Number.isFinite(amount) ? amount.toFixed(2) : '';
    }

    normalizeUserId(value) {
        const userId = String(value || '').trim();
        return /^[A-Za-z0-9._-]{3,80}$/.test(userId) ? userId : `anon_${crypto.randomBytes(8).toString('hex')}`;
    }

    start(port = 3001) {
        this.app.listen(port, () => console.log(`Payment API server running on port ${port}`));
    }
}

PaymentAPI.PREMIUM_PLAN = PREMIUM_PLAN;
module.exports = PaymentAPI;
