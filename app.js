/* =======================================================
   PriceMatch v5 — аккаунты по e-mail + предмет сделки
   База: GitHub (приватный репозиторий), письма: EmailJS
   ======================================================= */

// 🔴 GitHub (токен подставится автоматически при сборке — НЕ трогай)
const GH_OWNER = 'alllexey81';
const GH_REPO  = 'pricematch-db';
const GH_TOKEN = '__GH_TOKEN_PLACEHOLDER__';

// 🔴 ВСТАВЬ свои значения из EmailJS
const EMAILJS_SERVICE_ID  = 'service_aujtyg8';
const EMAILJS_TEMPLATE_ID = 'template_0kjakrk';
const EMAILJS_PUBLIC_KEY  = '6tltV-IsA-1uv4bfZ';

const ACCOUNT_KEY = 'pm_account';
const MY_SESSION_KEY = 'pm_my_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;      // 30 дней
const LOGIN_TTL_MS = 10 * 60 * 1000;          // код входа живёт 10 минут

const CURRENCIES = {
  RUB: { symbol: '₽', label: '₽ RUB' },
  USD: { symbol: '$', label: '$ USD' },
  EUR: { symbol: '€', label: '€ EUR' },
};

const state = {
  selectedRole: null,
  currency: 'RUB',
  currentSession: null,
  currentSessionCode: null,
  resultCode: null,
  loginEmail: null,
};

const $ = (s) => document.querySelector(s);

