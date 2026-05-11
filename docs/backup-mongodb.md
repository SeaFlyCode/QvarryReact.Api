# Backup & Disaster Recovery — MongoDB

**Status** : Phase B audit 2026-05-11 §3.4. Procédure documentée, tests trimestriels recommandés.

---

## Configuration actuelle

Le backend utilise **MongoDB Atlas** (cf. `src/config/database.ts`) avec :
- Connection string via `DB_CONN_STRING` env var (format `mongodb+srv://...`)
- Database name : `QvarryStorage` (override via `DB_NAME`)
- SSL/TLS activé par défaut en prod
- Pool 50 max / 10 min en prod
- Write concern `majority` + `retryWrites: true`

## Stratégie de backup

### 1. Snapshots Atlas (recommandé — natif)

MongoDB Atlas fournit des **snapshots automatiques continus** sur les tiers `M10+` (payants). Configuration recommandée :

| Paramètre | Valeur recommandée |
|---|---|
| Fréquence snapshot | Continu (Cloud Backup) |
| Rétention quotidienne | 7 jours |
| Rétention hebdomadaire | 4 semaines |
| Rétention mensuelle | 12 mois |
| Cross-region backup | Activé si tier le permet |
| Point-in-time recovery | Activé (PITR) |

**Coût indicatif** : ~$0.30/GB/mois pour les snapshots. Pour une DB de 50 GB ≈ $15/mois.

**Configuration via UI Atlas** :
1. Atlas Console → Project → Cluster → Backup
2. Cliquer "Configure Backup"
3. Activer "Cloud Backup" (anciennement "Continuous Backup")
4. Régler les policies de rétention (snapshot daily / weekly / monthly)
5. Activer "Cross-region Backup" si géo-disponibilité requise

### 2. Backup manuel via `mongodump` (fallback / archive)

Pour archive ponctuelle hors-Atlas (ex: avant migration majeure, compliance) :

```bash
#!/bin/bash
# scripts/manual-backup.sh — backup ponctuel hors Atlas
set -euo pipefail

DATE=$(date -u +%Y%m%dT%H%M%SZ)
OUTPUT_DIR="./backups/${DATE}"
mkdir -p "${OUTPUT_DIR}"

# Variables (à fournir via .env ou env vars)
: "${DB_CONN_STRING:?manque DB_CONN_STRING}"
: "${DB_NAME:?manque DB_NAME (défaut QvarryStorage)}"

echo "Dumping ${DB_NAME} vers ${OUTPUT_DIR}..."
mongodump \
  --uri="${DB_CONN_STRING}" \
  --db="${DB_NAME}" \
  --out="${OUTPUT_DIR}" \
  --gzip \
  --numParallelCollections=4

echo "Compressing..."
tar -czf "${OUTPUT_DIR}.tar.gz" -C ./backups "${DATE}"
rm -rf "${OUTPUT_DIR}"

echo "✓ Backup: ${OUTPUT_DIR}.tar.gz ($(du -h ${OUTPUT_DIR}.tar.gz | cut -f1))"

# Optionnel : upload S3
# aws s3 cp "${OUTPUT_DIR}.tar.gz" "s3://qvarry-backups/manual/${DATE}.tar.gz"
```

Ajouter dans `.gitignore` :
```
backups/
*.tar.gz
```

## Procédure de restauration

### Depuis snapshot Atlas

**RTO estimé** : 30 min - 2h selon taille DB.
**RPO estimé** : < 5 min (PITR activé).

1. Atlas Console → Backup → Snapshots
2. Identifier le snapshot cible (date + heure UTC)
3. Cliquer "Restore" → choisir une option :
   - **Restore in place** : remplace la DB courante (DESTRUCTIF — confirmer avec lead tech)
   - **Restore to a new cluster** : crée un nouveau cluster pour validation avant cutover (recommandé)
4. Une fois le restore complete, basculer le `DB_CONN_STRING` env var du backend prod vers le nouveau cluster
5. Smoke-test l'app : `curl https://api.qvarry.fr/api/health/ready` doit retourner 200

### Depuis archive `mongodump`

```bash
# Décompression
tar -xzf backups/20260511T143000Z.tar.gz -C /tmp/

# Restore vers nouvelle DB (ou en place)
mongorestore \
  --uri="${DB_CONN_STRING}" \
  --db="QvarryStorage_restored" \
  --gzip \
  /tmp/20260511T143000Z/QvarryStorage/

# Validation manuelle puis bascule DB_NAME env var
```

## Tests de restauration (obligatoire trimestriellement)

Chaque trimestre, exécuter :

1. Restaurer un snapshot Atlas vers un **nouveau cluster** (jamais en prod).
2. Pointer un backend staging vers ce cluster.
3. Exécuter le smoke-test (`scripts/smoke-test.sh` + `scripts/smoke-e2e.ts`).
4. Vérifier les compteurs clés : users, fiches, points, sos sessions, conversations.
5. Documenter le résultat dans `docs/dr-tests.md` (date, RTO mesuré, anomalies).
6. Détruire le cluster temporaire.

## Disaster Recovery scenarios

| Scénario | Mitigation | RTO | RPO |
|---|---|---|---|
| Cluster Atlas down (panne provider) | Failover automatique replica set | < 1 min | 0 |
| Région Atlas down | Bascule cross-region (si activé) | 5-15 min | < 5 min |
| Corruption logique (bug applicatif) | Restore snapshot pré-incident | 30-60 min | < 5 min PITR |
| Suppression accidentelle de collection | PITR restore | 30 min | < 5 min |
| Compromission credentials | Rotation immédiate + audit logs review | 1h | dépend incident |
| Perte totale projet Atlas (très rare) | Restore archive `mongodump` S3 | 4-8h | dernier `mongodump` |

## Variables d'env requises

`.env` backend :
- `DB_CONN_STRING=mongodb+srv://user:pwd@cluster.mongodb.net/?retryWrites=true&w=majority`
- `DB_NAME=QvarryStorage` (optionnel, défaut)
- `DB_SSL=true` (optionnel, défaut activé en prod)

Pour le script `mongodump` manuel :
- Mêmes variables + outils CLI MongoDB installés (`brew install mongodb-database-tools` macOS, ou apt).

## Audit & alerting

- Surveiller : Atlas → Alerts → activer "Backup compliance" + "Snapshot failure" + "Replication lag > 60s"
- Alertes destination : Slack `#ops-alerts` ou PagerDuty
- Audit log MongoDB : exposé via Atlas Audit (compliance SOC 2)

## Migration scripts (idempotence)

Les migrations BDD documentées (cf. `REFONTE_2026-05-04.md §7`) doivent être **idempotentes** :

```bash
ts-node src/scripts/migrations/2026-05-04-notification-cleanup.ts
ts-node src/scripts/migrations/2026-05-04-user-notification-prefs.ts
```

Avant toute migration en prod :
1. Snapshot Atlas manuel (UI → "Take Snapshot Now")
2. Migration en dry-run (si supporté)
3. Migration réelle
4. Validation smoke-test
5. Documenter dans `docs/dr-tests.md`

---

**Dernière mise à jour** : 2026-05-11 (Phase B audit). Procédure à valider lors du prochain test trimestriel.
