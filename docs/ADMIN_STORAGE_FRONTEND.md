# Documentation Admin Storage - Guide Frontend

## 🎯 Objectif

Ce document explique le format **EXACT** des réponses des endpoints admin storage et comment les utiliser côté front.

---

## 🚨 PROBLÈMES IDENTIFIÉS

### ❌ Problème 1 : Format de `usersData` incorrect

**L'API retourne :**

```typescript
{
  users: [...],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1
}
```

**Le front attend :**

```typescript
{
  users: [...],
  pagination: {    // ← MANQUE cette structure
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1
  }
}
```

**Solution :** Mapper la réponse côté front (voir section Mapping)

---

### ❌ Problème 2 : `stats.database.usagePercentage` n'existe pas

**L'API retourne :**

```typescript
{
  database: {
    totalUsers: 150,
    totalUsed: 78643200000,
    totalQuota: 322122547200,
    averageUsage: 524288000,
    usersOverQuota: 2
    // ⚠️ PAS de usagePercentage ici !
  }
}
```

**Le front essaie d'accéder à :**

```typescript
stats.database.usagePercentage; // ← undefined
```

**Solution :** Calculer manuellement ou utiliser les champs disponibles

---

## 📋 ENDPOINTS DISPONIBLES

### 1. Liste des utilisateurs avec stockage

```
GET /api/admin/users/storage?page=1&limit=20
```

#### Réponse API (FORMAT EXACT)

```typescript
{
  users: Array<{
    userId: string;           // ID MongoDB
    name: string;             // "Prénom Nom" (déchiffré)
    email: string;            // Email (déchiffré)
    storage: {
      used: number;           // Octets utilisés
      quota: number;          // Quota en octets (défaut: 2147483648 = 2 Go)
      available: number;      // Octets disponibles (quota - used)
      percentage: number;     // Pourcentage utilisé (0.00 - 100.00)
    }
  }>,
  total: number,              // Nombre total d'utilisateurs
  page: number,               // Page actuelle
  limit: number,              // Limite par page
  totalPages: number          // Nombre total de pages
}
```

#### Exemple de réponse réelle

```json
{
  "users": [
    {
      "userId": "507f1f77bcf86cd799439011",
      "name": "John Doe",
      "email": "john@example.com",
      "storage": {
        "used": 524288000,
        "quota": 2147483648,
        "available": 1623195648,
        "percentage": 24.41
      }
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 20,
  "totalPages": 8
}
```

---

### 2. Statistiques globales

```
GET /api/admin/storage/stats
```

#### Réponse API (FORMAT EXACT)

```typescript
{
  database: {
    totalUsers: number;       // Nombre total d'utilisateurs
    totalUsed: number;        // Total octets utilisés (somme des storage_used)
    totalQuota: number;       // Total des quotas (somme des storage_quota)
    averageUsage: number;     // Moyenne d'utilisation par utilisateur (octets)
    usersOverQuota: number;   // Nombre d'utilisateurs dépassant leur quota
  },
  disk: {
    totalStorageOnDisk: number;  // Taille réelle sur disque (octets)
    totalPhotos: number;         // Nombre total de photos dans la BDD
  },
  difference: {
    bytes: number;            // Différence absolue BDD vs disque (octets)
    percentage: string;       // Pourcentage de différence (format: "12.34")
  }
}
```

#### Exemple de réponse réelle

```json
{
  "database": {
    "totalUsers": 150,
    "totalUsed": 78643200000,
    "totalQuota": 322122547200,
    "averageUsage": 524288000,
    "usersOverQuota": 2
  },
  "disk": {
    "totalStorageOnDisk": 78640000000,
    "totalPhotos": 1250
  },
  "difference": {
    "bytes": 3200000,
    "percentage": "0.004"
  }
}
```

---

### 3. Détails d'un utilisateur

```
GET /api/admin/users/:userId/storage
```

#### Réponse API (FORMAT EXACT)

```typescript
{
  storage: {
    used: number;             // Octets utilisés (depuis la BDD)
    quota: number;            // Quota en octets
    available: number;        // Octets disponibles
    percentage: number;       // Pourcentage utilisé
  },
  actualStorageUsed: number,  // Taille réelle calculée sur le disque
  photos: Array<{
    pointId: string;          // ID du point MongoDB
    pointName: string;        // Nom du point
    size: number;             // Taille de la photo en octets
    uploadedAt: string;       // Date ISO 8601
    checksum: string;         // Checksum MD5
  }>,
  totalPhotos: number,        // Nombre de photos dans la BDD
  filesOnDisk: number         // Nombre de fichiers réels sur le disque
}
```

---

### 4. Modifier le quota

```
PATCH /api/admin/users/:userId/quota
```

#### Body

```json
{
  "quotaGb": 5 // Nouveau quota en Go (nombre positif)
}
```

