# Tappd-In

Backend skeleton for platform users, MongoDB persistence, and future OpenCode-assisted prospect research. This initial version provides an offline CLI workflow; there is no frontend, public API, authentication, live search, or provisioned cloud database yet.

## Local setup

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
| `src/models.ts` | Validated user and research-result contracts; profile and job types |
| `src/db.ts` | MongoDB connection, typed collections, unique and queue indexes |
| `src/store.ts` | Save platform users and queue research |
| `src/research/provider.ts` | Offline provider and deliberately unimplemented OpenCode adapter |
| `src/research/prompt.ts` | Prompt template for later research integration |
| `src/research/worker.ts` | Claim one job, validate output, save draft profile, record status |
| `src/cli.ts` | Local initialization, demo, worker, and profile inspection commands |

Collections: `users`, `prospect_profiles`, `research_jobs`. Platform `userId` connects all three. Profiles have a summary, sources, and evidence-linked signals for interests, projects, professional needs, and opportunities. Research output cannot overwrite platform identity fields. Profiles remain drafts.

## Checks

```sh
npm run check
npm test
npm run build
```

Unit tests run without MongoDB. To include the database integration test, set `MONGODB_TEST_URI=mongodb://127.0.0.1:27017` in the shell before `npm test`. It creates and drops a uniquely named test database. CI runs this integration test against MongoDB 8.

## Later

See [the implementation roadmap](docs/architecture.md). `RESEARCH_PROVIDER=opencode` currently fails explicitly; no OpenCode installation, provider credentials, or paid inference is needed for this skeleton.
