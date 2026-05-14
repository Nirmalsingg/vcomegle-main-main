class VComingleApp {
    constructor() {
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.socket = null;
        this.currentRoom = null;
        this.strangerId = null;
        this.isConnected = false;
        this.textOnly = false;
        this.isInitiator = false;
        this.connectionStartTime = null;
        this.connectionCheckInterval = null;
        this.socketHandlersBound = false;

        this.initializeElements();
        this.initializeEventListeners();
        this.updateOnlineCount();
    }

    initializeElements() {
        this.welcomeScreen = document.getElementById('welcomeScreen');
        this.chatScreen = document.getElementById('chatScreen');
        this.connectingScreen = document.getElementById('connectingScreen');
        this.disconnectedScreen = document.getElementById('disconnectedScreen');

        this.localVideo = document.getElementById('localVideo');
        this.remoteVideo = document.getElementById('remoteVideo');
        this.videoContainer = document.querySelector('.video-container');

        this.chatMessages = document.getElementById('chatMessages');
        this.messageInput = document.getElementById('messageInput');
        this.sendMessageBtn = document.getElementById('sendMessage');

        this.startChatBtn = document.getElementById('startChat');
        this.nextBtn = document.getElementById('nextButton');
        this.stopBtn = document.getElementById('stopButton');
        this.reportBtn = document.getElementById('reportButton');
        this.toggleVideoBtn = document.getElementById('toggleVideo');
        this.toggleAudioBtn = document.getElementById('toggleAudio');
        this.findNewBtn = document.getElementById('findNew');
        this.goHomeBtn = document.getElementById('goHome');

        this.chatModeVideo = document.getElementById('chatModeVideo');
        this.chatModeText = document.getElementById('chatModeText');
        this.interestsInput = document.getElementById('interests');

        this.onlineCount = document.getElementById('onlineCount');
        this.connectingDetail = document.getElementById('connectingDetail');
    }

    setConnectingDetail(html) {
        if (this.connectingDetail) this.connectingDetail.innerHTML = html;
    }

    initializeEventListeners() {
        if (this.startChatBtn) {
            this.startChatBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.startChat();
            });
        }

        this.sendMessageBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        this.nextBtn.addEventListener('click', () => this.nextChat());
        this.stopBtn.addEventListener('click', () => this.stopChat());
        this.reportBtn.addEventListener('click', () => this.reportUser());
        this.toggleVideoBtn.addEventListener('click', () => this.toggleVideo());
        this.toggleAudioBtn.addEventListener('click', () => this.toggleAudio());

        this.findNewBtn.addEventListener('click', () => this.startChat());
        this.goHomeBtn.addEventListener('click', () => this.goHome());
    }

    syncChatModeFromUI() {
        this.textOnly = !!(this.chatModeText && this.chatModeText.checked);
    }

    applyChatLayout() {
        if (!this.chatScreen || !this.videoContainer) return;
        if (this.textOnly) {
            this.chatScreen.classList.add('text-only-session');
            this.videoContainer.setAttribute('aria-hidden', 'true');
        } else {
            this.chatScreen.classList.remove('text-only-session');
            this.videoContainer.removeAttribute('aria-hidden');
        }
    }

    isDemoModeEnabled() {
        return new URLSearchParams(window.location.search).get('demo') === '1';
    }

    async startChat() {
        this.syncChatModeFromUI();
        this.showScreen('connectingScreen');
        this.setConnectingDetail('Connecting to chat server…');

        try {
            if (!this.textOnly) {
                await this.initializeLocalMedia();
            } else if (this.localVideo) {
                this.localVideo.srcObject = null;
            }

            await this.connectToSignalingServer();
            this.setConnectingDetail(
                'Looking for a stranger… Use the <strong>same</strong> mode (Video or Text only) on both devices.'
            );
            this.findMatch();
        } catch (error) {
            console.error('Error starting chat:', error);
            const msg =
                error && error.message
                    ? error.message
                    : 'Could not start chat. Check permissions, network, or try text-only mode.';
            this.showNotification(msg, 'error');
            this.goHome();
        }
    }

    async initializeLocalMedia() {
        const constraints = {
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: true
        };
        this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (this.localVideo) this.localVideo.srcObject = this.localStream;
    }

    getSocketUrl() {
        const params = new URLSearchParams(window.location.search);
        const override = params.get('socket');
        if (override) return override;
        return window.location.origin;
    }

    bindSocketHandlers() {
        if (!this.socket || this.socketHandlersBound) return;

        this.socket.on('match-found', (data) => {
            const { roomId, strangerId, isInitiator } = data;
            this.currentRoom = roomId;
            this.strangerId = strangerId;
            this.isInitiator = !!isInitiator;

            if (this.connectionCheckInterval) {
                clearInterval(this.connectionCheckInterval);
                this.connectionCheckInterval = null;
            }

            this.applyChatLayout();
            this.showScreen('chatScreen');
            if (this.chatMessages) this.chatMessages.innerHTML = '';

            this.onMatchReady();
        });

        this.socket.on('waiting', (payload) => {
            this.showScreen('connectingScreen');
            if (payload && typeof payload.othersWaiting === 'number') {
                const n = payload.othersWaiting;
                const modeHint = this.textOnly ? 'Text only' : 'Video + text';
                if (n === 0) {
                    this.setConnectingDetail(
                        `<strong>${modeHint}:</strong> You’re in the queue alone. Open this site on another phone or PC, choose <strong>${modeHint}</strong>, and tap <strong>Start chatting</strong> at the same time.`
                    );
                } else {
                    this.setConnectingDetail(
                        `<strong>${modeHint}:</strong> ${n} other user(s) waiting — matching soon…`
                    );
                }
            }
        });

        this.socket.on('offer', (data) => {
            this.handleOffer(data.offer);
        });

        this.socket.on('answer', (data) => {
            this.handleAnswer(data.answer);
        });

        this.socket.on('ice-candidate', (data) => {
            this.handleIceCandidate(data.candidate);
        });

        this.socket.on('chat-message', (data) => {
            this.addMessage(this.escapeHtml(data.message), 'stranger');
        });

        this.socket.on('stranger-disconnected', () => {
            this.onStrangerDisconnected();
        });

        this.socket.on('disconnected', () => {
            this.cleanupSession();
            this.goHome();
        });

        this.socketHandlersBound = true;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async connectToSignalingServer() {
        if (this.socket && this.socket.connected) {
            this.bindSocketHandlers();
            return;
        }

        if (this.socket) {
            try {
                this.socket.removeAllListeners();
                this.socket.disconnect();
            } catch (_) {
                /* ignore */
            }
            this.socket = null;
        }

        this.socketHandlersBound = false;

        const allowDemo = this.isDemoModeEnabled();
        const CONNECT_MS = 30000;

        return new Promise((resolve, reject) => {
            const socketUrl = this.getSocketUrl();
            let settled = false;

            const deadline = setTimeout(() => {
                if (settled) return;
                if (this.socket && this.socket.connected) return;
                settled = true;
                try {
                    this.socket?.disconnect();
                } catch (_) {
                    /* ignore */
                }
                if (allowDemo) {
                    console.warn('Demo mode: connection timeout, using local simulation (?demo=1)');
                    this.fallbackToDemoMode();
                    resolve();
                } else {
                    reject(
                        new Error(
                            'Cannot reach the chat server (timeout). Check Wi‑Fi/mobile data, try another browser, or wait and try again.'
                        )
                    );
                }
            }, CONNECT_MS);

            try {
                this.socket = io(socketUrl, {
                    transports: ['polling', 'websocket'],
                    timeout: 20000,
                    forceNew: true,
                    reconnection: true,
                    reconnectionAttempts: 10,
                    reconnectionDelay: 800
                });

                this.socket.once('connect', () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(deadline);
                    console.log('Connected to signaling server:', socketUrl);
                    this.bindSocketHandlers();
                    resolve();
                });

                this.socket.on('connect_error', (error) => {
                    console.error('Socket connection error (will retry):', error?.message || error);
                });
            } catch (error) {
                clearTimeout(deadline);
                if (!settled) {
                    settled = true;
                    if (allowDemo) {
                        this.fallbackToDemoMode();
                        resolve();
                    } else {
                        reject(error);
                    }
                }
            }
        });
    }

    fallbackToDemoMode() {
        console.warn('Demo mode: no signaling server. Match flow is simulated locally.');
        const self = this;
        this.socket = {
            connected: true,
            emit(event, data) {
                console.log('Demo emit:', event, data);
                if (event === 'find-match' || event === 'next') {
                    setTimeout(() => {
                        self.currentRoom = 'demo-room';
                        self.strangerId = 'demo-stranger';
                        self.isInitiator = Math.random() < 0.5;
                        self.applyChatLayout();
                        self.showScreen('chatScreen');
                        if (self.chatMessages) self.chatMessages.innerHTML = '';
                        self.onMatchReady();
                    }, 1500 + Math.random() * 1500);
                }
            },
            on() {},
            disconnect() {}
        };
        this.socketHandlersBound = false;
    }

    findMatch() {
        const interests = this.interestsInput ? this.interestsInput.value : '';
        if (this.socket && this.socket.connected) {
            this.socket.emit('find-match', {
                textOnly: this.textOnly,
                interests
            });
            return;
        }
        if (this.isDemoModeEnabled()) {
            this.fallbackToDemoMode();
            this.socket.emit('find-match', { textOnly: this.textOnly, interests });
            return;
        }
        this.showNotification('Not connected to the chat server. Go back and try again.', 'error');
        this.goHome();
    }

    async onMatchReady() {
        this.isConnected = true;
        this.addSystemMessage(
            this.textOnly
                ? 'Connected (text only). Stranger can chat; there is no video in this mode.'
                : 'Connected. Video is connecting; you can already type below.'
        );

        if (this.textOnly) {
            if (this.remoteVideo) this.remoteVideo.srcObject = null;
            return;
        }

        if (!this.localStream) {
            try {
                await this.initializeLocalMedia();
            } catch (e) {
                console.error(e);
                this.addSystemMessage('Camera/mic unavailable. You can still use text chat.');
                return;
            }
        }

        await this.createPeerConnection();
        this.connectionStartTime = Date.now();
        this.setupConnectionMonitoring();
    }

    setupConnectionMonitoring() {
        if (this.connectionCheckInterval) clearInterval(this.connectionCheckInterval);
        this.connectionCheckInterval = setInterval(() => {
            if (!this.peerConnection) return;
            const state = this.peerConnection.connectionState;
            if (state === 'connected' && this.connectionStartTime) {
                clearInterval(this.connectionCheckInterval);
                this.connectionCheckInterval = null;
            }
            if (state === 'failed' || state === 'closed') {
                clearInterval(this.connectionCheckInterval);
                this.connectionCheckInterval = null;
            }
        }, 1000);
    }

    async createPeerConnection() {
        if (this.textOnly) return;

        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ]
        };

        if (this.peerConnection) {
            try {
                this.peerConnection.close();
            } catch (_) {
                /* ignore */
            }
        }

        this.peerConnection = new RTCPeerConnection(configuration);

        if (this.localStream) {
            this.localStream.getTracks().forEach((track) => {
                this.peerConnection.addTrack(track, this.localStream);
            });
        }

        this.peerConnection.ontrack = (event) => {
            if (event.streams && event.streams[0] && this.remoteVideo) {
                this.remoteStream = event.streams[0];
                this.remoteVideo.srcObject = this.remoteStream;
            }
        };

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.socket && this.socket.connected && this.currentRoom) {
                this.socket.emit('ice-candidate', {
                    roomId: this.currentRoom,
                    candidate: event.candidate
                });
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection && this.peerConnection.connectionState;
            if (state === 'connected') {
                this.addSystemMessage('Video connection is up.');
            }
        };

        if (this.socket && this.socket.connected && this.currentRoom && this.isInitiator) {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            this.socket.emit('offer', { roomId: this.currentRoom, offer });
        }
    }

    handleOffer(offer) {
        if (!offer || this.textOnly) return;
        if (!this.peerConnection) {
            this.createPeerConnection().then(() => this.applyOffer(offer));
        } else {
            this.applyOffer(offer);
        }
    }

    applyOffer(offer) {
        if (!this.peerConnection) return;
        this.peerConnection
            .setRemoteDescription(new RTCSessionDescription(offer))
            .then(() => this.createAndSendAnswer())
            .catch((err) => console.error('Error handling offer:', err));
    }

    handleAnswer(answer) {
        if (!this.peerConnection || !answer) return;
        this.peerConnection
            .setRemoteDescription(new RTCSessionDescription(answer))
            .catch((err) => console.error('Error handling answer:', err));
    }

    handleIceCandidate(candidate) {
        if (!this.peerConnection || !candidate) return;
        this.peerConnection
            .addIceCandidate(new RTCIceCandidate(candidate))
            .catch((err) => console.error('ICE add failed:', err));
    }

    async createAndSendAnswer() {
        if (!this.peerConnection) return;
        try {
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            if (this.socket && this.socket.connected && this.currentRoom) {
                this.socket.emit('answer', { roomId: this.currentRoom, answer });
            }
        } catch (error) {
            console.error('Error creating answer:', error);
        }
    }

    sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message) return;

        this.addMessage(this.escapeHtml(message), 'you');
        this.messageInput.value = '';

        if (this.socket && this.socket.connected && this.currentRoom) {
            this.socket.emit('chat-message', { roomId: this.currentRoom, message });
            return;
        }

        setTimeout(() => {
            const responses = [
                'Hello there!',
                'How are you?',
                'Nice to meet you!',
                'Where are you from?',
                "That's interesting!"
            ];
            const randomResponse = responses[Math.floor(Math.random() * responses.length)];
            this.addMessage(this.escapeHtml(randomResponse), 'stranger');
        }, 800 + Math.random() * 1200);
    }

    addMessage(htmlText, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        messageDiv.innerHTML = `<span class="message-text">${htmlText}</span>`;
        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    addSystemMessage(text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message system';
        messageDiv.innerHTML = `<span class="message-text">${this.escapeHtml(text)}</span>`;
        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    async nextChat() {
        this.cleanupPeerAndMedia();
        this.showScreen('connectingScreen');
        this.setConnectingDetail('Looking for another stranger…');

        try {
            if (!this.textOnly) {
                await this.initializeLocalMedia();
            }
        } catch (e) {
            console.warn('Could not refresh camera for next chat:', e);
        }

        if (this.socket && this.socket.connected) {
            this.socket.emit('next');
        }
    }

    stopChat() {
        if (this.socket && this.socket.connected) {
            this.socket.emit('stop');
        }
        this.cleanupSession();
        this.goHome();
    }

    reportUser() {
        if (!confirm('Report this user and leave the chat?')) return;
        if (this.socket && this.socket.connected && this.currentRoom) {
            this.socket.emit('report', { roomId: this.currentRoom });
        }
        this.cleanupSession();
        this.goHome();
    }

    toggleVideo() {
        if (!this.localStream) return;
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            this.toggleVideoBtn.style.opacity = videoTrack.enabled ? '1' : '0.5';
        }
    }

    toggleAudio() {
        if (!this.localStream) return;
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            this.toggleAudioBtn.style.opacity = audioTrack.enabled ? '1' : '0.5';
        }
    }

    cleanupPeerAndMedia() {
        if (this.connectionCheckInterval) {
            clearInterval(this.connectionCheckInterval);
            this.connectionCheckInterval = null;
        }
        if (this.peerConnection) {
            try {
                this.peerConnection.close();
            } catch (_) {
                /* ignore */
            }
            this.peerConnection = null;
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach((t) => t.stop());
            this.localStream = null;
        }
        if (this.localVideo) this.localVideo.srcObject = null;
        if (this.remoteVideo) this.remoteVideo.srcObject = null;
        this.remoteStream = null;
        this.currentRoom = null;
        this.strangerId = null;
        this.isConnected = false;
        if (this.chatMessages) this.chatMessages.innerHTML = '';
    }

    cleanupSession() {
        this.cleanupPeerAndMedia();
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 4000);
    }

    goHome() {
        this.cleanupSession();
        if (this.chatScreen) {
            this.chatScreen.classList.remove('text-only-session');
        }
        this.showScreen('welcomeScreen');
    }

    showScreen(screenId) {
        const screens = [this.welcomeScreen, this.chatScreen, this.connectingScreen, this.disconnectedScreen];
        screens.forEach((screen) => {
            if (!screen) return;
            if (screen.id === screenId) {
                screen.classList.remove('hidden');
            } else {
                screen.classList.add('hidden');
            }
        });
    }

    updateOnlineCount() {
        const count = 800 + Math.floor(Math.random() * 4000);
        if (this.onlineCount) this.onlineCount.textContent = count.toLocaleString();
        setTimeout(() => this.updateOnlineCount(), 30000);
    }

    onStrangerDisconnected() {
        this.cleanupSession();
        this.showScreen('disconnectedScreen');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.vcomegleApp = new VComingleApp();

    document.addEventListener('visibilitychange', () => {
        /* reserved: no random disconnect on tab hide */
    });

    window.addEventListener('beforeunload', () => {
        if (window.vcomegleApp) window.vcomegleApp.cleanupSession();
    });
});

window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});
