import { z } from "zod";
import type { GitHubProfile } from "./store.js";

const tokenResponse = z.object({ access_token: z.string().min(1) });
const githubUser = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
});

export interface GitHubOAuthClient {
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<GitHubProfile>;
}

export class GitHubOAuth implements GitHubOAuthClient {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private callbackUrl: string,
    private request: typeof fetch = fetch,
  ) {}

  authorizationUrl(state: string) {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", this.callbackUrl);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(code: string) {
    const tokenResult = await this.request("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.callbackUrl,
      }),
    });
    if (!tokenResult.ok) throw new Error("GitHub token exchange failed");
    const token = tokenResponse.safeParse(await tokenResult.json());
    if (!token.success) throw new Error("GitHub did not return an access token");

    const userResult = await this.request("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token.data.access_token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!userResult.ok) throw new Error("GitHub identity lookup failed");
    const user = githubUser.parse(await userResult.json());
    return { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatar_url };
  }
}

export function githubOAuthFromEnv(appOrigin: string, env: NodeJS.ProcessEnv = process.env) {
  const clientId = env.GITHUB_APP_CLIENT_ID || env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET || env.GITHUB_CLIENT_SECRET;
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) throw new Error("Set both GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET");
  return new GitHubOAuth(clientId, clientSecret, new URL("/auth/github/callback", appOrigin).toString());
}
