/**
 * Utilitaires de masquage pour les logs (conformité RGPD)
 */

/**
 * Masque un email pour les logs : matheo@example.com → ma***@example.com
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "***";
  const [local, domain] = email.split("@");
  const masked =
    local.length <= 2 ? local[0] + "***" : local.substring(0, 2) + "***";
  return `${masked}@${domain}`;
}

/**
 * Anonymise une adresse IP pour les logs et emails
 * IPv4: 192.168.1.42 → 192.168.1.*
 * IPv6: 2001:0db8:85a3::8a2e → 2001:0db8:***
 */
export function anonymizeIp(ip: string): string {
  if (!ip) return "Inconnue";
  if (ip.includes(":")) {
    // IPv6
    return ip.split(":").slice(0, 2).join(":") + ":***";
  }
  // IPv4
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  }
  return "Anonymisée";
}

/**
 * Masque un Device ID pour les logs : ABC123XYZ → ABC123XY...
 */
export function maskDeviceId(deviceId: string): string {
  if (!deviceId) return "unknown";
  if (deviceId.length <= 8) return deviceId;
  return deviceId.substring(0, 8) + "...";
}

/**
 * Masque un token pour les logs : montre les 6 premiers + ... + 4 derniers chars
 * eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... → eyJhbG...VCJ9
 */
export function maskToken(token: string): string {
  if (!token) return "***";
  if (token.length <= 10) return "***";
  return token.substring(0, 6) + "..." + token.substring(token.length - 4);
}

/**
 * Masque le password dans une connection string MongoDB
 * mongodb+srv://user:password@host... → mongodb+srv://user:***@host...
 */
export function maskConnectionString(connStr: string): string {
  if (!connStr) return "***";
  // Format: mongodb+srv://user:password@host
  return connStr.replace(/:([^@:]+)@/, ":***@");
}

/**
 * Sanitise un objet pour les logs en masquant les champs sensibles
 * Re-export depuis loggerService pour éviter la duplication
 */
export { sanitizeLogData } from "../services/loggerService";
