'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadConfig(env = process.env) {
  // Optional: load a local .env file if present (Node >= 20.12). Real env vars win.
  const envFile = path.resolve(process.cwd(), '.env');
  if (typeof process.loadEnvFile === 'function' && fs.existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      /* ignore malformed .env */
    }
  }

  const port = Number(env.API_PORT ?? process.env.API_PORT ?? 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid API_PORT: ${env.API_PORT}`);
  }
  const baseDirectory = path.resolve(env.BASE_DIRECTORY ?? process.env.BASE_DIRECTORY ?? './data');
  return { port, baseDirectory };
}

module.exports = { loadConfig };
