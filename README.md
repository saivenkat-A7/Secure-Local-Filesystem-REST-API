# File Manager API

A secure REST API for managing a sandboxed local directory. It supports listing, recursive search, copy, move and delete, and rigorously confines every operation to a configurable `BASE_DIRECTORY` (path-traversal and symlink-escape protection). Built with Node.js + Express, no database, packaged with Docker.

## Configuration

Environment variables (see `.env.example`):

| Variable         | Description                                                        | Default  |
|------------------|--------------------------------------------------------------------|----------|
| `API_PORT`       | Port the server listens on                                         | `8080`   |
| `BASE_DIRECTORY` | Root directory for all file operations (nothing outside is reachable) | `./data` |

## Run locally

Requires Node.js 18+ (20+ recommended).

```bash
cp .env.example .env      # optional; real environment variables take precedence
npm install
npm start                 # http://localhost:8080
npm test                  # unit + integration tests
```

Or without a `.env` file:

```bash
API_PORT=8080 BASE_DIRECTORY=./data npm start
```

## Run with Docker

```bash
docker build -t file-manager-api .
docker run -p 8080:8080 -e API_PORT=8080 -e BASE_DIRECTORY=/app/data -v $(pwd)/data:/app/data file-manager-api
```

The app is then available at `http://localhost:8080`. (`GET /health` returns `{"status":"ok"}`.)

## Conventions

* All paths are **relative to `BASE_DIRECTORY`**. Absolute paths and anything resolving outside the base (via `../`, absolute paths, or symlinks) return **403**. Paths are resolved with `path.resolve` and verified to remain inside the base; no string replacement is used.
* Errors always have the shape `{ "error": { "message": "...", "code": "..." } }`.
* Status codes: `200` success, `400` invalid input, `403` outside base directory, `404` not found, `409` destination exists, `500` unexpected error.
* Copy/move never overwrite: an existing destination yields `409` and nothing changes. Missing parent directories of the destination are created.
* Directory listings are sorted directories first, then files; each group alphabetically by name (case-insensitive, with a case-sensitive tie-break).
* Check order: path safety (403) → source existence (404) → destination conflict (409).

## Endpoints

### `GET /files` — list a directory
Query: `path` (optional, default = base root).

```bash
curl "http://localhost:8080/files?path=documents"
```
```json
[
  { "name": "images", "type": "directory", "size": 0 },
  { "name": "notes.txt", "type": "file", "size": 14 },
  { "name": "report.pdf", "type": "file", "size": 29 }
]
```
Errors: 403 outside base, 404 missing, 400 if `path` is a file.

### `GET /search` — recursive search by file name
Query: `query` (required, case-insensitive substring of the file name), `path` (optional start directory). Returns relative paths (from `BASE_DIRECTORY`) of matching files, sorted.

```bash
curl "http://localhost:8080/search?query=report"
```
```json
["archive/old_report.pdf", "documents/report.pdf"]
```
Errors: 400 missing `query`, 403, 404.

### `POST /files/copy` — copy a file or directory (recursive)
Body: `{ "from": "path/to/source.txt", "to": "path/to/destination.txt" }`

```bash
curl -X POST http://localhost:8080/files/copy -H "Content-Type: application/json" \
  -d '{"from":"readme.txt","to":"backup/readme.txt"}'
```
```json
{ "message": "Copied successfully from 'readme.txt' to 'backup/readme.txt'" }
```
Errors: 400 invalid body / copying a directory into itself, 403, 404 (`from` missing), 409 (`to` exists).

### `POST /files/move` — move/rename a file or directory
Body: `{ "from": "...", "to": "..." }`

```json
{ "message": "Moved successfully from 'a.txt' to 'b/a.txt'" }
```
Errors: same as copy.

### `DELETE /files` — delete a file or directory (recursive)
Query: `path` (required). The base directory itself cannot be deleted (400).

```bash
curl -X DELETE "http://localhost:8080/files?path=backup/readme.txt"
```
```json
{ "message": "Deleted successfully: 'backup/readme.txt'" }
```

### Error examples
```json
// 403
{ "error": { "message": "Access denied: Path is outside the allowed directory.", "code": "FORBIDDEN" } }
// 404
{ "error": { "message": "Not Found: The path 'path/to/nonexistent_file.txt' does not exist.", "code": "NOT_FOUND" } }
// 409
{ "error": { "message": "Conflict: The destination 'path/to/existing_file.txt' already exists.", "code": "CONFLICT" } }
```

## Project structure

```
src/server.js       entry point (config, listen, graceful shutdown)
src/app.js          Express routing, validation, error middleware
src/security.js     path guard (traversal + symlink protection)
src/fileService.js  async filesystem operations
src/errors.js       ApiError + error factories
src/config.js       environment configuration
test/               node:test unit + integration tests
data/               sample sandbox directory
```
