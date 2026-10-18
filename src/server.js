'use strict';

const fs = require('node:fs');
const { loadConfig } = require('./config');
const { createApp } = require('./app');

const { port, baseDirectory } = loadConfig();
fs.mkdirSync(baseDirectory, { recursive: true });

const server = createApp(baseDirectory).listen(port, () => {
  console.log(`File manager API listening on port ${port} (base directory: ${baseDirectory})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
