
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
  let snapshotStorageKey = null;
  let syncPromise = null;

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
  }

  function loadSnapshots(userId) {
    snapshotStorageKey = `baustellenCloudSnapshots:${userId}`;
    snapshots.clear();
    try {
      const saved = JSON.parse(localStorage.getItem(snapshotStorageKey) || '{}');
      for (const key of KEYS) {
        if (Array.isArray(saved[key])) snapshots.set(key, JSON.stringify(saved[key]));
      }
    } catch {
      snapshots.clear();
    }
  }

  function remember() {
    const saved = {};
    for (const key of KEYS) {
      const value = JSON.stringify(read(key));
      snapshots.set(key, value);
      saved[key] = JSON.parse(value);
    }
    if (snapshotStorageKey) {
      try {
        localStorage.setItem(snapshotStorageKey, JSON.stringify(saved));
      } catch (error) {
        console.warn('Cloud-Snapshot konnte nicht gespeichert werden:', error);
      }
    }
  }

  function previous(key) {
    try {
      const value = JSON.parse(snapshots.get(key) || 'null');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function identity(item) {
    return item && typeof item === 'object'
      ? String(item.id || item.name || JSON.stringify(item)).toLowerCase()
      : String(item).trim().toLowerCase();
  }

  function changed(key) {
    return JSON.stringify(read(key)) !== snapshots.get(key);
  }

  function makeId() {
    return crypto.randomUUID();
  }

  // Alte/abweichende Cloud-Datensätze vereinheitlichen. Die App erwartet
  // Mitarbeiter, Funktionen und Leistungen als Text, nicht als Objekte.
  function normalizeMaster(category, value) {
    if (!Array.isArray(value)) return [];
    if (category === 'customers') {
      return value
        .filter(item => item && typeof item === 'object')
        .map(item => ({
          ...item,
          id: String(item.id || item.customer_id || `customer_${String(item.name || item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`),
          name: String(item.name || item.customerName || item.title || item.label || '').trim(),
          address: String(item.address || item.streetAddress || '').trim(),
          projects: Array.isArray(item.projects) ? item.projects.map(project =>
            typeof project === 'string' ? project : String(project?.name || project?.title || project?.value || '').trim()
          ).filter(Boolean) : []
        }))
        .filter(item => item.name);
    }
    return value.map(item => {
      if (typeof item === 'string' || typeof item === 'number') return String(item).trim();
      if (!item || typeof item !== 'object') return '';
      return String(
        item.name ?? item.employeeName ?? item.serviceName ??
        item.functionName ?? item.title ?? item.label ?? item.value ??
        item.description ?? ''
      ).trim();
    }).filter(Boolean);
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

  function mergeMaster(category, remote, local, baseline, detectDeletes) {
    let a = Array.isArray(remote) ? remote.map(x => ({ ...x })) : [];
    const b = Array.isArray(local) ? local : [];
    const old = Array.isArray(baseline) ? baseline : [];

    // Löschungen werden anhand des letzten erfolgreichen Cloud-Snapshots erkannt.
    // Nur Einträge, die vorher existierten und jetzt lokal fehlen, werden entfernt.
    if (detectDeletes) {
      const currentKeys = new Set(b.map(identity));
      const removedKeys = new Set(old.map(identity).filter(key => !currentKeys.has(key)));
      a = a.filter(item => !removedKeys.has(identity(item)));

      if (category === 'customers') {
        const oldByCustomer = new Map(old.map(item => [identity(item), item]));
        const currentByCustomer = new Map(b.map(item => [identity(item), item]));
        for (const cloudCustomer of a) {
          const oldCustomer = oldByCustomer.get(identity(cloudCustomer));
          const currentCustomer = currentByCustomer.get(identity(cloudCustomer));
          if (!oldCustomer || !currentCustomer) continue;
          const currentProjectKeys = new Set((currentCustomer.projects || []).map(identity));
          const removedProjectKeys = new Set((oldCustomer.projects || []).map(identity)
            .filter(key => !currentProjectKeys.has(key)));
          cloudCustomer.projects = (cloudCustomer.projects || [])
            .filter(project => !removedProjectKeys.has(identity(project)));
        }
      }
    }

    if (category !== 'customers') return unique([...a, ...b]);

    const result = a.map(x => ({
      ...x,
      projects: Array.isArray(x.projects) ? [...x.projects] : []
    }));

    for (const customer of b) {
      const existing = result.find(x => identity(x) === identity(customer));
      if (!existing) {
        result.push(customer);
      } else {
        existing.projects = unique([...(existing.projects || []), ...(customer.projects || [])]);
        if (!existing.address && customer.address) existing.address = customer.address;
      }
    }

    return result;
  }

  async function syncMaster(c, user, initial) {
    for (const [category, key] of Object.entries(MASTER)) {
      const hasBaseline = snapshots.has(key);
      const localChanged = hasBaseline && changed(key);
      if (!initial && !localChanged) continue;

      const localRaw = normalizeMaster(category, read(key));
      // Vereinheitlichte Daten auch lokal ablegen, damit die App sie direkt
      // nach einem Neuladen in ihrem erwarteten Format vorfindet.
      write(key, localRaw);

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

      // Es können ältere doppelte Zeilen derselben Kategorie existieren.
      // Alle sichtbaren Cloud-Zeilen einlesen, nicht nur die älteste.
      const remote = unique((rows || []).flatMap(row =>
        normalizeMaster(category, row?.data)
      ));
      const row = rows?.[0];
      const baseline = normalizeMaster(category, previous(key));
      const merged = mergeMaster(category, remote, local, baseline, localChanged);
      const remoteSerialized = JSON.stringify(remote);
      const mergedSerialized = JSON.stringify(merged);

      if (row) {
        // Nur schreiben, wenn sich der zusammengeführte Bestand wirklich ändert.
        if (mergedSerialized !== remoteSerialized || (rows || []).length > 1) {
          const { error: updateError } = await c
            .from('shared_master_data')
            .update({
              data: merged,
              updated_at: new Date().toISOString()
            })
            .eq('id', row.id);

          if (updateError) throw updateError;
        }
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

  function documentFingerprint(item) {
    // Nur vollständig inhaltsgleiche Nachweise gelten als Duplikat.
    // Datum/Kunde allein reichen ausdrücklich nicht: An einem Tag können
    // mehrere unterschiedliche Nachweise existieren.
    const clean = value => {
      if (Array.isArray(value)) return value.map(clean);
      if (!value || typeof value !== 'object') return value;
      const result = {};
      for (const key of Object.keys(value).sort()) {
        if (['_cloudId', '_sharedOwnerId', '_isShared'].includes(key)) continue;
        result[key] = clean(value[key]);
      }
      return result;
    };
    return JSON.stringify(clean(item || {}));
  }

  async function syncDocuments(c, user, initial) {
    // RLS liefert eigene UND aktiv freigegebene Dokumente.
    const { data, error } = await c
      .from('user_documents')
      .select('id,owner_id,document_type,payload');
    if (error) throw error;
    const cloudDocs = [...(data || [])];

    for (const [type, key] of Object.entries(DOCUMENTS)) {
      // Exakt gleiche eigene Cloud-Datensätze zusammenfassen. Unterschrift,
      // Mitarbeiter, Arbeiten und Materialien sind Teil des Vergleichs.
      const seenCloud = new Map();
      for (const doc of [...cloudDocs].filter(d => d.document_type === type && d.owner_id === user.id)) {
        const fingerprint = documentFingerprint(doc.payload);
        const existing = seenCloud.get(fingerprint);
        if (!existing) {
          seenCloud.set(fingerprint, doc);
          continue;
        }
        const { error: deleteError } = await c.from('user_documents')
          .delete().eq('id', doc.id).eq('owner_id', user.id);
        if (deleteError) throw deleteError;
        const index = cloudDocs.findIndex(item => item.id === doc.id);
        if (index >= 0) cloudDocs.splice(index, 1);
      }
      const hasBaseline = snapshots.has(key);
      const localChanged = hasBaseline && changed(key);
      if (!initial && !localChanged) continue;

      const rawLocal = read(key);
      const localSeen = new Map();
      for (const item of rawLocal) {
        const fingerprint = documentFingerprint(item);
        const existing = localSeen.get(fingerprint);
        if (!existing || (!existing._cloudId && item._cloudId)) {
          localSeen.set(fingerprint, item);
        }
      }
      const existingByFingerprint = new Map(
        (cloudDocs || []).filter(doc => doc.document_type === type && doc.owner_id === user.id)
          .map(doc => [documentFingerprint(doc.payload), doc.id])
      );
      const local = [...localSeen.values()].map(item => ({
        ...item,
        _cloudId: item._cloudId || existingByFingerprint.get(documentFingerprint(item)) || makeId()
      }));
      const remote = (cloudDocs || [])
        .filter(doc => doc.document_type === type)
        .map(doc => ({
          ...doc.payload,
          _cloudId: doc.id,
          _sharedOwnerId: doc.owner_id !== user.id ? doc.owner_id : undefined,
          _isShared: doc.owner_id !== user.id
        }));

      // Gelöschte eigene Dokumente auch in Supabase entfernen. Freigegebene
      // Dokumente anderer Eigentümer werden hier bewusst nicht global gelöscht.
      const removedIds = [];
      if (localChanged) {
        const oldIds = new Set(previous(key).map(item => item?._cloudId).filter(Boolean));
        const currentIds = new Set(local.map(item => item?._cloudId).filter(Boolean));
        removedIds.push(...[...oldIds].filter(id => !currentIds.has(id)));
        for (const id of removedIds) {
          const cloudDoc = (cloudDocs || []).find(doc => doc.id === id);
          if (!cloudDoc || cloudDoc.owner_id !== user.id) continue;
          const { error: deleteError } = await c
            .from('user_documents')
            .delete()
            .eq('id', id)
            .eq('owner_id', user.id);
          if (deleteError) throw deleteError;
        }
      }

      // Cloud-Inhalt ist beim Initialladen maßgeblich. Danach werden lokale
      // Änderungen mit UPDATE gespeichert; owner_id bleibt unverändert.
      const deletedOwnIds = new Set(removedIds);
      const merged = new Map(
        remote
          .filter(item => !deletedOwnIds.has(item._cloudId))
          .map(item => [item._cloudId, item])
      );
      for (const item of local) {
        if (!merged.has(item._cloudId) || !initial) merged.set(item._cloudId, item);
      }

      for (const item of local) {
        const existing = (cloudDocs || []).find(doc => doc.id === item._cloudId);
        const payload = { ...item };
        delete payload._cloudId;
        delete payload._sharedOwnerId;
        delete payload._isShared;
        const values = {
          document_type: type,
          title: documentTitle(type, item),
          document_date: /^\d{4}-\d{2}-\d{2}$/.test(item.date || '') ? item.date : null,
          payload,
          updated_at: new Date().toISOString()
        };

        if (existing) {
          const { error: updateError } = await c
            .from('user_documents')
            .update(values)
            .eq('id', item._cloudId);
          if (updateError) throw updateError;
          // Audit ist ergänzend; die Dokumentänderung selbst bleibt maßgeblich.
          try {
            await c.from('document_audit').insert({
              document_id: item._cloudId,
              user_id: user.id,
              action: 'document_updated',
              details: { document_type: type }
            });
          } catch (auditError) {
            console.warn('Dokument-Audit konnte nicht gespeichert werden:', auditError);
          }
        } else {
          const { error: insertError } = await c
            .from('user_documents')
            .insert({ id: item._cloudId, owner_id: user.id, ...values });
          if (insertError) throw insertError;
        }
      }

      write(key, [...merged.values()]);
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
    if (syncPromise) return syncPromise;
    syncPromise = performSync(initial);
    try {
      return await syncPromise;
    } finally {
      syncPromise = null;
    }
  }

  async function performSync(initial = false) {
    if (running) return false;

    const c = client();
    if (!c) return;

    running = true;
    let succeeded = false;

    try {
      const { data, error } = await c.auth.getUser();

      if (error) throw error;
      if (!data?.user) return false;

      if (snapshotStorageKey !== `baustellenCloudSnapshots:${data.user.id}`) {
        loadSnapshots(data.user.id);
      }

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

    // Die lokalen App-Daten werden beim Abmelden bewusst entfernt, damit
    // auf gemeinsam genutzten Geräten keine Daten des vorherigen Kontos
    // angezeigt werden. Deshalb darf der Snapshot dieses Kontos beim
    // nächsten Login NICHT als Löschvergleich verwendet werden.
    if (snapshotStorageKey) {
      localStorage.removeItem(snapshotStorageKey);
    }
    snapshotStorageKey = null;
    snapshots.clear();

    ready = false;
    clearInterval(timer);
    sessionStorage.removeItem('baustellenCloudInitialReload');
    return true;
  }

  function checkChanges() {
    if (!ready || running) return;

    // Auch Änderungen von anderen Geräten regelmäßig einlesen.
    // syncMaster vergleicht lokal/Cloud und schreibt nur bei tatsächlichen
    // Abweichungen; dadurch werden neue Kunden geräteübergreifend sichtbar.
    syncNow(false);
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

    clearInterval(timer);
    timer = setInterval(checkChanges, 3000);
  }

  window.BaustellenCloudSync = {
    syncNow: () => syncNow(false),
    prepareForLogout,
    scheduleSync: checkChanges
  };

  window.addEventListener('baustellen:login', async () => {
    if (!ready) await syncNow(true);
    clearInterval(timer);
    if (ready) timer = setInterval(checkChanges, 3000);
  });

  window.addEventListener('baustellen:logout', () => {
    ready = false;
    clearInterval(timer);
    sessionStorage.removeItem('baustellenCloudInitialReload');
    // Auch bei einem Logout außerhalb des regulären Buttons den alten
    // Snapshot verwerfen: leere lokale Listen sind nach dem Logout kein
    // Löschauftrag.
    if (snapshotStorageKey) localStorage.removeItem(snapshotStorageKey);
    snapshotStorageKey = null;
    snapshots.clear();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
