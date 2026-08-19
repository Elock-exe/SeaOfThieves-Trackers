# SoT Tracker — comment ça marche

**sottracker.fr** est un site de statistiques pour *Sea of Thieves*. On y cherche
un joueur par son gamertag Xbox ou son pseudo Steam, et on voit ses stats. Il y a
aussi des classements. C'est gratuit, sans publicité, et ce n'est pas affilié à
Rare ni à Microsoft.

La partie intéressante, techniquement, c'est **d'où viennent les données** — parce
que le jeu ne propose aucune API publique.

---

## Trois sources, et une seule est simple

### Steam et Xbox — la partie facile

Ces deux plateformes exposent des API officielles. Le serveur du tracker les
interroge avec des clés secrètes :

- **Steam** donne le temps de jeu et les succès, à condition que le profil soit
  public.
- **Xbox** donne les succès, le gamerscore et les minutes jouées.

Ces appels partent **du serveur**, jamais du navigateur — d'une part parce que les
clés doivent rester secrètes, d'autre part parce que ces API refusent les requêtes
venant d'une page web.

Mais Steam et Xbox ne connaissent rien de l'intérieur du jeu. Ils savent *combien
de temps* on a joué, pas *ce qu'on a fait*. Ni l'or, ni la réputation, ni le rang
Sablier.

### Sea of Thieves — la partie qui explique tout le reste

L'or, les doublons, le rang Sablier, la réputation des six compagnies : tout ça
n'existe que dans l'API interne du site officiel de Sea of Thieves. Elle a deux
propriétés qui compliquent radicalement les choses.

**Elle ne répond que pour le compte connecté.** Il n'existe aucun moyen de
demander « les stats de tel joueur ». Elle renvoie *vos* stats, ou rien.

**Son cookie de session est marqué `SameSite`.** Si le serveur du tracker appelait
seaofthieves.com, le navigateur considérerait la requête comme venant d'un autre
site et **refuserait d'attacher le cookie**. Le serveur recevrait une page de
connexion à la place des données.

Autrement dit : **aucun serveur au monde ne peut lire ces données**, quelle que
soit la manière dont on s'y prend. C'est une protection du navigateur, pas un
obstacle contournable.

---

## D'où l'extension

La seule façon d'obtenir ces données est de faire la requête **depuis la page
elle-même**, dans le navigateur de la personne, pendant qu'elle est connectée.

C'est exactement ce que fait l'extension. Un petit script s'exécute à l'intérieur
de la page seaofthieves.com. Comme il est sur le même site, le navigateur attache
le cookie automatiquement — la requête est indistinguable de celles que la page
fait déjà pour elle-même.

Le point important, et c'est ce qu'on demande toujours en premier :

> **L'extension ne lit jamais le cookie de session.** Elle ne le copie pas, ne le
> stocke pas, ne l'envoie nulle part. C'est le navigateur qui le joint, et
> l'extension n'y a aucun accès. Seules les statistiques quittent la page.

Le script renvoie ensuite le JSON brut au serveur, qui le range et le stocke. Ce
découpage est délibéré : si Rare modifie la structure de ses données, il suffit de
corriger le serveur — sans republier l'extension, sans repasser par la validation
d'un store, et sans que personne ait à mettre à jour quoi que ce soit.

---

## Le chemin d'une page profil

Quand on ouvre le profil d'un joueur, deux requêtes partent en parallèle :

1. **Les données publiques** — le serveur interroge Steam et Xbox, garde la
   réponse la plus complète, et renvoie temps de jeu, succès et avatar.

2. **Les données liées** — le serveur cherche le dernier instantané publié par
   l'extension pour ce joueur, s'il en existe un : or, Sablier, réputation.

La page fusionne les deux. Si le second manque, le profil s'affiche quand même,
simplement incomplet — c'est ce que voit un joueur qui n'a pas lié son compte.

---

## Qui peut publier sous quel nom

Sans garde-fou, la première personne à taper le gamertag de quelqu'un pourrait
publier n'importe quoi sous son nom. Le modèle est volontairement minimal :

- l'extension génère une clé aléatoire à l'installation, et la garde ;
- le premier envoi lie cette clé à un nom de pirate ;
- tout envoi suivant pour ce nom doit présenter la même clé.

Pas de mot de passe, pas d'adresse mail, rien à réinitialiser. Les clés sont
stockées sous forme de hash, comme des mots de passe : une fuite de la base ne
permettrait à personne de publier à la place d'autrui.

---

## Ce qui est stocké, et ce qui ne l'est pas

**Stocké :** les statistiques de jeu publiées via l'extension, et les données
publiques Steam/Xbox des joueurs recherchés sur le site.

**Jamais stocké :** aucun identifiant, aucun mot de passe, aucun cookie, aucune
adresse mail. Le serveur refuse d'ailleurs toute donnée entrante contenant un
champ qui ressemblerait à un identifiant.

Les statistiques publiées sont **publiques** : quiconque connaît un nom de pirate
peut les consulter. C'est le principe même d'un site de classements.

---

## Le classement ouvert à tous

Douze des treize classements reposent sur les données de Rare, donc sur
l'extension, donc sur un navigateur de bureau. Un joueur sur console sans PC ne
pouvait apparaître nulle part.

Le classement **temps de jeu** vient au contraire des données publiques
Steam/Xbox. Il ne demande aucune installation : il suffit que quelqu'un ait
recherché le gamertag une fois. C'est le seul classement de ce type, et c'est
précisément ce qui le rend utile.

---

## Où en est le projet

Le site fonctionne dans tous les navigateurs. L'extension — nécessaire uniquement
pour lier son propre compte — est disponible sur **Firefox** et **Edge**.

Elle ne peut pas exister sur Safari, qui impose d'empaqueter les extensions dans
une véritable application iOS/macOS. Sur Chrome, Brave, Opera et Vivaldi, elle
arrivera par le Chrome Web Store, qui les dessert tous.

Une fois le compte lié une seule fois depuis un ordinateur, les statistiques se
mettent à jour automatiquement en arrière-plan, et se consultent depuis n'importe
quel appareil — téléphone compris.

---

*Code source : github.com/Elock-exe/SeaOfThieves-Trackers*
*Projet non officiel, sans lien avec Rare ni Microsoft.*
