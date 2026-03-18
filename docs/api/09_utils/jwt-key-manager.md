# jwtKeyManager

Gestionnaire de clés JWT avec support de la rotation de clés sans invalidation des tokens existants (REM-003 : JWT Key Versioning). Implémenté comme un singleton.

## Principe

Chaque token JWT inclut un champ `kv` (key version) dans son payload. Lors de la vérification, le middleware lit cette version et sélectionne la clé correspondante. Les anciens tokens restent valides avec leurs clés jusqu'à leur expiration naturelle.

```
JWT_SECRET      → version "1"  (clé principale, toujours chargée)
JWT_SECRET_V2   → version "2"
JWT_SECRET_V3   → version "3"  (si c'est la plus haute : version active)
```

La **version active** est la plus haute définie dans les variables d'environnement.

## Classe `JWTKeyManager`

### Méthodes publiques

```typescript
getCurrentKey(): { secret: string; version: string }
```

Retourne la clé et la version actuelles pour signer de nouveaux tokens. Lève une exception si aucune clé n'est disponible.

```typescript
getKeyByVersion(version: string): string | null
```

Retourne la clé secrète pour une version donnée. Retourne `null` si la version n'existe pas. Utilisé lors de la vérification d'un token entrant.

```typescript
getCurrentVersion(): string
```

Retourne la version actuellement active (ex: `"3"`).

```typescript
hasVersion(version: string): boolean
```

Vérifie qu'une version existe (sans retourner la clé).

```typescript
getAllVersions(): string[]
```

Retourne la liste de toutes les versions chargées.

```typescript
getStats(): { totalKeys: number; currentVersion: string; versions: string[] }
```

Statistiques des clés pour le monitoring. Ne retourne pas les secrets.

```typescript
generateNewKey(): { key: string; version: number }
```

Génère une nouvelle clé aléatoire (64 bytes en base64). Log la version suggérée et retourne la clé **sans la stocker** — elle doit être ajoutée manuellement aux variables d'environnement.

> ⚠️ La clé générée n'est **pas loggée** (seule la version est loggée). Elle est retournée une seule fois dans la réponse.

## Singleton

```typescript
export const jwtKeyManager = new JWTKeyManager();
export default jwtKeyManager;
```

L'instance est créée au chargement du module. `loadKeys()` est appelé dans le constructeur et lit les variables d'environnement une seule fois au démarrage.

## Chargement des clés

```
JWT_SECRET       → version "1", isActive = true si aucun V2+
JWT_SECRET_V2    → version "2", isActive = true si aucun V3+
JWT_SECRET_V3    → version "3", isActive = true si aucun V4+
...jusqu'à V10
```

La version active est la plus haute version pour laquelle `JWT_SECRET_V{n+1}` n'est pas défini.

## Usage dans `authMiddleware`

```typescript
// 1. Décoder sans vérifier pour lire kv
const unverifiedPayload = jwt.decode(token) as { kv?: string } | null;
const keyVersion = unverifiedPayload?.kv;

// 2. Résoudre la clé
if (keyVersion && jwtKeyManager.hasVersion(keyVersion)) {
  jwtSecret = jwtKeyManager.getKeyByVersion(keyVersion)!;
} else {
  jwtSecret = process.env.JWT_SECRET!; // fallback tokens anciens
}

// 3. Vérifier avec la bonne clé
const decoded = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
```

## Procédure de rotation de clé

```
1. Générer une nouvelle clé : jwtKeyManager.generateNewKey()
2. Ajouter JWT_SECRET_V{n} aux variables d'environnement
3. Redémarrer le serveur
4. Les nouveaux tokens seront signés avec la nouvelle version
5. Les anciens tokens V{n-1} restent valides jusqu'à leur expiration
6. Après expiration de tous les anciens tokens, JWT_SECRET_V{n-1} peut être supprimé
```

## Variables d'environnement

| Variable                           | Description                              |
| ---------------------------------- | ---------------------------------------- |
| `JWT_SECRET`                       | Clé principale (version 1) — obligatoire |
| `JWT_SECRET_V2`                    | Clé version 2 (optionnel)                |
| `JWT_SECRET_V3` … `JWT_SECRET_V10` | Clés versionnées (optionnel)             |
