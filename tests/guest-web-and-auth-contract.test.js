const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('public web is guest-capable while the native client identifies itself for required authentication', () => {
    const authClient = fs.readFileSync(path.join(root, 'auth.js'), 'utf8');
    const chatClient = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

    assert.match(authClient, /window\.VCOMINGLE_REQUIRE_AUTH === true/);
    assert.match(chatClient, /client: window\.VCOMINGLE_REQUIRE_AUTH === true \? 'native' : 'web'/);
    assert.match(server, /socket\.handshake\.auth\?\.client === 'native'/);
    assert.match(server, /guest:\$\{socket\.id\}/);
});

