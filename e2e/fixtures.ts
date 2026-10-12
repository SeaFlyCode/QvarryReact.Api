import { test as base, expect } from "@playwright/test";
import * as fs from "fs";
import { STATE_FILE, E2EState } from "./global-setup";
import { DEVICE_IDS, mobileHeaders, Session } from "./helpers/auth";

export { expect };

function loadState(): E2EState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { serverUp: false, serverReason: "état global-setup absent", sessions: {}, reasons: {} };
  }
}

/** Client authentifié (Bearer + en-têtes mobiles). */
export interface Client {
  session: Session;
  headers: Record<string, string>;
}

type Fixtures = {
  /** Skip le test si le serveur ne répond pas. */
  server: E2EState;
  user: Client;
  user2: Client;
  admin: Client;
  /** En-têtes mobiles sans token. */
  anonHeaders: Record<string, string>;
};

function clientFor(label: "user1" | "user2" | "admin", state: E2EState): Client | null {
  const s = state.sessions[label];
  if (!s) return null;
  return { session: s, headers: mobileHeaders(s.deviceId, s.accessToken) };
}

export const test = base.extend<Fixtures>({
  server: async ({}, use, testInfo) => {
    const state = loadState();
    testInfo.skip(!state.serverUp, `E2E ignoré : ${state.serverReason ?? "serveur indisponible"}`);
    await use(state);
  },
  user: async ({ server }, use, testInfo) => {
    const c = clientFor("user1", server);
    testInfo.skip(!c, `E2E ignoré : ${server.reasons.user1 ?? "compte user1 indisponible"}`);
    await use(c as Client);
  },
  user2: async ({ server }, use, testInfo) => {
    const c = clientFor("user2", server);
    testInfo.skip(!c, `E2E ignoré : ${server.reasons.user2 ?? "compte user2 indisponible"}`);
    await use(c as Client);
  },
  admin: async ({ server }, use, testInfo) => {
    const c = clientFor("admin", server);
    testInfo.skip(!c, `E2E ignoré : ${server.reasons.admin ?? "compte admin indisponible"}`);
    await use(c as Client);
  },
  anonHeaders: async ({}, use) => {
    await use(mobileHeaders(DEVICE_IDS.anon));
  },
});
