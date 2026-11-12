
/* Cloud-Synchronisierung für die Baustellen-App.
   Benötigt cloud-login.js und die Supabase-Tabellen. */
(() => {
  'use strict';

  const MASTER_KEYS = {
    customers: 'tagelohnCustomers',
    employees: 'tagelohnEmployees',
    tagelohnServices: 'tagelohnServices',
    reportServices: 'tagesberichtServices',
    reportRoles: 'tagesberichtFunktionen'
  };

  const DOC_KEYS = {
    tagelohn: 'tagelohn',
    tagesbericht: 'tagesberichte'
  };

  let busy = false;
  let timer = null;
  let bootstrapped = false;

  const read = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  };

  const write = (key, value) =>
    localStorage.setItem(key, JSON.stringify(value));

  const uuid = () => crypto.randomUUID();

  const client = () => window.BaustellenCloud?.client;

  async function currentUser() {
    const c = client();
    if (!c) return null;
    const { data, error } = await c.auth.getUser();
    if (error) throw error;
    return data?.user || null;
  }

  function mergeMaster(category, local, remote) {
    const a = Array.isArray(remote) ? remote : [];
    const b = Array.isArray(local) ? local : [];

    if (category === 'customers') {
      const result = a.map(x => ({
        ...x,
        projects: Array.isArray(x.projects) ? x.projects : []
      }));

      b.forEach(x => {
        const old = result.find(y =>
          (y.name || '').trim().toLowerCase() ===
          (x.name || '').trim().toLowerCase()
        );

        if (old) {
          old.address = x.address || old.address;
          old.projects = [
            ...new Set([...(old.projects || []), ...(x.projects || [])])
          ];
        } else {
          result.push(x);
        }
      });

      return result;
    }

    return [...new Set([
      ...a,
      ...b
    ].filter(x => x != null && String(x).trim() !== ''))];
  }

  async function syncNow() {
    const c = client();
    if (!c || busy) return;

    busy = true;

    try {
      const user = await currentUser();
      if (!user) return;

      for (const [category, key] of Object.entries(MASTER_KEYS)) {
        const local = read(key, []);

        const { data: rows, error } = await c
          .from('shared_master_data')
          .select('id,data')
          .eq('category', category);

        if (error) throw error;

        const remote = rows?.[0]?.data;
        const merged = mergeMaster(category, local, remote);

        if (rows?.length) {
          const { error: updateError } = await c
            .from('shared_master_data')
            .update({
              data: merged,
              updated_at: new Date().toISOString()
            })
            .eq('id', rows[0].id);

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

      const { data: cloudDocs, error: docError } = await c
        .from('user_documents')
        .select('id,document_type,title,document_date,payload')
        .eq('owner_id', user.id);

      if (docError) throw docError;

      const deleted = read('baustellenCloudDeletedDocs', []);

      if (deleted.length) {
        const { error } = await c
          .from('user_documents')
          .delete()
          .eq('owner_id', user.id)
          .in('id', deleted);

        if (error) throw error;

        write('baustellenCloudDeletedDocs', []);
      }

      for (const [type, key] of Object.entries(DOC_KEYS)) {
        const local = read(key, []).map(item => ({
          ...item,
          _cloudId: item._cloudId || uuid()
        }));

        const remote = (cloudDocs || [])
          .filter(doc =>
            doc.document_type === type &&
            !deleted.includes(doc.id)
          )
          .map(doc => ({
            ...doc.payload,
            _cloudId: doc.id
          }));

        const byId = new Map(
          remote.map(item => [item._cloudId, item])
        );

        local.forEach(item => byId.set(item._cloudId, item));

        const merged = [...byId.values()];
        write(key, merged);

        for (const item of local) {
          const title = type === 'tagelohn'
            ? `${item.contractor || 'Tagelohn'} – ${item.date || ''}`
            : `${item.customer || 'Tagesbericht'} – ${item.date || ''}`;

          const { error } = await c
            .from('user_documents')
            .upsert({
              id: item._cloudId,
              owner_id: user.id,
              document_type: type,
              title,
              document_date: item.date || null,
              payload: item,
              updated_at: new Date().toISOString()
            });

          if (error) throw error;
        }
      }

      bootstrapped = true;

      const badge = document.getElementById('baustellen-cloud-user');
      if (badge) badge.textContent += ' · synchronisiert';

    } catch (error) {
      console.error('Cloud-Synchronisierung:', error);

      const badge = document.getElementById('baustellen-cloud-user');
      if (badge) badge.textContent = 'Cloud: Synchronisierung prüfen';

    } finally {
      busy = false;
    }
  }

  function scheduleSync() {
    if (!bootstrapped) return;

    clearTimeout(timer);
    timer = setTimeout(syncNow, 900);
  }

  window.BaustellenCloudSync = {
    syncNow,
    scheduleSync
  };

  window.addEventListener('baustellen:login', async () => {
    await syncNow();
    location.reload();
  });

  async function start() {
    for (let i = 0; i < 40 && !client(); i++) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    if (!client()) return;

    const { data } = await client().auth.getSession();

    if (data?.session) {
      await syncNow();

      if (!sessionStorage.getItem('baustellenCloudReloaded')) {
        sessionStorage.setItem('baustellenCloudReloaded', '1');
        location.reload();
      }
    } else {
      sessionStorage.removeItem('baustellenCloudReloaded');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
