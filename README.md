# Whisper Bloom

Whisper Bloom is a private one-to-one messenger with a React client and an Express/SQLite backend. SQLite is the source of truth for accounts, conversations, sessions, and messages. Logging out, losing connectivity, closing the app, or switching devices never deletes messages.

## Local setup

Node 24 or newer is recommended because the server uses Node's built-in `node:sqlite` driver.

```bash
npm install
copy .env.example .env
npm run db:migrate
npm run dev
```

Open `http://localhost:5173`. The existing demo accounts are migrated once from `server/data/users.json` (`priya` / `Game` and `amit` / `Game`). New accounts can use `POST /api/auth/register`; new passwords must be at least eight characters.

For a single-server deployment, build the client and start the API from the repository root:

```bash
npm ci
npm run build
npm start
```

The server serves the generated `dist/` client and the API from the same origin. Do not upload `node_modules`, `.env`, `dist`, or SQLite runtime files; they are excluded by `.gitignore` and are recreated or configured during deployment.

## Demo accounts

Use either account to sign in locally:

| Friend ID | Password | Name |
| --- | --- | --- |
| `priya` | `Game` | Priya |
| `amit` | `Game` | Amit |

Messages are stored in SQLite before they are broadcast. Closing or refreshing the page does not delete them; signing back in reloads the saved conversation history. The development Vite proxy forwards `/api` and Socket.IO traffic to the Express server.

## Backend guarantees

- Passwords are hashed with bcrypt and never returned.
- Authentication uses a revocable, seven-day JWT session in an HTTP-only cookie. Logout revokes the database session and does not touch messages.
- Every conversation lookup joins `conversation_participants` using the authenticated user ID. A known conversation ID is not sufficient for access.
- `POST /api/messages` takes only `receiverId` and `content`; the sender comes from the session.
- Messages are inserted before Socket.IO delivery and remain queryable while the recipient is offline.
- Message history is paginated with `limit` and `before`.
- Deletion is soft deletion for everyone and is permitted only to the original sender. Deleted rows remain in SQLite with `deleted_at`.
- Auth and message endpoints are rate limited, request bodies are validated with Zod, SQL is parameterized, CORS is explicit, and Helmet security headers are enabled.

## API

All protected routes use the HTTP-only `whisper_session` cookie. A bearer token is also accepted for non-browser clients.

### Authentication

`POST /api/auth/register`

```json
{ "userId": "1001", "password": "a-long-password", "name": "Ava", "color": "#ff7aa2" }
```

`POST /api/auth/login`

```json
{ "userId": "1001", "password": "a-long-password" }
```

`POST /api/auth/logout` revokes only the current session.

### Conversations and messages

`POST /api/conversations` creates or returns the unique conversation for the authenticated user and the requested user:

```json
{ "userId": "2002" }
```

`GET /api/conversations` returns only conversations containing the authenticated user.

`GET /api/conversations/:conversationId/messages?limit=50&before=<messageId>` returns non-deleted messages only. Use the oldest returned `messageId` as `before` for the next page.

`POST /api/messages`:

```json
{ "receiverId": "2002", "content": "Hello!" }
```

The response includes `messageId`, `conversationId`, `senderId`, `receiverId`, `messageContent`, `createdAt`, `updatedAt`, and `deletedAt`.

`DELETE /api/messages/:messageId` soft-deletes a message for everyone when called by its sender.

`GET /api/users/:userId` returns the public profile of an existing user and never exposes password data.

## Production

Set a high-entropy `JWT_SECRET`, use a persistent volume for `DATABASE_PATH`, serve the API behind HTTPS, set `NODE_ENV=production`, and set `CLIENT_ORIGIN` to the exact frontend origin. Do not ship `server/data/users.json` with real passwords; use registration or a one-time migration process. Run backups for the SQLite database and protect them as production secrets.
