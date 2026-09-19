# Tappd-In

A simple local browser chatbot backed by OpenCode, with conversation history in MongoDB. The prospect-research skeleton remains available separately. This version is for one local developer; platform sign-in, public hosting, and live prospect search are not implemented.

## Try the chat immediately

Requires Node.js 22+. No database or model credentials needed for this UI demo:

```powershell
npm ci
npm run chat:demo
```

Open **http://localhost:3000**. Demo replies are clearly labeled and are not AI-generated. History lasts only until the demo server stops.

## Run the real chatbot

Requires MongoDB 8 (Docker Desktop is an option on Windows), and OpenCode installed with a working provider login.

In the Tappd-In folder, run once:

```powershell
npm ci
# Create the file only if you do not already have one:
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d --wait
```

If using an existing MongoDB instance, set `MONGODB_URI` in `.env` and skip Docker. Set `OPENCODE_MODEL=provider/model` if you want a specific model; otherwise the OpenCode default is used. Run `opencode models` to see available IDs. The provider must already be authenticated in OpenCode (use `opencode auth login` if needed).

Start OpenCode in a separate terminal and leave it running:

```powershell
opencode serve --hostname 127.0.0.1 --port 4096
```

Then, from the Tappd-In folder in another terminal:

```powershell
npm start
```

Open **http://localhost:3000**. Send a message, create another conversation, and reload to resume saved history. `npm start` creates the chat indexes automatically. Stop the app with Ctrl+C. Stop the local database with `docker compose stop` when finished; its named volume retains history.

If you enabled OpenCode server authentication, put matching `OPENCODE_SERVER_PASSWORD` and `OPENCODE_SERVER_USERNAME` values in `.env`. Keys and credentials stay server-side. The chat uses a temporary OpenCode session for each reply, with tool permissions denied, and supplies the MongoDB transcript as context. No research or profile creation runs from chat.

The UI identifies the browser through an HTTP-only cookie; it is not platform authentication. Clearing the cookie loses access to that browser's old conversations. Use one app process, keep the app on localhost, and add real account authorization before exposing it publicly. Chats are capped at 50 turns, with 4,000 characters per user message.

### Troubleshooting

- **Startup failed:** check `.env`, MongoDB connectivity, and whether port 3000 is free. Use `npm run chat:demo` to isolate UI setup.
- **Reply failed:** make sure `opencode serve` is running, its credentials match, and the selected model works in OpenCode. Your unsent text stays in the composer for retry.
- **Port conflict:** change `PORT` in `.env`. If changing the OpenCode port, change `OPENCODE_URL` too.
- **Demo shown unexpectedly:** stop `chat:demo` and use `npm start` for actual model replies.

## Research skeleton

Requires Node.js 22+ and Docker Compose (or an existing MongoDB 8 instance).

```sh
npm ci
cp .env.example .env
# PowerShell: Copy-Item .env.example .env
docker compose up -d --wait
npm run db:init
npm run demo
npm run worker:once
npm run profiles
```

The demo inserts a fictional platform user and queues one research job. The worker copies supplied interests into a source-linked draft profile. It does not search the web or call a model. Run the worker before re-running the demo: only one queued/running job per user is allowed.

For an existing MongoDB instance, set `MONGODB_URI` and `MONGODB_DB` in `.env` and skip Docker. The Compose database has no authentication and binds only to localhost for local development; configure credentials and access controls for hosted environments. Keep `.env` out of git.

## Structure

| Path | Purpose |
| --- | --- |
| `src/server.ts`, `src/chat/`, `public/` | Browser chat, OpenCode adapter, and conversation storage |
| `src/models.ts` | Validated user and research-result contracts; profile and job types |
| `src/db.ts` | MongoDB connection, typed collections, unique and queue indexes |
| `src/store.ts` | Save platform users and queue research |
| `src/research/provider.ts` | Offline provider and deliberately unimplemented OpenCode adapter |
| `src/research/prompt.ts` | Prompt template for later research integration |
| `src/research/worker.ts` | Claim one job, validate output, save draft profile, record status |
| `src/cli.ts` | Local initialization, demo, worker, and profile inspection commands |

Research collections: `users`, `prospect_profiles`, `research_jobs`. Chat uses `chat_conversations`. Platform `userId` connects all three. Profiles have a summary, sources, and evidence-linked signals for interests, projects, professional needs, and opportunities. Research output cannot overwrite platform identity fields. Profiles remain drafts.

## Checks

```sh
npm run check
npm test
npm run build
```

Unit tests run without MongoDB. To include the database integration test, set `MONGODB_TEST_URI=mongodb://127.0.0.1:27017` in the shell before `npm test`. It creates and drops a uniquely named test database. CI runs this integration test against MongoDB 8.

## Later

See [the implementation roadmap](docs/architecture.md). `RESEARCH_PROVIDER=opencode` for the **research worker** still fails explicitly; no OpenCode installation, provider credentials, or paid inference is needed for this skeleton.
