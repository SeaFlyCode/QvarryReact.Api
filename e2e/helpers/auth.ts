import { APIRequestContext } from "@playwright/test";
import { API, Creds } from "./env";

/** Identifiants d'appareil fixes (UUID v4) : évite de multiplier les "devices" connus du serveur. */
export const DEVICE_IDS = {
  user1: "e2e00000-0000-4000-8000-000000000001",
  user2: "e2e00000-0000-4000-8000-000000000002",
  admin: "e2e00000-0000-4000-8000-000000000003",
  anon: "e2e00000-0000-4000-8000-0000000000ff",
} as const;

export function mobileHeaders(deviceId: string, token?: string): Record<string, string> {
  const h: Record<string, string> = {
    "X-Platform": "android",
    "X-Device-ID": deviceId,
    "X-App-Version": "99.0.0",
    "User-Agent": "qvarry-e2e-api",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export interface Session {
  label: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  userId?: string;
  isAdmin?: boolean;
}

export type LoginResult =
  | { ok: true; session: Session }
  | { ok: false; reason: string };

/**
 * Login mobile réel (aucun contournement de sécurité).
 * Sans token App Check (X-Firebase-Appcheck) ni bypass serveur, 2FA obligatoire,
 * rate limit ou identifiants refusés : retourne ok:false avec la raison (=> tests skip).
 */
export async function loginMobile(
  request: APIRequestContext,
  label: string,
  deviceId: string,
  creds: Creds,
): Promise<LoginResult> {
  const headers = mobileHeaders(deviceId);
  const appCheck = process.env.E2E_APPCHECK_TOKEN;
  if (appCheck) headers["X-Firebase-AppCheck"] = appCheck;

  const res = await request.post(`${API}/mobile/auth/login`, {
    headers,
    data: { email: creds.email, password: creds.password, deviceId },
  });
  const status = res.status();
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);

  if (status === 200 && body.requires2FA) {
    return { ok: false, reason: `${label}: 2FA activée sur ce compte (utiliser un compte de test sans 2FA)` };
  }
  if (status === 200 && body.accessToken && body.refreshToken) {
    return {
      ok: true,
      session: {
        label,
        deviceId,
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        userId: body.user?.id ?? body.user?._id,
        isAdmin: !!(body.user?.isAdmin ?? body.user?.is_admin),
      },
    };
  }
  const code = body.code ? ` code=${body.code}` : "";
  const text = JSON.stringify(body);
  let hint = "";
  if (status === 429) hint = " (rate limit mobile : attendre la fin de la fenêtre)";
  else if (/app ?check/i.test(text))
    hint = " (App Check actif : fournir E2E_APPCHECK_TOKEN ou APP_CHECK_ENABLED=false sur le serveur de dev)";
  return { ok: false, reason: `${label}: login refusé HTTP ${status}${code}${hint}` };
}
