const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

function loadAppClass(mediaDevices, peerConnection = MockPeerConnection) {
    const context = {
        console,
        navigator: { mediaDevices },
        RTCPeerConnection: peerConnection,
        document: {
            addEventListener() {},
            getElementById() {
                return null;
            },
            querySelector() {
                return null;
            }
        },
        window: {
            addEventListener() {}
        },
        setTimeout,
        clearTimeout,
        URLSearchParams
    };

    vm.runInNewContext(`${appSource}\n;globalThis.VComingleApp = VComingleApp;`, context);
    return context.VComingleApp;
}

function createSender(track) {
    return {
        track,
        getParameters() {
            return { encodings: [{}] };
        },
        async setParameters(parameters) {
            this.parameters = parameters;
        }
    };
}

class MockPeerConnection {
    constructor() {
        this.senders = [];
    }

    addTrack(track) {
        const sender = createSender(track);
        this.senders.push(sender);
        return sender;
    }

    getSenders() {
        return this.senders;
    }
}

test('requests a sharp front-facing camera feed without mandatory device-specific dimensions', async () => {
    let constraints;
    const stream = {
        getVideoTracks() {
            return [{}];
        }
    };
    const App = loadAppClass({
        async getUserMedia(requestedConstraints) {
            constraints = requestedConstraints;
            return stream;
        }
    });
    const app = Object.create(App.prototype);
    app.localVideo = {};
    app.applyCameraFilter = async () => {};

    await app.initializeLocalMedia();

    assert.equal(constraints.video.width.ideal, 1280);
    assert.equal(constraints.video.height.ideal, 720);
    assert.equal(constraints.video.frameRate.ideal, 30);
    assert.equal(constraints.video.facingMode.ideal, 'user');
    assert.equal(constraints.video.resizeMode, 'none');
    assert.equal(app.localVideo.srcObject, stream);
});

for (const connection of ['mobile-to-PC', 'PC-to-mobile', 'mobile-to-mobile', 'PC-to-PC']) {
    test(`${connection} applies the same high-quality outgoing video policy`, async () => {
        const App = loadAppClass({});
        const videoTrack = { kind: 'video' };
        const audioTrack = { kind: 'audio' };
        const app = Object.create(App.prototype);
        app.textOnly = false;
        app.peerConnection = null;
        app.socket = null;
        app.currentRoom = null;
        app.getOutgoingStream = () => ({
            getTracks() {
                return [videoTrack, audioTrack];
            }
        });

        await app.createPeerConnection();

        const videoSender = app.peerConnection.getSenders().find((sender) => sender.track.kind === 'video');
        assert.equal(videoSender.parameters.encodings[0].maxBitrate, 2500000);
        assert.equal(videoSender.parameters.encodings[0].maxFramerate, 30);
        assert.equal(videoSender.parameters.degradationPreference, 'maintain-resolution');
    });
}

test('remote video preserves the full camera frame without crop zooming', () => {
    assert.match(styles, /\.video-remote\s*\{[^}]*object-fit:\s*contain;/s);
});

test('matches carry a mobile device hint for portrait remote rendering', () => {
    assert.match(appSource, /deviceType:\s*this\.getDeviceType\(\)/);
    assert.match(appSource, /strangerDeviceType/);
    assert.match(appSource, /classList\.toggle\('remote-mobile'/);
    assert.match(serverSource, /strangerDeviceType:\s*userB\.deviceType/);
    assert.match(serverSource, /strangerDeviceType:\s*userA\.deviceType/);
});

test('mobile strangers render inside a white portrait frame', () => {
    assert.match(styles, /\.video-wrapper-remote\s*\{[^}]*background:\s*#fff;/s);
    assert.match(styles, /\.video-container\.remote-mobile \.video-remote\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16;/s);
});
