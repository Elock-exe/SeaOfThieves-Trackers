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

## Installer (mode développeur, gratuit)

### Firefox

1. Ouvre `about:debugging#/runtime/this-firefox`
2. Clique **« Charger un module complémentaire temporaire… »**
3. Sélectionne le fichier `extension/manifest.firefox.json`

> Le chargement temporaire disparaît à la fermeture de Firefox. C'est normal
> pour du test — il faudra publier sur addons.mozilla.org (gratuit) pour une
> installation permanente.

### Edge

1. Ouvre `edge://extensions/`
2. Active **« Mode développeur »** (en bas à gauche)
3. Renomme `manifest.chromium.json` en `manifest.json`
4. Clique **« Charger l'élément décompressé »** et choisis le dossier `extension/`

> Le même dossier fonctionnera sur Chrome le jour où tu voudras — Edge et
> Chrome partagent le format Chromium.

---

## Utiliser

1. Ouvre [seaofthieves.com](https://www.seaofthieves.com) et **connecte-toi**
   (garde l'onglet ouvert)
2. Lance le tracker : `npm start` (l'API doit tourner)
3. Clique l'icône de l'extension → **« Sync my profile »**

C'est tout. Aucun cookie à copier.

Si ton API n'est pas sur `http://localhost:8787`, change l'adresse dans
**Advanced → Tracker address**.

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