#### Réponse API (FORMAT EXACT)

```typescript
{
  message: string,            // "Quota updated successfully"
  storage: {
    used: number;
    quota: number;            // Nouveau quota en octets
    available: number;
    percentage: number;
  }
}
```

---

### 5. Nettoyage des fichiers orphelins

```
POST /api/admin/storage/cleanup
```

#### Body

```json
{
  "dryRun": true // true = simulation, false = suppression réelle
}
```

#### Réponse API (FORMAT EXACT)

```typescript
{
  message: string,            // Message de confirmation
  orphans: Array<{
    userId: string;
    pointId: string;
    deleted: boolean;         // true si supprimé, false en dry run
  }>,
  totalOrphans: number,       // Nombre d'orphelins trouvés
  deleted: number,            // Nombre supprimés (0 en dry run)
  recalculated: number,       // Nombre d'utilisateurs recalculés
  usersAffected: number,      // Nombre d'utilisateurs concernés
  recalculationDetails: Array<{
    userId: string;
    oldUsed: number;
    newUsed: number;
  }>
}
```

---

## 🔧 MAPPING CÔTÉ FRONT

### Solution 1 : Mapper `usersData` au format attendu

```typescript
// Réponse API brute
const apiResponse = await fetch("/api/admin/users/storage?page=1&limit=20");
const data = await apiResponse.json();

// Mapping vers le format attendu par le composant
const usersData = {
  users: data.users,
  pagination: {
    total: data.total,
    page: data.page,
    limit: data.limit,
    totalPages: data.totalPages,
  },
};

// Maintenant usersData a le bon format
console.log(usersData.pagination.total); // ✅ fonctionne
```

---

### Solution 2 : Calculer `usagePercentage` pour les stats

```typescript
// Réponse API stats
const statsResponse = await fetch("/api/admin/storage/stats");
const stats = await statsResponse.json();

// Calculer le pourcentage d'utilisation global
const globalUsagePercentage =
  (stats.database.totalUsed / stats.database.totalQuota) * 100;

console.log(`Utilisation globale: ${globalUsagePercentage.toFixed(2)}%`);

// Si vous voulez l'ajouter à l'objet stats
const statsWithPercentage = {
  ...stats,
  database: {
    ...stats.database,
    usagePercentage: globalUsagePercentage,
  },
};
```

---

## 💡 INTERFACES TYPESCRIPT RECOMMANDÉES

```typescript
// Interface pour la réponse de liste d'utilisateurs
interface ApiUsersStorageResponse {
  users: UserStorage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Interface pour le format attendu par le composant
interface UsersDataFormatted {
  users: UserStorage[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface UserStorage {
  userId: string;
  name: string;
  email: string;
  storage: {
    used: number;
    quota: number;
    available: number;
    percentage: number;
  };
}

// Interface pour les stats
interface StorageStats {
  database: {
    totalUsers: number;
    totalUsed: number;
    totalQuota: number;
    averageUsage: number;
    usersOverQuota: number;
  };
  disk: {
    totalStorageOnDisk: number;
    totalPhotos: number;
  };
  difference: {
    bytes: number;
    percentage: string;
  };
}

// Interface pour les stats enrichies (avec le pourcentage calculé)
interface StorageStatsEnriched extends StorageStats {
  database: StorageStats["database"] & {
    usagePercentage: number; // ← Ajouté côté front
  };
}
```

---

## 🚀 EXEMPLE COMPLET D'UTILISATION

### Composant React avec mapping

```typescript
import { useEffect, useState } from 'react';

interface UsersDataFormatted {
  users: UserStorage[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface StorageStatsEnriched {
  database: {
    totalUsers: number;
    totalUsed: number;
    totalQuota: number;
    averageUsage: number;
    usersOverQuota: number;
    usagePercentage: number;  // ← Calculé
  };
  disk: {
    totalStorageOnDisk: number;
    totalPhotos: number;
  };
  difference: {
    bytes: number;
    percentage: string;
  };
}

export function AdminStoragePanel() {
  const [usersData, setUsersData] = useState<UsersDataFormatted | null>(null);
  const [stats, setStats] = useState<StorageStatsEnriched | null>(null);

  useEffect(() => {
    // Charger la liste des utilisateurs
    fetch('/api/admin/users/storage?page=1&limit=20', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(res => res.json())
      .then(data => {
        // ✅ Mapper au bon format
        const formatted: UsersDataFormatted = {
          users: data.users,
          pagination: {
            total: data.total,
            page: data.page,
            limit: data.limit,
            totalPages: data.totalPages
          }
        };
        setUsersData(formatted);
      });

    // Charger les stats
    fetch('/api/admin/storage/stats', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(res => res.json())
      .then(data => {
        // ✅ Calculer le pourcentage manquant
        const usagePercentage = (data.database.totalUsed / data.database.totalQuota) * 100;

        const enriched: StorageStatsEnriched = {
          ...data,
          database: {
            ...data.database,
            usagePercentage
          }
        };
        setStats(enriched);
      });
  }, []);

  if (!usersData || !stats) {
    return <div>Chargement...</div>;
  }

  return (
    <div>
      <h2>Statistiques globales</h2>
      <p>Utilisateurs: {stats.database.totalUsers}</p>
      <p>Utilisation globale: {stats.database.usagePercentage.toFixed(2)}%</p>
      <p>Utilisateurs au-dessus du quota: {stats.database.usersOverQuota}</p>

      <h2>Liste des utilisateurs</h2>
      <p>Page {usersData.pagination.page} sur {usersData.pagination.totalPages}</p>
      <p>Total: {usersData.pagination.total} utilisateurs</p>

      <table>
        <thead>
          <tr>
            <th>Nom</th>
            <th>Email</th>
            <th>Utilisé</th>
            <th>Quota</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {usersData.users.map(user => (
            <tr key={user.userId}>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>{formatBytes(user.storage.used)}</td>
              <td>{formatBytes(user.storage.quota)}</td>
              <td>{user.storage.percentage.toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Helper pour formater les octets
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
```

