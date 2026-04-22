export function isValidSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

export function compareVersions(v1: string, v2: string): number {
  // Les inputs non-semver produiraient NaN dans les comparaisons (toujours
  // false), ce qui ferait passer silencieusement un client avec une version
  // invalide. On préfère lever — l'appelant doit valider via isValidSemver.
  if (!isValidSemver(v1) || !isValidSemver(v2)) {
    throw new Error(`Invalid semver: v1="${v1}", v2="${v2}"`);
  }

  const parts1 = v1.split(".").map(Number);
  const parts2 = v2.split(".").map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  return 0;
}
