import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { GitHubInstallationVerifier } from "../auth/github.js";
import type { AuthStore, GitHubIdentity } from "../auth/store.js";
import type { GitHubOAuthClient } from "../auth/github.js";
import type { GitHubInstallationStore } from "../github/installations.js";
import type { ChatProvider } from "./provider.js";
import type { ChatStore } from "./store.js";

const messageInput = z.object({ content: z.string().trim().min(1).max(4000) }).strict();
const uuid = z.string().uuid();
const assets: Record<string, [string, string]> = {
  "/": ["index.html", "text/html"], "/app.js": ["app.js", "text/javascript"], "/style.css": ["style.css", "text/css"],
};
const SESSION_COOKIE = "tappd_session";
const OAUTH_STATE_COOKIE = "tappd_oauth_state";
const INSTALL_STATE_COOKIE = "tappd_install_state";
const OWNER_COOKIE = "tappd_owner";

export interface AuthRuntime {
  store: AuthStore;
  github: GitHubOAuthClient;
  secureCookies?: boolean;
}

export interface GitHubAppRuntime {
  slug: string;
  store: GitHubInstallationStore;
  verifier: GitHubInstallationVerifier;
}

function cookies(request: Request) {
  return Object.fromEntries((request.headers.get("cookie") || "").split(";").map(item => item.trim()).filter(Boolean).map(item => {
    const separator = item.indexOf("=");
    return separator < 0 ? [item, ""] : [item.slice(0, separator), item.slice(separator + 1)];
  }));
}

