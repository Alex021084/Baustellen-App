(() => {
  "use strict";
  const URL = "https://vdzepnddsnspnmaintcb.supabase.co";
  const KEY = "sb_publishable_g0H7rda_fWQL_LaDggAHHA_5qpspRoc";
  const FN = URL + "/functions/v1/username-login";
  let supa;

  const css = document.createElement("style");
  css.textContent = `
  #baustellen-login{position:fixed;inset:0;z-index:2147483000;background:#f1f4f7;display:flex;align-items:center;justify-content:center;padding:18px;font-family:system-ui,-apple-system,sans-serif}
  #baustellen-login .panel{width:min(100%,410px);background:white;border-radius:18px;padding:25px;box-shadow:0 8px 30px #0002}
  #baustellen-login h1{font-size:24px;margin:0 0 8px;color:#172b3a}
  #baustellen-login p{color:#536575;line-height:1.45}
  #baustellen-login label{display:block;font-weight:650;margin:15px 0 6px}
  #baustellen-login input{width:100%;box-sizing:border-box;padding:13px;border:1px solid #c8d1da;border-radius:10px;font:inherit}
  #baustellen-login button{width:100%;margin-top:18px;padding:14px;border:0;border-radius:10px;background:#1769aa;color:white;font-size:16px;font-weight:700}
  #baustellen-login button:disabled{opacity:.6}
  #baustellen-login .error{color:#b42318;min-height:1.4em;font-size:14px}
  #baustellen-cloud-user{position:fixed;z-index:2147482000;right:8px;top:8px;background:#173f5f;color:white;border-radius:20px;padding:6px 10px;font:12px system-ui}
  `;
  document.head.append(css);

  function gate(message="") {
    if (document.getElementById("baustellen-login")) return;
    const el=document.createElement("div");
    el.id="baustellen-login";
    el.innerHTML=`<form class="panel" id="baustellen-login-form">
      <h1>Baustellen-App</h1>
      <p>Bitte melde dich mit deinem Benutzernamen und Passwort an.</p>
      <label for="bs-user">Benutzername</label>
      <input id="bs-user" name="username" autocomplete="username" autocapitalize="none" required minlength="3" maxlength="32">
      <label for="bs-pass">Passwort</label>
      <input id="bs-pass" name="password" type="password" autocomplete="current-password" required>
      <div class="error" id="bs-error" role="alert">${message}</div>
      <button type="submit">Anmelden</button>
    </form>`;
    document.body.append(el);
    el.querySelector("form").addEventListener("submit", doLogin);
  }

  function showUser(name) {
    document.getElementById("baustellen-login")?.remove();
    let tag=document.getElementById("baustellen-cloud-user");
    if(!tag){tag=document.createElement("div");tag.id="baustellen-cloud-user";document.body.append(tag);}
    tag.textContent="Angemeldet: "+name;
  }

  async function doLogin(ev) {
    ev.preventDefault();
    const form=ev.currentTarget, btn=form.querySelector("button");
    const username=form.username.value.trim().toLowerCase(), password=form.password.value;
    btn.disabled=true; btn.textContent="Anmeldung läuft …";
    form.querySelector(".error").textContent="";
    try {
      const r=await fetch(FN,{method:"POST",headers:{"Content-Type":"application/json","apikey":KEY},body:JSON.stringify({username,password})});
      const result=await r.json();
      if(!r.ok) throw new Error(result.error||"Anmeldung fehlgeschlagen.");
      const {error}=await supa.auth.setSession({access_token:result.access_token,refresh_token:result.refresh_token});
      if(error) throw error;
      showUser(username);
      window.dispatchEvent(new CustomEvent("baustellen:login",{detail:{username}}));
    } catch(e) {
      form.querySelector(".error").textContent=e.message||"Keine Verbindung zur Anmeldung.";
    } finally {btn.disabled=false;btn.textContent="Anmelden";}
  }

  async function start(){
    gate();
    try {
      await new Promise((resolve,reject)=>{
        if(window.supabase?.createClient) return resolve();
        const s=document.createElement("script");
        s.src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
        s.onload=resolve; s.onerror=()=>reject(new Error("Cloud-Bibliothek nicht erreichbar.")); document.head.append(s);
      });
      supa=window.supabase.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true}});
      const {data}=await supa.auth.getSession();
      if(data.session){
        const {data:u}=await supa.auth.getUser();
        if(u.user){
          const {data:p}=await supa.from("user_profiles").select("username").eq("id",u.user.id).maybeSingle();
          showUser(p?.username||"angemeldet");
        }
      }
    } catch(e) {
      const err=document.querySelector("#bs-error");
      if(err) err.textContent=e.message;
    }
  }
  window.BaustellenCloud={get client(){return supa;},async logout(){if(supa) await supa.auth.signOut();document.getElementById("baustellen-cloud-user")?.remove();gate();}};
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",start,{once:true}); else start();
})();
