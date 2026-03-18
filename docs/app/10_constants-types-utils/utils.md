# Utilitaires — Application Mobile Qvarry

## Vue d'ensemble

Tous les utilitaires sont dans `src/utils/`. Ils fournissent des fonctions pures, des helpers métier et des services transversaux (logger, événements, validation) utilisés dans l'ensemble de l'application.

---

## `conversationUtils.ts` — Utilitaires de messagerie

### `getDisplayName(participant: ContactInfo): string`

Retourne le nom à afficher pour un participant, en respectant ses préférences de confidentialité.

**Priorité** :
1. `pseudo` si `showPseudo === true`
2. `name` (prénom)
3. `surname` (nom de famille)
4. `'Inconnu'` en dernier recours

```typescript
// Exemples
getDisplayName({ name: 'Jean', surname: 'Dupont', showPseudo: false })
// → "Jean"

getDisplayName({ name: 'Jean', surname: 'Dupont', pseudo: 'speleoJD', showPseudo: true })
// → "speleoJD"

getDisplayName({})
// → "Inconnu"
```

### `getInitials(name: string): string`

Génère les initiales à afficher dans un avatar.

- **1 mot** → première lettre uniquement
- **2 mots ou plus** → première lettre du premier mot + première lettre du dernier mot

```typescript
getInitials('Jean')         // → "J"
getInitials('Jean Dupont')  // → "JD"
getInitials('Marie Anne Durand') // → "MD"
```

### `isSameDay(date1: Date | string, date2: Date | string): boolean`

