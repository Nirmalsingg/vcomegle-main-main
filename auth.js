(function () {
    const api = (path) => window.vcomingleApiUrl ? window.vcomingleApiUrl(path) : path;
    const key = 'vcomingle.auth.token';
    const nativeStore = () => window.Capacitor?.Plugins?.SecureSessionStorage;
    async function getToken() {
        const plugin = nativeStore();
        if (plugin) { const result = await plugin.get({ key }); return result.value || ''; }
        return sessionStorage.getItem(key) || '';
    }
    async function setToken(value) {
        const plugin = nativeStore();
        if (plugin) return plugin.set({ key, value });
        sessionStorage.setItem(key, value);
    }
    async function removeToken() {
        const plugin = nativeStore();
        if (plugin) return plugin.remove({ key });
        sessionStorage.removeItem(key);
    }
    class AuthManager {
        constructor() { this.token = ''; this.account = null; }
        async request(path, options = {}) {
            const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
            if (this.token) headers.Authorization = `Bearer ${this.token}`;
            let response;
            try { response = await fetch(api(path), { ...options, headers }); }
            catch (_) { throw new Error('Network unavailable. Check your connection and try again.'); }
            const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
            if (!response.ok) {
                if (response.status === 401) await this.clearSession(true);
                throw new Error(body.message || 'Request could not be completed.');
            }
            return body;
        }
        async restore() {
            this.token = await getToken();
            if (!this.token) return false;
            try { this.account = (await this.request('/api/auth/me')).account; return true; }
            catch (_) { return false; }
        }
        async saveSession(result) { this.token = result.token; this.account = result.account; await setToken(result.token); this.render(); if (!this.isEligible()) this.show('agePanel'); }
        async clearSession(expired = false) {
            this.token = ''; this.account = null; await removeToken(); this.render();
            if (expired) this.message('Your session expired. Please sign in again.', 'error');
        }
        isEligible() { return Boolean(this.account?.ageEligible); }
        message(text, type = 'error') { const box = document.getElementById('authMessage'); if (box) { box.textContent = text; box.className = `auth-message ${type}`; } }
        show(panel) {
            document.querySelectorAll('.auth-panel').forEach((item) => item.classList.toggle('hidden', item.id !== panel));
            document.getElementById('authScreen')?.classList.remove('hidden');
        }
        render() {
            const signedIn = Boolean(this.account);
            document.getElementById('authScreen')?.classList.toggle('hidden', signedIn);
            document.getElementById('welcomeScreen')?.classList.toggle('hidden', !signedIn);
            const label = document.getElementById('accountName'); if (label) label.textContent = signedIn ? this.account.name : '';
            document.getElementById('logoutBtn')?.classList.toggle('hidden', !signedIn);
            document.getElementById('profileBtn')?.classList.toggle('hidden', !signedIn);
            document.getElementById('adminBtn')?.classList.toggle('hidden', !this.account?.isAdmin);
            if (!signedIn) this.show('loginPanel');
        }
        async boot() { await this.restore(); this.render(); if (this.account && !this.isEligible()) this.show('agePanel'); }
    }
    window.vcomingleAuth = new AuthManager();
    function setBusy(form, busy) { const submit = form.querySelector('[type="submit"]'); if (submit) { submit.disabled = busy; submit.dataset.label ||= submit.textContent; submit.textContent = busy ? 'Please wait…' : submit.dataset.label; } }
    function line(container, text, buttonLabel, onClick) { const row = document.createElement('div'); row.className = 'account-list-row'; const label = document.createElement('span'); label.textContent = text; row.append(label); if (buttonLabel) { const button = document.createElement('button'); button.className = 'auth-header-btn'; button.type = 'button'; button.textContent = buttonLabel; button.addEventListener('click', onClick); row.append(button); } container.append(row); }
    async function loadBlocks(auth) { const container = document.getElementById('blockedUsersList'); if (!container) return; container.textContent = 'Loading…'; try { const data = await auth.request('/api/blocks'); container.textContent = ''; if (!data.blockedUsers.length) return line(container, 'You have not blocked anyone.'); data.blockedUsers.forEach((user) => line(container, user.name, 'Unblock', async () => { await auth.request(`/api/blocks/${encodeURIComponent(user.id)}`, { method: 'DELETE' }); loadBlocks(auth); })); } catch (error) { container.textContent = error.message; } }
    async function loadReports(auth) { const container = document.getElementById('adminReportsList'); if (!container) return; container.textContent = 'Loading…'; try { const data = await auth.request('/api/admin/reports'); container.textContent = ''; if (!data.reports.length) return line(container, 'No reports yet.'); data.reports.forEach((report) => { const row = document.createElement('div'); row.className = 'account-list-row report-row'; const text = document.createElement('span'); text.textContent = `${report.reason}: ${report.reported.name || 'Deleted account'} — ${report.details || 'No details'}`; row.append(text); ['warn', 'suspend', 'ban'].forEach((action) => { const button = document.createElement('button'); button.className = 'auth-header-btn'; button.type = 'button'; button.textContent = action; button.addEventListener('click', async () => { const days = action === 'suspend' ? Number(prompt('Suspend for how many days?', '7')) || 7 : undefined; await auth.request(`/api/admin/accounts/${encodeURIComponent(report.reportedId)}/action`, { method: 'POST', body: JSON.stringify({ action, days }) }); loadReports(auth); }); row.append(button); }); container.append(row); }); } catch (error) { container.textContent = error.message; } }
    document.addEventListener('DOMContentLoaded', () => {
        const auth = window.vcomingleAuth;
        document.querySelectorAll('[data-auth-show]').forEach((button) => button.addEventListener('click', () => { auth.message(''); auth.show(button.dataset.authShow); if (button.dataset.authShow === 'blockedPanel') loadBlocks(auth); if (button.dataset.authShow === 'adminPanel') loadReports(auth); }));
        document.querySelectorAll('[data-password-toggle]').forEach((button) => button.addEventListener('click', () => { const input = document.getElementById(button.dataset.passwordToggle); input.type = input.type === 'password' ? 'text' : 'password'; button.textContent = input.type === 'password' ? 'Show' : 'Hide'; }));
        document.getElementById('signupForm')?.addEventListener('submit', async (event) => {
            event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
            if (data.get('password') !== data.get('confirmPassword')) return auth.message('Passwords do not match.');
            if (!data.get('ageConfirmed')) return auth.message('You must explicitly confirm that you are 18 or older.');
            setBusy(form, true); auth.message('');
            try { const result = await auth.request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: data.get('name'), email: data.get('email'), password: data.get('password'), ageConfirmed: true }) }); form.reset(); auth.message(result.message, 'success'); auth.show('loginPanel'); }
            catch (error) { auth.message(error.message); } finally { setBusy(form, false); }
        });
        document.getElementById('loginForm')?.addEventListener('submit', async (event) => {
            event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(form, true); auth.message('');
            try { await auth.saveSession(await auth.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: data.get('email'), password: data.get('password') }) })); form.reset(); }
            catch (error) { auth.message(error.message); } finally { setBusy(form, false); }
        });
        document.getElementById('forgotForm')?.addEventListener('submit', async (event) => {
            event.preventDefault(); const form = event.currentTarget; setBusy(form, true); auth.message('');
            try { const result = await auth.request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: new FormData(form).get('email') }) }); auth.message(result.message, 'success'); }
            catch (error) { auth.message(error.message); } finally { setBusy(form, false); }
        });
        document.getElementById('resendVerificationPanel')?.addEventListener('submit', async (event) => {
            event.preventDefault(); const form = event.currentTarget; setBusy(form, true); auth.message('');
            try { const result = await auth.request('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: new FormData(form).get('email') }) }); auth.message(result.message, 'success'); }
            catch (error) { auth.message(error.message); } finally { setBusy(form, false); }
        });
        document.getElementById('resetPanel')?.addEventListener('submit', async (event) => {
            event.preventDefault(); const form = event.currentTarget; setBusy(form, true); auth.message('');
            try { const data = new FormData(form); const result = await auth.request('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: data.get('token'), password: data.get('password') }) }); auth.message(result.message, 'success'); auth.show('loginPanel'); }
            catch (error) { auth.message(error.message); } finally { setBusy(form, false); }
        });
        document.getElementById('agePanel')?.addEventListener('submit', async (event) => {
            event.preventDefault(); const form = event.currentTarget; if (!new FormData(form).get('ageConfirmed')) return auth.message('You must explicitly confirm that you are 18 or older.'); setBusy(form, true);
            try { auth.account = (await auth.request('/api/auth/age-confirmation', { method: 'POST', body: JSON.stringify({ ageConfirmed: true }) })).account; auth.render(); }
            catch (error) { auth.message(error.message); } finally { setBusy(form, false); }
        });
        document.getElementById('logoutBtn')?.addEventListener('click', () => auth.clearSession());
        document.getElementById('deleteAccountBtn')?.addEventListener('click', async () => { if (!confirm('Delete your account permanently? This cannot be undone.')) return; try { await auth.request('/api/auth/account', { method: 'DELETE' }); await auth.clearSession(); } catch (error) { auth.message(error.message); } });
        auth.boot().then(async () => {
            const token = new URLSearchParams(location.hash.slice(1)).get('token') || new URLSearchParams(location.search).get('token');
            if (!auth.account && location.pathname === '/verify-email') {
                auth.show('verifyPanel');
                if (!token) return auth.message('This verification link is invalid or incomplete. Request a new one.');
                try { const result = await auth.request('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }); history.replaceState(null, '', '/'); auth.message(result.message, 'success'); auth.show('loginPanel'); }
                catch (error) { auth.message(error.message); auth.show('resendVerificationPanel'); }
            } else if (!auth.account && location.pathname === '/reset-password' && token) { document.getElementById('resetToken').value = token; auth.show('resetPanel'); }
        });
    });
})();