function setCookie(name: string, value: string, options: { maxAge: number; path?: string; secure?: boolean }) {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=${options.path || "/"}; Max-Age=${options.maxAge}${options.secure ? "; Secure" : ""}`;
}

function clearCookie(name: string, path = "/", secure = false) {
  return `${name}=; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=0${secure ? "; Secure" : ""}`;
}

function installationPermissionsAreSufficient(permissions: Record<string, string>) {
  const metadata = permissions.metadata;
  return (metadata === "read" || metadata === "write")
    && permissions.contents === "write"
    && permissions.pull_requests === "write";
}

export function createChatApp(
  store: ChatStore,
  provider: ChatProvider,
  demo: boolean,
  port: number,
  auth?: AuthRuntime,
  appOrigin = `http://localhost:${port}`,
  githubApp?: GitHubAppRuntime,
) {
  const busy = new Set<string>();
  const configuredOrigin = new URL(appOrigin).origin;
  const allowed = new Set([configuredOrigin]);
  const originUrl = new URL(configuredOrigin);
  if (originUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(originUrl.hostname)) {
    allowed.add(`http://localhost:${originUrl.port || port}`);
    allowed.add(`http://127.0.0.1:${originUrl.port || port}`);
  }
  const secureCookies = auth?.secureCookies ?? originUrl.protocol === "https:";
  const installationCallbackUrl = new URL("/github/setup/callback", configuredOrigin).toString();

  return async (request: Request): Promise<Response> => {
    const headers = new Headers({
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
    const redirect = (location: string, status = 302) => {
      headers.set("Location", location);
      return new Response(null, { status, headers });
    };
    const url = new URL(request.url);
    if (!allowed.has(url.origin)) return json({ error: "Invalid application origin." }, 403);
    if (request.method !== "GET" && (!allowed.has(request.headers.get("origin") || "") || !request.headers.get("content-type")?.startsWith("application/json"))) {
      return json({ error: "Send same-origin JSON requests." }, 403);
    }
    const requestCookies = cookies(request);

    const sessionUser = async (): Promise<GitHubIdentity | null> => {
      if (!auth) return null;
      const token = requestCookies[SESSION_COOKIE];
      return token ? auth.store.resolveSession(token) : null;
    };

    const ownerForChat = async () => {
      if (auth) {
        const user = await sessionUser();
        return user?.userId || null;
      }
      const cookie = requestCookies[OWNER_COOKIE];
      const ownerId = uuid.safeParse(cookie).success ? cookie! : randomUUID();
      if (ownerId !== cookie) headers.append("Set-Cookie", setCookie(OWNER_COOKIE, ownerId, { maxAge: 31536000 }));
      return ownerId;
    };

    try {
      if (request.method === "GET" && assets[url.pathname]) {
        const [file, type] = assets[url.pathname]!;
        headers.set("Content-Type", `${type}; charset=utf-8`);
        return new Response(await readFile(resolve("public", file), "utf8"), { headers });
      }

      if (request.method === "GET" && url.pathname === "/api/status") {
        return json({
          demo,
          storage: demo ? "memory" : "mongodb",
          authEnabled: Boolean(auth),
          githubAppEnabled: Boolean(auth && githubApp),
        });
      }

      if (request.method === "GET" && url.pathname === "/auth/github") {
        if (!auth) return json({ error: "GitHub sign-in is not configured." }, 503);
        const state = await auth.store.createOAuthState();
        headers.append("Set-Cookie", setCookie(OAUTH_STATE_COOKIE, state, { maxAge: 600, path: "/auth/github/callback", secure: secureCookies }));
        return redirect(auth.github.authorizationUrl(state));
      }

      if (request.method === "GET" && url.pathname === "/auth/github/callback") {
        if (!auth) return json({ error: "GitHub sign-in is not configured." }, 503);
        if (url.searchParams.get("error")) {
          headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE, "/auth/github/callback", secureCookies));
          return redirect("/?auth=denied");
        }
        const state = url.searchParams.get("state") || "";
        const code = url.searchParams.get("code") || "";
        if (!state || !code || !await auth.store.consumeOAuthState(state, requestCookies[OAUTH_STATE_COOKIE])) {
          headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE, "/auth/github/callback", secureCookies));
          return json({ error: "GitHub sign-in state is invalid or expired. Start sign-in again." }, 400);
        }
        try {
          const profile = await auth.github.exchangeCode(code);
          const identity = await auth.store.bindGitHubUser(profile);
          const session = await auth.store.createSession(identity.userId);
          headers.append("Set-Cookie", setCookie(SESSION_COOKIE, session.token, { maxAge: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)), secure: secureCookies }));
          return redirect("/");
        } catch (error) {
          console.error("[auth] GitHub callback failed", { error: error instanceof Error ? error.message : String(error) });
          headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE, "/auth/github/callback", secureCookies));
          return redirect("/?auth=failed");
        }
      }

      if (request.method === "GET" && url.pathname === "/api/me") {
        if (!auth) return json({ error: "Authentication is not configured." }, 404);
        const user = await sessionUser();
        if (!user) return json({ error: "Sign in with GitHub to continue." }, 401);
        return json({
          userId: user.userId,
          githubUserId: user.githubUserId,
          githubLogin: user.githubLogin,
          ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
        });
      }

      if (request.method === "POST" && url.pathname === "/auth/logout") {
        if (!auth) return json({ ok: true });
        const token = requestCookies[SESSION_COOKIE];
        if (token) await auth.store.deleteSession(token);
        headers.append("Set-Cookie", clearCookie(SESSION_COOKIE, "/", secureCookies));
        return json({ ok: true });
      }

      if (request.method === "GET" && url.pathname === "/github/install") {
        if (!auth || !githubApp) return json({ error: "GitHub App installation is not configured." }, 503);
        const user = await sessionUser();
        if (!user) return json({ error: "Sign in with GitHub before connecting repositories." }, 401);
        return redirect(`https://github.com/apps/${githubApp.slug}/installations/new`);
      }

      if (request.method === "GET" && url.pathname === "/github/setup") {
        if (!auth || !githubApp) return redirect("/?github=unavailable");
        const user = await sessionUser();
        if (!user) return redirect("/?github=signin");
        if (url.searchParams.get("setup_action") === "request") return redirect("/?github=requested");
        const installationId = Number(url.searchParams.get("installation_id"));
        if (!Number.isSafeInteger(installationId) || installationId <= 0) return redirect("/?github=failed");
        const state = await githubApp.store.createVerificationState(user.userId, installationId);
        headers.append("Set-Cookie", setCookie(INSTALL_STATE_COOKIE, state, {
          maxAge: 600,
          path: "/github/setup/callback",
          secure: secureCookies,
        }));
        return redirect(githubApp.verifier.installationAuthorizationUrl(state, installationCallbackUrl));
      }

      if (request.method === "GET" && url.pathname === "/github/setup/callback") {
        if (!auth || !githubApp) return redirect("/?github=unavailable");
        headers.append("Set-Cookie", clearCookie(INSTALL_STATE_COOKIE, "/github/setup/callback", secureCookies));
        if (url.searchParams.get("error")) return redirect("/?github=denied");
        const user = await sessionUser();
        if (!user) return redirect("/?github=signin");
        const state = url.searchParams.get("state") || "";
        const code = url.searchParams.get("code") || "";
        const installationId = state && code
          ? await githubApp.store.consumeVerificationState(state, requestCookies[INSTALL_STATE_COOKIE], user.userId)
          : null;
        if (!installationId) return json({ error: "GitHub installation verification state is invalid or expired." }, 400);
        try {
          const verified = await githubApp.verifier.verifyInstallationCode(code, installationCallbackUrl, installationId);
          if (verified.profile.id !== user.githubUserId) return redirect("/?github=account-mismatch");
          if (!verified.installation) return redirect("/?github=unauthorized");
          if (!installationPermissionsAreSufficient(verified.installation.permissions)) return redirect("/?github=permissions");
          await githubApp.store.linkInstallation(user.userId, verified.installation);
          return redirect("/?github=connected");
        } catch (error) {
          console.error("[github-app] installation verification failed", {
            userId: user.userId,
            installationId,
            error: error instanceof Error ? error.message : String(error),
          });
          return redirect("/?github=failed");
        }
      }

      if (request.method === "GET" && url.pathname === "/api/github/installations") {
        if (!auth || !githubApp) return json({ error: "GitHub App installation is not configured." }, 503);
        const user = await sessionUser();
        if (!user) return json({ error: "Sign in with GitHub to continue." }, 401);
        return json(await githubApp.store.listForUser(user.userId));
      }

      if (url.pathname.startsWith("/api/chats")) {
        const ownerId = await ownerForChat();
        if (!ownerId) return json({ error: "Sign in with GitHub to continue." }, 401);
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
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("[chat] reply failed", { chatId: chat.id, error: message });
          const userError = message.startsWith("OpenCode server is unreachable")
            ? message
            : "Reply failed. Check MongoDB, your OpenCode server, and model access, then try again.";
          return json({ error: userError }, 502);
        } finally { busy.delete(chat.id); }
      }

      return json({ error: "Not found." }, 404);
    } catch (error) {
      console.error("[http] request failed", { path: url.pathname, error: error instanceof Error ? error.message : String(error) });
      return json({ error: "The service is temporarily unavailable. Please try again." }, 503);
    }
  };
}
