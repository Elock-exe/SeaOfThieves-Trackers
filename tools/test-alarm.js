/* Does the alarm survive the background script restarting?

   That is the whole bug: MV3 tears the background context down when idle
   and rebuilds it on the next event, so applyAutoSync() runs constantly.
   The old version cleared and recreated each time, resetting the countdown
   and pushing the deadline permanently out of reach. */

const MIN_INTERVAL_MIN = 15;
const DEFAULT_INTERVAL_MIN = 60;
const AUTO_ALARM = 'sot-auto-sync';

/* A fake alarms API with a clock, close enough to the real semantics:
   an alarm fires once `delayInMinutes` has elapsed since it was created. */
function makeBrowser(stored) {
  const state = { now: 0, alarms: new Map(), fired: [] };
  return {
    state,
    storage: { local: { get: async () => stored } },
    alarms: {
      get: async (n) => state.alarms.get(n) || null,
      clear: async (n) => state.alarms.delete(n),
      create: (n, o) => state.alarms.set(n, {
        name: n,
        periodInMinutes: o.periodInMinutes,
        scheduledAt: state.now + (o.delayInMinutes || 0)
      })
    },
    tick(mins) {
      state.now += mins;
      for (const a of state.alarms.values()) {
        while (a.scheduledAt <= state.now) {
          state.fired.push(Math.round(a.scheduledAt));
          if (!a.periodInMinutes) { state.alarms.delete(a.name); break; }
          a.scheduledAt += a.periodInMinutes;
        }
      }
    }
  };
}

async function settings(api) {
  const s = await api.storage.local.get();
  const minutes = Number(s && s.autoSyncMinutes);
  return {
    enabled: s && s.autoSync !== undefined ? Boolean(s.autoSync) : true,
    minutes: Number.isFinite(minutes) && minutes >= MIN_INTERVAL_MIN
      ? Math.round(minutes) : DEFAULT_INTERVAL_MIN
  };
}

// --- the version that shipped ---
async function applyOld(api) {
  const { enabled, minutes } = await settings(api);
  await api.alarms.clear(AUTO_ALARM);
  if (!enabled) return;
  api.alarms.create(AUTO_ALARM, { periodInMinutes: minutes, delayInMinutes: minutes });
}

// --- the fix ---
async function applyNew(api, force) {
  const { enabled, minutes } = await settings(api);
  const existing = await api.alarms.get(AUTO_ALARM);
  if (!enabled) { if (existing) await api.alarms.clear(AUTO_ALARM); return; }
  if (existing && !force && existing.periodInMinutes === minutes) return;
  await api.alarms.clear(AUTO_ALARM);
  api.alarms.create(AUTO_ALARM, { periodInMinutes: minutes, delayInMinutes: minutes });
}

/* 24 simulated hours. The script restarts every 10 minutes, which is
   conservative — a real event page wakes far more often than that. */
async function run(apply, label) {
  const api = makeBrowser({});
  await apply(api);
  for (let i = 0; i < 24 * 6; i++) {
    api.tick(10);
    await apply(api);          // the restart that caused the bug
  }
  console.log(`  ${label.padEnd(26)} syncs en 24h : ${api.state.fired.length}`);
  return api.state.fired.length;
}

(async () => {
  console.log('\n  Script relance toutes les 10 min, periode de sync = 60 min\n');
  const oldCount = await run(applyOld, 'ancienne version');
  const newCount = await run(applyNew, 'version corrigee');

  console.log('\n  attendu pour 24h a 60 min : 24');
  console.log('  ancienne version           : ' + (oldCount === 0 ? 'JAMAIS declenchee ✗' : oldCount));
  console.log('  version corrigee           : ' + (newCount === 24 ? 'OK ✓' : 'INATTENDU (' + newCount + ')'));

  // Changing the interval must take effect immediately, not next period.
  const api = makeBrowser({ autoSync: true, autoSyncMinutes: 60 });
  await applyNew(api);
  const before = (await api.alarms.get(AUTO_ALARM)).periodInMinutes;
  api.storage.local.get = async () => ({ autoSync: true, autoSyncMinutes: 15 });
  await applyNew(api, true);
  const after = (await api.alarms.get(AUTO_ALARM)).periodInMinutes;
  console.log('\n  changement 60 -> 15 min    : ' + (before === 60 && after === 15 ? 'applique ✓' : 'RATE'));
})();
