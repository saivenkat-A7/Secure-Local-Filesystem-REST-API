'use strict';

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const badRequest = (message) => new ApiError(400, 'BAD_REQUEST', message);
const forbidden = () =>
  new ApiError(403, 'FORBIDDEN', 'Access denied: Path is outside the allowed directory.');
const notFound = (p) =>
  new ApiError(404, 'NOT_FOUND', `Not Found: The path '${p}' does not exist.`);
const conflict = (p) =>
  new ApiError(409, 'CONFLICT', `Conflict: The destination '${p}' already exists.`);

module.exports = { ApiError, badRequest, forbidden, notFound, conflict };
