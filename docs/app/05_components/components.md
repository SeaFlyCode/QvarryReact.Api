# Composants réutilisables — Application Mobile Qvarry

## Vue d'ensemble

Les composants réutilisables sont situés dans `src/components/`. Ils sont exportés depuis `src/components/index.ts` pour un import simplifié.

---

## Composants globaux (niveau App)

### `BiometricLockScreen`

**Fichier** : `src/components/BiometricLockScreen.tsx`

Écran de verrouillage biométrique affiché au premier plan quand `isLocked === true` dans `App.tsx`.

```typescript
<BiometricLockScreen onUnlock={() => setIsLocked(false)} />
```

**Fonctionnalités** :
- Fond flou (via `@react-native-community/blur`)
- Invitation à s'authentifier via Face ID / Touch ID / empreinte
- Fallback vers saisie du code PIN si la biométrie échoue

---

### `SplashLoader`

**Fichier** : `src/components/SplashLoader.tsx`

Écran de chargement stylisé affiché pendant les phases d'initialisation.

```typescript
<SplashLoader message="Connexion" />
<SplashLoader message="Autorisations" />
<SplashLoader message="Chargement" />
```

---

### `SessionExpiredModal`

**Fichier** : `src/components/SessionExpiredModal.tsx`

Modal affiché quand la session expire pendant l'utilisation.

```typescript
<SessionExpiredModal
  visible={showSessionExpiredModal}
  onReconnect={handleReconnect}   // Déconnexion → écran Login
  onContinue={dismissModal}        // Rester en mode dégradé
/>
```

---

### `MaintenanceModal`

**Fichier** : `src/components/MaintenanceModal.tsx`

Modal bloquant affiché quand le serveur est en mode maintenance (erreur 503).

```typescript
<MaintenanceModal
  visible={showMaintenanceModal}
  onRetry={handleRetry}      // Re-vérifie l'auth
  onContinue={dismissModal}  // Mode dégradé
/>
```

---

### `DegradedModeBanner`

**Fichier** : `src/components/DegradedModeBanner.tsx`

Bannière affichée en haut de l'écran quand `connectionMode === 'limited'`.

Informe l'utilisateur qu'il est en mode hors ligne / mode dégradé et que les modifications seront synchronisées à la reconnexion.

---

### `SosActiveBanner`

**Fichier** : `src/components/SosActiveBanner.tsx`

Bannière rouge permanente en haut de l'écran quand un SOS est actif. Priorité d'affichage maximale, au-dessus de la `DegradedModeBanner`.

---

### `InAppMessageToast`

**Fichier** : `src/components/InAppMessageToast.tsx`

Toast de notification pour les messages entrants reçus en temps réel via WebSocket, affiché quand l'utilisateur est sur un autre écran que le Chat.

**Fonctionnalités** :
- Aperçu du message (expéditeur, début du message)
- Tap → navigation vers la conversation
- Disparaît automatiquement après quelques secondes

---

### `OfflineDownloadWebView`

**Fichier** : `src/components/OfflineDownloadWebView.tsx`

WebView cachée (opacity 0) montée au niveau racine. Utilisée pour télécharger les tuiles de carte en arrière-plan en exploitant le cache HTTP de la WebView.

---

## Composants de liste et d'interaction

### `FicheCard`

**Fichier** : `src/components/FicheCard.tsx`

Carte d'affichage d'une fiche dans les listes. Affiche le titre, la description courte, les tags et la date.

---

### `SwipeableRow`

**Fichier** : `src/components/SwipeableRow.tsx`

Wrapper de swipe-to-action (suppression, archivage) basé sur `react-native-gesture-handler`.

```typescript
<SwipeableRow onDelete={() => deleteFiche(id)}>
  <FicheCard fiche={fiche} />
</SwipeableRow>
```

---

### `AnimatedHeader`

**Fichier** : `src/components/AnimatedHeader.tsx`

Header avec animation de scroll (disparaît / réapparaît selon la direction de scroll), basé sur Reanimated.

