'use strict';

const express = require('express');
const { ApiError, badRequest } = require('./errors');
const { createPathGuard } = require('./security');
const { createFileService } = require('./fileService');

const handler = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

function optionalString(value, name) {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw badRequest(`Query parameter '${name}' must be a single string.`);
  return value;
}

function requiredString(value, name, where) {
  if (typeof value !== 'string' || value.length === 0) {
    throw badRequest(`${where} '${name}' is required and must be a non-empty string.`);
  }
  return value;
}

function createApp(baseDirectory) {
  const guard = createPathGuard(baseDirectory);
  const files = createFileService(guard);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.get('/files', handler(async (req, res) => {
    const target = await guard.resolve(optionalString(req.query.path, 'path'));
    res.status(200).json(await files.list(target));
  }));

  app.get('/search', handler(async (req, res) => {
    const target = await guard.resolve(optionalString(req.query.path, 'path'));
    const query = requiredString(req.query.query, 'query', 'Query parameter');
    res.status(200).json(await files.search(target, query));
  }));

  app.post('/files/copy', handler(async (req, res) => {
    const body = req.body ?? {};
    const rawFrom = requiredString(body.from, 'from', 'Body field');
    const rawTo = requiredString(body.to, 'to', 'Body field');
    const from = await guard.resolve(rawFrom);
    const to = await guard.resolve(rawTo);
    await files.copy(from, to);
    res.status(200).json({ message: `Copied successfully from '${rawFrom}' to '${rawTo}'` });
  }));

  app.post('/files/move', handler(async (req, res) => {
    const body = req.body ?? {};
    const rawFrom = requiredString(body.from, 'from', 'Body field');
    const rawTo = requiredString(body.to, 'to', 'Body field');
    const from = await guard.resolve(rawFrom);
    const to = await guard.resolve(rawTo);
    await files.move(from, to);
    res.status(200).json({ message: `Moved successfully from '${rawFrom}' to '${rawTo}'` });
  }));

  app.delete('/files', handler(async (req, res) => {
    const raw = requiredString(req.query.path, 'path', 'Query parameter');
    const target = await guard.resolve(raw);
    await files.remove(target);
    res.status(200).json({ message: `Deleted successfully: '${raw}'` });
  }));

  app.use((req, _res, next) =>
    next(new ApiError(404, 'ROUTE_NOT_FOUND', `Not Found: ${req.method} ${req.path} is not a valid route.`))
  );

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error.';
    if (err instanceof ApiError) {
      ({ status, code, message } = err);
    } else if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      status = 400; code = 'BAD_REQUEST'; message = 'Malformed JSON request body.';
    } else if (err.type === 'entity.too.large') {
      status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body too large.';
    } else if (err.code === 'ENOTDIR' || err.code === 'ENAMETOOLONG') {
      status = 400; code = 'BAD_REQUEST'; message = 'Invalid path.';
    } else if (err.code === 'EEXIST') {
      status = 409; code = 'CONFLICT'; message = 'Conflict: The destination already exists.';
    } else {
      console.error(err);
    }
    res.status(status).json({ error: { message, code } });
  });

  return app;
}

module.exports = { createApp };
