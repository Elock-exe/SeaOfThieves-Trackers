# assets/fonts/

Polices auto-hébergées.

Ce dossier est vide au départ : le site n'utilise que des polices Google
(Roboto, IM Fell English SC, Caveat Brush), chargées par l'`@import` en
haut de `assets/css/style.css`.

## Ajouter une police

1. Poser le fichier ici (`.woff2` de préférence, sinon `.ttf` ou `.otf`)
2. Déclarer un `@font-face` dans `style.css`
3. La brancher sur une variable : `--font-display`, `--font-script`…

Toujours garder un repli dans la pile : si le fichier ne charge pas, la
page doit rester lisible.

## Licences

Une police posée ici est **distribuée avec le site**, donc servie à chaque
visiteur. Une licence « free for personal use » ne couvre pas ça — il faut
une licence web, ou une police libre (SIL OFL, Apache).

Les trois polices actuelles sont sous SIL OFL, donc utilisables sans rien
devoir à personne.
