const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

function request(port, route, body, method = 'POST', headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? '' : JSON.stringify(body);
        const req = http.request({ port, path: route, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } }, (res) => {
            let raw = '';
            res.on('data', (chunk) => { raw += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }));
        });
        req.on('error', reject);
        req.end(payload);
    });
}

test('registration, verification, login, and password reset work without issuing an unverified session', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcomingle-auth-'));
    const dataFile = path.join(directory, 'accounts.json');
    const originalFetch = global.fetch;
    const sent = [];
    Object.assign(process.env, {
        AUTH_DATA_FILE: dataFile,
        AUTH_TOKEN_SECRET: 'test-secret-that-is-long-enough-to-sign-tokens-safely',
        APP_BASE_URL: 'https://chat.example.test',
        RESEND_API_KEY: 're_test_key',
        EMAIL_FROM: 'VComingle <no-reply@mail.example.test>',
        NODE_ENV: 'test'
    });
    global.fetch = async (url, options) => {
        assert.equal(url, 'https://api.resend.com/emails');
        sent.push(JSON.parse(options.body));
        return { ok: true, status: 200, text: async () => '' };
    };
    delete require.cache[require.resolve('../auth-service')];
    const auth = require('../auth-service');
    const app = express();
    app.use(express.json());
    auth.register(app);
    app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
    const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
    t.after(() => {
        global.fetch = originalFetch;
        delete require.cache[require.resolve('../auth-service')];
        server.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const port = server.address().port;
    const credentials = { name: 'Test User', email: 'test@example.com', password: 'a secure test password', ageConfirmed: true };

    let response = await request(port, '/api/auth/register', credentials);
    assert.equal(response.status, 201);
    assert.equal(response.body.token, undefined);
    assert.equal(sent.length, 1);
    const verificationToken = new URL(sent[0].html.match(/href="([^"]+)"/)[1]).hash.slice('#token='.length);

    response = await request(port, '/api/auth/login', credentials);
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'EMAIL_VERIFICATION_REQUIRED');

    response = await request(port, '/api/auth/verify-email', { token: verificationToken });
    assert.equal(response.status, 200);
    response = await request(port, '/api/auth/login', credentials);
    assert.equal(response.status, 200);
    assert.ok(response.body.token);
    const originalSessionToken = response.body.token;

    response = await request(port, '/api/auth/forgot-password', { email: credentials.email });
    assert.equal(response.status, 200);
    assert.equal(sent.length, 2);
    const resetToken = new URL(sent[1].html.match(/href="([^"]+)"/)[1]).hash.slice('#token='.length);
    response = await request(port, '/api/auth/reset-password', { token: resetToken, password: 'an even safer new password' });
    assert.equal(response.status, 200);
    response = await request(port, '/api/auth/me', undefined, 'GET', { Authorization: `Bearer ${originalSessionToken}` });
    assert.equal(response.status, 401);
    response = await request(port, '/api/auth/login', credentials);
    assert.equal(response.status, 401);
    response = await request(port, '/api/auth/login', { email: credentials.email, password: 'an even safer new password' });
    assert.equal(response.status, 200);
});
