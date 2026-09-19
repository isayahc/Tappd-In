import { createServer } from "node:http";
import { connectDatabase } from "./db.js";
import { createChatApp } from "./chat/app.js";
import { DemoChatProvider, OpenCodeChatProvider } from "./chat/provider.js";
import { MemoryChatStore, MongoChatStore, type Conversation } from "./chat/store.js";

async function main() {
  const demo = process.argv.includes("--demo");
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535");
  const provider = demo ? new DemoChatProvider() : new OpenCodeChatProvider();
  const db = demo ? undefined : await connectDatabase();
  const store = db ? new MongoChatStore(db.database.collection<Conversation>("chat_conversations")) : new MemoryChatStore();
  if (store instanceof MongoChatStore) await store.init();
  const app = createChatApp(store, provider, demo, port);
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 20000) { res.writeHead(413).end("Request too large"); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const response = await app(new Request(`http://${req.headers.host || "invalid"}${req.url}`, {
        method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500).end("Request failed"); }
  });
  server.requestTimeout = 120000;
  server.listen(port, "127.0.0.1", () => console.log(`Tappd-In: http://localhost:${port}${demo ? " (demo: no AI, temporary history)" : " (OpenCode + MongoDB)"}`));
  server.on("error", async () => { console.error("Cannot start server. Check that PORT is available."); await db?.client.close(); process.exitCode = 1; });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
    server.close(() => { void db?.client.close(); });
  });
}
main().catch(() => {
  console.error("Startup failed. Check MONGODB_URI, MongoDB connectivity, and .env. Docker is optional; to try the UI without services use: npm run chat:demo");
  process.exitCode = 1;
});
