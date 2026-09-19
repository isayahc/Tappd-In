import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { ChatProvider } from "./provider.js";
import type { ChatStore } from "./store.js";

const messageInput = z.object({ content: z.string().trim().min(1).max(4000) }).strict();
const uuid = z.string().uuid();
const assets: Record<string, [string, string]> = {
  "/": ["index.html", "text/html"], "/app.js": ["app.js", "text/javascript"], "/style.css": ["style.css", "text/css"],
};
export function createChatApp(store: ChatStore, provider: ChatProvider, demo: boolean, port: number) {
  const busy = new Set<string>();
  return async (request: Request): Promise<Response> => {
    const headers = new Headers({
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
    const url = new URL(request.url);
    const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
    // This release is localhost-only, with host validation against DNS rebinding.
    if (!allowed.has(url.origin)) return json({ error: "Local access only." }, 403);
    if (request.method !== "GET" && (!allowed.has(request.headers.get("origin") || "") || !request.headers.get("content-type")?.startsWith("application/json"))) {
      return json({ error: "Send same-origin JSON requests." }, 403);
    }
    const cookie = request.headers.get("cookie")?.split(";").map(item => item.trim()).find(item => item.startsWith("tappd_owner="))?.slice(12);
    const ownerId = uuid.safeParse(cookie).success ? cookie! : randomUUID();
    if (ownerId !== cookie) headers.append("Set-Cookie", `tappd_owner=${ownerId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
    try {
      if (request.method === "GET" && assets[url.pathname]) {
        const [file, type] = assets[url.pathname]!;
        headers.set("Content-Type", `${type}; charset=utf-8`);
        return new Response(await readFile(resolve("public", file), "utf8"), { headers });
      }
      if (request.method === "GET" && url.pathname === "/api/status") return json({ demo, storage: demo ? "memory" : "mongodb" });
      if (url.pathname === "/api/chats") {
        if (request.method === "GET") return json(await store.list(ownerId));
        if (request.method === "POST") return json(await store.create(ownerId), 201);
      }
      const match = /^\/api\/chats\/([^/]+)(\/messages)?$/.exec(url.pathname);
      if (!match || !uuid.safeParse(match[1]).success) return json({ error: "Not found." }, 404);
      const chat = await store.get(ownerId, match[1]!);
      if (!chat) return json({ error: "Conversation not found." }, 404);
      if (request.method === "GET" && !match[2]) return json(chat);
      if (request.method !== "POST" || !match[2]) return json({ error: "Not found." }, 404);
      if (chat.messages.length >= 100) return json({ error: "Start a new chat to continue (50 turns per chat)." }, 400);
      let input;
      try { input = messageInput.parse(await request.json()); } catch { return json({ error: "Enter a message of 1–4,000 characters." }, 400); }
      if (busy.has(chat.id)) return json({ error: "A reply is already in progress." }, 409);
      busy.add(chat.id);
      try {
        const user = { role: "user" as const, content: input.content };
        const reply = await provider.reply([...chat.messages, user], chat.opencodeSessionId, chat.opencodeSessionVersion);
        const assistant = { role: "assistant" as const, content: reply.content };
        if (!await store.append(chat, [user, assistant], reply.opencodeSessionId, reply.opencodeSessionVersion)) return json({ error: "Chat changed in another tab. Reload before sending again." }, 409);
        return json(await store.get(ownerId, chat.id));
      } catch {
        return json({ error: "Reply failed. Check MongoDB, your OpenCode server, and model access, then try again." }, 502);
      } finally { busy.delete(chat.id); }
    } catch {
      return json({ error: "Storage is unavailable. Check MongoDB and try again." }, 503);
    }
  };
}