---

## Composants de formulaire

### `InputModal`

**Fichier** : `src/components/InputModal.tsx`

Modal avec un champ de saisie texte. Utilisé pour les opérations de renommage, saisie de code, etc.

```typescript
<InputModal
  visible={visible}
  title="Renommer la liste"
  placeholder="Nouveau nom"
  onConfirm={(value) => renameList(id, value)}
  onCancel={close}
/>
```

---

### `CustomAlert`

**Fichier** : `src/components/CustomAlert.tsx`

Système d'alertes personnalisées (remplace `Alert.alert` natif). Expose un hook `useAlert()` et un helper `AlertHelper`.

```typescript
const { showAlert, AlertComponent } = useAlert();

// Afficher une alerte
showAlert(AlertHelper.warning('Titre', 'Message'));
showAlert(AlertHelper.error('Erreur', 'Description'));
showAlert(AlertHelper.success('Succès', 'Opération réussie'));
```

`AlertComponent` doit être rendu à la racine du composant pour être visible par-dessus tout.

---

## Sous-dossiers de composants

### `components/fiches/`

Composants spécialisés pour le module Fiches (champs de formulaire spécifiques, rendus de contenu de fiche).

### `components/messaging/`

Composants spécialisés pour la messagerie (bulle de message, avatar, indicateur de frappe).

### `components/sos/`

Composants spécialisés pour le module SOS (bouton d'activation, indicateur d'état).

### `components/admin/`

Composants réservés à l'interface d'administration SOS.

### `components/animations/`

Composants d'animations réutilisables (fade in, slide, pulse).

---

## Composants Messaging (`components/messaging/`)

### `Avatar`

**Fichier** : `src/components/messaging/Avatar.tsx`

Affiche les initiales d'un contact dans un cercle coloré. La couleur est dérivée d'un hash du `name`. Supporte un indicateur de présence et un mode groupe.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `name` | `string` | — | Nom affiché en initiales |
| `size` | `'small' \| 'medium' \| 'large'` | `'medium'` | Taille du cercle |
| `isOnline` | `boolean` | `false` | Affiche un point vert en badge bas-droite |
| `isGroup` | `boolean` | `false` | Affiche une icône de groupe à la place des initiales |

**Tailles** :
- `small` → 28px
- `medium` → 40px
- `large` → 56px

```typescript
<Avatar name="Jean Dupont" size="large" isOnline />
<Avatar name="Équipe RH" isGroup size="medium" />
```

---

### `MessageBubble`

**Fichier** : `src/components/messaging/MessageBubble.tsx`

Bulle de message alignée à droite (`isOwn=true`) ou à gauche. Animée à l'entrée via `FadeInUp` (react-native-reanimated). Affiche l'heure et un indicateur de lecture pour les messages envoyés.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `message` | `Message` | — | Objet message à afficher |
| `isOwn` | `boolean` | — | `true` si le message appartient à l'utilisateur courant |
| `showReadReceipt` | `boolean` | `false` | Affiche l'icône de statut de lecture |

**Statuts de lecture** (si `isOwn=true`) :
- Check simple → message envoyé
- Double check → message lu

**Types de message supportés** : `text`, `file`, `image`

```typescript
<MessageBubble message={msg} isOwn={msg.senderId === currentUserId} showReadReceipt />
```

---

### `ConversationItem`

**Fichier** : `src/components/messaging/ConversationItem.tsx`

Ligne de liste représentant une conversation. Affiche l'avatar, le nom, le dernier message, la date et un badge de messages non lus. Produit un retour haptique léger au tap via `Haptics.impactAsync`.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `item` | `ConversationListItem` | — | Données de la conversation |
| `onPress` | `() => void` | — | Callback au tap sur l'item |

**Comportement** :
- Badge rouge affiché si `unreadCount > 0`
- `isOnline` actif si la conversation est privée et que le contact est en ligne

```typescript
<ConversationItem item={conversation} onPress={() => navigate('Chat', { id: conversation.id })} />
```

