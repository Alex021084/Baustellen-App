/* Baustellen-App – gemeinsame Dokumentfreigabe */
(() => {
  'use strict';

  const DOCS = {
    tagelohn: { key: 'tagelohn', title: 'Tagelohnnachweis', control: 'tagelohnShareControls' },
    tagesbericht: { key: 'tagesberichte', title: 'Tagesbericht', control: 'tagesberichtShareControls' }
  };

  const $ = id => document.getElementById(id);
  let currentUser = null;
  let profiles = [];
  let modal = null;

  function cloud() { return window.BaustellenCloud?.client || null; }
  function read(key) {
    try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; }
    catch { return []; }
  }
  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
  }
  function dateLabel(v) {
    if (!v) return 'Ohne Datum';
    const d = new Date(v + 'T12:00:00');
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('de-DE');
  }
  function titleFor(type, item) {
    const primary = type === 'tagelohn' ? (item.contractor || 'Tagelohn') : (item.customer || 'Tagesbericht');
    const project = item.project ? ' · ' + item.project : '';
    return primary + project + ' · ' + dateLabel(item.date);
  }
  async function signedInUser() {
    const c = cloud();
    if (!c) return null;
    const { data } = await c.auth.getUser();
    return data?.user || null;
  }
  async function loadProfiles() {
    const c = cloud();
    const { data, error } = await c.from('user_profiles').select('id,username').order('username');
    if (error) throw error;
    profiles = (data || []).filter(p => p.id !== currentUser.id);
  }
  async function ensureCloudId(type, item) {
    const c = cloud();
    if (item._cloudId) return item._cloudId;
    const payload = { ...item };
    delete payload._cloudId; delete payload._sharedOwnerId; delete payload._isShared;
    const row = {
      owner_id: currentUser.id,
      document_type: type === 'tagelohn' ? 'tagelohn' : 'tagesberichte',
      title: titleFor(type, item),
      document_date: /^\d{4}-\d{2}-\d{2}$/.test(item.date || '') ? item.date : null,
      payload
    };
    const { data, error } = await c.from('user_documents').insert(row).select('id').single();
    if (error) throw error;
    item._cloudId = data.id;
    const key = DOCS[type].key;
    localStorage.setItem(key, JSON.stringify(read(key)));
    return data.id;
  }
  async function rowsFor(type) {
    const c = cloud();
    const documentType = type === 'tagelohn' ? 'tagelohn' : 'tagesberichte';
    const { data, error } = await c.from('user_documents')
      .select('id,owner_id,title,document_date,payload')
      .eq('document_type', documentType);
    if (error) throw error;
    return (data || []);
  }
  async function renderControls() {
    currentUser = await signedInUser();
    if (!currentUser) return;
    for (const [type, cfg] of Object.entries(DOCS)) {
      const root = $(cfg.control);
      if (!root) continue;
      const rows = await rowsFor(type);
      const shares = await cloud().from('document_shares')
        .select('document_id,shared_with,revoked_at')
        .eq('owner_id', currentUser.id)
        .is('revoked_at', null);
      if (shares.error) throw shares.error;
      const count = (shares.data || []).length;
      root.innerHTML = `
        <div class="shareActionRow">
          <button type="button" class="secondary shareManageButton" data-share-type="${type}">Dokumente teilen</button>
          <button type="button" class="secondary shareInboxButton" data-inbox-type="${type}">Geteilte Dokumente</button>
        </div>
        <small class="shareHint">${count ? count + ' aktive Freigabe' + (count === 1 ? '' : 'n') : 'Noch keine Freigaben'}</small>`;
    }
  }
  function closeModal() {
    if (modal) modal.remove();
    modal = null;
  }
  function makeModal(title, content) {
    closeModal();
    modal = document.createElement('div');
    modal.className = 'shareModalBackdrop';
    modal.innerHTML = `<section class="shareModal" role="dialog" aria-modal="true">
      <div class="shareModalHeader"><h2>${escapeHtml(title)}</h2><button type="button" class="shareClose" aria-label="Schließen">×</button></div>
      <div class="shareModalBody">${content}</div></section>`;
    document.body.appendChild(modal);
    modal.querySelector('.shareClose').onclick = closeModal;
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  }
  async function openShareManager(type) {
    currentUser = await signedInUser();
    await loadProfiles();
    const rows = await rowsFor(type);
    const sharesResult = await cloud().from('document_shares')
      .select('document_id,shared_with')
      .eq('owner_id', currentUser.id)
      .is('revoked_at', null);
    if (sharesResult.error) throw sharesResult.error;
    const alreadyShared = new Set((sharesResult.data || []).map(x => x.document_id));
    const docs = rows.filter(d => d.owner_id === currentUser.id);
    makeModal('Dokumente teilen', `
      <p>Wähle ein oder mehrere Dokumente und anschließend die Mitarbeiter aus. Freigegebene Mitarbeiter erhalten vollständige Bearbeitungsrechte.</p>
      <div class="shareSubheading">Dokumente auswählen</div>
      <div class="shareList">${docs.length ? docs.map(d => `
        <label class="shareChoice"><input type="checkbox" name="shareDoc" value="${d.id}">
          <span><b>${escapeHtml(d.title || DOCS[type].title)}</b><small>${alreadyShared.has(d.id) ? 'Bereits teilweise geteilt' : 'Noch nicht geteilt'}</small></span>
        </label>`).join('') : '<p>Es sind noch keine Dokumente dieses Typs in der Cloud gespeichert.</p>'}</div>
      <div class="shareSubheading">Mitarbeiter auswählen</div>
      <div class="shareList">${profiles.map(p => `
        <label class="shareChoice"><input type="checkbox" name="shareUser" value="${p.id}">
          <span><b>${escapeHtml(p.username || 'Mitarbeiter')}</b></span>
        </label>`).join('') || '<p>Keine weiteren Benutzer gefunden.</p>'}</div>
      <button type="button" class="primary shareSubmit" ${docs.length && profiles.length ? '' : 'disabled'}>Freigabe erteilen</button>
      <div class="shareFeedback" role="status"></div>
    `);
    modal.querySelector('.shareSubmit')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      const ids = [...modal.querySelectorAll('input[name="shareDoc"]:checked')].map(x => x.value);
      const users = [...modal.querySelectorAll('input[name="shareUser"]:checked')].map(x => x.value);
      const feedback = modal.querySelector('.shareFeedback');
      if (!ids.length || !users.length) { feedback.textContent = 'Bitte mindestens ein Dokument und einen Mitarbeiter auswählen.'; return; }
      btn.disabled = true;
      feedback.textContent = 'Freigabe wird gespeichert …';
      try {
        const { error } = await cloud().rpc('share_documents_with_users', {
          p_document_ids: ids, p_user_ids: users
        });
        if (error) throw error;
        feedback.textContent = 'Freigabe erfolgreich erteilt.';
        await renderControls();
        setTimeout(closeModal, 900);
      } catch (err) {
        feedback.textContent = err.message || 'Freigabe fehlgeschlagen.';
        btn.disabled = false;
      }
    });
  }
  async function openInbox(type) {
    currentUser = await signedInUser();
    const { data: shares, error } = await cloud().from('document_shares')
      .select('document_id,owner_id,shared_with')
      .eq('shared_with', currentUser.id)
      .is('revoked_at', null);
    if (error) throw error;
    const ids = (shares || []).map(s => s.document_id);
    let docs = [];
    if (ids.length) {
      const result = await cloud().from('user_documents')
        .select('id,title,document_type,document_date,payload,owner_id')
        .in('id', ids)
        .eq('document_type', type === 'tagelohn' ? 'tagelohn' : 'tagesberichte');
      if (result.error) throw result.error;
      docs = result.data || [];
    }
    const ownerIds = [...new Set(docs.map(d => d.owner_id))];
    let ownerProfiles = [];
    if (ownerIds.length) {
      const people = await cloud().from('user_profiles').select('id,username').in('id', ownerIds);
      if (people.error) throw people.error;
      ownerProfiles = people.data || [];
    }
    const ownerGroups = ownerIds.map(ownerId => ({
      ownerId,
      username: ownerProfiles.find(p => p.id === ownerId)?.username || 'Mitarbeiter',
      docs: docs.filter(d => d.owner_id === ownerId)
    }));
    makeModal('Dokumente anderer Nutzer', `
      <p>Wähle zuerst den Mitarbeiter aus. Darunter findest du seine freigegebenen Dokumente.</p>
      <div class="shareList">${ownerGroups.length ? ownerGroups.map(group => `
        <section class="shareOwnerGroup">
          <h3>${escapeHtml(group.username)}</h3>
          ${group.docs.map(d => `
            <div class="shareInboxItem"><b>${escapeHtml(d.title || DOCS[type].title)}</b>
              <small>${dateLabel(d.document_date)}</small>
              <button type="button" class="secondary" data-open-shared="${d.id}">Öffnen</button>
            </div>`).join('')}
        </section>`).join('') : '<p>Zurzeit hat noch niemand Dokumente mit dir geteilt.</p>'}</div>
    `);
    modal.querySelectorAll('[data-open-shared]').forEach(btn => btn.addEventListener('click', () => {
      const row = docs.find(d => d.id === btn.dataset.openShared);
      if (!row) return;
      const key = DOCS[type].key;
      const local = read(key);
      const item = { ...(row.payload || {}), _cloudId: row.id, _sharedOwnerId: row.owner_id, _isShared: true };
      const at = local.findIndex(x => x._cloudId === row.id);
      if (at >= 0) local[at] = item; else local.unshift(item);
      localStorage.setItem(key, JSON.stringify(local));
      closeModal();
      // Die bestehende App hält Tagelohnnachweise zusätzlich im Arbeitsspeicher.
      // Ein Reload lädt den Datensatz in beide bestehenden Archive neu ein.
      sessionStorage.setItem('baustellenOpenSharedType', type);
      location.reload();
    }));
  }
  function resetSelection() {
    document.querySelectorAll('.shareDocumentCheck').forEach(input => {
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    document.querySelectorAll('.shareSelectionMode').forEach(root => {
      root.classList.remove('shareSelectionMode');
      root.querySelectorAll('.reportRow').forEach(row => {
        const saved = row.__shareOriginalStyle;
        if (saved) {
          row.removeAttribute('style');
          if (saved) row.setAttribute('style', saved);
          delete row.__shareOriginalStyle;
        }
      });
    });
    document.querySelectorAll('.shareDocsTile').forEach(tile => {
      tile.classList.remove('shareDocsTileActive');
      tile.textContent = 'Dokumente teilen';
      tile.style.removeProperty('display');
      tile.style.removeProperty('width');
      tile.style.removeProperty('min-width');
      tile.style.removeProperty('max-width');
      tile.style.removeProperty('height');
      tile.style.removeProperty('min-height');
      tile.style.removeProperty('margin');
      tile.style.removeProperty('padding');
      tile.style.removeProperty('flex-direction');
      tile.style.removeProperty('align-items');
      tile.style.removeProperty('justify-content');
    });
  }

  function beginSelection(type, root) {
    if (!root) return;
    resetSelection();

    // Originalgröße jeder Karte vor dem Einblenden der Checkbox exakt sichern.
    root.querySelectorAll('.reportRow').forEach(row => {
      row.__shareOriginalStyle = row.getAttribute('style') || '';
      const rect = row.getBoundingClientRect();
      row.style.setProperty('box-sizing', 'border-box', 'important');
      row.style.setProperty('width', rect.width + 'px', 'important');
      row.style.setProperty('min-width', rect.width + 'px', 'important');
      row.style.setProperty('max-width', rect.width + 'px', 'important');
      row.style.setProperty('height', rect.height + 'px', 'important');
      row.style.setProperty('min-height', rect.height + 'px', 'important');
      row.style.setProperty('max-height', rect.height + 'px', 'important');
      row.style.setProperty('flex', '0 0 ' + rect.width + 'px', 'important');
      row.style.setProperty('position', 'relative', 'important');
      row.style.setProperty('overflow', 'hidden', 'important');
    });

    root.classList.add('shareSelectionMode');
    root.querySelectorAll('.reportRow').forEach(row => {
      const label = row.querySelector('.shareDocCheck');
      const input = label?.querySelector('input');
      const mark = label?.querySelector('span');
      if (!label || !input || !mark) return;

      label.style.setProperty('position', 'absolute', 'important');
      label.style.setProperty('right', '16px', 'important');
      label.style.setProperty('top', '50%', 'important');
      label.style.setProperty('left', 'auto', 'important');
      label.style.setProperty('bottom', 'auto', 'important');
      label.style.setProperty('transform', 'translateY(-50%)', 'important');
      label.style.setProperty('display', 'flex', 'important');
      label.style.setProperty('width', '36px', 'important');
      label.style.setProperty('height', '48px', 'important');
      label.style.setProperty('margin', '0', 'important');
      label.style.setProperty('padding', '0', 'important');
      label.style.setProperty('align-items', 'center', 'important');
      label.style.setProperty('justify-content', 'center', 'important');
      label.style.setProperty('z-index', '5', 'important');

      input.style.setProperty('position', 'absolute', 'important');
      input.style.setProperty('opacity', '0', 'important');
      input.style.setProperty('width', '1px', 'important');
      input.style.setProperty('height', '1px', 'important');

      const paint = () => {
        mark.textContent = input.checked ? '✓' : '';
        mark.style.setProperty('display', 'flex', 'important');
        mark.style.setProperty('width', '27px', 'important');
        mark.style.setProperty('height', '27px', 'important');
        mark.style.setProperty('box-sizing', 'border-box', 'important');
        mark.style.setProperty('align-items', 'center', 'important');
        mark.style.setProperty('justify-content', 'center', 'important');
        mark.style.setProperty('border', input.checked ? '2px solid #27834d' : '2px solid #9aa5ae', 'important');
        mark.style.setProperty('border-radius', '8px', 'important');
        mark.style.setProperty('background', input.checked ? '#27834d' : '#fff', 'important');
        mark.style.setProperty('color', input.checked ? '#fff' : '#9aa5ae', 'important');
        mark.style.setProperty('font-size', '21px', 'important');
        mark.style.setProperty('font-weight', '900', 'important');
        mark.style.setProperty('line-height', '1', 'important');
      };
      input.addEventListener('change', paint);
      paint();
    });

    const tile = root.querySelector('.shareDocsTile');
    if (tile) {
      tile.classList.add('shareDocsTileActive');
      tile.textContent = 'Ausgewählte Dokumente teilen';
      tile.style.setProperty('display', 'flex', 'important');
      tile.style.setProperty('width', '270px', 'important');
      tile.style.setProperty('min-width', '270px', 'important');
      tile.style.setProperty('max-width', '270px', 'important');
      tile.style.setProperty('height', '54px', 'important');
      tile.style.setProperty('min-height', '54px', 'important');
      tile.style.setProperty('margin', '8px 0 12px auto', 'important');
      tile.style.setProperty('padding', '6px 12px', 'important');
      tile.style.setProperty('align-items', 'center', 'important');
      tile.style.setProperty('justify-content', 'center', 'important');
      tile.style.setProperty('text-align', 'center', 'important');
      tile.style.setProperty('white-space', 'normal', 'important');
      tile.style.setProperty('font-weight', '700', 'important');
      tile.onclick = () => shareSelected(type);
    }
  }

  async function shareSelected(type) {
    currentUser = await signedInUser();
    await loadProfiles();
    const checked = [...document.querySelectorAll('.shareDocumentCheck:checked')];
    const ids = checked.map(x => x.value).filter(Boolean);
    if (!ids.length) {
      alert('Bitte zuerst die Dokumente mit Häkchen auswählen, die du teilen möchtest.');
      return;
    }
    makeModal('Mit Mitarbeitern teilen', `
      <p>Die ausgewählten Dokumente erhalten vollständige Bearbeitungsrechte für die ausgewählten Mitarbeiter.</p>
      <div class="shareSubheading">Mitarbeiter auswählen</div>
      <div class="shareList">${profiles.map(p => `
        <label class="shareChoice"><input type="checkbox" name="shareUser" value="${p.id}">
          <span><b>${escapeHtml(p.username || 'Mitarbeiter')}</b></span>
        </label>`).join('') || '<p>Keine weiteren Benutzer gefunden.</p>'}</div>
      <button type="button" class="primary shareSubmit">Freigabe erteilen</button>
      <div class="shareFeedback" role="status"></div>
    `);
    modal.querySelector('.shareSubmit').onclick = async e => {
      const btn=e.currentTarget;
      const users=[...modal.querySelectorAll('input[name="shareUser"]:checked')].map(x=>x.value);
      const feedback=modal.querySelector('.shareFeedback');
      if(!users.length){feedback.textContent='Bitte mindestens einen Mitarbeiter auswählen.';return;}
      btn.disabled=true; feedback.textContent='Freigabe wird gespeichert …';
      try {
        const {error}=await cloud().rpc('share_documents_with_users',{p_document_ids:ids,p_user_ids:users});
        if(error) throw error;
        feedback.textContent='Freigabe erfolgreich erteilt.';
        setTimeout(closeModal,900);
      } catch(err){feedback.textContent=err.message||'Freigabe fehlgeschlagen.';btn.disabled=false;}
    };
  }

  function installEvents() {
    // Auswahl ist nur für den aktuellen Freigabevorgang gültig.
    // Beim Zurückgehen/Verlassen der Liste wird sie vollständig zurückgesetzt.
    document.addEventListener('click', e => {
      const leaving = e.target.closest('#navBack, #homeBtn, #backToStartFromReports, #backToStartFromManagement, #backToEditorFromSummary, #reportSummaryBack, [data-back], .backButton, #backButton, .backBtn, [onclick*="back"], [onclick*="Back"]');
      if (leaving) resetSelection();
    }, true);
    // Auch bei Navigation über andere App-Schaltflächen/Ansichten Auswahl entfernen.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') resetSelection();
    });
    window.addEventListener('pagehide', resetSelection);
    window.addEventListener('popstate', resetSelection);
    document.addEventListener('click', async e => {
      const share = e.target.closest('[data-share-type]');
      const inbox = e.target.closest('[data-inbox-type]');
      try {
        if (share) await openShareManager(share.dataset.shareType);
        if (inbox) await openInbox(inbox.dataset.inboxType);
      } catch (err) {
        alert(err.message || 'Freigabeverwaltung konnte nicht geladen werden.');
      }
    });
  }
  async function start() {
    installEvents();
    for (let i = 0; i < 40 && !cloud(); i++) await new Promise(r => setTimeout(r, 250));
    if (!cloud()) return;
    const { data } = await cloud().auth.getSession();
    if (data?.session) currentUser = data.session.user;
    window.addEventListener('baustellen:login', async () => { currentUser = await signedInUser(); });
    window.addEventListener('baustellen:logout', closeModal);
    const pendingType = sessionStorage.getItem('baustellenOpenSharedType');
    if (pendingType) {
      sessionStorage.removeItem('baustellenOpenSharedType');
      setTimeout(() => {
        const target = pendingType === 'tagelohn' ? 'openTagelohn' : 'openTagesbericht';
        document.getElementById(target)?.click();
      }, 900);
    }
    document.addEventListener('click', e => {
      // Die Freigabekachel wird direkt in der jeweiligen Dokumentliste angezeigt.
    });
  }
  window.BaustellenDocumentSharing = { shareSelected, beginSelection };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
