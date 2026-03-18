# Routes points

**Préfixe** : `/api/v1/points`

Ces routes permettent de consulter le solde de points d'un utilisateur et l'historique des transactions associées. La modification des points est réservée aux administrateurs.

Toutes les routes de ce groupe requièrent une authentification.

---

## Sommaire

- [GET /points](#get-points)
- [GET /points/history](#get-pointshistory)
- [POST /points](#post-points)

---

## Endpoints

### GET /api/v1/points

**Description** : Retourne le solde de points actuel de l'utilisateur authentifié.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Réponses

- **200 — Solde retourné**

```json
{
  "userId": "string",
  "balance": "number",
  "updatedAt": "2026-03-18T10:00:00.000Z"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### GET /api/v1/points/history

**Description** : Retourne l'historique des transactions de points de l'utilisateur authentifié, triées de la plus récente à la plus ancienne.

**Auth** : Requise (`authMiddleware`)

**Rate Limit** : Aucun

#### Paramètres de requête (query)

| Paramètre | Type   | Obligatoire | Description                                                 |
| --------- | ------ | ----------- | ----------------------------------------------------------- |
| `limit`   | number | Non         | Nombre de transactions à retourner (défaut : 20, max : 100) |
| `offset`  | number | Non         | Décalage pour la pagination (défaut : 0)                    |

#### Réponses

- **200 — Historique retourné**

```json
{
  "history": [
    {
      "id": "string",
      "amount": "number (positif = crédit, négatif = débit)",
      "reason": "string",
      "balanceAfter": "number",
      "createdAt": "2026-03-18T10:00:00.000Z"
    }
  ],
  "total": "number",
  "hasMore": "boolean"
}
```

- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`

---

### POST /api/v1/points

**Description** : Crédite ou débite des points sur le compte d'un utilisateur. Un montant positif ajoute des points, un montant négatif en retire. Cette route est réservée aux administrateurs.

**Auth** : Requise (`authMiddleware` + `adminMiddleware`)

**Rate Limit** : Aucun

⚠️ **Cette route est réservée aux administrateurs (`isAdmin: true`).**

#### Corps de la requête

```json
{
  "userId": "string (requis — identifiant de l'utilisateur cible)",
  "amount": "number (requis — positif pour crédit, négatif pour débit)",
  "reason": "string (requis — justification de l'opération)"
}
```

#### Réponses

- **200 — Points mis à jour**

```json
{
  "message": "Points mis à jour",
  "userId": "string",
  "amount": "number",
  "newBalance": "number"
}
```

- **400** : Champs manquants ou montant invalide — `{ "error": "...", "code": "MISSING_FIELDS" | "INVALID_AMOUNT" }`
- **400** : Solde insuffisant pour un débit — `{ "error": "Solde insuffisant", "code": "INSUFFICIENT_BALANCE" }`
- **401** : Non authentifié — `{ "error": "Non authentifié", "code": "NO_TOKEN" }`
- **403** : Droits administrateur requis — `{ "error": "Accès interdit", "code": "FORBIDDEN" }`
- **404** : Utilisateur cible introuvable — `{ "error": "Utilisateur introuvable", "code": "USER_NOT_FOUND" }`
