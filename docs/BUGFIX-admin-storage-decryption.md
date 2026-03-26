# 🔧 Correction : Déchiffrement des données utilisateur dans l'API Admin Storage

**Date** : 24 mars 2026  
**Type** : Bugfix - Données chiffrées exposées  
**Criticité** : Haute (UX bloquant pour admin)

---

## 📋 Problème identifié

### Symptômes

Les données utilisateur affichées dans le tableau admin de gestion du stockage étaient **chiffrées** au lieu d'être lisibles :

```
Utilisateur: 3a947a69b5096ede6405bd0c:0f27c7a10c0f2cd4a64625d1d588576e:07d8b8d5dff501...
Email: 365d27b9486664fb9be202d6:e24933f4a64f7e8091aeaa57ae09ae81:dffab42274dbc523...
```

### Cause racine

Le service `storageQuotaService` renvoyait les données **brutes** de la base MongoDB sans les déchiffrer, alors que ces champs sont chiffrés côté base avec `masterEncryptionUtils`.

**Fichier concerné** : `/src/services/storageQuotaService.ts`  
**Fonction** : `getAllUsersStorage()` (lignes 236-285)

```typescript
// ❌ AVANT (bugué)
return {
  userId: user._id.toString(),
  name: `${user.name} ${user.surname}`,  // Chiffré !
  email: user.email,                      // Chiffré !
  storage: { ... }
};
```

---

## ✅ Solution appliquée

### 1. Import de la fonction de déchiffrement

**Fichier** : `/src/services/storageQuotaService.ts`  
**Ligne 9** :

```typescript
import { decrypt } from "../utils/masterEncryptionUtils";
```

### 2. Ajout d'une fonction `safeDecrypt`

Protection contre les erreurs de déchiffrement (données corrompues, clé invalide, etc.) :

```typescript
const safeDecrypt = (value: string | undefined): string => {
  if (!value) return "";
  try {
    return decrypt(value);
  } catch (e) {
    logger.warn("Erreur déchiffrement donnée utilisateur", {
      userId: user._id,
      error: e instanceof Error ? e.message : String(e),
    });
    return "[Données indisponibles]";
  }
};
```

### 3. Déchiffrement dans le mapping

**Lignes 274-277** :

```typescript
return {
  userId: user._id.toString(),
  name: `${safeDecrypt(user.name)} ${safeDecrypt(user.surname)}`.trim(),
  email: safeDecrypt(user.email),
  storage: {
    used,
    quota,
    available,
    percentage: parseFloat(percentage.toFixed(2)),
  },
};
```

---

## 🧪 Tests mis à jour

### Fichier : `/src/__tests__/services/storageQuotaService.test.ts`

**Modifications** :

1. Import de la fonction `encrypt` (ligne 5)
2. Chiffrement des données mock pour simuler la vraie base

```typescript
// ✅ APRÈS (corrigé)
const mockUsers = [
  {
    _id: new Types.ObjectId(),
    name: encrypt("John"), // Chiffré comme en base
    surname: encrypt("Doe"), // Chiffré comme en base
    email: encrypt("john@example.com"), // Chiffré comme en base
    storage_quota: 2 * GB,
    storage_used: 1 * GB,
  },
  // ...
];
```

**Résultat** : ✅ Tous les tests passent

```
PASS src/__tests__/services/storageQuotaService.test.ts
  getAllUsersStorage
    ✓ devrait retourner la liste paginée des utilisateurs
    ✓ devrait gérer la pagination
    ✓ devrait utiliser les valeurs par défaut
```

---

## 🎯 Impact

### ✅ Avantages

- **UX admin** : Données lisibles dans l'interface
- **Sécurité maintenue** : Déchiffrement uniquement côté backend pour les admins authentifiés
- **Robustesse** : Gestion des erreurs de déchiffrement
- **Cohérence** : Même approche que `adminControllers.ts`
- **Aucune modification frontend** requise

### 📊 Performance

- **Négligeable** : `decrypt()` est une opération rapide (AES-256-GCM)
- **Déjà paginé** : Max 50 utilisateurs par requête
- **Pas de cache** nécessaire : Les données ne sont pas appelées fréquemment

---

## 🔐 Sécurité

### Données concernées

Les champs suivants sont maintenant **déchiffrés automatiquement** :

- `name` (prénom)
- `surname` (nom)
- `email` (adresse email)

### Protection appliquée

1. **Authentification** : Route protégée par `authMiddleware` + `adminMiddleware`
2. **Permissions** : `is_admin: true` vérifié en base de données
3. **Audit logging** : Toutes les actions admin sont loggées
4. **Fallback** : Si déchiffrement échoue → `"[Données indisponibles]"`

---

## 📝 Route concernée

**Endpoint** : `GET /api/v1/admin/users/storage`

**Contrôleur** : `/src/controllers/adminStorageController.ts`  
**Service** : `/src/services/storageQuotaService.ts`

**Réponse attendue** :

```json
{
  "users": [
    {
      "userId": "507f1f77bcf86cd799439011",
      "name": "John Doe", // ✅ Déchiffré
      "email": "john@example.com", // ✅ Déchiffré
      "storage": {
        "used": 1073741824,
        "quota": 2147483648,
        "available": 1073741824,
        "percentage": 50.0
      }
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50,
  "totalPages": 1
}
```

---

## 🚀 Déploiement

### Build

```bash
npm run build  # ✅ Compilation réussie
```

### Tests

```bash
npm test -- storageQuotaService.test.ts  # ✅ 29 tests passent
```

### Vérification manuelle

1. Se connecter en tant qu'admin
2. Accéder à `/admin/storage` ou équivalent
3. Vérifier que les noms et emails sont lisibles

---

## 📚 Ressources liées

- **Documentation API** : `/docs/admin-api-routes.md`
- **Utils chiffrement** : `/src/utils/masterEncryptionUtils.ts`
- **Middleware admin** : `/src/middlewares/adminMiddleware.ts`
- **Contrôleur principal** : `/src/controllers/adminControllers.ts` (utilise la même approche)

---

## ✅ Checklist finale

- [x] Code corrigé (`storageQuotaService.ts`)
- [x] Tests mis à jour (`storageQuotaService.test.ts`)
- [x] Tests passent (29/29)
- [x] Build réussi
- [x] Documentation mise à jour
- [x] Approche cohérente avec `adminControllers.ts`
- [x] Gestion d'erreur robuste
- [x] Aucune régression introduite

---

**Correction validée et prête pour déploiement** ✅
