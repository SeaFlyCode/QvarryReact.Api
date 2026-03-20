# 🚀 GUIDE RAPIDE : TEST DES NOTIFICATIONS PUSH

## 📋 Prérequis

Avant de tester sur ton iPhone physique :

### 1. Vérifier la Configuration Backend ✓

```bash
# Le backend est déjà configuré et tourne
npm run test:push:check
```

**Ce qui sera vérifié** :

- ✓ Firebase Service Account présent
- ✓ Project ID : `qvarry-bbf06`
- ✓ Client Email configuré

---

### 2. Configurer APNs dans Firebase Console ⚠️

**⚠️ CRITIQUE : Sans ça, AUCUNE notification iOS ne fonctionnera**

#### Étapes :

1. **Aller sur** : https://console.firebase.google.com
2. **Sélectionner** : Projet `qvarry-bbf06`
3. **Menu** : Paramètres du projet (⚙️) → Cloud Messaging
4. **Section** : Apple app configuration

#### Options APNs (choisir UNE des deux) :

**Option A : APNs Authentication Key (.p8) - RECOMMANDÉ**

- Aller sur Apple Developer : https://developer.apple.com/account/resources/authkeys/list
- Créer une clé APNs
- Télécharger le fichier `.p8`
- Dans Firebase Console : Upload la clé + saisir Team ID + Key ID

**Option B : APNs Certificate (.p12)**

- Générer un certificat via Keychain Access
- Exporter en `.p12`
- Upload dans Firebase Console

#### Vérification :

Dans Firebase Console, tu dois voir :

```
✅ APNs certificate/key uploaded
✅ Bundle ID: fr.qvarry.app
```

---

### 3. Préparer l'App Mobile iOS

#### 3.1 Vérifier les Capabilities dans Xcode

**Fichier** : `Qvarry.xcodeproj` → Signing & Capabilities

- [ ] **Push Notifications** activé
- [ ] **Background Modes** → ☑️ Remote notifications

#### 3.2 Vérifier `Info.plist`

```xml
<key>UIBackgroundModes</key>
<array>
    <string>remote-notification</string>
</array>
```

#### 3.3 Vérifier le Handler de Notifications

**Fichier** : `AppDelegate.swift` ou équivalent

```swift
// Handler foreground
messaging.onMessage { notification in
    print("📱 Notification reçue en foreground:", notification)
    // Afficher notification locale
}

// Handler background
messaging.onBackgroundMessage { notification in
    print("📱 Notification reçue en background:", notification)
}
```

---

## 🧪 TEST SUR APPAREIL PHYSIQUE

### Étape 1 : Lister les Tokens FCM Enregistrés

```bash
npm run test:push:list
```

**Output attendu** :

```
📱 Tokens FCM enregistrés :

✅ 2 token(s) trouvé(s) :

┌─ Token ID: 65f1a2b3c4d5e6789012345a
│  User ID: 65e1b2c3d4e5f67890123456
│  Device ID: 8FE271D3-0484-4F88-8DA1-62E611AAC920
│  Platform: IOS
│  Token: eA6OgP5HpkZwnrDiZgm3...
│  Created: 2026-03-20T09:00:00.000Z
│  Updated: 2026-03-20T09:30:00.000Z
└─────────────────────────────────────────────────────────
```

**Si aucun token** :

1. Lancer l'app Qvarry sur ton iPhone
2. Te connecter avec ton compte
3. Attendre quelques secondes (token auto-enregistré)
4. Relancer `npm run test:push:list`

---

### Étape 2 : Envoyer une Notification Test

#### Mode Interactif (Recommandé) :

```bash
npm run test:push
```

Puis choisir :

```
3. Envoyer une notification de test
User ID (ObjectId MongoDB) : 65e1b2c3d4e5f67890123456
```

#### Mode Ligne de Commande :

```bash
npm run test:push send 65e1b2c3d4e5f67890123456
```

**Output attendu** :

```
🚀 Envoi de la notification de test...

📋 Paramètres :
  - User ID : 65e1b2c3d4e5f67890123456
  - Titre : 🔔 Test Notification
  - Corps : Ceci est une notification de test envoyée depuis le script
  - Data : { type: 'test', timestamp: '...', source: 'test-script' }

✅ Résultat :
  - Envoyé : ✅ OUI
  - Méthode : FCM

🎉 Notification envoyée avec succès !

💡 Vérifiez votre appareil mobile pour voir la notification.
```

---

### Étape 3 : Vérifier Réception sur iPhone

#### Test 1 : App en Foreground (Ouverte)

1. **Ouvrir** l'app Qvarry sur ton iPhone
2. **Envoyer** une notification depuis le backend (étape 2)
3. **Observer** : Notification apparaît dans l'app (via handler `onMessage`)

**Attendu** :

- Notification affichée dans l'interface de l'app
- Pas de bannière système (app déjà ouverte)

---

#### Test 2 : App en Background

1. **Appuyer** sur le bouton Home (app en arrière-plan)
2. **Envoyer** une notification depuis le backend
3. **Observer** : Bannière iOS apparaît en haut de l'écran

**Attendu** :

