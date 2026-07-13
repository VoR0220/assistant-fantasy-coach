const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Keep the watch root on mobile/ only. Watching the monorepo root caused
// server log file writes to trigger Fast Refresh and kill the Sleeper login
// WebView mid-keystroke.
config.resolver.blockList = [
  /(^|[/\\])server[/\\]logs[/\\].*/,
  /sleeper-login-debug\.log$/,
];

module.exports = config;
