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
