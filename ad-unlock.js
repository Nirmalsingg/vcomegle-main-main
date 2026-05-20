// Ad-based temporary unlocks (client-side)
// This provides a 2-minute unlock window for the gender filter after an ad flow.

(function () {
    const STORAGE_KEY = 'vcomingle_gender_unlock_until';
    const UNLOCK_MS = 2 * 60 * 1000;

    function now() {
        return Date.now();
    }

    function getUntilMs() {
        const raw = localStorage.getItem(STORAGE_KEY);
        const n = raw ? Number(raw) : 0;
        return Number.isFinite(n) ? n : 0;
    }

    function setUntilMs(until) {
        localStorage.setItem(STORAGE_KEY, String(until));
    }

    function isUnlocked() {
        return getUntilMs() > now();
    }

    function remainingMs() {
        return Math.max(0, getUntilMs() - now());
    }

    function unlockFor(ms) {
        setUntilMs(now() + Math.max(0, ms));
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function showModal() {
        const modal = byId('adUnlockModal');
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
    }

    function hideModal() {
        const modal = byId('adUnlockModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
    }

    function tickUI() {
        try {
            if (typeof window.applyPremiumUI === 'function') window.applyPremiumUI();
        } catch (_) {
            /* ignore */
        }
    }

    function openGenderUnlockModal() {
        showModal();
    }

    function claimGenderUnlock() {
        unlockFor(UNLOCK_MS);
        hideModal();
        tickUI();
    }

    function bindModalControls() {
        const closeBtn = byId('adUnlockCloseBtn');
        const startBtn = byId('adUnlockStartBtn');
        const goPremiumBtn = byId('adUnlockGoPremiumBtn');
        const modal = byId('adUnlockModal');

        if (closeBtn) closeBtn.addEventListener('click', hideModal);
        if (startBtn) startBtn.addEventListener('click', claimGenderUnlock);
        if (goPremiumBtn)
            goPremiumBtn.addEventListener('click', () => {
                try {
                    if (typeof window.showPremiumUpgrade === 'function') {
                        window.showPremiumUpgrade();
                    }
                } finally {
                    hideModal();
                }
            });

        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) hideModal();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') hideModal();
            });
        }
    }

    function startTicker() {
        setInterval(() => {
            if (!isUnlocked()) return;
            tickUI();
        }, 1000);
    }

    document.addEventListener('DOMContentLoaded', () => {
        bindModalControls();
        startTicker();
        tickUI();
    });

    window.adUnlock = {
        isGenderUnlocked: isUnlocked,
        getGenderRemainingMs: remainingMs,
        openGenderUnlockModal,
        claimGenderUnlock,
        unlockGenderForMs: unlockFor
    };
})();

