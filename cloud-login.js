
/* Baustellen-App – Anmeldung über Supabase
   Benutzername und Passwort statt sichtbarer E-Mail-Adresse.
   Stellt window.BaustellenCloud.client für cloud-sync.js bereit.
*/
(() => {
  'use strict';

  const SUPABASE_URL = 'https://vdzepnddsnspnmaintcb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_g0H7rda_fWQL_LaDggAHHA_5qpspRoc';
  const AUTH_URL = SUPABASE_URL + '/functions/v1/username-auth';

  let client = null;

  function loadSupabase() {
    return new Promise((resolve, reject) => {
      if (window.supabase?.createClient) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = resolve;
      script.onerror = () => reject(
        new Error('Supabase-Bibliothek konnte nicht geladen werden.')
      );
      document.head.appendChild(script);
    });
  }

  function createLoginScreen() {
    if (document.getElementById('baustellen-login')) return;

    const style = document.createElement('style');
    style.textContent = `
      #baustellen-login {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        background: #f1f4f7;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
        font-family: system-ui, sans-serif;
      }
      #baustellen-login .panel {
        width: min(100%, 410px);
        background: white;
        border-radius: 18px;
        padding: 25px;
        box-shadow: 0 8px 30px #0002;
      }
      #baustellen-login h1 {
        font-size: 24px;
        margin: 0 0 8px;
        color: #172b3a;
      }
      #baustellen-login p {
        color: #64748b;
        margin-bottom: 22px;
      }
      #baustellen-login label {
        display: block;
        font-weight: 600;
        margin: 14px 0 6px;
      }
      #baustellen-login input {
        box-sizing: border-box;
        width: 100%;
        padding: 14px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        font-size: 17px;
      }
      #baustellen-login button {
        width: 100%;
        padding: 15px;
        margin-top: 22px;
        border: 0;
        border-radius: 10px;
        background: #1677d2;
        color: white;
        font-size: 17px;
        font-weight: 700;
      }
      #baustellen-login button:disabled {
        opacity: .6;
      }
      #baustellen-login .message {
        color: #b42318;
        min-height: 22px;
        font-size: 14px;
        margin-top: 12px;
      }
    `;
    document.head.appendChild(style);

    const screen = document.createElement('div');
    screen.id = 'baustellen-login';
    screen.innerHTML = `
      <div class="panel">
        <h1>Baustellen-App</h1>
        <p>Bitte melde dich mit deinem Benutzernamen an.</p>

        <form id="baustellen-login-form">
          <label for="baustellen-username">Benutzername</label>
          <input id="baustellen-username"
                 autocomplete="username"
                 autocapitalize="none"
                 required>

          <label for="baustellen-password">Passwort</label>
          <input id="baustellen-password"
                 type="password"
                 autocomplete="current-password"
                 required>

          <button id="baustellen-login-button" type="submit">
            Anmelden
          </button>
          <div class="message" id="baustellen-login-message"
               role="alert"></div>
        </form>
      </div>
    `;

    document.body.appendChild(screen);

    screen.querySelector('form').addEventListener('submit', signIn);
  }

  async function signIn(event) {
    event.preventDefault();

    const username = document
      .getElementById('baustellen-username').value.trim();

    const password = document
      .getElementById('baustellen-password').value;

    const button = document.getElementById('baustellen-login-button');
    const message = document.getElementById('baustellen-login-message');

    button.disabled = true;
    button.textContent = 'Anmeldung läuft …';
    message.textContent = '';

    try {
      const response = await fetch(AUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY
        },
        body: JSON.stringify({ username, password })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || result.message || 'Anmeldung fehlgeschlagen.'
        );
      }

      if (!result.access_token || !result.refresh_token) {
        throw new Error('Die Anmeldung lieferte keine gültige Sitzung.');
      }

      const { error } = await client.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token
      });

      if (error) throw error;

      document.getElementById('baustellen-login').remove();

      window.dispatchEvent(new Event('baustellen:login'));

    } catch (error) {
      message.textContent = error.message || 'Anmeldung fehlgeschlagen.';
      button.disabled = false;
      button.textContent = 'Anmelden';
    }
  }

  async function showUserBadge() {
  const { data } = await client.auth.getUser();
  if (!data.user) return;

  const { data: profile } = await client
    .from('user_profiles')
    .select('username')
    .eq('id', data.user.id)
    .maybeSingle();

  const old = document.getElementById('baustellen-user-badge');
  if (old) old.remove();

  const badge = document.createElement('div');
  badge.id = 'baustellen-user-badge';
  badge.textContent = 'Angemeldet: ' + (profile?.username || data.user.email?.split('@')[0] || 'Benutzer').replace(/^./, c => c.toUpperCase());
  Object.assign(badge.style, {
    position: 'fixed',
    top: '10px',
    left: '12px',
    zIndex: '9997',
    padding: '8px 12px',
    borderRadius: '18px',
    background: '#173b57',
    color: 'white',
    font: '600 13px system-ui'
  });

  document.body.appendChild(badge);
}   
   async function start() {
    try {
      await loadSupabase();

      client = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_KEY
      );

      window.BaustellenCloud = { client };

      const { data, error } = await client.auth.getSession();
      if (error) throw error;

      if (data.session) {
        await showUserBadge();         
        return;
      }

      createLoginScreen();

    } catch (error) {
      console.error('Baustellen-App Anmeldung:', error);
      createLoginScreen();

      const message = document.getElementById(
        'baustellen-login-message'
      );
      if (message) {
        message.textContent =
          'Verbindung konnte nicht hergestellt werden. Bitte Internet prüfen.';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
