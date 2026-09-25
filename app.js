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
        this.demoMatchTimer = null;
        this.searchRequestId = 0;
        this.filteredStream = null;
        this.filterSourceVideo = null;
        this.filterCanvas = null;
        this.filterContext = null;
        this.filterAnimationFrame = null;
        this.activeCameraFilter = 'none';
        this.isVideoEnabled = true;
        this.remoteDeviceType = 'desktop';
        this.blockedStrangerIds = new Set();

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
        this.toggleGiftsBtn = document.getElementById('toggleGifts');
        this.cameraFilterSelect = document.getElementById('cameraFilter');
        this.ageConfirmation = document.getElementById('ageConfirmation');
        this.reportDialog = document.getElementById('reportDialog');
        this.reportForm = document.getElementById('reportForm');
        this.reportReason = document.getElementById('reportReason');
        this.reportDetails = document.getElementById('reportDetails');
        this.blockReportedUser = document.getElementById('blockReportedUser');
        this.closeReportDialogBtn = document.getElementById('closeReportDialog');
        this.cancelReportBtn = document.getElementById('cancelReport');
        this.findNewBtn = document.getElementById('findNew');
        this.goHomeBtn = document.getElementById('goHome');
        this.cancelSearchBtn = document.getElementById('cancelSearch');

        this.chatModeVideo = document.getElementById('chatModeVideo');
        this.chatModeText = document.getElementById('chatModeText');
        this.interestsInput = document.getElementById('interests');
        this.selfGenderSelect = document.getElementById('selfGender');
        this.partnerGenderSelect = document.getElementById('partnerGender');
        this.virtualGiftsPanel = document.getElementById('virtualGiftsPanel');

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
        if (this.toggleGiftsBtn) {
            this.toggleGiftsBtn.addEventListener('click', () => this.toggleGifts());
        }
        if (this.cameraFilterSelect) {
            this.cameraFilterSelect.addEventListener('change', () => {
                this.applyCameraFilter().catch((error) => {
                    console.error('Could not update camera filter:', error);
                    this.showNotification('Could not apply that camera filter.', 'error');
                });
            });
            this.applyCameraFilter();
        }
        if (this.reportForm) {
            this.reportForm.addEventListener('submit', (event) => {
                event.preventDefault();
                this.submitReport();
            });
        }
        if (this.closeReportDialogBtn) {
            this.closeReportDialogBtn.addEventListener('click', () => this.closeReportDialog());
        }
        if (this.cancelReportBtn) {
            this.cancelReportBtn.addEventListener('click', () => this.closeReportDialog());
        }

        this.findNewBtn.addEventListener('click', () => this.startChat());
        this.goHomeBtn.addEventListener('click', () => this.goHome());
        if (this.cancelSearchBtn) {
            this.cancelSearchBtn.addEventListener('click', () => this.cancelSearch());
        }
        if (this.selfGenderSelect) {
            this.selfGenderSelect.addEventListener('change', () => this.restartSearchIfWaiting());
        }
        if (this.partnerGenderSelect) {
            this.partnerGenderSelect.addEventListener('change', () => this.restartSearchIfWaiting());
        }
    }

    syncChatModeFromUI() {
        this.textOnly = !!(this.chatModeText && this.chatModeText.checked);
    }

    hasGenderFilterEntitlement() {
        try {
            if (window.VCOMINGLE_FREE_GENDER_FILTER) return true;
            if (
                typeof vcomingleMonetization !== 'undefined' &&
                vcomingleMonetization &&
                typeof vcomingleMonetization.hasRewardedGenderFilter === 'function' &&
                vcomingleMonetization.hasRewardedGenderFilter()
            ) {
                return true;
            }
            return (
                typeof vcomingleMonetization !== 'undefined' &&
                vcomingleMonetization &&
                typeof vcomingleMonetization.hasGenderFilter === 'function' &&
                vcomingleMonetization.hasGenderFilter()
            );
        } catch (_) {
            return false;
        }
    }

    hasPremiumGenderFilter() {
        return this.hasGenderFilterEntitlement();
    }

    getUserId() {
        if (
            typeof vcomingleMonetization !== 'undefined' &&
            vcomingleMonetization &&
            vcomingleMonetization.userId
        ) {
            return vcomingleMonetization.userId;
        }
        return '';
    }

    getDeviceType() {
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
        const userAgentData = typeof navigator !== 'undefined' ? navigator.userAgentData : null;
        return userAgentData?.mobile || /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(userAgent)
            ? 'mobile'
            : 'desktop';
    }

    updateRemoteVideoLayout() {
        if (!this.videoContainer) return;
        this.videoContainer.classList.toggle('remote-mobile', this.remoteDeviceType === 'mobile');
    }

    getGenderEntitlementToken() {
        if (
            typeof vcomingleMonetization !== 'undefined' &&
            vcomingleMonetization &&
            typeof vcomingleMonetization.getGenderEntitlementToken === 'function'
        ) {
            return vcomingleMonetization.getGenderEntitlementToken();
        }
        return '';
    }

    getSelfGender() {
        const v = (this.selfGenderSelect && this.selfGenderSelect.value) || 'unspecified';
        if (v === 'male' || v === 'female') return v;
        return 'unspecified';
    }

    getPartnerGenderPreference() {
        if (!this.hasGenderFilterEntitlement()) return 'random';
        const v = (this.partnerGenderSelect && this.partnerGenderSelect.value) || 'random';
        if (v === 'male' || v === 'female') return v;
        return 'random';
    }

    validateGenderSelection() {
        const selfGender = this.getSelfGender();
        const partnerGender = this.getPartnerGenderPreference();
        if (partnerGender !== 'random' && selfGender === 'unspecified') {
            this.showNotification(
                'Choose your gender to use a male or female match filter.',
                'error'
            );
            return false;
        }
        return true;
    }

    validateAgeConfirmation() {
        if (this.ageConfirmation && !this.ageConfirmation.checked) {
            this.showNotification('You must confirm that you are 18 or older before starting a chat.', 'error');
            this.ageConfirmation.focus();
            return false;
        }
        return true;
    }

    getMatchSearchDetail(fallback) {
        const partnerGender = this.getPartnerGenderPreference();
        return partnerGender === 'random'
            ? fallback
            : `Looking for a ${partnerGender} stranger...`;
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
        const requestId = ++this.searchRequestId;
        this.syncChatModeFromUI();
        if (!this.validateGenderSelection() || !this.validateAgeConfirmation()) return;
        this.showScreen('connectingScreen');
        this.setConnectingDetail(this.getMatchSearchDetail('Connecting to chat server…'));

        try {
            if (!this.textOnly) {
                await this.initializeLocalMedia();
            } else if (this.localVideo) {
                this.localVideo.srcObject = null;
            }

            await this.connectToSignalingServer();
            if (requestId !== this.searchRequestId) return;
            this.setConnectingDetail(this.getMatchSearchDetail('Waiting for a stranger to connect...'));
            this.findMatch();
        } catch (error) {
            if (requestId !== this.searchRequestId) return;
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
        const premiumVideo =
            typeof vcomingleMonetization !== 'undefined' &&
            vcomingleMonetization &&
            typeof vcomingleMonetization.hasHDVideo === 'function' &&
            vcomingleMonetization.hasHDVideo();
        const constraints = {
            // Prefer a sharp front camera feed without making a lower-end phone fail capture.
            video: {
                width: { ideal: premiumVideo ? 1920 : 1280 },
                height: { ideal: premiumVideo ? 1080 : 720 },
                frameRate: { ideal: 30, max: 30 },
                facingMode: { ideal: 'user' },
                resizeMode: 'none'
            },
            audio: true
        };
        this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        this.isVideoEnabled = true;
        if (this.localVideo) this.localVideo.srcObject = this.localStream;
        await this.applyCameraFilter();
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
            const { roomId, strangerId, isInitiator, strangerDeviceType } = data;
            this.currentRoom = roomId;
            this.strangerId = strangerId;
            this.isInitiator = !!isInitiator;
            this.remoteDeviceType = strangerDeviceType === 'mobile' ? 'mobile' : 'desktop';
            this.updateRemoteVideoLayout();

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
                this.setConnectingDetail('Waiting for a stranger to connect...');
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

        this.socket.on('virtual-gift', (data) => {
            this.receiveGift(data && data.giftType);
        });

        this.socket.on('stranger-disconnected', () => {
            this.onStrangerDisconnected();
        });

        this.socket.on('moderation-action', (payload) => {
            this.showNotification(
                (payload && payload.message) || 'This session is unavailable while moderation reviews reports.',
                'error'
            );
            this.cleanupSession();
            this.goHome();
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
                    if (self.demoMatchTimer) clearTimeout(self.demoMatchTimer);
                    self.demoMatchTimer = setTimeout(() => {
                        self.demoMatchTimer = null;
                        self.currentRoom = 'demo-room';
                        self.strangerId = 'demo-stranger';
                        self.isInitiator = Math.random() < 0.5;
                        self.applyChatLayout();
                        self.showScreen('chatScreen');
                        if (self.chatMessages) self.chatMessages.innerHTML = '';
                        self.onMatchReady();
                    }, 1500 + Math.random() * 1500);
                }
                if (event === 'cancel-search' || event === 'stop') {
                    if (self.demoMatchTimer) {
                        clearTimeout(self.demoMatchTimer);
                        self.demoMatchTimer = null;
                    }
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
                interests,
                selfGender: this.getSelfGender(),
                partnerGender: this.getPartnerGenderPreference(),
                userId: this.getUserId(),
                genderEntitlementToken: this.getGenderEntitlementToken(),
                deviceType: this.getDeviceType(),
                tier:
                    typeof vcomingleMonetization !== 'undefined' && vcomingleMonetization
                        ? vcomingleMonetization.userTier
                        : 'free'
            });
            return;
        }
        if (this.isDemoModeEnabled()) {
            this.fallbackToDemoMode();
            this.socket.emit('find-match', {
                textOnly: this.textOnly,
                interests,
                selfGender: this.getSelfGender(),
                partnerGender: this.getPartnerGenderPreference(),
                userId: this.getUserId(),
                genderEntitlementToken: this.getGenderEntitlementToken(),
                deviceType: this.getDeviceType(),
                tier:
                    typeof vcomingleMonetization !== 'undefined' && vcomingleMonetization
                        ? vcomingleMonetization.userTier
                        : 'free'
            });
            return;
        }
        this.showNotification('Not connected to the chat server. Go back and try again.', 'error');
        this.goHome();
    }

    isWaitingForMatch() {
        return !!(this.connectingScreen && !this.connectingScreen.classList.contains('hidden'));
    }

    restartSearchIfWaiting() {
        if (!this.isWaitingForMatch()) return;
        if (!this.validateGenderSelection()) {
            if (this.socket && this.socket.connected) {
                this.socket.emit('cancel-search');
            }
            this.setConnectingDetail('Choose your gender to use a male or female match filter.');
            return;
        }
        if (this.socket && this.socket.connected) {
            this.socket.emit('cancel-search');
        }
        this.setConnectingDetail('Updating your search...');
        this.findMatch();
    }

    cancelSearch() {
        this.searchRequestId += 1;

        if (this.socket && this.socket.connected) {
            this.socket.emit('cancel-search');
        }
        if (this.demoMatchTimer) {
            clearTimeout(this.demoMatchTimer);
            this.demoMatchTimer = null;
        }

        this.cleanupSession();
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

    getOutgoingStream() {
        return this.filteredStream || this.localStream;
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

        const outgoingStream = this.getOutgoingStream();
        if (outgoingStream) {
            for (const track of outgoingStream.getTracks()) {
                const sender = this.peerConnection.addTrack(track, outgoingStream);
                if (track.kind === 'video') {
                    await this.configureVideoSender(sender);
                }
            }
        }

        this.peerConnection.ontrack = (event) => {
            if (event.streams && event.streams[0] && this.remoteVideo) {
                this.remoteStream = event.streams[0];
                this.remoteVideo.srcObject = this.remoteStream;
                this.remoteVideo.addEventListener(
                    'loadedmetadata',
                    () => this.updateRemoteVideoLayout(),
                    { once: true }
                );
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

    getGift(giftType) {
        const gifts = {
            heart: { icon: '❤️', name: 'Heart' },
            rose: { icon: '🌹', name: 'Rose' },
            star: { icon: '⭐', name: 'Star' },
            diamond: { icon: '💎', name: 'Diamond' },
            crown: { icon: '👑', name: 'Crown' }
        };
        return gifts[giftType] || null;
    }

    sendGift(giftType) {
        const gift = this.getGift(giftType);
        if (!gift) return;

        this.showGiftAnimation(gift, 'Sent');
        this.addSystemMessage(`You sent a ${gift.name} gift.`);

        if (this.socket && this.socket.connected && this.currentRoom) {
            this.socket.emit('virtual-gift', { roomId: this.currentRoom, giftType });
            return;
        }

        setTimeout(() => this.receiveGift(giftType), 900);
    }

    receiveGift(giftType) {
        const gift = this.getGift(giftType);
        if (!gift) return;
        this.showGiftAnimation(gift, 'Received');
        this.addSystemMessage(`Stranger sent you a ${gift.name} gift.`);
    }

    showGiftAnimation(gift, label) {
        const animation = document.createElement('div');
        animation.className = 'gift-animation';
        animation.innerHTML = `
            <div class="gift-content">
                <div class="gift-icon">${gift.icon}</div>
                <div class="gift-name">${this.escapeHtml(label)} ${this.escapeHtml(gift.name)}</div>
            </div>
        `;
        document.body.appendChild(animation);
        setTimeout(() => animation.remove(), 3000);
    }

    setGiftsOpen(isOpen) {
        if (this.virtualGiftsPanel) {
            this.virtualGiftsPanel.classList.toggle('show', isOpen);
            this.virtualGiftsPanel.setAttribute('aria-hidden', String(!isOpen));
        }
        if (this.toggleGiftsBtn) {
            this.toggleGiftsBtn.classList.toggle('active', isOpen);
            this.toggleGiftsBtn.setAttribute('aria-expanded', String(isOpen));
        }
    }

    toggleGifts() {
        const isOpen = !!(this.virtualGiftsPanel && this.virtualGiftsPanel.classList.contains('show'));
        this.setGiftsOpen(!isOpen);
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
        if (!this.validateGenderSelection()) return;
        this.cleanupPeerAndMedia();
        this.showScreen('connectingScreen');
        this.setConnectingDetail(this.getMatchSearchDetail('Looking for another stranger…'));

        try {
            if (!this.textOnly) {
                await this.initializeLocalMedia();
            }
        } catch (e) {
            console.warn('Could not refresh camera for next chat:', e);
        }

        if (this.socket && this.socket.connected) {
            this.socket.emit('next', {
                selfGender: this.getSelfGender(),
                partnerGender: this.getPartnerGenderPreference(),
                genderEntitlementToken: this.getGenderEntitlementToken()
            });
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
        if (!this.currentRoom || !this.strangerId) {
            this.showNotification('There is no active chat to report.', 'error');
            return;
        }
        if (this.reportDetails) this.reportDetails.value = '';
        if (this.blockReportedUser) this.blockReportedUser.checked = true;
        if (this.reportDialog) {
            this.reportDialog.classList.remove('hidden');
            if (this.reportReason) this.reportReason.focus();
        }
    }

    closeReportDialog() {
        if (!this.reportDialog) return;
        this.reportDialog.classList.add('hidden');
        if (this.reportBtn) this.reportBtn.focus();
    }

    submitReport() {
        if (!this.currentRoom || !this.strangerId || !this.reportReason) {
            this.closeReportDialog();
            this.showNotification('The chat is no longer active.', 'error');
            return;
        }

        const reason = this.reportReason.value;
        const details = this.reportDetails ? this.reportDetails.value.trim() : '';
        const shouldBlock = !this.blockReportedUser || this.blockReportedUser.checked;

        if (shouldBlock) this.blockedStrangerIds.add(this.strangerId);
        if (this.socket && this.socket.connected && this.currentRoom) {
            this.socket.emit('report', {
                roomId: this.currentRoom,
                reason,
                details,
                blockUser: shouldBlock
            });
        }
        this.closeReportDialog();
        this.showNotification('Your report was submitted. Thanks for helping keep VComingle safe.', 'success');
        this.cleanupSession();
        this.goHome();
    }

    toggleVideo() {
        if (!this.localStream) return;
        this.isVideoEnabled = !this.isVideoEnabled;
        this.localStream.getVideoTracks().forEach((track) => {
            track.enabled = this.isVideoEnabled;
        });
        if (this.filteredStream) {
            this.filteredStream.getVideoTracks().forEach((track) => {
                track.enabled = this.isVideoEnabled;
            });
        }
        this.toggleVideoBtn.style.opacity = this.isVideoEnabled ? '1' : '0.5';
    }

    getCameraFilterCss(filter) {
        const filters = {
            none: 'none',
            warm: 'sepia(0.18) saturate(1.15) contrast(1.04)',
            cool: 'saturate(0.9) hue-rotate(12deg) brightness(1.04)',
            mono: 'grayscale(1) contrast(1.12)',
            vivid: 'saturate(1.45) contrast(1.08)'
        };
        return filters[filter] || filters.none;
    }

    async applyCameraFilter() {
        const selectedFilter = (this.cameraFilterSelect && this.cameraFilterSelect.value) || 'none';
        this.activeCameraFilter = selectedFilter;
        const filterControl = this.cameraFilterSelect && this.cameraFilterSelect.closest('.camera-filter-control');
        if (filterControl) filterControl.dataset.filter = selectedFilter || 'none';

        if (!this.localStream || !this.localVideo) return;

        if (selectedFilter === 'none') {
            this.stopFilteredVideoPipeline();
            this.localVideo.srcObject = this.localStream;
            await this.replaceOutgoingVideoTrack(this.localStream.getVideoTracks()[0] || null);
            return;
        }

        await this.startFilteredVideoPipeline();
        await this.replaceOutgoingVideoTrack(
            this.filteredStream && this.filteredStream.getVideoTracks()[0]
        );
    }

    async startFilteredVideoPipeline() {
        if (!this.localStream) return;

        if (!this.filterSourceVideo) {
            this.filterSourceVideo = document.createElement('video');
            this.filterSourceVideo.autoplay = true;
            this.filterSourceVideo.muted = true;
            this.filterSourceVideo.playsInline = true;
            this.filterSourceVideo.srcObject = this.localStream;
            try {
                await this.filterSourceVideo.play();
            } catch (_) {
                // Playback will start once the browser has enough media data.
            }
        }

        if (!this.filteredStream) {
            await this.waitForVideoDimensions(this.filterSourceVideo);
            this.filterCanvas = document.createElement('canvas');
            this.filterCanvas.width = this.filterSourceVideo.videoWidth || 1280;
            this.filterCanvas.height = this.filterSourceVideo.videoHeight || 720;
            this.filterContext = this.filterCanvas.getContext('2d');
            if (!this.filterContext || typeof this.filterCanvas.captureStream !== 'function') {
                throw new Error('Camera filters are not supported by this browser.');
            }

            const filteredVideoTrack = this.filterCanvas.captureStream(30).getVideoTracks()[0];
            filteredVideoTrack.enabled = this.isVideoEnabled;
            this.filteredStream = new MediaStream([
                ...this.localStream.getAudioTracks(),
                filteredVideoTrack
            ]);
            this.renderFilteredFrame();
        }

        this.localVideo.srcObject = this.filteredStream;
    }

    waitForVideoDimensions(video) {
        if (video.videoWidth && video.videoHeight) return Promise.resolve();
        return new Promise((resolve) => {
            const ready = () => {
                video.removeEventListener('loadedmetadata', ready);
                resolve();
            };
            video.addEventListener('loadedmetadata', ready, { once: true });
            setTimeout(ready, 1200);
        });
    }

    renderFilteredFrame() {
        if (!this.filterContext || !this.filterCanvas || !this.filterSourceVideo || !this.filteredStream) {
            return;
        }
        const width = this.filterSourceVideo.videoWidth || this.filterCanvas.width;
        const height = this.filterSourceVideo.videoHeight || this.filterCanvas.height;
        if (width !== this.filterCanvas.width || height !== this.filterCanvas.height) {
            this.filterCanvas.width = width;
            this.filterCanvas.height = height;
        }
        this.filterContext.filter = this.getCameraFilterCss(this.activeCameraFilter);
        this.filterContext.drawImage(this.filterSourceVideo, 0, 0, this.filterCanvas.width, this.filterCanvas.height);
        this.filterAnimationFrame = requestAnimationFrame(() => this.renderFilteredFrame());
    }

    async replaceOutgoingVideoTrack(videoTrack) {
        if (!this.peerConnection || !videoTrack) return;
        const sender = this.peerConnection
            .getSenders()
            .find((candidate) => candidate.track && candidate.track.kind === 'video');
        if (sender && sender.track !== videoTrack) {
            await sender.replaceTrack(videoTrack);
            await this.configureVideoSender(sender);
        }
    }

    async configureVideoSender(sender) {
        if (!sender || !sender.track || sender.track.kind !== 'video') return;

        try {
            const parameters = sender.getParameters();
            const encodings = parameters.encodings && parameters.encodings.length ? parameters.encodings : [{}];

            encodings.forEach((encoding) => {
                encoding.maxBitrate = 2500000;
                encoding.maxFramerate = 30;
            });

            parameters.encodings = encodings;
            parameters.degradationPreference = 'maintain-resolution';
            await sender.setParameters(parameters);
        } catch (error) {
            // Browsers that do not expose sender tuning still use the requested camera settings.
            console.warn('Could not apply preferred video sender settings:', error);
        }
    }

    stopFilteredVideoPipeline() {
        if (this.filterAnimationFrame) {
            cancelAnimationFrame(this.filterAnimationFrame);
            this.filterAnimationFrame = null;
        }
        if (this.filteredStream) {
            this.filteredStream.getVideoTracks().forEach((track) => track.stop());
            this.filteredStream = null;
        }
        this.filterCanvas = null;
        this.filterContext = null;
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
        if (this.demoMatchTimer) {
            clearTimeout(this.demoMatchTimer);
            this.demoMatchTimer = null;
        }
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
        this.stopFilteredVideoPipeline();
        if (this.filterSourceVideo) {
            this.filterSourceVideo.srcObject = null;
            this.filterSourceVideo = null;
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach((t) => t.stop());
            this.localStream = null;
        }
        if (this.localVideo) this.localVideo.srcObject = null;
        if (this.remoteVideo) this.remoteVideo.srcObject = null;
        this.remoteStream = null;
        this.remoteDeviceType = 'desktop';
        this.updateRemoteVideoLayout();
        this.isVideoEnabled = true;
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
        if (screenId !== 'chatScreen') this.setGiftsOpen(false);
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

function sendGift(giftType) {
    if (window.vcomegleApp) {
        window.vcomegleApp.sendGift(giftType);
    }
}

window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});
