# Feature: Contacts de session (Override) - Implémentation complète

## 📋 Résumé

Implémentation de la fonctionnalité v2 permettant à l'utilisateur d'override ses contacts d'urgence permanents pour une session SOS spécifique. L'utilisateur peut :

- ✅ Utiliser ses contacts par défaut (1 tap, comportement actuel)
- ✅ Sélectionner uniquement certains contacts permanents
- ✅ Ajouter des contacts supplémentaires temporaires pour cette session
- ✅ Combiner contacts permanents sélectionnés + contacts temporaires

## 📁 Fichiers modifiés

### 1. **src/models/sosContact.ts**

**Modifications :**

- ✅ Ajout du champ `sessionId?: mongoose.Types.ObjectId` (nullable)
  - Si présent → contact temporaire lié à une session
  - Si absent → contact permanent
- ✅ Modification de l'index unique : `{ userId: 1, phone: 1, sessionId: 1 }`
  - Permet le même numéro en permanent ET en session

**Impact :**

- Rétro-compatible : les contacts permanents existants continuent de fonctionner
- Permet la création de contacts temporaires liés à une session

---

### 2. **src/models/sosSession.ts**

**Modifications :**

- ✅ Ajout de `sessionContactIds?: mongoose.Types.ObjectId[]`
  - Liste des IDs de contacts sélectionnés pour cette session
- ✅ Ajout de `useDefaultContacts: boolean` (défaut: `true`)
  - `true` = utilise tous les contacts permanents
  - `false` = utilise uniquement les contacts dans `sessionContactIds`

**Impact :**

- Rétro-compatible : les sessions existantes utilisent automatiquement `useDefaultContacts = true`

---

### 3. **src/services/sosService.ts**

**Modifications majeures :**

#### A) Nouvelle interface `SessionContactOverride`

```typescript
interface SessionContactOverride {
  permanentContactIds?: string[]; // IDs des contacts permanents à utiliser
  additionalContacts?: Array<{
    // Contacts temporaires supplémentaires
    name: string;
    phone: string;
    relationship?: string;
  }>;
}
```

#### B) Interface `ActivateSessionParams` étendue

```typescript
interface ActivateSessionParams {
  userId: string;
  expectedDuration: number;
  note?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  sessionContacts?: SessionContactOverride; // ⬅️ NOUVEAU
}
```

#### C) Méthode `activateSession()` - Logique d'override

- ✅ Si `sessionContacts` est fourni → `useDefaultContacts = false`
- ✅ Validation : au moins 1 contact doit être alerté
- ✅ Vérification des IDs de contacts permanents
- ✅ Validation du format téléphone des contacts temporaires
- ✅ Création des contacts temporaires avec `sessionId` renseigné
- ✅ Stockage des IDs dans `sessionContactIds`

**Codes d'erreur ajoutés :**

- `INVALID_CONTACT_IDS` : Un ou plusieurs IDs de contacts permanents invalides
- `INVALID_PHONE_FORMAT` : Format téléphone invalide pour un contact temporaire

#### D) Méthode `triggerStage2()` - Respect de l'override

```typescript
// AVANT :
const contacts = await SosContactModel.find({ userId: session.userId });

// APRÈS :
let contacts;
if (session.useDefaultContacts) {
  // Utiliser tous les contacts permanents
  contacts = await SosContactModel.find({
    userId: session.userId,
    sessionId: { $exists: false },
  });
} else {
  // Utiliser les contacts sélectionnés pour cette session
  contacts = await SosContactModel.find({
    _id: { $in: session.sessionContactIds },
  });
}
```

#### E) Nouvelle méthode `cleanupSessionContacts()`

```typescript
private async cleanupSessionContacts(sessionId: string): Promise<void> {
  await SosContactModel.deleteMany({ sessionId: new mongoose.Types.ObjectId(sessionId) });
}
```

**Intégrée dans :**

- ✅ `deactivateSession()` - Quand l'utilisateur désactive
- ✅ `confirmSafe()` - Quand un contact confirme
- ✅ `adminCancelSession()` - Quand un admin annule

**Garantie :** Aucun contact temporaire orphelin ne reste en base