---

## 📊 CONVERSIONS UTILES

### Octets → Go

```typescript
function bytesToGb(bytes: number): number {
  return bytes / (1024 * 1024 * 1024);
}

// Exemple
const quotaGb = bytesToGb(2147483648); // 2 Go
```

### Go → Octets

```typescript
function gbToBytes(gb: number): number {
  return gb * 1024 * 1024 * 1024;
}

// Exemple
const quotaBytes = gbToBytes(5); // 5368709120 octets
```

### Formater les tailles

```typescript
function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

// Exemples
formatBytes(524288000); // "500 MB"
formatBytes(2147483648); // "2 GB"
formatBytes(78643200000); // "73.25 GB"
```

---

## ⚠️ POINTS D'ATTENTION

### 1. Pagination

**Valeurs par défaut :**

- `page` : 1
- `limit` : 50 (max recommandé : 100)

**Toujours vérifier :**

```typescript
if (usersData.pagination.page > usersData.pagination.totalPages) {
  // Page invalide, revenir à la page 1
}
```

---

### 2. Incohérences BDD/Disque

Le champ `difference` dans les stats indique si la BDD et le disque sont désynchronisés :

```typescript
if (parseFloat(stats.difference.percentage) > 5) {
  console.warn("⚠️ Incohérence détectée entre BDD et disque");
  // Proposer un nettoyage avec /storage/cleanup
}
```

---

### 3. Utilisateurs au-dessus du quota

```typescript
if (stats.database.usersOverQuota > 0) {
  console.warn(
    `⚠️ ${stats.database.usersOverQuota} utilisateur(s) dépassent leur quota`,
  );
}

// Filtrer les utilisateurs au-dessus du quota
const overQuotaUsers = usersData.users.filter(
  (u) => u.storage.percentage > 100,
);
```

---

### 4. Gestion des erreurs

```typescript
try {
  const response = await fetch("/api/admin/users/storage");

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("Accès refusé - Admin requis");
    }
    throw new Error(`Erreur API: ${response.status}`);
  }

  const data = await response.json();

  // Validation de la structure
  if (!data.users || !Array.isArray(data.users)) {
    throw new Error("Format de réponse invalide");
  }

  // Mapping...
} catch (error) {
  console.error("Erreur lors du chargement des données storage:", error);
  // Afficher un message d'erreur à l'utilisateur
}
```

---

## 🎯 RÉSUMÉ DES SOLUTIONS

### Problème 1 : Format `usersData`

**❌ Ne pas faire :**

```typescript
const total = usersData.pagination.total; // ❌ undefined
```

**✅ Faire :**

```typescript
// Mapper la réponse API
const formatted = {
  users: apiResponse.users,
  pagination: {
    total: apiResponse.total,
    page: apiResponse.page,
    limit: apiResponse.limit,
    totalPages: apiResponse.totalPages,
  },
};
```

---

### Problème 2 : `usagePercentage` manquant

**❌ Ne pas faire :**

```typescript
const percentage = stats.database.usagePercentage; // ❌ undefined
```

**✅ Faire :**

```typescript
// Calculer manuellement
const percentage = (stats.database.totalUsed / stats.database.totalQuota) * 100;
```

---

## 📞 SUPPORT

En cas de problème avec les endpoints admin storage :

1. Vérifier les headers d'authentification (`Authorization: Bearer {token}`)
2. Vérifier que l'utilisateur a `is_admin: true`
3. Consulter les logs serveur pour les erreurs détaillées
4. Vérifier que les conversions octets/Go sont correctes

---

**Date de mise à jour :** 24 mars 2026  
**Version API :** v1  
**Base URL :** `/api/admin`