- 🔔 Bannière système iOS
- Son de notification
- Badge sur l'icône (si configuré)

---

#### Test 3 : App Killed (Force Quit)

1. **Swipe up** l'app dans le multitâche (force quit)
2. **Envoyer** une notification depuis le backend
3. **Observer** : Bannière iOS apparaît

**Attendu** :

- 🔔 Bannière système iOS même app fermée
- Tap sur la bannière → app se relance

---

## 🐛 TROUBLESHOOTING

### ❌ Aucun Token Trouvé en Base

**Symptôme** :

```
❌ Aucun token FCM trouvé en base de données
```

**Solutions** :

1. Vérifier que l'app est bien connectée au backend `http://localhost:3000`
2. Se connecter avec un compte dans l'app
3. Vérifier les logs de l'app : `[Push] Token FCM enregistré`
4. Vérifier l'endpoint `/api/mobile/push-tokens` (doit retourner 200)

---

### ❌ Notification Non Envoyée (sent: false)

**Symptôme** :

```
✅ Résultat :
  - Envoyé : ❌ NON
  - Méthode : DB_ONLY
  - Erreur : FCM not configured
```

**Solutions** :

1. **Vérifier Firebase** : `npm run test:push:check`
   - S'assurer que Firebase est bien initialisé
2. **Vérifier logs backend** au démarrage :
   ```bash
   grep -i "firebase" logs/server.log
   ```

   - Doit contenir : `Firebase Admin SDK initialisé via FIREBASE_SERVICE_ACCOUNT`
3. **Redémarrer le backend** :
   ```bash
   npm run dev
   ```

---

### ❌ Notification Envoyée mais Pas Reçue sur iPhone

**Symptôme** :

```
✅ Notification envoyée avec succès !
```

Mais rien n'apparaît sur l'iPhone.

**Solutions** :

#### 1. Vérifier APNs dans Firebase Console

**⚠️ CAUSE #1 LA PLUS FRÉQUENTE**

- Aller sur Firebase Console → Cloud Messaging
- Vérifier qu'un certificat/clé APNs est bien uploadé
- Vérifier que le Bundle ID correspond : `fr.qvarry.app`

#### 2. Vérifier les Permissions iOS

- Réglages → Qvarry → Notifications
- S'assurer que les notifications sont **ACTIVÉES**
- Vérifier Bannières, Sons, Badge

#### 3. Vérifier le Token FCM

```bash
# Lister les tokens
npm run test:push:list

# Vérifier que le token affiché correspond au deviceId de ton iPhone
# Device ID visible dans l'app (section debug ou logs)
```

#### 4. Test avec Firebase Console Directement

- Firebase Console → Cloud Messaging → Send test message
- Coller le token FCM de l'iPhone
- Envoyer
- **Si ça ne marche pas non plus** → Problème APNs ou token invalide

#### 5. Vérifier les Logs FCM dans Firebase Console

- Firebase Console → Cloud Messaging → Reports
- Regarder les erreurs d'envoi
- Chercher les codes d'erreur :
  - `messaging/invalid-registration-token` → Token expiré/invalide
  - `messaging/registration-token-not-registered` → Token non enregistré APNs
  - `messaging/third-party-auth-error` → Certificat APNs invalide

---

### ❌ Simulateur iOS : "Aucune Notification Reçue"

**Symptôme** :
L'app tourne sur le simulateur iOS, mais aucune notification n'apparaît.

**Explication** :
🚫 **Les simulateurs iOS NE SUPPORTENT PAS les notifications push APNs**

**Solution** :
✅ **Utiliser un appareil physique (iPhone) obligatoirement**

---

## 📊 CHECKLIST FINALE AVANT TEST

Avant de tester sur ton iPhone, vérifie :

- [ ] **Backend** : `npm run test:push:check` → ✅ Firebase configuré
- [ ] **APNs** : Firebase Console → Certificat/clé uploadé
- [ ] **App iOS** : Capabilities Push Notifications activées
- [ ] **Permissions** : Notifications autorisées dans Réglages iOS
- [ ] **Token** : `npm run test:push:list` → Au moins 1 token iOS visible
- [ ] **Appareil** : iPhone physique (PAS simulateur)

---

## 🎯 COMMANDES UTILES

```bash
# Vérifier config Firebase
npm run test:push:check

# Lister les tokens FCM enregistrés
npm run test:push:list

# Mode interactif (menu)
npm run test:push

# Envoyer une notification directement
npm run test:push send <userId>

# Health check du backend
npm run health
```

---

## 📖 DOCUMENTATION COMPLÈTE

Pour plus de détails, consulter :

- `AUDIT_NOTIFICATIONS_PUSH.md` → Audit complet du backend
- `docs/api/06_services/push-notifications.md` → Documentation API

---

**Prêt pour les tests ?** 🚀  
Lance `npm run test:push` et suis les étapes !

---

**Note** : Si tu rencontres un problème non listé ici, vérifie :

1. Les logs du backend : `tail -f logs/server.log`
2. Les logs de l'app iOS dans Xcode
3. Firebase Console → Cloud Messaging → Reports
