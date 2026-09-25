const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

function loadAppClass(mediaDevices, peerConnection = MockPeerConnection, userAgent = '') {
    const context = {
        console,
        navigator: { mediaDevices, userAgent },
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
    assert.equal(constraints.video.aspectRatio.ideal, 16 / 9);
    assert.equal(constraints.video.frameRate.ideal, 30);
    assert.equal(constraints.video.facingMode.ideal, 'user');
    assert.equal(constraints.video.resizeMode, 'none');
    assert.equal(app.localVideo.srcObject, stream);
});

test('requests a native mobile front-camera field of view without sensor cropping', async () => {
    let constraints;
    const stream = {
        getVideoTracks() {
            return [{}];
        }
    };
    const App = loadAppClass(
        {
            async getUserMedia(requestedConstraints) {
                constraints = requestedConstraints;
                return stream;
            }
        },
        MockPeerConnection,
        'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36'
    );
    const app = Object.create(App.prototype);
    app.localVideo = {};
    app.applyCameraFilter = async () => {};

    await app.initializeLocalMedia();

    assert.equal(constraints.video.width.ideal, 1280);
    assert.equal(constraints.video.height.ideal, 960);
    assert.equal(constraints.video.aspectRatio.ideal, 4 / 3);
    assert.equal(constraints.video.resizeMode, 'none');
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

for (const connection of ['mobile-to-PC', 'PC-to-mobile', 'mobile-to-mobile', 'PC-to-PC']) {
    test(`${connection} selects the correct source orientation for the sending device`, async () => {
        let constraints;
        const mobileSender = connection.startsWith('mobile');
        const App = loadAppClass(
            {
                async getUserMedia(requestedConstraints) {
                    constraints = requestedConstraints;
                    return {
                        getVideoTracks() {
                            return [{}];
                        }
                    };
                }
            },
            MockPeerConnection,
            mobileSender ? 'Mozilla/5.0 (Linux; Android 14; Mobile)' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        );
        const app = Object.create(App.prototype);
        app.localVideo = {};
        app.applyCameraFilter = async () => {};

        await app.initializeLocalMedia();

        assert.equal(constraints.video.aspectRatio.ideal, mobileSender ? 4 / 3 : 16 / 9);
        assert.equal(constraints.video.resizeMode, 'none');
    });
}

test('remote video fills its stage and crops from the center when needed', () => {
    assert.match(styles, /\.video-local,\s*\.video-remote\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
    assert.match(styles, /\.video-remote\s*\{[^}]*object-fit:\s*cover;[^}]*object-position:\s*center;/s);
    assert.match(styles, /\.video-local\s*\{[^}]*object-fit:\s*contain;/s);
});

test('matches carry a mobile device hint for portrait remote rendering', () => {
    assert.match(appSource, /deviceType:\s*this\.getDeviceType\(\)/);
    assert.match(appSource, /strangerDeviceType/);
    assert.match(appSource, /classList\.toggle\('remote-mobile'/);
    assert.match(serverSource, /strangerDeviceType:\s*userB\.deviceType/);
    assert.match(serverSource, /strangerDeviceType:\s*userA\.deviceType/);
});

test('remote video stage has no white portrait framing', () => {
    assert.match(styles, /\.video-wrapper-remote\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*background:\s*#111827;/s);
    assert.doesNotMatch(styles, /\.video-container\.remote-mobile \.video-remote/);
});

test('every mobile stream receives the phone-shaped remote frame', () => {
    const App = loadAppClass({});
    const classes = new Map();
    const app = Object.create(App.prototype);
    app.remoteDeviceType = 'mobile';
    app.videoContainer = {
        classList: {
            toggle(name, enabled) {
                classes.set(name, enabled);
            }
        }
    };

    app.updateRemoteVideoLayout();
    assert.equal(classes.get('remote-mobile'), true);
});

test('resets supported cameras to their widest zoom setting', async () => {
    const App = loadAppClass({});
    const app = Object.create(App.prototype);
    let appliedConstraints;
    await app.resetCameraZoom({
        getCapabilities() {
            return { zoom: { min: 1, max: 4 } };
        },
        async applyConstraints(constraints) {
            appliedConstraints = constraints;
        }
    });

    assert.equal(appliedConstraints.advanced[0].zoom, 1);
});