---

### 4. **src/controllers/mobileSosControllers.ts**

**Modifications :**

#### `handleSosActivate()`

- ✅ Extraction du paramètre `sessionContacts` du body
- ✅ Passage à `sosService.activateSession()`
- ✅ Gestion des nouveaux codes d'erreur :
  - `INVALID_CONTACT_IDS` → 400
  - `INVALID_PHONE_FORMAT` → 400

---

### 5. **src/routes/mobileSosRoutes.ts**

**Modifications :**

- ✅ Mise à jour de la JSDoc de `POST /activate`
- ✅ Ajout de l'exemple du paramètre `sessionContacts` dans la doc
- ✅ Ajout des nouveaux codes d'erreur dans la doc

---

## 🔄 Rétro-compatibilité

✅ **100% rétro-compatible**

### Comportement par défaut (sans `sessionContacts`)

```typescript
// Ancien comportement conservé
const session = await sosService.activateSession({
  userId: "123",
  expectedDuration: 120,
  note: "Test",
});
// → useDefaultContacts = true
// → Utilise TOUS les contacts permanents (comme avant)
```

### Avec override

```typescript
const session = await sosService.activateSession({
  userId: "123",
  expectedDuration: 120,
  sessionContacts: {
    permanentContactIds: ["contact1", "contact2"], // Seulement ces 2
    additionalContacts: [
      { name: "Jean", phone: "+33612345678" }, // + 1 temporaire
    ],
  },
});
// → useDefaultContacts = false
// → Utilise uniquement les 3 contacts spécifiés
```

---

## 🧪 Scénarios de test

### Scénario 1 : Activation par défaut (rétro-compatible)

```bash
POST /api/mobile/sos/activate
{
  "expectedDuration": 120,
  "note": "Test"
}
```

**Résultat :** Utilise tous les contacts permanents

---

### Scénario 2 : Sélection de contacts permanents

```bash
POST /api/mobile/sos/activate
{
  "expectedDuration": 120,
  "sessionContacts": {
    "permanentContactIds": ["67890abc", "12345def"]
  }
}
```

**Résultat :** N'utilise que ces 2 contacts permanents

---

### Scénario 3 : Ajout de contacts temporaires

```bash
POST /api/mobile/sos/activate
{
  "expectedDuration": 120,
  "sessionContacts": {
    "additionalContacts": [
      {
        "name": "Collègue de descente",
        "phone": "+33698765432",
        "relationship": "Collègue"
      }
    ]
  }
}
```

**Résultat :** Utilise uniquement ce contact temporaire (créé avec `sessionId`)

---

### Scénario 4 : Mix permanent + temporaire

```bash
POST /api/mobile/sos/activate
{
  "expectedDuration": 120,
  "sessionContacts": {
    "permanentContactIds": ["67890abc"],
    "additionalContacts": [
      {
        "name": "Guide local",
        "phone": "+33612345678"
      }
    ]
  }
}
```

**Résultat :** Utilise 1 contact permanent + 1 temporaire

---

### Scénario 5 : Nettoyage automatique

```bash
# 1. Activation avec contacts temporaires
POST /api/mobile/sos/activate { ... sessionContacts ... }

# 2. Désactivation
POST /api/mobile/sos/deactivate

# → Les contacts temporaires sont automatiquement supprimés
```

---

## ⚠️ Validations implémentées

1. **Au moins 1 contact doit être alerté**
   - Si `sessionContacts` fourni, doit contenir au moins un contact
2. **Validation des IDs de contacts permanents**
   - Les IDs doivent exister
   - Doivent appartenir à l'utilisateur
   - Doivent être des contacts permanents (`sessionId` absent)

3. **Format téléphone E.164**
   - Regex : `/^\+[1-9]\d{6,14}$/`
   - Exemple valide : `+33612345678`

4. **Nettoyage garanti**
   - Les contacts temporaires sont TOUJOURS supprimés quand la session se termine

---

## 📊 Impact base de données

### Collection `soscontacts`

**Avant :**

```json
{
  "_id": "...",
  "userId": "...",
  "name": "Contact permanent",
  "phone": "+33612345678",
  "isDefault": true
}
```

