# Extension navigateur — SoT Tracker

Récupère ton or, ton rang Sablier et ta réputation depuis Sea of Thieves,
et les envoie à ton tracker.

## Pourquoi une extension plutôt qu'un copier-coller de cookie

L'extension tourne **dans ton navigateur**, avec ta session déjà ouverte sur
seaofthieves.com. Elle interroge l'API de Rare localement, puis n'envoie que
**les statistiques** au serveur.

```
extension (ton navigateur)
   ├─ appelle l'API Rare avec TA session, en local
   └─ POST vers le tracker : { or, sablier, réputation... }
                              ↑ jamais le jeton de session
```

Le serveur ne reçoit jamais ton cookie et ne peut donc pas le stocker ni le
fuiter. Il refuse même explicitement toute charge utile contenant un champ qui
ressemble à un identifiant.

---

## Installer pour toi (mode développeur, gratuit)

Construis d'abord les paquets — c'est cette étape qui met le bon manifeste
sous le nom `manifest.json` que les deux navigateurs exigent :

```bash
npm run build:ext
```

Tu obtiens `dist/sot-tracker-chrome.zip` et `dist/sot-tracker-firefox.zip`.

### Chrome / Edge

1. Décompresse `dist/sot-tracker-chrome.zip`
2. Ouvre `chrome://extensions` (ou `edge://extensions/`)
3. Active **« Mode développeur »**
4. **« Charger l'élément décompressé »** → choisis le dossier décompressé

### Firefox

1. Ouvre `about:debugging#/runtime/this-firefox`
2. **« Charger un module complémentaire temporaire… »**
3. Sélectionne `dist/sot-tracker-firefox.zip`

> Le chargement temporaire disparaît à la fermeture de Firefox. Pour une
> installation permanente, il faut passer par un store — voir plus bas.

---

## Publier pour tout le monde

Le mode développeur ne sert qu'à toi : Chrome le désactive à chaque
redémarrage sur les profils gérés, et Firefox l'oublie en fermant. Pour que
n'importe qui installe l'extension en un clic, il faut passer par un store.

Les trois acceptent le **même paquet** que `npm run build:ext` produit.

| Store | Coût | Paquet | Délai typique |
|---|---|---|---|
| **Chrome Web Store** | 5 $ une fois, à vie | `sot-tracker-chrome.zip` | 1 à 5 jours |
| **Firefox (AMO)** | gratuit | `sot-tracker-firefox.zip` | quelques heures à 2 jours |
| **Edge Add-ons** | gratuit | `sot-tracker-chrome.zip` | 3 à 7 jours |

### Ce qu'il faut préparer une seule fois

- **Une icône 128×128** — déjà là (`icons/icon-128.png`)
- **Des captures d'écran** — 1280×800 ou 640×400. Une capture du popup et une
  de la page profil du tracker suffisent.
- **Une politique de confidentialité accessible publiquement** — obligatoire
  dès qu'une extension touche à des données de compte. Tu en as déjà une :
  `https://sottracker.fr/privacy`.
- **Une justification pour chaque permission.** C'est la partie qui fait
  recaler les gens. Réponses prêtes à coller :

  | Permission | Justification |
  |---|---|
  | `storage` | Mémoriser le nom de pirate, l'adresse du tracker et la clé de compte locale. |
  | `tabs` | Retrouver l'onglet seaofthieves.com déjà ouvert pour y lire le profil. |
  | `scripting` | Réinjecter le script de lecture dans un onglet ouvert avant l'installation. |
  | `alarms` | Déclencher la synchronisation périodique quand l'utilisateur l'active. |
  | `host_permissions` seaofthieves.com | Lire le profil du joueur, en same-origin, avec sa propre session. |
  | `host_permissions` tracker | Publier les statistiques (et **uniquement** elles). |

> **Le point qui compte pour un relecteur :** le cookie de session n'est jamais
> lu, copié ni transmis. Le script de contenu laisse le navigateur l'attacher
> et n'y accède pas. Dis-le explicitement dans le formulaire — c'est la
> première question qu'ils se posent sur une extension qui lit un compte de jeu.

### Chrome Web Store

