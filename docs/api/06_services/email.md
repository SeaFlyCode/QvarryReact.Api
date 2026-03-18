# Service Email (Nodemailer)

## Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Configuration SMTP](#configuration-smtp)
- [Templates disponibles](#templates-disponibles)
- [Utilisation](#utilisation)
- [Détail des templates](#détail-des-templates)

---

## Vue d'ensemble

Le service email utilise **Nodemailer** pour l'envoi d'emails transactionnels. Il est configuré par défaut avec **Protonmail** comme fournisseur SMTP, mais peut être utilisé avec n'importe quel serveur SMTP compatible.

```
┌────────────────────────────────────────┐
│           emailService                 │
│                                        │
│  sendEmail(to, subject, template, vars)│
│           │                            │
│           ▼                            │
│  Charge template HTML                  │
│  Injecte variables (Handlebars-like)   │
│  Nodemailer → SMTP Server              │
└────────────────────────────────────────┘
               │
               ▼
     smtp.protonmail.ch:587
     (ou autre serveur SMTP)
```

---

## Configuration SMTP

### Variables d'environnement

| Variable      | Description           | Valeur par défaut    |
| ------------- | --------------------- | -------------------- |
| `SMTP_HOST`   | Serveur SMTP          | `smtp.protonmail.ch` |
| `SMTP_PORT`   | Port SMTP             | `587`                |
| `SMTP_SECURE` | TLS direct (port 465) | `false`              |
| `SMTP_USER`   | Identifiant SMTP      | —                    |
| `SMTP_PASS`   | Mot de passe SMTP     | —                    |
| `EMAIL_FROM`  | Adresse d'expédition  | `noreply@qvarry.com` |

### Exemple de configuration

```env
# Protonmail (défaut)
SMTP_HOST=smtp.protonmail.ch
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@qvarry.com
SMTP_PASS=votre_mot_de_passe_app
EMAIL_FROM="Qvarry <noreply@qvarry.com>"

# Gmail (alternative)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=votre@gmail.com
SMTP_PASS=votre_mot_de_passe_app

# Mailhog (développement local)
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
```

> ⚠️ En développement, utiliser **Mailhog** ou **Mailtrap** pour intercepter les emails sans les envoyer réellement.

---

## Templates disponibles

13 templates HTML sont disponibles dans `src/templates/emails/` :

| Fichier                         | Nom                   | Déclencheur                                   |
| ------------------------------- | --------------------- | --------------------------------------------- |
| `account-approved.html`         | Compte approuvé       | Admin approuve un compte en attente           |
| `account-rejected.html`         | Compte refusé         | Admin refuse un compte en attente             |
| `admin-pending-validation.html` | Alerte admin          | Nouvel utilisateur en attente de validation   |
| `base.html`                     | Template de base      | Utilisé comme layout par les autres templates |
| `contact-accepted.html`         | Contact accepté       | Une demande de contact a été acceptée         |
| `contact-request.html`          | Demande de contact    | Nouvelle demande de contact reçue             |
| `email-verification.html`       | Vérification email    | Inscription → vérifier l'adresse email        |
| `password-changed.html`         | Mot de passe changé   | Confirmation après changement de MDP          |
| `password-reset.html`           | Reset mot de passe    | Demande de réinitialisation                   |
| `security-alert-admin.html`     | Alerte sécurité admin | Événement sécurité critique détecté           |
| `security-alert-login.html`     | Alerte connexion      | Connexion depuis un nouvel appareil/lieu      |
| `share-notification.html`       | Partage de données    | Un contact a partagé des données              |
| `welcome.html`                  | Bienvenue             | Après vérification email réussie              |

---

## Utilisation

### Exemple d'envoi

```typescript
import { emailService } from "../services/emailService";

// Envoi d'un email de vérification
await emailService.send({
  to: "user@example.com",
  subject: "Vérifiez votre email",
  template: "email-verification",
  variables: {
    firstName: "Jean",
    verificationCode: "123456",
    verificationLink: "https://app.qvarry.com/verify?token=abc123",
    expiresIn: "24 heures",
  },
});

// Alerte admin nouveau compte
await emailService.send({
  to: process.env.ADMIN_EMAIL,
  subject: "Nouveau compte en attente de validation",
  template: "admin-pending-validation",
  variables: {
    userName: "Marie Martin",
    userEmail: "marie@example.com",
    registeredAt: new Date().toLocaleDateString("fr-FR"),
    adminUrl: "https://app.qvarry.com/admin/users",
  },
});
```

---

## Détail des templates

### account-approved.html

**Déclencheur** : Admin approuve un compte via le panel d'administration.

Variables injectées :
| Variable | Description |
|----------|-------------|
| `firstName` | Prénom de l'utilisateur |
| `loginUrl` | URL de connexion |

---

### account-rejected.html

**Déclencheur** : Admin refuse un compte via le panel d'administration.

Variables injectées :
| Variable | Description |
|----------|-------------|
| `firstName` | Prénom de l'utilisateur |
| `reason` | Raison du refus (optionnel) |
| `contactEmail` | Email de contact support |

---

### admin-pending-validation.html

**Déclencheur** : Nouvel utilisateur inscrit, en attente de validation admin.

Variables injectées :
| Variable | Description |
|----------|-------------|
| `userName` | Nom complet du nouvel utilisateur |
| `userEmail` | Email du nouvel utilisateur |
| `registeredAt` | Date d'inscription |
| `adminUrl` | URL du panel d'administration |

---

### email-verification.html

**Déclencheur** : Inscription (web et mobile) ou renvoi de l'email de vérification.

Variables injectées :
| Variable | Description |
|----------|-------------|
| `firstName` | Prénom de l'utilisateur |
| `verificationCode` | Code à 6 chiffres (mobile) |
| `verificationLink` | Lien cliquable (web) |
| `expiresIn` | Durée de validité (ex: "24 heures") |

---

### password-reset.html

**Déclencheur** : Demande de réinitialisation de mot de passe.

Variables injectées :
| Variable | Description |
|----------|-------------|
| `firstName` | Prénom de l'utilisateur |
| `resetLink` | Lien de réinitialisation (validité 1h) |
| `expiresIn` | Durée de validité |
| `ipAddress` | IP de la demande (sécurité) |

---

### password-changed.html

**Déclencheur** : Après changement de mot de passe réussi.

Variables injectées :
| Variable | Description |
|----------|-------------|
| `firstName` | Prénom de l'utilisateur |
| `changedAt` | Date/heure du changement |
| `ipAddress` | IP depuis laquelle le changement a été effectué |
| `supportEmail` | Email support si ce n'est pas l'utilisateur |

---

### security-alert-login.html

**Déclencheur** : Connexion depuis un appareil/lieu inhabituel, ou désactivation du 2FA.

Variables injectées :
| Variable | Description |
|----------|-------------|
| `firstName` | Prénom |
| `eventType` | Type d'événement (ex: "Nouvelle connexion") |
| `device` | Description de l'appareil |
| `location` | Localisation approximative |
| `ipAddress` | Adresse IP |
| `timestamp` | Horodatage |
| `supportEmail` | Email support |

---

### security-alert-admin.html

**Déclencheur** : Événements de sécurité critiques (tentative PRIVILEGE_ESCALATION_ATTEMPT, BLOCKED_DEVICE_ACCESS_ATTEMPT, etc.).

Variables injectées :
| Variable | Description |
|----------|-------------|
| `eventType` | Type d'événement audit |
| `level` | Niveau (warning/critical) |
| `userId` | ID utilisateur concerné |
| `ipAddress` | IP source |
| `details` | Détails JSON de l'événement |
| `timestamp` | Horodatage |
| `adminUrl` | Lien vers les logs d'audit admin |

---

### contact-request.html

**Déclencheur** : Réception d'une nouvelle demande de contact.

Variables injectées :
| Variable | Description |
|----------|-------------|
| `recipientName` | Prénom du destinataire |
| `senderName` | Nom de l'expéditeur de la demande |
| `acceptUrl` | URL d'acceptation directe |
| `profileUrl` | URL du profil de l'expéditeur |

---

### contact-accepted.html

**Déclencheur** : Une demande de contact a été acceptée.

Variables injectées :
| Variable | Description |
|----------|-------------|
| `firstName` | Prénom de l'utilisateur dont la demande a été acceptée |
| `contactName` | Nom du contact qui a accepté |
| `profileUrl` | URL du profil du contact |

---

### share-notification.html

**Déclencheur** : Un contact partage des données (fiches, points, etc.).

Variables injectées :
| Variable | Description |
|----------|-------------|
| `recipientName` | Prénom du destinataire |
| `senderName` | Nom du contact partageant |
| `shareType` | Type de données partagées |
| `shareCount` | Nombre d'éléments partagés |
| `viewUrl` | URL pour voir les données partagées |
| `expiresAt` | Date d'expiration du partage |

---

### welcome.html

**Déclencheur** : Après vérification de l'email réussie.

Variables injectées :
| Variable | Description |
|----------|-------------|
| `firstName` | Prénom de l'utilisateur |
| `loginUrl` | URL de connexion |
| `docsUrl` | URL de la documentation |

---

_Voir aussi : [logger-service.md](logger-service.md)_
