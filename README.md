# Tappd-In

A simple browser chatbot backed by OpenCode, with conversation history in MongoDB. The prospect-research skeleton remains available separately. GitHub sign-in, verified GitHub App installation linking, per-user repository synchronization, and opt-in agent branch execution are available when configured; pull-request automation, public hosting, and live prospect search are still being built.

## Try the chat immediately

Requires Node.js 22+. No database or model credentials needed for this UI demo:

```powershell
npm ci
npm run chat:demo
```

Open **http://localhost:3000**. Demo replies are clearly labeled and are not AI-generated. History lasts only until the demo server stops.

## Run the OpenCode chatbot

Requires access to MongoDB through `MONGODB_URI`, and OpenCode installed with a working provider login. Docker is optional and only provides a convenient local MongoDB.

In the Tappd-In folder, run once:

```powershell
npm ci
# Create the file only if you do not already have one:
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Set your MongoDB connection string in `.env`:

```dotenv
MONGODB_URI=mongodb+srv://username:password@cluster.example.mongodb.net
MONGODB_DB=tappd_in
```

Both `mongodb://` and `mongodb+srv://` connection strings are supported. Do not commit `.env`, since it may contain database credentials. For an optional local MongoDB, run `docker compose up -d --wait`.

Tappd-In defaults to `opencode/big-pickle` when `OPENCODE_MODEL` is blank or unset. OpenCode currently offers Big Pickle at no token charge for a limited time, so free availability is not guaranteed permanently. To override it, set `OPENCODE_MODEL=provider/model` and run `opencode models` to see available IDs. Provider-backed overrides must already be authenticated in OpenCode (use `opencode auth login` if needed).

Start the OpenCode-backed chat with one command:

```bash
npm run chat:start
```

If OpenCode is not installed, `chat:start` installs it automatically using the official OpenCode installer. You can also install it explicitly with:

```bash
npm run opencode:install
```

The installer requires `curl` and does not use `sudo` or modify project dependencies.

Open **http://localhost:3000**. Send a message, create another conversation, and reload to resume saved history. The app creates the chat indexes automatically. Stop the app with Ctrl+C. If you used the optional Docker database, stop it with `docker compose stop`.

`chat:start` starts OpenCode with web search enabled, waits for it to become healthy, then starts Tappd-In. If OpenCode is already running on port 4096, it reuses that process. Press Ctrl+C to stop Tappd-In and any OpenCode process started by the script.

The chat agent can use OpenCode's `websearch` and `webfetch` tools for web research. It cannot read or modify local files, run shell commands, or write files. If you enabled OpenCode server authentication, put matching `OPENCODE_SERVER_PASSWORD` and `OPENCODE_SERVER_USERNAME` values in `.env`. Keys and credentials stay server-side. Each MongoDB chat stores its OpenCode session ID and reuses that session for subsequent replies. No profile creation runs from chat.

By default, with GitHub credentials unset, the UI keeps the existing localhost-only anonymous browser cookie so local development continues to work. When `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` are configured, chat endpoints require GitHub sign-in and conversations are owned by the application `userId` associated with GitHub's stable numeric user ID. Sessions are stored server-side; the browser receives only an opaque HTTP-only cookie. Set `APP_ORIGIN` to the exact application origin and register `${APP_ORIGIN}/auth/github/callback` as the GitHub OAuth callback URL. Chats are capped at 50 turns, with 4,000 characters per user message.

### Optional GitHub sign-in

To enable account authentication, set `APP_ORIGIN`, `GITHUB_APP_CLIENT_ID`, and `GITHUB_APP_CLIENT_SECRET` in `.env`. The callback URL registered with GitHub must be `${APP_ORIGIN}/auth/github/callback` (for local development: `http://localhost:3000/auth/github/callback`).

On sign-in, Tappd-In exchanges the OAuth code server-side, loads the GitHub `/user` identity, and discards the GitHub access token. MongoDB stores the stable numeric GitHub user ID, the application-owned `userId`, hashed session tokens, and short-lived one-time OAuth state. Leaving the GitHub credentials blank preserves local anonymous mode for development.

### Optional GitHub App repository connection

After GitHub sign-in is configured, set `GITHUB_APP_SLUG` to enable **Connect GitHub repos**. Configure the GitHub App itself with:

- **Setup URL:** `${APP_ORIGIN}/github/setup`
- **Callback URLs:** `${APP_ORIGIN}/auth/github/callback` and `${APP_ORIGIN}/github/setup/callback`
- **Request user authorization (OAuth) during installation:** off, because Tappd-In uses the setup URL for post-install verification
- **Repository permissions:** Metadata read, Contents read/write, Pull requests read/write
- **Repository access:** users may select all repositories or only chosen repositories in GitHub's installation UI

When GitHub returns an `installation_id` to the setup URL, Tappd-In does not trust that parameter by itself. It creates a one-time state record tied to the signed-in Tappd-In user, performs a short GitHub user-authorization round trip, and accepts the installation only if GitHub's `/user/installations` response for that user contains the same installation. The temporary user access token is discarded after verification. This supports both personal-account and organization installations.

Verified installation links are stored in `github_installations`. Add `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` to enable repository synchronization. Tappd-In signs a short-lived GitHub App JWT, mints an installation access token in memory, lists the repositories currently granted to that installation, and discards the token after the request. GitHub installation tokens expire after one hour.

Connected repositories are stored in `connected_repositories` using GitHub's stable numeric repository ID, installation ID, full name, default branch, visibility/archive state, and an explicit `agentEnabled` flag. A repository removed from the GitHub App selection is marked disconnected on the next sync and its agent access is forcibly disabled. Archived repositories cannot be enabled. The server-side `authorizeAgentRepository(userId, repositoryId)` guard only returns repositories that belong to the authenticated user, remain connected, are not archived, and have agent access enabled.

