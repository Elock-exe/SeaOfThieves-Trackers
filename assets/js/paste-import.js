/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* ============================================================
   Import by copy and paste — the route no phone blocks.

   Every other way in is closed on a phone. Chrome for Android strips the
   javascript: prefix from a pasted bookmark, Firefox removed bookmarklets
   entirely, and Safari will not execute one either. No mobile browser runs
   the importer, and none of them install an extension except Firefox.

   What every browser still does is open a URL and let you copy the text on
   the page. So the person becomes the transport: they open the endpoints
   themselves, already signed in, and paste what comes back here.

   Clumsy, and the only thing that works. It also needs no permission from
   anyone: the page is read by its owner, in their own browser, and nothing
   automated ever touches Rare.
   ============================================================ */

(function () {
  'use strict';

  var API = (window.SOT_API_BASE || '').replace(/\/+$/, '');
  var CLE = 'sot-tracker-key';
  var NOM = 'sot-tracker-handle';

  var SOURCES = [
    { id: 'reputation', url: 'https://www.seaofthieves.com/api/profilev2/reputation' },
    { id: 'ledger',     url: 'https://www.seaofthieves.com/api/profilev2/balance' },
    { id: 'overview',   url: 'https://www.seaofthieves.com/api/profilev2/overview' }
  ];

  var racine = document.getElementById('paste-import');
  if (!racine) return;

  /* Ouvert d office sur un appareil tactile : c'est la seule voie qui y
     fonctionne, elle n'a pas a etre cherchee. */
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    var repli = document.getElementById('paste-details');
    if (repli) repli.open = true;
  }

  function t(cle, repli) {
    return (window.I18N && I18N.t(cle)) || repli;
  }

  /* Une cle par navigateur, comme pour le bookmarklet. Celle-ci vit sur
     sottracker.fr et non sur seaofthieves.com, donc quelqu'un qui a deja
     importe depuis un PC en aura une autre — le serveur refusera alors le
     pseudo, et le champ plus bas sert a recoller les deux. */
  function cleDeCompte() {
    var k = null;
    try { k = localStorage.getItem(CLE); } catch (e) { /* navigation privee */ }
    if (k) return k;

    var o = new Uint8Array(24);
    (window.crypto || window.msCrypto).getRandomValues(o);
    k = Array.prototype.map.call(o, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
    try { localStorage.setItem(CLE, k); } catch (e) { /* pas fatal */ }
    return k;
  }

  function dire(texte, type) {
    var el = document.getElementById('paste-status');
    if (!el) return;
    el.textContent = texte;
    el.className = 'paste-status' + (type ? ' paste-' + type : '');
    el.hidden = false;
  }

  /* Rare renvoie du JSON ; si la personne n'est pas connectee elle copie une
     page de connexion, et il vaut mieux le lui dire que d'envoyer du HTML. */
  function lire(brut) {
    var s = String(brut || '').trim();
    if (!s) return null;
    if (s.charAt(0) === '<') return { erreur: 'html' };
    try { return { data: JSON.parse(s) }; }
    catch (e) { return { erreur: 'json' }; }
  }

  racine.querySelector('#paste-send').addEventListener('click', function () {
    var payloads = {};
    var probes = {};
    var vides = 0;

    for (var i = 0; i < SOURCES.length; i++) {
      var src = SOURCES[i];
      var zone = document.getElementById('paste-' + src.id);
      var r = lire(zone && zone.value);

      if (!r) { vides++; continue; }
      if (r.erreur === 'html') {
        dire(t('paste.notSignedIn', 'Tu as copié une page de connexion. Connecte-toi sur seaofthieves.com puis rouvre le lien.'), 'erreur');
        zone.focus();
        return;
      }
      if (r.erreur === 'json') {
        dire(t('paste.badPaste', 'Un des blocs n\u2019est pas du texte valide. Recopie-le en entier, du premier au dernier caractère.'), 'erreur');
        zone.focus();
        return;
      }
      payloads[src.id] = r.data;
      probes[src.id] = src.url;
    }

    if (!Object.keys(payloads).length) {
      dire(t('paste.empty', 'Colle au moins la réputation.'), 'erreur');
      return;
    }

    var nom = String(racine.querySelector('#paste-handle').value || '').trim();
    if (!nom) {
      dire(t('paste.noHandle', 'Indique ton nom de pirate, exactement comme en jeu.'), 'erreur');
      racine.querySelector('#paste-handle').focus();
      return;
    }
    try { localStorage.setItem(NOM, nom); } catch (e) { /* miroir seulement */ }

    /* Une cle deja possedee prend le pas : c'est ce qui permet a quelqu'un
       ayant importe depuis un PC de continuer depuis son telephone. */
    var saisie = String(racine.querySelector('#paste-key').value || '').trim();
    var cle = saisie || cleDeCompte();
    if (saisie) { try { localStorage.setItem(CLE, saisie); } catch (e) { /* miroir */ } }

    payloads.page = { title: document.title, path: '/import', name: nom };

    dire(t('paste.sending', 'Envoi\u2026'), 'attente');

    fetch(API + '/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Account-Key': cle },
      body: JSON.stringify({
        handle: nom,
        collectedAt: new Date().toISOString(),
        source: 'paste',
        payloads: payloads,
        probes: probes,
        accountKey: cle
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { status: res.status, body: body };
      });
    }).then(function (r) {
      if (r.status === 200 && r.body && r.body.ok) {
        var qui = r.body.handle || nom;
        dire(t('paste.done', 'Importé.') + ' ' + qui, 'ok');
        var lien = document.getElementById('paste-profile');
        if (lien) {
          lien.href = '/profile?player=' + encodeURIComponent(qui);
          lien.hidden = false;
        }
        return;
      }

      /* Le seul echec qui merite une explication : ce pirate appartient a
         une autre cle. C'est la protection qui fonctionne, pas une panne. */
      if (r.status === 409) {
        dire(t('paste.taken', 'Ce pirate est déjà publié depuis un autre navigateur. Colle sa clé de compte ci-dessous pour continuer.'), 'erreur');
        var champ = document.getElementById('paste-key-row');
        if (champ) champ.hidden = false;
        return;
      }

      var err = (r.body && r.body.error) || {};
      dire(err.message || (t('paste.failed', 'Le serveur a répondu ') + r.status), 'erreur');
    }).catch(function () {
      dire(t('paste.offline', 'Le serveur ne répond pas. Il se réveille peut-être — réessaie dans une minute.'), 'erreur');
    });
  });

  /* Le pseudo et la cle deja connus de ce navigateur, pre-remplis. */
  try {
    var n = localStorage.getItem(NOM);
    if (n) racine.querySelector('#paste-handle').value = n;
  } catch (e) { /* rien a pre-remplir */ }
})();
