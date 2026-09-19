# Research foundation

## Browser chat

`npm start` serves a localhost UI and JSON endpoints for listing, creating, reading, and sending messages to conversations. MongoDB stores each browser-owned conversation in `chat_conversations`; optimistic version checks prevent overwriting another request. Messages are saved as a user/assistant pair only after a successful reply. On a failed reply, the browser keeps the unsent text for retry. A process crash after model completion but before database persistence can require repeating the generation.

The OpenCode chat adapter uses the installed SDK v2 client, creates a tool-denied session per turn, supplies the existing transcript, and requests session deletion afterward. Deletion is best effort; interrupted cleanup can leave a temporary session on the local OpenCode server. Inference has a 90-second timeout. The SDK transport is tested with a fake server response; local real-model verification requires a working OpenCode server and provider credentials.

`npm run chat:demo` explicitly uses canned responses and process memory. It never silently substitutes for a failing live provider. Browser cookies separate local histories, but do not constitute a platform identity or production login.

## Research skeleton behavior

A platform user is saved with an application-owned `userId`, display name, headline, optional company, stated interests, and public profile links. `enqueueResearch` creates a durable job. The worker atomically claims the oldest queued job and hands the user to a provider. Validated output becomes a draft prospect profile; completion or a sanitized failure code is stored on the job.

The stub returns supplied interests only. The OpenCode class is an integration seam, not a working search implementation. The prompt is prepared for that future adapter, but is not executed by the offline provider.

## Next implementation steps

1. Define what makes someone a prospect and which projects, interests, or professional needs matter. Add matching criteria separately from factual profile evidence.
2. Connect platform authentication. Derive `userId` from the authenticated account and add workspace ownership/authorization before exposing any HTTP endpoints.
3. Choose approved search sources and implement identity matching, source timestamps, refresh rules, profile review, and deletion. Public profile links are stored but never fetched by this skeleton.
4. Implement the OpenCode adapter using a pinned [OpenCode SDK](https://opencode.ai/docs/sdk/) version, scoped sessions, structured output, and timeouts. Add approved search tools; keep write/shell tools disabled for research. Validate every response against `researchResult` before persistence. Treat scraped text as data, and preserve uncertainty instead of guessing identities or sensitive attributes.
5. Add worker leases, crash recovery, bounded retries, and reconciliation. Currently a process crash can leave a job `running`; after confirming the worker stopped, manually mark it failed before requeuing. Profile persistence and job completion are separate writes; recovery must reconcile them by `jobId`. Historical profile versions are not retained yet.
6. Add a hosted MongoDB deployment, secret management, monitoring, and a continuously supervised worker. MongoDB driver reference: [MongoClient setup](https://www.mongodb.com/docs/drivers/node/current/connect/mongoclient/).

No scheduled research, external discovery, outreach, prospect scoring, or production deployment is enabled in this scaffold.