The Repositories workspace lets a signed-in user sync from GitHub and enable or disable agent access per repository. The server can now mint job-bound repository-scoped credentials internally, but actual cloning, code modification, branch pushes, and pull requests remain disabled until the agent-execution issues.

### Agent GitHub credential broker

When `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are configured, the backend also creates an internal credential broker for agent jobs. There is intentionally no browser/API route that returns GitHub credentials.

Before minting a credential, the broker checks both an active `agent_jobs` record matching `userId + jobId + repositoryId` and the repository's current server-side authorization state. The repository must still be connected, not archived, and explicitly agent-enabled. That check runs even when a token is already cached in memory, so a completed/cancelled job or webhook revocation prevents cached-token reuse.

GitHub installation credentials are minted for exactly one `repository_id` with only `contents: write` and `pull_requests: write`. GitHub installation tokens expire after one hour; Tappd-In keeps them only in process memory and refreshes when fewer than five minutes remain. No installation token, user PAT, or GitHub App private key is written to MongoDB or returned to the browser.

The current `agent_jobs` record is deliberately minimal: job ID, user ID, repository ID, status, and timestamps. The isolated execution issue extends that same collection with base SHA, branch, workspace, test, and execution metadata.

### Agent repository execution

Repository execution is deliberately opt-in. Set `TAPPD_AGENT_EXECUTION_ENABLED=1` only on a worker/server where repository code is allowed to run. `TAPPD_AGENT_WORKSPACE_ROOT` can override the default OS-temp workspace root.

Creating `POST /api/agent-jobs` with an authorized `repositoryId` and instruction records the repository full name, default branch, the default branch's current Git SHA, and a generated `tappd-in/<job-id>` branch before execution starts. `GET /api/agent-jobs/<job-id>` returns only jobs owned by the signed-in user.

The execution path is:

```text
authorize repository
  -> record default branch + base SHA
  -> create ephemeral per-job workspace
  -> clone with job-bound repo credential
  -> checkout recorded base SHA
  -> create tappd-in/<job-id>
  -> OpenCode edits inside that workspace
  -> verify branch + origin were not changed
  -> run detected npm check/test/build scripts
  -> commit as Tappd-In Agent
  -> push HEAD only to refs/heads/tappd-in/<job-id>
  -> invalidate credential cache
  -> delete workspace
```

GitHub tokens are injected only into the clone/push child-process environment and never appear in git command arguments, job records, or browser responses. The default branch is never a push target and the executor never uses force-push.

OpenCode receives the job directory as its active directory, file read/edit/search tools, and only a narrow read-only Git shell allowlist (`git status`, `git diff`, `git log`, `git grep`). It is denied external-directory access and cannot run commit/push commands. OpenCode's shell is not an OS sandbox, so arbitrary shell access is intentionally not enabled. Repository checks are fixed Tappd-In subprocesses with a scrubbed environment; they still execute repository-owned npm scripts on the host, which is why execution requires the explicit opt-in flag.

Failed jobs persist only status, check pass/fail metadata, timestamps, and a small sanitized failure code. Workspaces and in-memory credentials are cleaned in a `finally` path.

### GitHub webhook reconciliation

Set `GITHUB_APP_WEBHOOK_SECRET` and configure the GitHub App webhook URL as `${APP_ORIGIN}/webhooks/github` using `application/json`. The endpoint validates the raw request body against GitHub's `X-Hub-Signature-256` HMAC before parsing or changing access state.

Tappd-In handles the GitHub App `installation` lifecycle events needed for created/deleted/suspend/unsuspend state plus `installation_repositories` added/removed events. Removing a repository, suspending an installation, or deleting an installation immediately disconnects affected repository records and forces agent access off. Unsuspension reconciles the current repository list when App credentials are available, but does not silently restore agent access.

Webhook deliveries use `X-GitHub-Delivery` as an idempotency key. Minimal delivery records are retained for seven days; successfully processed redeliveries are acknowledged without applying the event twice, while failed processing releases the claim so a later redelivery can retry.

If a webhook is missed, the existing **Sync from GitHub** action (or `POST /api/github/repositories/sync`) is the manual reconciliation path. It re-queries every active installation and revokes any stale repository access it finds.

### Troubleshooting

- **Startup failed:** check that `MONGODB_URI` is present and reachable, then check whether port 3000 is free. Use `npm run chat:demo` to isolate UI setup without MongoDB.
- **Reply failed:** run `npm run chat:start`; it starts OpenCode with web search enabled and reports if the service is unavailable. If Big Pickle's free allowance is temporarily unavailable or exhausted, retry later or set `OPENCODE_MODEL` to another model you can access. Your unsent text stays in the composer for retry.
- **Port conflict:** change `PORT` in `.env`. If changing the OpenCode port, change `OPENCODE_URL` too.
- **Demo shown unexpectedly:** stop `chat:demo` and use `npm run chat:opencode` for actual model replies.

## Research skeleton

Requires Node.js 22+ and access to MongoDB. Docker Compose is optional for local development.

```sh
npm ci
cp .env.example .env
# PowerShell: Copy-Item .env.example .env
npm run db:init
npm run demo
npm run worker:once
npm run profiles
```

The demo inserts a fictional platform user and queues one research job. The worker copies supplied interests into a source-linked draft profile. It does not search the web or call a model. Run the worker before re-running the demo: only one queued/running job per user is allowed.

Set `MONGODB_URI` and `MONGODB_DB` in `.env` before running the commands. Docker Compose can be used for a local database but is not required. The Compose database has no authentication and binds only to localhost for local development; configure credentials and access controls for hosted environments. Keep `.env` out of git.

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
