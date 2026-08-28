/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* ============================================================
   Accounts — who is allowed to write stats for which pirate.

   The tracker is public to read: anyone can look up a pirate, the way
   any stats site works. Writing is the part that needs an owner, or the
   first person to guess a gamertag could publish whatever they liked
   under it.

   The model is deliberately small:

     - The extension generates a random key on install and keeps it.
     - The first sync carrying that key binds it to a pirate handle.
     - Later syncs for that handle must present the same key.

   No passwords, no email, nothing to reset — and nothing worth stealing
   beyond the ability to post someone's gold count.

   Keys are stored hashed (SHA-256). A leaked accounts file therefore
   does not hand over the ability to write as anyone, the same reason
   password files store hashes.
   ============================================================ */

const crypto = require('crypto');
const db = require('./db');

function hash(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

/** Handles are compared case-insensitively: Rare treats them that way. */
function normalise(handle) {
  return String(handle || '').trim().toLowerCase();
}

/**
 * Decide whether `key` may write stats for `handle`.
 *
 * @returns {{ok: true, first: boolean}} when the write is allowed
 *          {{ok: false, code: string, message: string}} when it is not
 */
async function authorize(key, handle) {
  const h = normalise(handle);
  if (!key) {
    return { ok: false, code: 'no_account_key', message: 'Missing X-Account-Key header' };
  }
  if (!h) {
    return { ok: false, code: 'no_handle', message: 'A pirate name is required to publish stats' };
  }

  const id = hash(key);
  const owner = await db.findAccountByHandle(h);

  if (owner && owner.id !== id) {
    return {
      ok: false,
      code: 'handle_taken',
      message: `"${handle}" is already published by another account`
    };
  }

  const existing = await db.getAccount(id);
  const first = !existing || normalise(existing.handle) !== h;

  await db.putAccount(id, {
    handle: String(handle).trim(),
    createdAt: (existing && existing.createdAt) || new Date().toISOString(),
    lastSync: new Date().toISOString(),
    syncs: ((existing && existing.syncs) || 0) + 1
  });

  return { ok: true, first };
}

/** What this key owns, without revealing anything about other accounts. */
async function describe(key) {
  if (!key) return null;
  const rec = await db.getAccount(hash(key));
  if (!rec) return null;
  return { handle: rec.handle, syncs: rec.syncs, lastSync: rec.lastSync };
}

module.exports = { authorize, describe };
