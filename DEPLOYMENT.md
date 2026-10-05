# Deployment

## Vercel frontend with a separate backend

Vercel serves the Vite frontend, but this application also requires its Express API, SQLite storage, and a persistent Socket.IO server. A static Vercel deployment does not start `server/index.js`, so requests to `/api` and `/socket.io` on the Vercel domain return 404.

Deploy the Node server on a host that supports long-running processes, WebSockets, and persistent storage. Configure the Vercel project with this build-time environment variable:

```text
VITE_SERVER_URL=https://api.example.com
```

Use the backend's HTTPS origin, without a trailing slash. Configure the backend with `NODE_ENV=production`, a long random `JWT_SECRET`, `CLIENT_ORIGIN=https://chat.example.com`, and a persistent `DATABASE_PATH`. Run `npm ci`, `npm run build`, and `npm run db:migrate` as part of backend setup; start it with `npm start`.

For reliable cookie authentication, use a custom frontend and backend domain under the same site (for example, `chat.example.com` and `api.example.com`). The default production cookie policy is `SameSite=Strict`. If the domains are genuinely cross-site, set `COOKIE_SAME_SITE=none` on the backend; this requires HTTPS, and browser third-party-cookie restrictions may still block sessions.

## Single-server deployment

Alternatively, deploy the whole project to a Node host that supports WebSockets and persistent storage. Run `npm ci`, `npm run build`, and `npm run db:migrate`, then start with `npm start`. The Express server serves both `dist/` and the API from one origin, so `VITE_SERVER_URL` can remain unset. Set `CLIENT_ORIGIN` to that exact HTTPS origin.

Persist and back up the SQLite database; do not use ephemeral container storage. Remove or replace `server/data/users.json` before production because it is only a one-time local demo migration source. Restrict network access to the API and database volume, rotate secrets through the deployment secret manager, and monitor rate-limit and authentication failures.