---

### `ContactItem`

**Fichier** : `src/components/messaging/ContactItem.tsx`

Ligne de liste représentant un contact. Bascule entre un mode normal (bouton "Message") et un mode en attente (boutons "Accepter" / "Refuser") selon la prop `isPending`.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `contact` | `Contact` | — | Données du contact |
| `onMessage` | `() => void` | — | Callback bouton "Message" |
| `onAccept` | `() => void` | — | Callback bouton "Accepter" (mode pending) |
| `onRefuse` | `() => void` | — | Callback bouton "Refuser" (mode pending) |
| `isPending` | `boolean` | `false` | Active le mode invitation en attente |

```typescript
<ContactItem contact={contact} onMessage={() => openChat(contact.id)} />
<ContactItem contact={invite} isPending onAccept={accept} onRefuse={refuse} />
```

---

### `DateSeparator`

**Fichier** : `src/components/messaging/DateSeparator.tsx`

Séparateur de date centré dans la liste des messages. Affiche une ligne avec un texte de date formaté (Aujourd'hui / Hier / lundi 14 janvier). Utilise `formatDateSeparator` de `conversationUtils`.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `date` | `string \| Date` | — | Date à afficher |

```typescript
<DateSeparator date={message.createdAt} />
```

---

### `EmptyState`

**Fichier** : `src/components/messaging/EmptyState.tsx`

État vide centré verticalement avec icône, titre, sous-titre optionnel et un bouton CTA optionnel.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `icon` | `LucideIcon` | — | Icône Lucide affichée en grand |
| `title` | `string` | — | Titre principal (style h3) |
| `subtitle` | `string` | — | Sous-titre affiché en gris |
| `action` | `{ label: string; onPress: () => void }` | — | Bouton CTA optionnel |

```typescript
<EmptyState
  icon={MessageCircle}
  title="Aucune conversation"
  subtitle="Commencez par ajouter un contact"
  action={{ label: 'Ajouter un contact', onPress: openContacts }}
/>
```

---

### `MessageInput`

**Fichier** : `src/components/messaging/MessageInput.tsx`

Champ de saisie multiline pour envoyer un message. Le bord s'anime au focus (vert emerald) et au blur (gris). Le bouton d'envoi est animé en spring (scale) et n'est actif que si le champ contient du texte. Désactivé visuellement (opacité 0.6) pendant l'envoi.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `onSend` | `(content: string) => void` | — | Callback déclenché à l'envoi |
| `isSending` | `boolean` | `false` | Désactive le champ pendant l'envoi en cours |

```typescript
<MessageInput onSend={(text) => sendMessage(text)} isSending={isSending} />
```

---

## Composants SOS (`components/sos/`)

### `SosButton`

**Fichier** : `src/components/sos/SosButton.tsx`

Bouton circulaire rouge (120px) pour déclencher une alerte SOS. Anime une pulsation en boucle (`withRepeat` / `withSequence` sur opacity + scale) quand `isActive=true`. Affiche un badge de comptage de contacts et un timer sous le bouton.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `onPress` | `() => void` | — | Callback au déclenchement |
| `isActive` | `boolean` | `false` | Active l'animation de pulsation |
| `contactCount` | `number` | — | Nombre de contacts SOS, affiché en badge haut-droite |
| `timerSeconds` | `number` | — | Secondes affichées sous le bouton si défini |
| `disabled` | `boolean` | `false` | Désactive le bouton (automatique si `contactCount === 0`) |

```typescript
<SosButton
  onPress={triggerSos}
  isActive={sosActive}
  contactCount={sosContacts.length}
  timerSeconds={remainingSeconds}
/>
```

---

### `SosContactCard`

**Fichier** : `src/components/sos/SosContactCard.tsx`

Carte d'un contact SOS affichant le nom, le téléphone et la relation. La couleur d'accent varie selon le type de relation. Affiche un badge "Par défaut" si `isDefault=true`.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `contact` | `SosContact` | — | Données du contact SOS |
| `isDefault` | `boolean` | `false` | Affiche le badge "Par défaut" |
| `onEdit` | `() => void` | — | Callback bouton éditer |
| `onDelete` | `() => void` | — | Callback bouton supprimer |

**Couleurs par relation** :

| Relation | Couleur |
|----------|---------|
| `family` | Vert `#16a34a` |
| `colleague` | Bleu `#0284c7` |
| `supervisor` | Violet `#7c3aed` |
| `friend` | Orange `#ea580c` |
| `other` | Gris `#64748b` |

```typescript
<SosContactCard contact={contact} isDefault onEdit={editContact} onDelete={deleteContact} />
```

---

### `SosSwipeConfirm`

**Fichier** : `src/components/sos/SosSwipeConfirm.tsx`

Slider de confirmation swipe-to-activate basé sur `Gesture Handler PanGesture`. L'utilisateur doit glisser le curseur jusqu'au seuil de 80% pour confirmer. La couleur de la piste s'interpole de rouge à orange à l'approche du seuil. Un retour haptique est déclenché à la confirmation. Le slider se réinitialise si relâché avant le seuil.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `onConfirm` | `() => void` | — | Callback déclenché quand le seuil est atteint |
| `label` | `string` | — | Texte affiché dans le slider |
| `disabled` | `boolean` | `false` | Désactive l'interaction |

```typescript
<SosSwipeConfirm onConfirm={triggerAlert} label="Glisser pour confirmer" />
```

---

### `SosTimerDisplay`

**Fichier** : `src/components/sos/SosTimerDisplay.tsx`

Affichage d'un compte à rebours au format `HH:MM:SS`. La couleur change selon le temps restant pour indiquer l'urgence.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `seconds` | `number` | — | Durée en secondes à afficher |
| `size` | `'small' \| 'large'` | — | Taille du texte |

**États visuels** :

| Seuil | Couleur | État |
|-------|---------|------|
| `> 30 min` | Vert `#16a34a` | Normal |
| `5 – 30 min` | Orange `#ea580c` | `warning` |
| `< 5 min` | Rouge `#dc2626` | `danger` |

```typescript
<SosTimerDisplay seconds={remainingSeconds} size="large" />
```

---

### `SosStageIndicator`

**Fichier** : `src/components/sos/SosStageIndicator.tsx`

Indicateur de progression à 3 étapes connectées par des lignes. Le stage actif est représenté par un cercle rempli, les suivants par des cercles vides.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `currentStage` | `-1 \| 0 \| 1 \| 2` | — | Stage courant (`-1` = inactif) |

**Couleurs par stage** :
- Stage `0` → Vert
- Stage `1` → Orange
- Stage `2` → Rouge

```typescript
<SosStageIndicator currentStage={sosStage} />
```

---

## Composants Fiches (`components/fiches/`)

### `ChipCheckbox`

**Fichier** : `src/components/fiches/ChipCheckbox.tsx`

Groupe de chips à sélection multiple. Si `grouped=true`, les chips sont organisées par catégorie avec des en-têtes. Un checkmark animé (scale spring) apparaît sur chaque chip sélectionnée. Un emoji optionnel peut être affiché avant le label.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `options` | `Array<{ id: number; label: string; emoji?: string; category?: string }>` | — | Liste des options disponibles |
| `selected` | `number[]` | — | Tableau des IDs sélectionnés |
| `onChange` | `(ids: number[]) => void` | — | Callback à chaque changement de sélection |
| `grouped` | `boolean` | `false` | Organise les chips par `category` avec en-têtes |

```typescript
<ChipCheckbox
  options={skillOptions}
  selected={selectedSkills}
  onChange={setSelectedSkills}
  grouped
/>
```

---

### `LevelSlider`

**Fichier** : `src/components/fiches/LevelSlider.tsx`

Slider par segments permettant de sélectionner un niveau parmi N. Le segment actif est mis en évidence par une couleur de fond (gradient vert → rouge selon la position). La description du niveau sélectionné est affichée dynamiquement sous le slider.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `levels` | `readonly { id: number; label: string; description?: string; color?: string }[]` | — | Liste des niveaux disponibles |
| `value` | `number \| undefined` | — | ID du niveau actuellement sélectionné |
| `onChange` | `(id: number) => void` | — | Callback à la sélection d'un niveau |

```typescript
<LevelSlider
  levels={expertiseLevels}
  value={selectedLevel}
  onChange={setSelectedLevel}
/>
```

---

### `StarRating`

**Fichier** : `src/components/fiches/StarRating.tsx`

5 étoiles cliquables pour sélectionner une note. Chaque tap produit une animation spring (scale 1 → 1.3 → 1) sur l'étoile. Les étoiles actives sont colorées selon la couleur définie dans l'option sélectionnée.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `options` | `readonly { id: number; label: string; stars: number; color?: string }[]` | — | Options de notation (chaque option correspond à un nombre d'étoiles) |
| `value` | `number \| undefined` | — | ID de l'option actuellement sélectionnée |
| `onChange` | `(id: number) => void` | — | Callback à la sélection |

```typescript
<StarRating
  options={ratingOptions}
  value={selectedRating}
  onChange={setSelectedRating}
/>
```

---

### `RadioButtonGroup`

**Fichier** : `src/components/fiches/RadioButtonGroup.tsx`

Liste de boutons radio permettant un choix unique. Chaque option peut afficher un emoji, une icône ou un point coloré (`colorDot`) selon les données fournies.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `options` | `readonly { id: number; label: string; emoji?: string; icon?: string; colorDot?: string }[]` | — | Liste des options |
| `value` | `number \| undefined` | — | ID de l'option sélectionnée |
| `onChange` | `(id: number) => void` | — | Callback à la sélection |

```typescript
<RadioButtonGroup
  options={statusOptions}
  value={selectedStatus}
  onChange={setSelectedStatus}
/>
```

---

## Composants Animations (`components/animations/`)

### `FadeInView`

**Fichier** : `src/components/animations/FadeInView.tsx`

Conteneur animé appliquant un fondu (opacity 0 → 1) combiné à une translation verticale (translateY 20 → 0). Easing cubicBezier, durée 400ms.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `children` | `ReactNode` | — | Contenu à animer |
| `delay` | `number` | `0` | Délai avant le début de l'animation (ms) |
| `style` | `ViewStyle` | — | Styles supplémentaires appliqués au conteneur |

```typescript
<FadeInView delay={200}>
  <MyContent />
</FadeInView>
```

---

### `AnimatedListItem`

**Fichier** : `src/components/animations/AnimatedListItem.tsx`

Variante de `FadeInView` avec un délai calculé automatiquement selon l'index de l'élément dans une liste (effet stagger). Le délai est plafonné à 500ms pour éviter un décalage excessif sur les longues listes.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `children` | `ReactNode` | — | Contenu à animer |
| `index` | `number` | — | Position de l'élément dans la liste (calcule le délai : `Math.min(index * 50, 500)`) |
| `style` | `ViewStyle` | — | Styles supplémentaires appliqués au conteneur |

```typescript
{items.map((item, index) => (
  <AnimatedListItem key={item.id} index={index}>
    <ItemCard item={item} />
  </AnimatedListItem>
))}
```

---

### `ScaleIn`

**Fichier** : `src/components/animations/ScaleIn.tsx`

Conteneur animé appliquant un scale spring d'entrée (damping: 15, stiffness: 150). Si `flex=true`, le conteneur prend `flex: 1`.

| Prop | Type | Défaut | Description |
|------|------|--------|-------------|
| `children` | `ReactNode` | — | Contenu à animer |
| `style` | `ViewStyle` | — | Styles supplémentaires appliqués au conteneur |
| `flex` | `boolean` | `false` | Applique `flex: 1` sur le conteneur |

```typescript
<ScaleIn flex>
  <ModalContent />
</ScaleIn>
```
