import { request, FullConfig } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { ADMIN, BASE_URL, USER1, USER2 } from "./helpers/env";
import { DEVICE_IDS, loginMobile, Session } from "./helpers/auth";

export const STATE_FILE = path.join(__dirname, ".auth", "state.json");

export interface E2EState {
  serverUp: boolean;
  serverReason?: string;
  healthPath?: string;
  sessions: Record<string, Session | undefined>;
  reasons: Record<string, string | undefined>;
}

/**
 * Sonde le serveur puis effectue UN login par compte configuré (budget de
 * rate limit mobile très bas : 3-5/h/IP en prod). Ne lève jamais d'erreur :
 * toute impossibilité est consignée et les tests concernés sont skip.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const state: E2EState = { serverUp: false, sessions: {}, reasons: {} };
  const ctx = await request.newContext({ baseURL: BASE_URL });
  try {
    for (const p of ["/api/health", "/health"]) {
      try {
        const r = await ctx.get(p, { timeout: 5000 });
        if (r.ok()) {
          state.serverUp = true;
          state.healthPath = p;
          break;
        }
      } catch (e) {
        state.serverReason = `serveur injoignable sur ${BASE_URL} (${(e as Error).message.split("\n")[0]})`;
      }
    }
    if (!state.serverUp && !state.serverReason) {
      state.serverReason = `${BASE_URL}/api/health et /health ne répondent pas 2xx`;
    }

    if (state.serverUp) {
      const accounts = [
        ["user1", USER1, DEVICE_IDS.user1, "E2E_TEST_EMAIL/E2E_TEST_PASSWORD"],
        ["user2", USER2, DEVICE_IDS.user2, "E2E_TEST_EMAIL_2/E2E_TEST_PASSWORD_2"],
        ["admin", ADMIN, DEVICE_IDS.admin, "E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD"],
      ] as const;
      for (const [label, creds, device, vars] of accounts) {
        if (!creds) {
          state.reasons[label] = `${label}: variables ${vars} non définies`;
          continue;
        }
        try {
          const r = await loginMobile(ctx, label, device, creds);
          if ("session" in r) state.sessions[label] = r.session;
          else state.reasons[label] = r.reason;
        } catch (e) {
          state.reasons[label] = `${label}: erreur de login (${(e as Error).message})`;
        }
      }
    }
  } finally {
    await ctx.dispose();
  }
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });
}