const screens = {
  'login': $('#screen-login'),
  'landing': $('#screen-landing'),
  'creator-range': $('#screen-creator-range'),
  'creator-code': $('#screen-creator-code'),
  'partner-range': $('#screen-partner-range'),
  'dashboard': $('#screen-dashboard'),
  'result': $('#screen-result'),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(() => (el.className = 'toast'), 2600);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* -------------------- БАЗА: GitHub -------------------- */
const GH_API = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents`;

function ghHeaders() {
  return {
    'Authorization': `Bearer ${GH_TOKEN}`,
    'Accept': 'application/vnd.github+json',
  };
}
function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function b64decodeUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function isExpired(d) {
  return d && d.createdAt && (Date.now() - d.createdAt > TTL_MS);
}
async function dbGet(path) {
  const r = await fetch(`${GH_API}${path}.json`, { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GET ' + r.status);
  const meta = await r.json();
  return JSON.parse(b64decodeUtf8(meta.content));
}
async function dbPut(path, data) {
  const body = {
    message: 'pricematch: ' + path,
    content: b64encodeUtf8(JSON.stringify(data)),
  };
  const cur = await fetch(`${GH_API}${path}.json`, { headers: ghHeaders() });
  if (cur.ok) body.sha = (await cur.json()).sha;
  const r = await fetch(`${GH_API}${path}.json`, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('PUT ' + r.status);
}
function dbDelete(path) {
  (async () => {
    try {
      const cur = await fetch(`${GH_API}${path}.json`, { headers: ghHeaders() });
      if (!cur.ok) return;
      const sha = (await cur.json()).sha;
      await fetch(`${GH_API}${path}.json`, {
        method: 'DELETE',
        headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'pricematch: delete ' + path, sha }),
      });
    } catch (e) {}
  })();
}

async function saveSession(code, data) { await dbPut('/sessions/' + code, data); }
async function loadSession(code) {
  const d = await dbGet('/sessions/' + code);
  if (isExpired(d)) { dbDelete('/sessions/' + code); return null; }
  return d || null;
}
async function saveResult(code, data) { await dbPut('/results/' + code, data); }
async function loadResult(code) {
  const d = await dbGet('/results/' + code);
  if (isExpired(d)) { dbDelete('/results/' + code); return null; }
  return d || null;
}
async function generateUniqueCode() {
  for (let i = 0; i < 50; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const [s, r] = await Promise.all([
      dbGet('/sessions/' + code),
      dbGet('/results/' + code),
    ]);
    if (!s && !r) return code;
  }
  return String(Date.now()).slice(-6);
}

/* -------------------- АККАУНТЫ -------------------- */
function hashEmail(email) {
  let h = 5381;
  for (let i = 0; i < email.length; i++) {
    h = ((h * 33) ^ email.charCodeAt(i)) >>> 0;
  }
  return 'u' + h.toString(16);
}
function currentAccount() {
  try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY)); } catch { return null; }
}
async function ensureAccount(hash, email) {
  let acc = await dbGet('/accounts/' + hash);
  if (!acc) {
    acc = { email, createdAt: Date.now(), mySessions: [], joinedSessions: [] };
    await dbPut('/accounts/' + hash, acc);
  }
  return acc;
}
async function addSessionToAccount(hash, code, kind) {
  const acc = await dbGet('/accounts/' + hash);
  if (!acc) return;
  if (!acc.mySessions) acc.mySessions = [];
  if (!acc.joinedSessions) acc.joinedSessions = [];
  const arr = kind === 'own' ? acc.mySessions : acc.joinedSessions;
  if (!arr.includes(code)) {
    arr.push(code);
    await dbPut('/accounts/' + hash, acc);
  }
}

/* -------------------- EMAILJS -------------------- */
async function sendLoginCode(email, code) {
  const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: { email: email, passcode: code },
    }),
  });
  if (!r.ok) throw new Error('EmailJS ' + r.status);
}

/* -------------------- АЛГОРИТМ ЦЕНЫ -------------------- */
function computeCompromisePrice(lo, hi) {
  const width = hi - lo;
  const STEPS = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1];

  let step = 1;
  for (const s of STEPS) {
    if (width >= s * 6) { step = s; break; }
  }

  let candidates = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    if (v > lo && v < hi) candidates.push(v);
  }
  if (candidates.length < 3 && step > 1) {
    candidates = [];
    for (let v = lo + 1; v < hi; v++) candidates.push(v);
  }
  if (candidates.length === 0) return Math.round((lo + hi) / 2);

  const mid = (lo + hi) / 2;
  const filtered = candidates.filter((v) => v !== mid);
  const pool = filtered.length ? filtered : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* -------------------- UTIL -------------------- */
function formatPrice(n, cur = 'RUB') {
  const symbol = (CURRENCIES[cur] || CURRENCIES.RUB).symbol;
  return new Intl.NumberFormat('ru-RU').format(n) + ' ' + symbol;
}
function readInt(selector) {
  const val = $(selector).value.trim();
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}
function attachDigits(el) {
  el.addEventListener('input', () => {
    el.value = el.value.replace(/\D/g, '').slice(0, 6);
  });
}
function setLoading(btn, on) {
  if (!btn) return;
  if (on) {
    btn.dataset.oldHtml = btn.innerHTML;
    btn.disabled = true;
    btn.style.opacity = '0.7';
    btn.innerHTML = '⏳ Секунду…';
  } else {
    btn.disabled = false;
    btn.style.opacity = '';
    if (btn.dataset.oldHtml) btn.innerHTML = btn.dataset.oldHtml;
  }
}

/* ================= ВХОД ================= */
$('#btn-send-login').addEventListener('click', async () => {
  const email = $('#login-email').value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast('Введите корректный e-mail', 'error'); return;
  }
  if (EMAILJS_PUBLIC_KEY.includes('ВСТАВЬ')) {
    toast('⚙️ Настройте EmailJS в app.js', 'error'); return;
  }
  const btn = $('#btn-send-login');
  setLoading(btn, true);
  try {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await dbPut('/logins/' + code, {
      hash: hashEmail(email), email, createdAt: Date.now(),
    });
    await sendLoginCode(email, code);
    state.loginEmail = email;
    $('#login-email-echo').textContent = email;
    $('#login-code').value = '';
    $('#login-step-email').style.display = 'none';
    $('#login-step-code').style.display = 'block';
    toast('Код отправлен на почту', 'success');
  } catch (e) {
    toast('Не удалось отправить письмо. Попробуйте ещё раз', 'error');
  } finally {
    setLoading(btn, false);
  }
});

$('#btn-login-back').addEventListener('click', () => {
  $('#login-step-code').style.display = 'none';
  $('#login-step-email').style.display = 'block';
});

$('#btn-login').addEventListener('click', async () => {
  const code = $('#login-code').value.trim();
  if (!/^\d{6}$/.test(code)) { toast('Введите 6 цифр', 'error'); return; }
  const btn = $('#btn-login');
  setLoading(btn, true);
  try {
    const rec = await dbGet('/logins/' + code);
    if (!rec || !state.loginEmail || rec.hash !== hashEmail(state.loginEmail)) {
      toast('Неверный код', 'error'); return;
    }
    if (Date.now() - rec.createdAt > LOGIN_TTL_MS) {
      toast('Код истёк, запросите новый', 'error'); return;
    }
    dbDelete('/logins/' + code);
    await ensureAccount(rec.hash, rec.email);
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ hash: rec.hash, email: rec.email }));
    enterApp();
    toast('Добро пожаловать!', 'success');
  } catch (e) {
    toast('Ошибка входа. Попробуйте ещё раз', 'error');
  } finally {
    setLoading(btn, false);
  }
});

function enterApp() {
  const acc = currentAccount();
  $('#topbar-email').textContent = acc.email;
  showScreen('landing');
}

$('#btn-logout').addEventListener('click', () => {
  localStorage.removeItem(ACCOUNT_KEY);
  resetAll();
  $('#login-step-code').style.display = 'none';
  $('#login-step-email').style.display = 'block';
  $('#login-email').value = '';
  showScreen('login');
});

/* ================= ЛЕНДИНГ ================= */
document.querySelectorAll('.role-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.role-card').forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    state.selectedRole = card.dataset.role;
  });
});

$('#btn-continue').addEventListener('click', () => {
  if (!state.selectedRole) {
    toast('Выберите роль: Продавец или Покупатель', 'error'); return;
  }
  showScreen('creator-range');
});

$('#btn-join').addEventListener('click', async () => {
  const btn = $('#btn-join');
  setLoading(btn, true);
  try {
    await joinByCode($('#join-code-input').value.trim());
  } catch (e) {
    toast('Не удалось связаться с базой. Попробуйте ещё раз', 'error');
  } finally {
    setLoading(btn, false);
  }
});

async function joinByCode(code) {
  if (!/^\d{6}$/.test(code)) { toast('Введите 6 цифр', 'error'); return; }
  const session = await loadSession(code);
  if (!session) { toast('Сессия не найдена', 'error'); return; }

  if (code === localStorage.getItem(MY_SESSION_KEY)) {
    openCreatorCode(session);
    toast('Это ваша сессия', 'success');
    return;
  }
  if (session.status === 'completed') {
    toast('По этой сессии уже рассчитана цена', 'error'); return;
  }

  state.currentSession = session;
  state.currentSessionCode = code;
  fillPartnerScreen(session);
  showScreen('partner-range');
}

function fillPartnerScreen(session) {
  const partnerRole = session.role === 'seller' ? 'buyer' : 'seller';
  $('#partner-role-label').textContent = partnerRole === 'seller' ? 'Продавец' : 'Покупатель';
  $('#partner-currency').textContent = (CURRENCIES[session.currency] || CURRENCIES.RUB).label;
  $('#partner-item').textContent = session.item || '—';
  $('#partner-min').value = '';
  $('#partner-max').value = '';
}

/* ================= СОЗДАНИЕ СЕССИИ ================= */
document.querySelectorAll('.currency-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.currency-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    state.currency = btn.dataset.currency;
  });
});

$('#btn-create').addEventListener('click', async () => {
  const item = $('#creator-item').value.trim();
  const min = readInt('#creator-min');
  const max = readInt('#creator-max');
  if (!item) { toast('Опишите предмет сделки', 'error'); return; }
  if (min === null || max === null) { toast('Укажите обе границы диапазона', 'error'); return; }
  if (min < 0 || max < 0) { toast('Цена не может быть отрицательной', 'error'); return; }
  if (min >= max) { toast('«От» должно быть меньше «До»', 'error'); return; }

  const btn = $('#btn-create');
  setLoading(btn, true);
  try {
    const me = currentAccount();
    const code = await generateUniqueCode();
    const session = {
      code,
      role: state.selectedRole,
      item,
      min,
      max,
      currency: state.currency,
      owner: me.hash,
      partner: null,
      failCode: null,
      createdAt: Date.now(),
      status: 'waiting',
      resultCode: null,
    };
    await saveSession(code, session);
    await addSessionToAccount(me.hash, code, 'own');
    localStorage.setItem(MY_SESSION_KEY, code);
    openCreatorCode(session);
  } catch (e) {
    toast('Не удалось связаться с базой. Попробуйте ещё раз', 'error');
  } finally {
    setLoading(btn, false);
  }
});

/* ================= КОД СЕССИИ ================= */
function openCreatorCode(session) {
  state.currentSessionCode = session.code;
  state.currentSession = session;
  const cur = session.currency || 'RUB';
  $('#summary-item').textContent = session.item || '—';
  $('#summary-min').textContent = formatPrice(session.min, cur);
  $('#summary-max').textContent = formatPrice(session.max, cur);
  $('#creator-session-code').textContent = session.code;
  showScreen('creator-code');
}

$('#btn-copy').addEventListener('click', () => {
  copyText($('#creator-session-code').textContent, 'Код сессии скопирован');
});

$('#btn-creator-cancel').addEventListener('click', () => {
  if (state.currentSessionCode) dbDelete('/sessions/' + state.currentSessionCode);
  localStorage.removeItem(MY_SESSION_KEY);
  resetAll();
});

/* ================= РАСЧЁТ (ПАРТНЁР) ================= */
$('#btn-calculate').addEventListener('click', async () => {
  const session = state.currentSession;
  if (!session) { toast('Сессия не найдена', 'error'); return; }

  const pMin = readInt('#partner-min');
  const pMax = readInt('#partner-max');
  if (pMin === null || pMax === null) { toast('Укажите обе границы', 'error'); return; }
  if (pMin < 0 || pMax < 0) { toast('Цена не может быть отрицательной', 'error'); return; }
  if (pMin >= pMax) { toast('«От» должно быть меньше «До»', 'error'); return; }

  const btn = $('#btn-calculate');
  setLoading(btn, true);
  try {
    const me = currentAccount();
    const uMin = session.min, uMax = session.max;
    const lo = Math.max(pMin, uMin);
    const hi = Math.min(pMax, uMax);

    const resultCode = await generateUniqueCode();
    let resultData;

    if (lo > hi) {
      // Анонимность: чужие диапазоны НЕ сохраняются и НЕ показываются
      resultData = {
        deal: false,
        currency: session.currency,
        item: session.item,
        createdAt: Date.now(),
        sessionCode: state.currentSessionCode,
      };
      session.failCode = resultCode;
    } else {
      const price = computeCompromisePrice(lo, hi);
      resultData = {
        deal: true,
        currency: session.currency,
        item: session.item,
        price,
        intersectMin: lo,
        intersectMax: hi,
        createdAt: Date.now(),
        sessionCode: state.currentSessionCode,
      };
      session.status = 'completed';
      session.resultCode = resultCode;
    }

    session.partner = me.hash;
    await saveSession(state.currentSessionCode, session);
    await saveResult(resultCode, resultData);
    await addSessionToAccount(me.hash, state.currentSessionCode, 'joined');

    state.resultCode = resultCode;
    showFinalResult(resultData);
  } catch (e) {
    toast('Не удалось связаться с базой. Попробуйте ещё раз', 'error');
  } finally {
    setLoading(btn, false);
  }
});

/* ================= МОИ СДЕЛКИ ================= */
$('#btn-dashboard').addEventListener('click', () => openDashboard());

async function openDashboard() {
  showScreen('dashboard');
  const list = $('#dashboard-list');
  list.innerHTML = '<p class="muted">Загрузка…</p>';
  try {
    const me = currentAccount();
    const acc = await dbGet('/accounts/' + me.hash);
    if (!acc) { list.innerHTML = '<p class="muted">Пока нет сделок.</p>'; return; }
    const codes = [...new Set([
      ...(acc.mySessions || []),
      ...(acc.joinedSessions || []),
    ])].reverse();

    const rows = [];
    for (const code of codes) {
      const s = await loadSession(code);
      if (!s) continue;

      let result = null;
      if (s.status === 'completed' && s.resultCode) result = await loadResult(s.resultCode);
      else if (s.failCode) result = await loadResult(s.failCode);

      let status, cls;
      if (result && result.deal) { status = 'Сделка состоялась'; cls = 'ok'; }
      else if (result)           { status = 'Не договорились';   cls = 'warn'; }
      else if (s.owner === me.hash) { status = 'Ожидание ответа'; cls = 'wait'; }
      else { status = 'Ожидание расчёта'; cls = 'wait'; }

      const myRole = s.owner === me.hash ? s.role : (s.role === 'seller' ? 'buyer' : 'seller');
      const cur = s.currency || 'RUB';
      const priceTxt = (result && result.deal) ? ' • ' + formatPrice(result.price, cur) : '';

      rows.push(`
        <button class="deal-row" data-code="${code}">
          <div class="deal-main">
            <div class="deal-item">${esc(s.item || 'Без описания')}</div>
            <div class="deal-meta">
              Вы: ${myRole === 'seller' ? 'Продавец' : 'Покупатель'} • Код ${code} •
              ${formatPrice(s.min, cur)}–${formatPrice(s.max, cur)}${priceTxt}
            </div>
          </div>
          <span class="status-pill ${cls}">${status}</span>
        </button>`);
    }

    list.innerHTML = rows.join('') ||
      '<p class="muted">Пока нет сделок — создайте первую!</p>';
  } catch (e) {
    list.innerHTML = '<p class="muted">Ошибка загрузки. Попробуйте ещё раз.</p>';
  }
}

$('#dashboard-list').addEventListener('click', async (e) => {
  const row = e.target.closest('.deal-row');
  if (!row) return;
  const code = row.dataset.code;
  try {
    const s = await loadSession(code);
    if (!s) { toast('Сессия не найдена', 'error'); return; }
    const me = currentAccount();

    let result = null;
    if (s.status === 'completed' && s.resultCode) result = await loadResult(s.resultCode);
    else if (s.failCode) result = await loadResult(s.failCode);

    if (result) {
      state.resultCode = s.resultCode || null;
      state.currentSession = s;
      state.currentSessionCode = code;
      showFinalResult(result);
      return;
    }
    if (s.owner === me.hash) {
      openCreatorCode(s);
    } else {
      state.currentSession = s;
      state.currentSessionCode = code;
      fillPartnerScreen(s);
      showScreen('partner-range');
    }
  } catch (err) {
    toast('Не удалось открыть сделку', 'error');
  }
});

/* ================= РЕЗУЛЬТАТ ================= */
function showFinalResult(data) {
  const cur = data.currency || 'RUB';
  const successBlock = $('#result-success');
  const failBlock = $('#result-fail');
  const itemTxt = esc(data.item || '—');

  if (data.deal) {
    successBlock.style.display = 'block';
    failBlock.style.display = 'none';
    $('#result-item').innerHTML = itemTxt;
    $('#result-price').textContent = formatPrice(data.price, cur);
    $('#result-intersect').innerHTML =
      'Зона компромисса: <strong>' + formatPrice(data.intersectMin, cur) +
      ' — ' + formatPrice(data.intersectMax, cur) + '</strong>';

  } else {
    successBlock.style.display = 'none';
    failBlock.style.display = 'block';
    $('#result-item-fail').innerHTML = itemTxt;
    $('#fail-ranges-info').innerHTML =
      'Вы не договорились по цене.<br>' +
      'Диапазоны не пересеклись. Каждый видит только свой диапазон — ' +
      'измените границы и попробуйте ещё раз.';
  }
  showScreen('result');
}

$('#btn-retry').addEventListener('click', () => {
  if (state.currentSession) {
    fillPartnerScreen(state.currentSession);
    showScreen('partner-range');
  } else {
    resetAll();
  }
});

$('#btn-result-reset').addEventListener('click', () => {
  localStorage.removeItem(MY_SESSION_KEY);
  resetAll();
});
$('#btn-result-reset-fail').addEventListener('click', () => {
  localStorage.removeItem(MY_SESSION_KEY);
  resetAll();
});

function resetAll() {
  state.selectedRole = null;
  state.currency = 'RUB';
  state.currentSession = null;
  state.currentSessionCode = null;
  state.resultCode = null;
  document.querySelectorAll('.role-card').forEach((c) => c.classList.remove('selected'));
  document.querySelectorAll('.currency-btn').forEach((b) => {
    b.classList.toggle('selected', b.dataset.currency === 'RUB');
  });
  ['#creator-min', '#creator-max', '#partner-min', '#partner-max',
   '#join-code-input', '#creator-item'].forEach((s) => ($(s).value = ''));
  showScreen('landing');
}

/* -------------------- ОБЩЕЕ -------------------- */
function copyText(text, okMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => toast(okMsg, 'success'))
      .catch(() => toast('Не удалось скопировать', 'error'));
  } else {
    toast('Копирование недоступно: ' + text, 'error');
  }
}

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

/* -------------------- INIT -------------------- */
attachDigits($('#join-code-input'));
attachDigits($('#login-code'));

if (currentAccount()) {
  enterApp();
} else {
  showScreen('login');
}
