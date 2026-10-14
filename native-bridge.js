(function configureNativeBackend() {
    const isNative = Boolean(
        window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform()
    );

    if (!isNative) return;

    // Lets the bundled UI use the same app-safe viewport treatment without
    // affecting the public website.
    document.documentElement.classList.add('capacitor-native');
    // Authentication is an app-only requirement. The public website remains
    // usable by guests, while the bundled Android client always signs in.
    window.VCOMINGLE_REQUIRE_AUTH = true;
    // Rewarded ads are not part of the native release until an Android ad
    // provider is integrated and tested.
    window.VCOMINGLE_DISABLE_REWARDED_ADS = true;

    // Android packages the frontend locally; its APIs and Socket.IO server stay hosted.
    window.VCOMINGLE_API_BASE_URL = window.VCOMINGLE_API_BASE_URL || 'https://vcomingle.in';
    const baseUrl = window.VCOMINGLE_API_BASE_URL.replace(/\/$/, '');

    window.vcomingleApiUrl = function vcomingleApiUrl(path) {
        if (/^https?:\/\//i.test(path)) return path;
        return `${baseUrl}${String(path).startsWith('/') ? '' : '/'}${path}`;
    };

    window.vcomingleRequestMediaPermissions = async function vcomingleRequestMediaPermissions() {
        const plugin = window.Capacitor?.Plugins?.MediaPermissions;

        // A web build relies on the browser prompt. Native Android builds use
        // the plugin so the WebView receives its runtime grants before calling
        // getUserMedia().
        if (!plugin) return;

        let permissions = await plugin.checkPermissions();
        if (permissions.camera !== 'granted' || permissions.microphone !== 'granted') {
            permissions = await plugin.requestPermissions();
        }

        if (permissions.camera !== 'granted' || permissions.microphone !== 'granted') {
            throw new Error('Camera and microphone permission is required to start a video chat.');
        }
    };
})();
