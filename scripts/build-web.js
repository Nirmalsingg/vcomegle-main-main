const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const webDir = path.join(projectRoot, 'www');

const assets = [
  'about.html',
  'ads.txt',
  'anonymous-chat.html',
  'app.js',
  'auth.js',
  'contact.html',
  'content-policy.html',
  'googleda40c23abde55731.html',
  'index.html',
  'meet-new-people-online.html',
  'monetization.css',
  'monetization.js',
  'native-bridge.js',
  'payment-system.js',
  'premium-features.html',
  'premium-functions.js',
  'privacy.html',
  'random-video-chat.html',
  'revenue-dashboard.js',
  'robots.txt',
  'socket-loader.js',
  'sitemap.xml',
  'styles.css',
  'terms.html',
  'text-chat.html',
];

fs.rmSync(webDir, { recursive: true, force: true });
fs.mkdirSync(webDir, { recursive: true });

for (const asset of assets) {
  const source = path.join(projectRoot, asset);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing web asset: ${asset}`);
  }
  fs.copyFileSync(source, path.join(webDir, asset));
}

console.log(`Copied ${assets.length} web assets to ${path.relative(projectRoot, webDir)}.`);