Compare deux dates sur la même journée calendaire (ignore l'heure).

```typescript
isSameDay('2024-01-15T10:00:00Z', '2024-01-15T22:00:00Z') // → true
isSameDay('2024-01-15T23:59:00Z', '2024-01-16T00:01:00Z') // → false
```

### `getConversationListItems(conversations, currentUserId): ConversationListItem[]`

Transforme la liste brute des conversations en `ConversationListItem[]` enrichis pour l'affichage.

**Enrichissements appliqués** :
- Calcule `displayName` : nom du groupe ou nom du contact (via `getDisplayName`)
- Calcule `avatarInitials` : via `getInitials`
- Filtre les conversations supprimées par l'utilisateur courant

```typescript
const items = getConversationListItems(conversations, userId);
// items[0].displayName    → "speleoJD"
// items[0].avatarInitials → "SJ"
```

### `formatConversationDate(date: Date | string): string`

Formate la date du dernier message dans la liste des conversations.

| Contexte | Résultat |
|---|---|
| Aujourd'hui | `"14:30"` |
| Hier | `"Hier"` |
| Cette semaine (< 7 jours) | `"lun."`, `"mar."`, … |
| Antérieur | `"14/01"` |

### `formatMessageTime(date: Date | string): string`

Formate l'heure d'un message individuel.

```typescript
formatMessageTime('2024-01-15T14:30:00Z') // → "14:30"
```

### `formatDateSeparator(date: Date | string): string`

Formate le séparateur de date affiché entre les groupes de messages.

| Contexte | Résultat |
|---|---|
| Aujourd'hui | `"Aujourd'hui"` |
| Hier | `"Hier"` |
| Autre | `"lundi 14 janvier"` |

---

## `events.ts` — AppEvents

Singleton d'événements cross-composant, permettant la communication entre des composants sans relation parent/enfant directe, sans passer par un contexte React.

### Interface

```typescript
AppEvents.on(event: string, callback: Function): () => void
AppEvents.off(event: string, callback: Function): void
AppEvents.emit(event: string, ...args: unknown[]): void
```

### `AppEvents.on(event, callback)`

Abonne une fonction à un événement. **Retourne une fonction de cleanup** à appeler dans `useEffect` pour éviter les fuites mémoire.

### `AppEvents.off(event, callback)`

Désabonne une fonction d'un événement.

### `AppEvents.emit(event, ...args)`

Émet un événement avec des arguments optionnels vers tous les abonnés.

### Exemple d'utilisation

```typescript
import { AppEvents } from '@/utils/events';

// Composant A — émetteur
const handleFicheCreated = (fiche: Fiche) => {
  AppEvents.emit('fiche:created', fiche);
};

// Composant B — récepteur (useEffect)
useEffect(() => {
  const cleanup = AppEvents.on('fiche:created', (fiche: Fiche) => {
    // Mettre à jour l'affichage
    refreshList();
  });
  return cleanup; // appelé au démontage
}, []);
```

**Cas d'usage typiques** :
- Rafraîchissement d'une liste après création depuis un écran différent
- Notification d'un changement de thème
- Signalement d'une synchronisation terminée

---

## `logger.ts` — Logger

Logger structuré préfixé par module, silencieux en production pour les niveaux debug/info.

### `createLogger(module: string): Logger`

Crée une instance de logger préfixée `[module]`.

```typescript
const logger = createLogger('MapScreen');

logger.debug('Chargement des tuiles', { zoom: 12 });
// [MapScreen] Chargement des tuiles { zoom: 12 }

logger.info('Carte initialisée');
// [MapScreen] Carte initialisée

logger.warn('Quota de tuiles approché');
// [MapScreen] Quota de tuiles approché

logger.error('Erreur de chargement', error);
// [MapScreen] Erreur de chargement Error: ...
```

### Interface `Logger`

| Méthode | Actif en | Canal |
|---|---|---|
| `debug(...args)` | `__DEV__` uniquement | `console.log` |
| `info(...args)` | `__DEV__` uniquement | `console.log` |
| `warn(...args)` | Toujours | `console.warn` |
| `error(...args)` | Toujours | `console.error` |

### Instance par défaut

```typescript
// Instance globale prête à l'emploi
export const logger = createLogger('App');
```

### Exemple d'intégration dans un service

```typescript
import { createLogger } from '@/utils/logger';

const logger = createLogger('SosService');

export const activateSos = async (payload: SosActivatePayload) => {
  logger.info('Activation SOS', { duration: payload.expectedDuration });
  try {
    const result = await api.post('/sos/activate', payload);
    logger.debug('Session créée', result.session.id);
    return result;
  } catch (error) {
    logger.error('Échec activation SOS', error);
    throw error;
  }
};
```

---

## `sos.ts` — Utilitaires SOS

Fonctions utilitaires légères pour l'affichage des données SOS.

### `getStageColor(stage: SosStage): string`

Retourne la couleur sémantique associée à un stade SOS.

| Stade | Valeur | Couleur |
|---|---|---|
| `-1` | Inactif | Gris (`grey`) |
| `0` | Actif | Vert (`success`) |
| `1` | Alerte | Orange (`warning`) |
| `2` | Urgence | Rouge (`danger`) |

```typescript
getStageColor(0)  // → couleur success
getStageColor(2)  // → couleur danger
getStageColor(-1) // → couleur grey
```

### `getStageLabel(stage: SosStage): string`

Retourne le label FR du stade en déléguant à `SOS_STAGE_LABELS`.

```typescript
getStageLabel(0)  // → "Actif"
getStageLabel(1)  // → "Alerte"
getStageLabel(2)  // → "Urgence"
getStageLabel(-1) // → "Inactif"
```

### `formatSosDuration(minutes: number): string`

Formate une durée en minutes pour l'affichage utilisateur.

| Entrée | Résultat |
|---|---|
| `30` | `"30min"` |
| `60` | `"1h"` |
| `120` | `"2h"` |
| `150` | `"2h30"` |
| `480` | `"8h"` |

```typescript
formatSosDuration(45)  // → "45min"
formatSosDuration(90)  // → "1h30"
formatSosDuration(240) // → "4h"
```

---

## `validation.ts` — Validation de formulaires

### `ValidationResult`

```typescript
interface ValidationResult {
  isValid: boolean;
  errors: string[];
}
```

### `sanitizeInput(input: string): string`

Nettoie une saisie utilisateur avant utilisation. Supprime les caractères `< > ' "` et applique un `trim()`.

```typescript
sanitizeInput('  Jean <script>  ') // → "Jean script"
```

### `validateEmail(email: string): ValidationResult`

Valide un email selon la RFC 5321.

**Règles** :
- Format regex `user@domain.tld`
- Longueur maximale : 254 caractères

```typescript
validateEmail('test@qvarry.fr')    // → { isValid: true, errors: [] }
validateEmail('pas-un-email')      // → { isValid: false, errors: ['Email invalide'] }
```

### `validatePassword(password: string): ValidationResult`

Validation simple (connexion).

**Règles** :
- Minimum : 8 caractères
- Maximum : 128 caractères

### `validateRegistrationPassword(password: string): ValidationResult`

Validation renforcée (inscription).

**Règles** :
- Minimum 8 caractères, maximum 128 caractères
- Au moins une **majuscule**
- Au moins une **minuscule**
- Au moins un **chiffre**
- Au moins un **caractère spécial** (`!@#$%^&*…`)

```typescript
validateRegistrationPassword('Qvarry1!')
// → { isValid: true, errors: [] }

validateRegistrationPassword('password')
// → { isValid: false, errors: ['Le mot de passe doit contenir une majuscule', ...] }
```

### `validateName(name: string, fieldLabel?: string): ValidationResult`

Valide un prénom ou un nom de famille.

**Règles** :
- Longueur maximale : 50 caractères
- Caractères autorisés : lettres (y compris accents), espaces, tirets, apostrophes — regex `[a-zA-ZÀ-ÿ\s\-']`
- Pas de caractères dangereux (`<>'"`)

```typescript
validateName('Jean-Pierre')        // → { isValid: true, errors: [] }
validateName('A'.repeat(51))       // → { isValid: false, errors: ['Prénom trop long'] }
validateName('<script>', 'Prénom') // → { isValid: false, errors: ['Prénom invalide'] }
```

### `validateLoginForm(email, password): ValidationResult`

Combine `validateEmail` + `validatePassword`. Agrège toutes les erreurs.

```typescript
validateLoginForm('test@qvarry.fr', 'monMotDePasse')
// → { isValid: true, errors: [] }
```

### `validateRegistrationForm({ firstName, lastName, email, password }): ValidationResult`

Combine `validateName` (×2) + `validateEmail` + `validateRegistrationPassword`. Agrège toutes les erreurs.

```typescript
validateRegistrationForm({
  firstName: 'Jean',
  lastName:  'Dupont',
  email:     'jean@qvarry.fr',
  password:  'Secure1!',
})
// → { isValid: true, errors: [] }
```

---

## `lucideIcons.ts` — Icônes Lucide pour la carte

Fournit les SVG internes des icônes Lucide pour le rendu dans la **WebView Leaflet**. Ces icônes sont utilisées comme marqueurs personnalisés sur la carte, là où les composants React Native ne sont pas accessibles.

### `LUCIDE_ICONS`

Mapping nom d'icône → chemin SVG interne (attribut `d` du `<path>`).

| Icône | Usage typique |
|---|---|
| `MapPin` | Marqueur standard |
| `Mountain` | Site montagneux |
| `Compass` | Navigation |
| `Map` | Vue carte |
| `Navigation` | Direction |
| `Target` | Point cible |
| `Flag` | Drapeau / repère |
| `Star` | Favori |
| `Heart` | Aimé |
| `Bookmark` | Sauvegardé |
| `Eye` | Visible |
| `Camera` | Photo |
| `Search` | Recherche |
| `Globe` | Mondial |

### `DEFAULT_ICON`

```typescript
export const DEFAULT_ICON = 'MapPin';
```

Icône utilisée lorsqu'aucune icône spécifique n'est configurée pour un marqueur.

### `getLucideSvgPath(iconName: string): string | null`

Retourne le chemin SVG interne de l'icône ou `null` si elle n'est pas disponible.

```typescript
getLucideSvgPath('MapPin')    // → "M12 2C8.13 2 5 5.13 5 9c0 5.25..."
getLucideSvgPath('Undefined') // → null
```

### `AVAILABLE_ICONS`

Liste des noms d'icônes disponibles. Utile pour construire un sélecteur d'icône dans l'UI.

```typescript
export const AVAILABLE_ICONS: string[] = Object.keys(LUCIDE_ICONS);
// → ['MapPin', 'Mountain', 'Compass', ...]
```

### Exemple d'utilisation dans la WebView

```typescript
import { getLucideSvgPath, DEFAULT_ICON } from '@/utils/lucideIcons';

// Construction du marqueur SVG pour Leaflet
const buildMarkerHtml = (iconName: string, color: string): string => {
  const svgPath = getLucideSvgPath(iconName) ?? getLucideSvgPath(DEFAULT_ICON);
  return `
    <svg viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg">
      <path d="${svgPath}" />
    </svg>
  `;
};
```
