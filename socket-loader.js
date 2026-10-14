(function loadSocketIoClient() {
    const baseUrl = window.VCOMINGLE_API_BASE_URL || '';
    const source = baseUrl
        ? `${baseUrl.replace(/\/$/, '')}/socket.io/socket.io.js`
        : '/socket.io/socket.io.js';

    // This runs while the document is still parsing, so app.js always sees window.io.
    document.write(`<script src="${source}"><\\/script>`);
})();
