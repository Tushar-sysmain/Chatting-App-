# Deployment

1. Set `NODE_ENV=production`, a long random `JWT_SECRET`, an exact `CLIENT_ORIGIN`, and a persistent `DATABASE_PATH`.
2. Run `npm ci` and `npm run db:migrate` during release setup.
3. Put the Node server behind an HTTPS reverse proxy. The session cookie is secure only in production, so HTTP is not suitable there.
4. Persist and back up the SQLite database files. Do not use ephemeral container storage.
5. Remove or replace `server/data/users.json` before production; it exists only as a one-time local demo migration source.
6. Restrict network access to the API and database volume, rotate secrets through the deployment secret manager, and monitor rate-limit and authentication failures.

The frontend must call the API with credentials enabled. Socket.IO uses the same authenticated HTTP-only cookie and must be served through the same trusted origin configuration.
