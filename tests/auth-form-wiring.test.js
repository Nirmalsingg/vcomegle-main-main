const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const authJs = fs.readFileSync(path.join(projectRoot, 'auth.js'), 'utf8');

test('auth forms use POST handlers wired to the same element ids as index.html', () => {
    const formIds = [...indexHtml.matchAll(/<form id="([^"]+)"/g)].map((match) => match[1]);
    const wiredIds = [...authJs.matchAll(/getElementById\('([^']+)'\)\?\.addEventListener\('submit'/g)].map((match) => match[1]);

    for (const id of ['loginPanel', 'signupPanel', 'forgotPanel', 'resendVerificationPanel', 'resetPanel', 'agePanel']) {
        assert.ok(formIds.includes(id), `index.html is missing form#${id}`);
        assert.ok(wiredIds.includes(id), `auth.js is missing submit handler for #${id}`);
    }

    assert.equal(authJs.includes("getElementById('loginForm')"), false);
    assert.equal(authJs.includes("getElementById('signupForm')"), false);
    assert.equal(authJs.includes("getElementById('forgotForm')"), false);
});
