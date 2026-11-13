/* Admin-only overview of Supabase user profiles. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const display = value => { const s=String(value||'Benutzer').trim(); return s ? s.charAt(0).toLocaleUpperCase('de-DE')+s.slice(1) : 'Benutzer'; };
  async function open() {
    const status=$('userAccountsStatus'), list=$('userAccountsList');
    if(!status||!list) return;
    status.textContent='Benutzer werden geladen …'; list.innerHTML='';
    const client=window.BaustellenCloud?.client;
    if(!client){status.textContent='Supabase-Verbindung ist noch nicht bereit. Bitte erneut öffnen.';return;}
    try {
      const {data:{user},error:userError}=await client.auth.getUser();
      if(userError||!user) throw new Error('Bitte zuerst anmelden.');
      const {data:me,error:meError}=await client.from('user_profiles').select('role').eq('id',user.id).maybeSingle();
      if(meError) throw meError;
      if(me?.role!=='admin') { status.textContent='Diese Seite ist nur für Administratoren freigeschaltet.'; return; }
      const {data:profiles,error}=await client.from('user_profiles').select('id, username, role').order('username');
      if(error) throw error;
      if(!profiles?.length){status.textContent='Keine Benutzerprofile gefunden.';return;}
      list.innerHTML=profiles.map(p=>`<div class="userAdminRow" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 4px;border-top:1px solid #e2e8f0"><div><b style="display:block;color:#1b3445">${esc(display(p.username))}</b><small style="color:#718096">${p.role==='admin'?'Administrator':'Mitarbeiter'}</small></div><span style="font-size:13px;padding:6px 10px;border-radius:20px;background:${p.role==='admin'?'#e8f1fa':'#edf7ef'};color:${p.role==='admin'?'#24577b':'#287747'}">${p.role==='admin'?'Admin':'Aktiv'}</span></div>`).join('');
      status.textContent=`${profiles.length} Benutzerkonten gefunden.`;
    } catch(err) { status.textContent=err.message||'Benutzer konnten nicht geladen werden.'; }
  }
  window.BaustellenUserManagement={open};
})();
