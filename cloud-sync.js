
/* Baustellen-App – Cloud-Synchronisierung */
(() => {
  'use strict';

  const MASTER = {
    customers: 'tagelohnCustomers',
    employees: 'tagelohnEmployees',
    tagelohnServices: 'tagelohnServices',
    reportServices: 'tagesberichtServices',
    reportRoles: 'tagesberichtFunktionen'
  };

  const DOCUMENTS = {
    tagelohn: 'tagelohn',
    tagesbericht: 'tagesberichte'
  };

  const KEYS = [...Object.values(MASTER), ...Object.values(DOCUMENTS)];
  const snapshots = new Map();

  let running = false;
  let ready = false;
  let timer = null;

  function client() {
    return window.BaustellenCloud?.client || null;
  }

  function read(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    snapshots.set(key, JSON.stringify(value));
  }

  function remember() {
    for (const key of KEYS) {
      snapshots.set(key, JSON.stringify(read(key)));
    }
  }

  function changed(key) {
    return JSON.stringify(read(key)) !== snapshots.get(key);
  }

  function makeId() {
    return crypto.randomUUID();
  }

  function unique(items) {
    const result = [];
    const seen = new Set();

    for (const item of items) {
      const identity =
        item && typeof item === 'object'
          ? String(item.id || item.name || JSON.stringify(item)).toLowerCase()
          : String(item).trim().toLowerCase();

      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      result.push(item);
    }

    return result;
  }

  function mergeMaster(category, remote, local) {
    const a = Array.isArray(remote) ? remote : [];
    const b = Array.isArray(local) ? local : [];

    if (category !== 'customers') {
      return unique([...a, ...b]);
    }

    const result = a.map(x => ({
      ...x,
      projects: Array.isArray(x.projects) ? [...x.projects] : []
    }));

    for (const customer of b) {
      const existing = result.find(x =>
        String(x.id || x.name).toLowerCase() ===
        String(customer.id || customer.name).toLowerCase()
      );

      if (!existing) {
        result.push(customer);
      } else {
        existing.projects = unique([
          ...(existing.projects || []),
          ...(customer.projects || [])
        ]);

        if (!existing.address && customer.address) {
          existing.address = customer.address;
        }
      }
    }

    return result;
  }

  async function syncMaster(c, user, initial) {
    for (const [category, key] of Object.entries(MASTER)) {
      if (!initial && !changed(key)) continue;

      const localRaw = read(key);

// Entfernte Testkunden nicht wieder hochladen.
const local = category === 'customers'
  ? localRaw.filter(item =>
      String(item?.name || '').trim().toLowerCase() !== 'cloudtest'
    )
  : localRaw;

      const { data: rows, error } = await c
        .from('shared_master_data')
        .select('id,data')
        .eq('category', category)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const row = rows?.[0];
      const merged = mergeMaster(category, row?.data, local);

      if (row) {
        const { error: updateError } = await c
          .from('shared_master_data')
          .update({
            data: merged,
            updated_at: new Date().toISOString()
          })
          .eq('id', row.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await c
          .from('shared_master_data')
          .insert({
            category,
            data: merged,
            created_by: user.id
          });

        if (insertError) throw insertError;
      }

      write(key, merged);
    }
  }

  function documentTitle(type, item) {
    if (type === 'tagelohn') {
      return `${item.contractor || 'Tagelohn'} – ${item.date || ''}`;
    }

    return `${item.customer || 'Tagesbericht'} – ${item.date || ''}`;
  }

  async function syncDocuments(c, user, initial) {
    const { data: cloudDocs, error } = await c
      .from('user_documents')
      .select('id,document_type,payload')
      .eq('owner_id', user.id);

    if (error) throw error;

    for (const [type, key] of Object.entries(DOCUMENTS)) {
      if (!initial && !changed(key)) continue;

      const local = read(key).map(item => ({
        ...item,
        _cloudId: item._cloudId || makeId()
      }));

      const remote = (cloudDocs || [])
        .filter(doc => doc.document_type === type)
        .map(doc => ({
          ...doc.payload,
          _cloudId: doc.id
        }));

      const remoteIds = new Set(remote.map(x => x._cloudId));

      // Bei bereits vorhandenen Cloud-Dokumenten hat
      // beim ersten Laden die Cloud-Fassung Vorrang.
      const combined = initial
        ? new Map(local.map(x => [x._cloudId, x]))
        : new Map(remote.map(x => [x._cloudId, x]));

      if (initial) {
        remote.forEach(x => combined.set(x._cloudId, x));
      } else {
        local.forEach(x => combined.set(x._cloudId, x));
      }

      const merged = [...combined.values()];

      // Nur neue Dokumente bzw. lokal geänderte
      // Dokumente an die Cloud senden.
      const upload = initial
        ? local.filter(x => !remoteIds.has(x._cloudId))
        : local;

      for (const item of upload) {
        const { error: saveError } = await c
          .from('user_documents')
          .upsert({
            id: item._cloudId,
            owner_id: user.id,
            document_type: type,
            title: documentTitle(type, item),
            document_date: /^\d{4}-\d{2}-\d{2}$/.test(item.date || '')
              ? item.date
              : null,
            payload: item,
            updated_at: new Date().toISOString()
          });

        if (saveError) throw saveError;
      }

      write(key, merged);
    }
  }

  function showStatus(message) {
    let badge = document.getElementById('baustellen-sync-status');

    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'baustellen-sync-status';

      Object.assign(badge.style, {
        position: 'fixed',
        right: '10px',
        bottom: '10px',
        zIndex: '9998',
        padding: '7px 10px',
        borderRadius: '8px',
        background: '#173b57',
        color: 'white',
        fontSize: '12px',
        boxShadow: '0 2px 8px #0003'
      });

      document.body.appendChild(badge);
    }

    badge.textContent = message;
  }

  async function syncNow(initial = false) {
    if (running) return;

    const c = client();
    if (!c) return;

    running = true;
    let succeeded = false;

    try {
      const { data, error } = await c.auth.getUser();

      if (error) throw error;
      if (!data?.user) return false;

      showStatus('Cloud: synchronisiere …');

      await syncMaster(c, data.user, initial);
      await syncDocuments(c, data.user, initial);

      remember();
      ready = true;
      succeeded = true;
      showStatus('Cloud: synchronisiert');
    } catch (error) {

  console.error('Baustellen-Cloud:', error);

  showStatus('Cloud-Fehler: ' + (error.message || String(error)).slice(0, 90));    
    } finally {
      running = false;
    }
    return succeeded;
  }

  async function prepareForLogout() {
    const saved = await syncNow(false);
    if (!saved) return false;

    // Lokale Kopien entfernen, damit der nächste Benutzer auf diesem Gerät
    // nicht versehentlich Dokumente des vorherigen Kontos sieht oder übernimmt.
    for (const key of KEYS) localStorage.removeItem(key);
    ready = false;
    clearInterval(timer);
    sessionStorage.removeItem('baustellenCloudInitialReload');
    return true;
  }

  function checkChanges() {
    if (!ready || running) return;

    if (KEYS.some(changed)) {
      syncNow(false);
    }
  }

  async function start() {
    for (let i = 0; i < 40 && !client(); i++) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    const c = client();
    if (!c) {
      console.error('Supabase-Client nicht gefunden');
      return;
    }

    const { data } = await c.auth.getSession();

    if (!data?.session) return;

    await syncNow(true);

    if (ready) {
      const reloadKey = 'baustellenCloudInitialReload';

      if (!sessionStorage.getItem(reloadKey)) {
        sessionStorage.setItem(reloadKey, '1');
        location.reload();
        return;
      }
    }

    clearInterval(timer);
    timer = setInterval(checkChanges, 3000);
  }

  window.BaustellenCloudSync = {
    syncNow: () => syncNow(false),
    prepareForLogout,
    scheduleSync: checkChanges
  };

  window.addEventListener('baustellen:login', async () => {
    sessionStorage.removeItem('baustellenCloudInitialReload');
    await syncNow(true);

    if (ready) location.reload();
  });

  window.addEventListener('baustellen:logout', () => {
    ready = false;
    clearInterval(timer);
    sessionStorage.removeItem('baustellenCloudInitialReload');
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
