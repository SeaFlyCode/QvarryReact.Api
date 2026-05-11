# Audit Logs — Politique de rétention

Date de création : 2026-05-11
Lié à : AUDIT_2026-05-11 §5.5 (P2) + RGPD Art. 5.1(e) (limitation de conservation)

## TL;DR

| Type de log | Rétention | Champ TTL |
|-------------|-----------|-----------|
| Logs standard (info / warning) | **2 ans** | `expiresAt = createdAt + 2 ans` |
| Logs `permanent: true` | **Indéfinie** | `expiresAt = null` |

Les logs sont supprimés automatiquement par Mongo (TTL index sur `expiresAt`).
Aucune action manuelle requise.

## Pourquoi 2 ans ?

- **RGPD Art. 5.1(e)** : "Les données à caractère personnel doivent être
  conservées sous une forme permettant l'identification des personnes
  concernées pendant une durée n'excédant pas celle nécessaire au regard des
  finalités pour lesquelles elles sont traitées."
- Les logs d'audit contiennent IP (hashée HMAC) et User-Agent (chiffré). Ce
  sont des données personnelles au sens RGPD.
- 2 ans = compromis entre :
  - **Forensic / investigation post-incident** : un incident sécu peut être
    découvert plusieurs mois après les faits (cf. délais typiques en
    cybersécurité : 6 à 18 mois selon Verizon DBIR).
  - **Obligations légales FR** : LCEN Art. 6 impose 1 an de conservation des
    journaux d'accès aux services en ligne pour les autorités. 2 ans laisse
    une marge sereine.
  - **Volumétrie** : à 100 logs/min, 2 ans = ~100M docs (~10 GB compressés
    avec WiredTiger zstd) — gérable.

Si tu veux ajuster, modifie `DEFAULT_RETENTION_SECONDS` dans
`src/models/auditLogs.ts`. Les **nouveaux** logs prendront la nouvelle durée ;
les anciens gardent leur `expiresAt` déjà calculé (cf. section « Changer la
durée » plus bas).

## Logs `permanent: true` — exemption du TTL

Certains events ne doivent **jamais** être supprimés, par exemple :

- Tentative de breach sécurité (`security_breach_attempt`)
- Fraude avérée (`fraud_confirmed`)
- Accès admin non-autorisé (`admin_unauthorized_access`)
- Demande légale (`legal_hold_request`)

Pour les marquer en rétention indéfinie :

```ts
await auditService.log({
  userId,
  action: "security_breach_attempt",
  level: "critical",
  permanent: true,           // ← exempte du TTL
  ipAddress: req.ip,
  details: { ... },
});
```

Mécanique technique : `permanent: true` met `expiresAt = null` sur le doc.
Le TTL index Mongo (`expireAfterSeconds: 0` sur `expiresAt`) ignore les docs
où ce champ est null/absent — c'est le pattern officiel Mongo « TTL on a
specific date » (cf. https://www.mongodb.com/docs/manual/tutorial/expire-data/).

### Bonnes pratiques

- N'utilise `permanent: true` que pour des events **réellement** sensibles.
  Si tout est permanent, plus rien ne l'est, et la collection explose.
- Pour les logs de niveau `error`/`critical` "ordinaires" (rate limit dépassé,
  validation échouée), garde le défaut (2 ans). Si l'investigation prend
  plus de 2 ans, c'est qu'il y a un autre problème.
- Documente le pourquoi du `permanent: true` dans `details` du log :
  ```ts
  permanent: true,
  details: {
    reason: "Confirmed breach — investigation ongoing, court order pending",
    incident_id: "INC-2026-051",
  }
  ```

## Changer la durée de rétention en production

### Option A — Modifier le défaut pour les nouveaux logs

1. Édite `DEFAULT_RETENTION_SECONDS` dans `src/models/auditLogs.ts`.
2. Redéploie.
3. Les nouveaux logs auront la nouvelle durée. Les anciens gardent leur
   `expiresAt` déjà calculé (immutable).

### Option B — Mettre à jour rétroactivement les logs existants

Écris une migration ad-hoc :

```ts
// src/scripts/migrations/2026-XX-XX-extend-audit-retention.ts
import AuditLog from "../../models/auditLogs";

const NEW_RETENTION_SECONDS = 60 * 60 * 24 * 365 * 3; // 3 ans

export async function run() {
  // Re-calcule expiresAt = timestamp + NEW_RETENTION pour tous les non-permanent
  const cursor = AuditLog.find({ permanent: { $ne: true } }).cursor();
  let updated = 0;
  for await (const doc of cursor) {
    const newExpiresAt = new Date(
      doc.timestamp.getTime() + NEW_RETENTION_SECONDS * 1000,
    );
    await AuditLog.updateOne({ _id: doc._id }, { $set: { expiresAt: newExpiresAt } });
    updated++;
  }
  return updated;
}
```

### Option C — Changer l'index TTL directement

Si tu veux passer d'un TTL par-date à un TTL par-durée (mais perdre la
flexibilité `permanent`), tu peux modifier l'index en runtime :

```js
// mongo shell
db.auditlogs.dropIndex("expiresAt_1");
db.auditlogs.createIndex(
  { timestamp: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 365 * 3 } // 3 ans
);
```

⚠️ Non recommandé : tu perds le mécanisme `permanent`, et un index TTL
changé en runtime peut prendre plusieurs heures à se propager sur une
collection lourde.

## Audit & vérification

Pour vérifier la politique en place sur ta DB :

```js
// mongo shell
db.auditlogs.getIndexes();
// Doit retourner un index { v: 2, key: { expiresAt: 1 }, name: 'expiresAt_1', expireAfterSeconds: 0 }

// Compter les logs permanent
db.auditlogs.countDocuments({ permanent: true });

// Compter les logs qui vont expirer dans les 30 prochains jours
db.auditlogs.countDocuments({
  expiresAt: { $lte: new Date(Date.now() + 30 * 86400000), $ne: null }
});
```

## Liens

- AUDIT_2026-05-11 §5.5
- RGPD Art. 5.1(e) — https://gdpr-info.eu/art-5-gdpr/
- Mongo TTL on specific date — https://www.mongodb.com/docs/manual/tutorial/expire-data/
- `src/models/auditLogs.ts`
- `src/services/auditService.ts` — `log({ permanent: true })`
