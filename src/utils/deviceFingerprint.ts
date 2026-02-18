// server/src/utils/deviceFingerprint.ts
import crypto from "crypto";
import { Request } from "express";

/**
 * Génère un device fingerprint côté serveur basé sur les headers HTTP
 *
 * SÉCURITÉ: Le fingerprint est calculé côté serveur pour éviter la manipulation côté client.
 * Il combine plusieurs informations de la requête pour créer une empreinte unique du device.
 *
 * Note: Ce n'est pas une identification parfaite (les headers peuvent changer),
 * mais c'est suffisant pour détecter les anomalies de session.
 */
export function generateDeviceFingerprint(req: Request): string {
  const components: string[] = [];

  // User-Agent (navigateur, OS, etc.)
  const userAgent = req.headers["user-agent"] || "unknown";
  components.push(userAgent);

  // Accept-Language (préférences linguistiques)
  const acceptLanguage = req.headers["accept-language"] || "unknown";
  components.push(acceptLanguage);

  // Accept-Encoding
  const acceptEncoding = req.headers["accept-encoding"] || "unknown";
  components.push(acceptEncoding);

  // Sec-CH-UA headers (Client Hints pour navigateurs modernes)
  const secChUa = req.headers["sec-ch-ua"] || "";
  const secChUaPlatform = req.headers["sec-ch-ua-platform"] || "";
  const secChUaMobile = req.headers["sec-ch-ua-mobile"] || "";
  components.push(String(secChUa));
  components.push(String(secChUaPlatform));
  components.push(String(secChUaMobile));

  // DNT (Do Not Track) - stable par utilisateur
  const dnt = req.headers["dnt"] || "";
  components.push(String(dnt));

  // Connection type
  const connection = req.headers["connection"] || "";
  components.push(String(connection));

  // Concaténer et hasher
  const rawFingerprint = components.join("|");
  const hash = crypto.createHash("sha256").update(rawFingerprint).digest("hex");

  // Retourner les 32 premiers caractères pour un fingerprint plus court
  return hash.substring(0, 32);
}
