# Lancer le tracker avec les vraies données Steam / Xbox

## 1. Récupérer les deux clés (gratuites)

### Steam
1. Va sur **https://steamcommunity.com/dev/apikey**
2. Connecte-toi avec ton compte Steam
3. Dans « Domain Name », mets n'importe quoi (`localhost` fait l'affaire)
4. Coche l'accord, valide → ta clé s'affiche

> ⚠️ Steam refuse les comptes « limités » (jamais eu d'achat d'au moins 5 $).
> Si ça bloque, c'est ça — et il n'y a pas de contournement.

### Xbox (OpenXBL)
1. Va sur **https://xbl.io**
2. Connecte-toi avec un compte Microsoft
3. Ta clé apparaît dans le tableau de bord

---

## 2. Coller les clés

Ouvre le fichier **`.env`** à la racine du projet (il existe déjà) et remplis :

```
STEAM_API_KEY=ta_cle_steam_ici
OPENXBL_API_KEY=ta_cle_openxbl_ici
PORT=8787
```

> `.env` est dans `.gitignore` — tes clés ne partent jamais sur GitHub
> et ne sont jamais envoyées au navigateur.

---

## 3. Lancer

Il faut **deux terminaux** ouverts en même temps.

**Terminal 1 — l'API** (celle qui parle à Steam/Xbox) :

```bash
npm start
```

Tu dois voir :

```
  SoT Tracker API  →  http://localhost:8787
  providers: steam ok · xbox ok
```

Si ça affiche `MISSING KEY`, la clé n'est pas prise en compte — vérifie `.env`
et relance.

**Terminal 2 — le site** :

```bash
npm run site
```

Puis ouvre **http://localhost:5501**

---

## 4. Chercher un vrai joueur

Sur la page d'accueil, la barre de recherche a maintenant un menu déroulant à droite :

| Choix | Ce que ça cherche |
|---|---|
| **Données de démo** | les ~60 pirates générés (comportement d'avant) |
| **Steam** | un vrai joueur — pseudo Steam, URL de profil, ou SteamID64 |
| **Xbox** | un vrai joueur — gamertag |

Sous la barre, une ligne verte t'indique quelles sources sont actives.
Si l'API n'est pas lancée, Steam et Xbox sont grisés avec l'explication.

---

## Ce que tu verras vraiment

Steam et Xbox ne donnent **que des données publiques** :

- ✅ Temps de jeu total (+ 2 dernières semaines sur Steam)
- ✅ Succès débloqués, avec les dates
- ✅ Gamerscore (Xbox)
- ✅ « Pirate Legend » — c'est un succès, donc visible

Restent vides (bandeau rouge « compte non lié ») :

- ❌ Or, doublons, pièces anciennes
- ❌ Rang Sablier
- ❌ Réputation des compagnies
- ❌ Commendations

Ces données-là ne sortent que de l'API interne de Rare, qui n'expose que
le compte connecté. C'est l'étape 3.

---

## Si ça ne marche pas

| Message | Cause | Solution |
|---|---|---|
| « L'API locale ne tourne pas » | terminal 1 fermé | relance `npm start` |
| « Aucune clé API pour cette source » | `.env` vide ou mal rempli | vérifie la clé, **relance l'API** |
| « Aucun joueur de ce nom » | faute de frappe / mauvaise plateforme | vérifie l'orthographe, essaie l'autre plateforme |
| « Ce profil est privé » | profil Steam/Xbox privé | rien à faire de ton côté — c'est le réglage du joueur |
| « Trop de requêtes » | quota atteint | attends une minute |

Les erreurs détaillées s'affichent dans le terminal 1, sans jamais montrer ta clé.
