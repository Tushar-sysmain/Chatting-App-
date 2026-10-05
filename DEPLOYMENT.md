# Deployment

## Architecture

Whisper Bloom is a full-stack application:
- **Frontend**: React + Vite SPA (served statically)
- **Backend**: Express + Socket.IO + SQLite (requires a persistent Node.js server)

Vercel serves only the static frontend. The backend must be deployed to a separate host that supports long-running processes, WebSockets, and persistent storage.

## Root Cause of 404 on "Open the room"

When deployed to Vercel without a backend:
1. Vercel serves the static React app from `dist/`
2. The "Open the room" button calls `POST /api/auth/login`
3. Vercel has no Express server running, so `/api/*` returns 404
4. Socket.IO connections also fail because no WebSocket server is listening

## Frontend Deployment (Vercel)

1. Connect your repository to Vercel
2. Set the following environment variable in Vercel (Project Settings → Environment Variables):
   ```
   VITE_SERVER_URL=https://your-backend-domain.com
   ```
   Use your backend's HTTPS origin without a trailing slash.

3. Vercel automatically detects Vite and runs `npm run build`, then serves `dist/`.

4. The `vercel.json` in this repo ensures SPA fallback so that all frontend routes load `index.html`.

## Backend Deployment

Deploy the Node server to a host like Render, Railway, Fly.io, or any VPS.

### Required backend environment variables:
```
NODE_ENV=production
PORT=10000                    # Use the port provided by your host
CLIENT_ORIGIN=https://your-app.vercel.app
JWT_SECRET=<long-random-secret-32+chars>
DATABASE_PATH=/app/server/data/chat.sqlite   # Persistent path on your host
COOKIE_SAME_SITE=none         # Required if backend and frontend are on different origins
```

### Start command:
```
npm start
```

### Build/setup command (if your host supports it):
```
npm ci && npm run db:migrate
```

## Cross-Origin Cookie Notes

- If the backend is on a **different origin** (e.g., `api.example.com` vs `chat.vercel.app`):
  - Set `COOKIE_SAME_SITE=none` on the backend
  - Ensure both origins use HTTPS
  - Browser third-party cookie restrictions may still block sessions in some browsers

- If using **subdomains of the same parent domain** (e.g., `chat.example.com` and `api.example.com`):
  - These are still cross-site for cookie purposes
  - `SameSite=None; Secure` is required

- If the backend is on the **exact same origin** (single-server deployment):
  - `SameSite=Lax` (default) works fine

## Alternative: Single-Server Deployment

If you want to avoid cross-origin issues entirely, deploy the entire app (frontend + backend) to a Node host like:
- DigitalOcean App Platform
- AWS Elastic Beanstalk
- A VPS with Nginx/PM2

In this setup:
1. Run `npm ci && npm run build && npm run db:migrate`
2. Start with `npm start`
3. The Express server serves both `dist/` and the API from one origin
4. `VITE_SERVER_URL` can remain unset
5. Set `CLIENT_ORIGIN` to your production HTTPS origin

## Database Persistence

- **Do not** use ephemeral container storage for SQLite
- Use a persistent volume or managed database
- For production, consider migrating SQLite to a managed Postgres/MySQL instance
- Remove `server/data/users.json` after the first migration; it is a one-time demo migration source
