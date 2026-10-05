# Backend

The server uses Node's built-in `node:sqlite` driver and creates `server/data/chat.sqlite` on first start. `db.js` owns the schema and indexes for `users`, `sessions`, `conversations`, `conversation_participants`, and `messages`.

Run `npm run db:migrate` to initialize the schema without starting HTTP. Run `npm start` for the API and Socket.IO server. Configuration is documented in the root `.env.example` and `README.md`.

The Socket.IO connection is authenticated from the same HTTP-only session cookie as REST. It is an optional delivery channel only: messages are inserted into SQLite before the `new-message` event is emitted.