1. Crée un compte développeur sur
   [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
   et paie les 5 $ (une fois, définitif)
2. **« Nouvel élément »** → dépose `dist/sot-tracker-chrome.zip`
3. Remplis fiche, captures, politique de confidentialité, justifications
4. Soumets

### Firefox (AMO)

1. Compte sur [addons.mozilla.org/developers](https://addons.mozilla.org/developers/)
2. **« Soumettre un nouveau module »** → **« Sur ce site »** → dépose
   `dist/sot-tracker-firefox.zip`
3. Le linter de Mozilla passe tout de suite : s'il râle, c'est presque
   toujours le manifeste ou un nom d'entrée ZIP — que `tools/build-extension.js`
   vérifie déjà avant de te laisser envoyer quoi que ce soit

> **« Sur ce site »** = listé publiquement dans le catalogue.
> **« Sur mon propre site »** = Mozilla te renvoie un `.xpi` signé que tu
> héberges toi-même. C'est la seule façon d'avoir une installation permanente
> hors catalogue — Chrome n'a pas d'équivalent.

### Edge Add-ons

1. Compte sur
   [partner.microsoft.com/dashboard/microsoftedge](https://partner.microsoft.com/dashboard/microsoftedge)
2. Dépose le **même** zip que Chrome — Edge lit le format Chromium

### À chaque mise à jour

Incrémente `version` dans **les deux** manifestes (ils doivent rester
identiques — le build t'avertit sinon), relance `npm run build:ext`, renvoie
le zip. Un store refuse un paquet dont la version n'a pas augmenté.

> Rappel de conception : l'extension envoie le **JSON brut** de Rare, et c'est
> le serveur qui le normalise. Si Rare change la forme de ses données, tu
> corriges le serveur et tout le monde en profite immédiatement — sans
> republier ni repasser par une validation. Ne republie que pour changer le
> comportement de l'extension elle-même.

---

## Utiliser

1. Ouvre [seaofthieves.com](https://www.seaofthieves.com) et **connecte-toi**
   (garde l'onglet ouvert)
2. Lance le tracker : `npm start` (l'API doit tourner)
3. Clique l'icône de l'extension → **« Sync my profile »**

C'est tout. Aucun cookie à copier.

Si ton API n'est pas sur `http://localhost:8787`, change l'adresse dans
**Advanced → Tracker address**.

### Garder les stats à jour toutes seules

Coche **« Keep my stats up to date automatically »** et choisis un intervalle.
L'extension resynchronise en arrière-plan tant que le navigateur est ouvert.

Désactivé par défaut, et l'intervalle ne descend pas sous 15 minutes — pour
une raison qui vaut d'être comprise :

> **Multiplier les requêtes ne rend pas les chiffres plus frais.** Les stats
> de Rare ne bougent que quand tu joues ; relire les mêmes endpoints deux fois
> d'affilée renvoie exactement la même charge utile. Ce qui maintient un profil
> à jour, c'est de resynchroniser *plus tard*, pas *plus souvent dans la même
> seconde*. Et comme cette API n'est ni publique ni documentée, une boucle
> serrée s'y fait rate-limiter (HTTP 429) — l'extension le signale déjà.

Ce qui a vraiment été accéléré, c'est le sync lui-même : les trois groupes
(`overview`, `reputation`, `ledger`) partent désormais **en parallèle** au lieu
de s'attendre l'un l'autre. Même nombre de requêtes, à peu près un tiers du
temps d'attente.

---

## Pourquoi il faut un onglet seaofthieves.com ouvert

Le cookie de session de Rare est marqué `SameSite`. Une requête partant du
worker de l'extension serait considérée comme **cross-site**, et le navigateur
n'attacherait pas le cookie — la requête reviendrait sur la page de connexion.

L'extension exécute donc la lecture **depuis la page elle-même** (script de
contenu), où la requête est same-origin et le cookie passe normalement.
Si aucun onglet n'est ouvert, l'extension en ouvre un en arrière-plan, fait
la lecture, puis le referme.

---

## Ce qui peut mal se passer

| Message | Cause | Solution |
|---|---|---|
| *Got the login page — not signed in* | session expirée | reconnecte-toi sur seaofthieves.com |
| *Could not reach the Sea of Thieves page* | script de contenu absent | ouvre seaofthieves.com, réessaie |
| *Tracker API is unreachable* | API éteinte | `npm start` |
| *No endpoint answered* | Rare a déplacé son API | ouvre **Advanced** et envoie-moi la liste |
| *Rate limited* | trop d'appels | attends une minute |

Chaque erreur affiche aussi son **code** et, en cas d'échec total, la liste
des chemins essayés. C'est exactement ce qu'il me faut pour corriger.

---

## Structure

```
extension/
  manifest.firefox.json    Firefox  (MV3, background.scripts)
  manifest.json            Edge + Chrome (MV3, service_worker)
  icons/                   48px et 128px
  src/
    content.js             tourne SUR seaofthieves.com, lit l'API (same-origin)
    background.js          trouve l'onglet, orchestre, envoie au tracker
    popup.html/.css/.js    l'interface du bouton
```

**Deux choix de conception :**

1. **La lecture se fait dans la page**, pas dans le worker — sinon le cookie
   `SameSite` n'est pas envoyé.
2. **L'extension transmet le JSON brut** de Rare ; c'est le serveur qui
   normalise. Si Rare change la forme de ses données, je corrige le serveur —
   sans republier l'extension ni repasser par la validation d'un store.
