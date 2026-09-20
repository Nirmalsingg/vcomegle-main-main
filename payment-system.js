class VCominglePaymentSystem {
    constructor() {
        this.premiumAmount = '99.00';
        this.premiumDisplayPrice = '₹99/month';
        this.currentOrder = null;
        this.pollTimer = null;
    }

    initialize() {
        this.setupPaymentButtons();
    }

    setupPaymentButtons() {
        const premiumBtn = document.getElementById('premiumBtn');
        if (premiumBtn) {
            premiumBtn.onclick = () => this.showPaymentModal('premium');
        }
    }

    async showPaymentModal(tier = 'premium') {
        if (tier !== 'premium') {
            alert('Only the Premium plan is available right now.');
            return;
        }

        this.closePaymentModals();
        this.addModalStyles();

        const modal = document.createElement('div');
        modal.className = 'payment-modal';
        modal.innerHTML = `
            <div class="payment-modal-content" role="dialog" aria-modal="true" aria-labelledby="paymentTitle">
                <div class="payment-header">
                    <div>
                        <p class="payment-eyebrow">VComingle Premium</p>
                        <h3 id="paymentTitle">Premium Plan</h3>
                    </div>
                    <button class="close-btn" type="button" aria-label="Close payment modal" onclick="paymentSystem.closePaymentModals()">×</button>
                </div>

                <div class="payment-plan-summary">
                    <span>Premium Plan</span>
                    <strong>₹99/month</strong>
                </div>

                <div id="upiCheckoutBody" class="upi-loading">
                    Creating a secure UPI payment request...
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        try {
            const order = await this.createUPIOrder();
            this.currentOrder = order;
            this.renderUPICheckout(order);
            this.startPaymentStatusPolling(order.referenceId);
        } catch (error) {
            console.error('Unable to create UPI order:', error);
            const body = document.getElementById('upiCheckoutBody');
            if (body) {
                body.className = 'upi-error';
                body.textContent = 'Unable to create the UPI payment request. Please try again.';
            }
        }
    }

    async createUPIOrder() {
        const response = await fetch('/api/payments/upi-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tier: 'premium',
                userId: this.getUserId()
            })
        });

        const data = await response.json();
        if (!response.ok || !data.success || !data.order) {
            throw new Error(data.message || 'UPI order request failed');
        }

        return data.order;
    }

    renderUPICheckout(order) {
        const body = document.getElementById('upiCheckoutBody');
        if (!body) return;

        body.className = 'upi-checkout';
        body.innerHTML = `
            <div class="upi-grid">
                <div class="qr-panel">
                    <div class="qr-frame">
                        <img src="${this.getQRCodeUrl(order.upiUri)}" alt="UPI QR code for Premium Plan ₹99">
                    </div>
                    <p class="qr-caption">Scan with a compatible UPI app. The standard UPI request includes ₹99.00 INR.</p>
                </div>

                <div class="upi-details">
                    <div class="detail-row">
                        <span>Payee</span>
                        <strong>${this.escapeHTML(order.merchantName)}</strong>
                    </div>
                    <div class="detail-row">
                        <span>UPI ID</span>
                        <strong>${this.escapeHTML(order.payeeUpiId)}</strong>
                    </div>
                    <div class="detail-row">
                        <span>Reference</span>
                        <strong>${this.escapeHTML(order.referenceId)}</strong>
                    </div>

                    <a class="upi-pay-btn" href="${this.escapeAttribute(order.upiUri)}" onclick="paymentSystem.handleUPIIntentClick(event)">
                        Pay ₹99 with UPI
                    </a>

                    <button class="secondary-btn" type="button" onclick="paymentSystem.copyPaymentReference()">Copy reference ID</button>

                    <div class="payment-status" id="paymentStatus">
                        Waiting for backend payment verification. Premium activates only after verified payment confirmation.
                    </div>
                </div>
            </div>
        `;
    }

    handleUPIIntentClick() {
        const status = document.getElementById('paymentStatus');
        if (status) {
            status.textContent = 'UPI app opened where supported. Keep this page open; Premium unlocks only after backend verification.';
        }
    }

    startPaymentStatusPolling(referenceId) {
        this.stopPaymentStatusPolling();
        this.pollTimer = window.setInterval(() => {
            this.checkPaymentStatus(referenceId);
        }, 5000);
    }

    stopPaymentStatusPolling() {
        if (this.pollTimer) {
            window.clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    async checkPaymentStatus(referenceId) {
        try {
            const response = await fetch(`/api/payments/${encodeURIComponent(referenceId)}/status`);
            const data = await response.json();
            if (!response.ok || !data.success || !data.payment) return;

            const status = document.getElementById('paymentStatus');
            if (data.payment.verified) {
                this.stopPaymentStatusPolling();
                this.activateVerifiedPremium(data.payment);
            } else if (status) {
                status.textContent = data.payment.status === 'failed'
                    ? 'Payment could not be verified. Please contact support with your reference ID.'
                    : 'Payment pending. We are waiting for backend/provider verification.';
            }
        } catch (error) {
            console.error('Payment status check failed:', error);
        }
    }

    activateVerifiedPremium(payment) {
        if (!window.vcomingleMonetization) return;

        vcomingleMonetization.userTier = 'premium';
        vcomingleMonetization.saveUserData({
            paymentReferenceId: payment.referenceId,
            paymentVerifiedAt: payment.verifiedAt
        });
        vcomingleMonetization.trackRevenue('premium_upgrade', 99);

        this.updatePremiumButton('premium');
        if (typeof window.applyPremiumUI === 'function') {
            window.applyPremiumUI();
        }

        const status = document.getElementById('paymentStatus');
        if (status) {
            status.classList.add('verified');
            status.textContent = 'Payment verified. Premium is active.';
        }

        this.showPaymentSuccess();
    }

    showPaymentSuccess() {
        const success = document.createElement('div');
        success.className = 'success-modal';
        success.innerHTML = `
            <div class="success-content">
                <h3>Premium Activated</h3>
                <p>Your ₹99 Premium payment was verified by the backend.</p>
                <button type="button" onclick="this.closest('.success-modal').remove(); paymentSystem.closePaymentModals();">Continue</button>
            </div>
        `;
        document.body.appendChild(success);
    }

    updatePremiumButton(tier) {
        const premiumBtn = document.getElementById('premiumBtn');
        if (premiumBtn) {
            premiumBtn.textContent = tier === 'premium' ? 'Premium' : 'VIP';
            premiumBtn.classList.add(tier);
            premiumBtn.onclick = () => alert('You are already a Premium member.');
        }
    }

    copyPaymentReference() {
        if (!this.currentOrder) return;

        navigator.clipboard.writeText(this.currentOrder.referenceId)
            .then(() => this.showToast('Reference ID copied'))
            .catch(() => this.showToast('Could not copy reference ID'));
    }

    showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'copy-notification';
        toast.textContent = message;
        document.body.appendChild(toast);
        window.setTimeout(() => toast.remove(), 2000);
    }

    closePaymentModals() {
        this.stopPaymentStatusPolling();
        document.querySelectorAll('.payment-modal, .success-modal').forEach((modal) => modal.remove());
    }

    getQRCodeUrl(upiUri) {
        return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(upiUri)}`;
    }

    getUserId() {
        if (window.vcomingleMonetization && vcomingleMonetization.userId) {
            return vcomingleMonetization.userId;
        }

        let userId = localStorage.getItem('vcomingle_user_id');
        if (!userId) {
            userId = `user_${Math.random().toString(36).slice(2, 11)}`;
            localStorage.setItem('vcomingle_user_id', userId);
        }
        return userId;
    }

    escapeHTML(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    escapeAttribute(value) {
        return this.escapeHTML(value).replace(/`/g, '&#96;');
    }

    addModalStyles() {
        if (document.getElementById('payment-styles')) return;

        const styles = document.createElement('style');
        styles.id = 'payment-styles';
        styles.textContent = `
            .payment-modal,
            .success-modal {
                position: fixed;
                inset: 0;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                background: rgba(17, 24, 39, 0.72);
                backdrop-filter: blur(6px);
            }

            .payment-modal-content,
            .success-content {
                width: min(720px, 100%);
                max-height: 92vh;
                overflow-y: auto;
                background: #ffffff;
                border-radius: 16px;
                box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
                color: #1f2937;
            }

            .payment-modal-content {
                padding: 24px;
            }

            .payment-header {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 16px;
                margin-bottom: 18px;
            }

            .payment-eyebrow {
                margin: 0 0 4px;
                color: #667eea;
                font-size: 0.78rem;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0;
            }

            .payment-header h3 {
                margin: 0;
                font-size: 1.55rem;
                color: #111827;
            }

            .close-btn {
                width: 36px;
                height: 36px;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                background: #ffffff;
                color: #4b5563;
                cursor: pointer;
                font-size: 24px;
                line-height: 1;
            }

            .payment-plan-summary {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 16px;
                padding: 16px;
                margin-bottom: 18px;
                border: 1px solid #e8ecff;
                border-radius: 12px;
                background: #f8f9ff;
            }

            .payment-plan-summary span {
                font-weight: 700;
                color: #374151;
            }

            .payment-plan-summary strong {
                color: #667eea;
                font-size: 1.4rem;
            }

            .upi-loading,
            .upi-error {
                padding: 28px;
                text-align: center;
                border: 1px dashed #c7d2fe;
                border-radius: 12px;
                color: #4b5563;
                background: #fafbff;
            }

            .upi-error {
                border-color: #fecaca;
                color: #991b1b;
                background: #fff7f7;
            }

            .upi-grid {
                display: grid;
                grid-template-columns: minmax(220px, 280px) 1fr;
                gap: 22px;
                align-items: stretch;
            }

            .qr-panel {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 18px;
                border: 1px solid #edf0f7;
                border-radius: 12px;
                background: #ffffff;
            }

            .qr-frame {
                width: 240px;
                height: 240px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 12px;
                border: 1px solid #e5e7eb;
                background: #ffffff;
            }

            .qr-frame img {
                width: 220px;
                height: 220px;
                display: block;
            }

            .qr-caption {
                margin: 14px 0 0;
                color: #6b7280;
                font-size: 0.9rem;
                line-height: 1.4;
                text-align: center;
            }

            .upi-details {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .detail-row {
                display: flex;
                justify-content: space-between;
                gap: 12px;
                padding: 12px 0;
                border-bottom: 1px solid #eef2f7;
            }

            .detail-row span {
                color: #6b7280;
            }

            .detail-row strong {
                max-width: 62%;
                color: #111827;
                overflow-wrap: anywhere;
                text-align: right;
            }

            .upi-pay-btn,
            .secondary-btn,
            .success-content button {
                min-height: 46px;
                border: none;
                border-radius: 10px;
                cursor: pointer;
                font-weight: 800;
                text-align: center;
            }

            .upi-pay-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                margin-top: 4px;
                background: linear-gradient(135deg, #667eea, #764ba2);
                color: #ffffff;
                text-decoration: none;
                box-shadow: 0 10px 24px rgba(102, 126, 234, 0.28);
            }

            .secondary-btn {
                background: #f3f4f6;
                color: #374151;
            }

            .payment-status {
                padding: 12px;
                border-radius: 10px;
                background: #fff7ed;
                color: #9a3412;
                font-size: 0.92rem;
                line-height: 1.4;
            }

            .payment-status.verified {
                background: #ecfdf5;
                color: #047857;
            }

            .success-content {
                max-width: 420px;
                padding: 28px;
                text-align: center;
            }

            .success-content h3 {
                margin: 0 0 10px;
                color: #047857;
            }

            .success-content p {
                margin: 0 0 20px;
                color: #4b5563;
            }

            .success-content button {
                padding: 0 20px;
                background: #667eea;
                color: #ffffff;
            }

            .copy-notification {
                position: fixed;
                left: 50%;
                bottom: 24px;
                transform: translateX(-50%);
                z-index: 11000;
                padding: 10px 14px;
                border-radius: 10px;
                background: #111827;
                color: #ffffff;
                box-shadow: 0 12px 30px rgba(15, 23, 42, 0.3);
            }

            @media (max-width: 720px) {
                .payment-modal {
                    align-items: flex-start;
                    padding: 12px;
                    overflow-y: auto;
                }

                .payment-modal-content {
                    padding: 18px;
                    border-radius: 14px;
                }

                .payment-plan-summary,
                .detail-row {
                    align-items: flex-start;
                    flex-direction: column;
                    gap: 6px;
                }

                .payment-plan-summary strong,
                .detail-row strong {
                    max-width: 100%;
                    text-align: left;
                }

                .upi-grid {
                    grid-template-columns: 1fr;
                }

                .qr-frame {
                    width: min(240px, 100%);
                }

                .upi-pay-btn,
                .secondary-btn {
                    width: 100%;
                }
            }
        `;

        document.head.appendChild(styles);
    }
}

const paymentSystem = new VCominglePaymentSystem();
window.paymentSystem = paymentSystem;

document.addEventListener('DOMContentLoaded', () => {
    paymentSystem.initialize();
});