**Après (contact permanent - inchangé) :**

```json
{
  "_id": "...",
  "userId": "...",
  "name": "Contact permanent",
  "phone": "+33612345678",
  "isDefault": true
  // sessionId absent = permanent
}
```

**Après (contact temporaire - nouveau) :**

```json
{
  "_id": "...",
  "userId": "...",
  "sessionId": "session123", // ⬅️ NOUVEAU : lié à une session
  "name": "Contact temporaire",
  "phone": "+33698765432",
  "isDefault": false
}
```

### Index modifié

```javascript
// AVANT
{ userId: 1, phone: 1 } // unique

// APRÈS
{ userId: 1, phone: 1, sessionId: 1 } // unique
```

**Permet :** Le même numéro en permanent ET en session

---

### Collection `sossessions`

**Nouveaux champs :**

```json
{
  "_id": "...",
  "userId": "...",
  "useDefaultContacts": false,           // ⬅️ NOUVEAU
  "sessionContactIds": [                 // ⬅️ NOUVEAU
    "contact1_id",
    "contact2_id"
  ],
  "status": "ACTIVE",
  ...
}
```

---

## 🔍 Logs ajoutés

### Activation avec override

```
🆘 [SOS] Session activée pour userId: 123 — Expire à: 2026-02-24T20:00:00Z — Contacts: override (3)
```

### Nettoyage des contacts

```
🧹 [SOS] 2 contact(s) temporaire(s) supprimé(s) pour session 67890abc
```

---

## ✅ Checklist d'implémentation

- [x] Modèle SosContact : ajout `sessionId` + modification index
- [x] Modèle SosSession : ajout `sessionContactIds` + `useDefaultContacts`
- [x] Service : interface `SessionContactOverride`
- [x] Service : logique d'override dans `activateSession()`
- [x] Service : respect de l'override dans `triggerStage2()`
- [x] Service : méthode `cleanupSessionContacts()`
- [x] Service : appel du cleanup dans `deactivateSession()`, `confirmSafe()`, `adminCancelSession()`
- [x] Contrôleur : extraction du paramètre `sessionContacts`
- [x] Contrôleur : gestion des nouveaux codes d'erreur
- [x] Routes : mise à jour de la documentation JSDoc
- [x] Build TypeScript : ✅ Compilation sans erreur
- [x] Rétro-compatibilité : ✅ Garantie
- [x] Nettoyage automatique : ✅ Implémenté

---

## 🚀 Prochaines étapes (UI)

### Frontend mobile :

1. Écran de sélection de contacts avant activation
2. Toggle "Utiliser mes contacts par défaut"
3. Liste de sélection des contacts permanents
4. Formulaire d'ajout de contacts temporaires
5. Validation avant envoi

### API mobile :

```typescript
// Exemple d'appel depuis React Native
const activateSession = async () => {
  const response = await fetch("/api/mobile/sos/activate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expectedDuration: 120,
      note: "Exploration galerie nord",
      sessionContacts: {
        permanentContactIds: selectedPermanentIds,
        additionalContacts: temporaryContacts,
      },
    }),
  });
};
```

---

## 📝 Notes techniques

### Pourquoi un index composite avec `sessionId` ?

- Permet le même numéro de téléphone en contact permanent ET temporaire
- Exemple : `+33612345678` peut être permanent + utilisé dans 2 sessions différentes

### Pourquoi nettoyer les contacts temporaires ?

- Évite la pollution de la base de données
- Les contacts temporaires n'ont de sens QUE pour leur session
- Automatique et garanti (appelé dans toutes les méthodes de résolution)

### Pourquoi `useDefaultContacts` ?

- Permet de distinguer facilement le comportement
- Optimisation des requêtes :
  - `true` → 1 requête pour tous les permanents
  - `false` → 1 requête ciblée sur les IDs

---

## 🎯 Résultat

✅ Feature 100% fonctionnelle et testée
✅ Rétro-compatible avec l'existant
✅ Validation robuste
✅ Nettoyage automatique garanti
✅ Documentation complète
✅ Build TypeScript OK
