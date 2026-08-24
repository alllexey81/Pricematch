/* =======================================================
   PriceMatch v4 — база данных = приватный репозиторий GitHub
   Без сторонних сервисов: только GitHub API (стабилен в РФ)
   ======================================================= */

// 🔴 ВСТАВЬ СВОИ ЗНАЧЕНИЯ
const GH_OWNER = 'alllexey81';
const GH_REPO  = 'pricematch-db';
const GH_TOKEN = '__GH_TOKEN_PLACEHOLDER__';

const MY_SESSION_KEY = 'pm_my_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

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
};

const $ = (s) => document.querySelector(s);

const screens = {
  'landing': $('#screen-landing'),
  'creator-range': $('#screen-creator-range'),
  'creator-code': $('#screen-creator-code'),
  'partner-range': $('#screen-partner-range'),
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

/* -------------------- БАЗА: GitHub REST API -------------------- */
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
  // если файл уже есть — нужен его sha для обновления
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
    } catch (e) { /* тихое удаление */ }
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

  if (candidates.length === 0) {
    return Math.round((lo + hi) / 2);
  }

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

/* ================= СТРАНИЦА 1 ================= */
document.querySelectorAll('.role-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.role-card').forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    state.selectedRole = card.dataset.role;
  });
});

$('#btn-continue').addEventListener('click', () => {
  if (!state.selectedRole) {
    toast('Выберите роль: Продавец или Покупатель', 'error');
    return;
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
    toast('По этой сессии уже рассчитана цена', 'error');
    return;
  }

  state.currentSession = session;
  state.currentSessionCode = code;

  const partnerRole = session.role === 'seller' ? 'buyer' : 'seller';
  $('#partner-role-label').textContent = partnerRole === 'seller' ? 'Продавец' : 'Покупатель';
  $('#partner-currency').textContent = (CURRENCIES[session.currency] || CURRENCIES.RUB).label;
  $('#partner-min').value = '';
  $('#partner-max').value = '';
  showScreen('partner-range');
}

/* ================= СТРАНИЦА 2 ================= */
document.querySelectorAll('.currency-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.currency-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    state.currency = btn.dataset.currency;
  });
});

$('#btn-create').addEventListener('click', async () => {
  const min = readInt('#creator-min');
  const max = readInt('#creator-max');
  if (min === null || max === null) { toast('Укажите обе границы диапазона', 'error'); return; }
  if (min < 0 || max < 0) { toast('Цена не может быть отрицательной', 'error'); return; }
  if (min >= max) { toast('«От» должно быть меньше «До»', 'error'); return; }

  const btn = $('#btn-create');
  setLoading(btn, true);
  try {
    const code = await generateUniqueCode();
    const session = {
      code,
      role: state.selectedRole,
      min,
      max,
      currency: state.currency,
      createdAt: Date.now(),
      status: 'waiting',
      resultCode: null,
    };
    await saveSession(code, session);
    localStorage.setItem(MY_SESSION_KEY, code);
    openCreatorCode(session);
  } catch (e) {
    toast('Не удалось связаться с базой. Попробуйте ещё раз', 'error');
  } finally {
    setLoading(btn, false);
  }
});

/* ================= СТРАНИЦА 3 ================= */
function openCreatorCode(session) {
  state.currentSessionCode = session.code;
  state.currentSession = session;
  const cur = session.currency || 'RUB';
  $('#summary-min').textContent = formatPrice(session.min, cur);
  $('#summary-max').textContent = formatPrice(session.max, cur);
  $('#creator-session-code').textContent = session.code;
  $('#result-code-input').value = '';
  showScreen('creator-code');
}

$('#btn-copy').addEventListener('click', () => {
  copyText($('#creator-session-code').textContent, 'Код сессии скопирован');
});

$('#btn-check-result').addEventListener('click', async () => {
  const btn = $('#btn-check-result');
  setLoading(btn, true);
  try {
    const code = $('#result-code-input').value.trim();
    if (!/^\d{6}$/.test(code)) { toast('Введите 6-значный код', 'error'); return; }
    const result = await loadResult(code);
    if (!result) { toast('Код не найден или срок истёк', 'error'); return; }
    state.resultCode = code;
    showFinalResult(result);
  } catch (e) {
    toast('Не удалось связаться с базой. Попробуйте ещё раз', 'error');
  } finally {
    setLoading(btn, false);
  }
});

$('#btn-creator-cancel').addEventListener('click', () => {
  if (state.currentSessionCode) dbDelete('/sessions/' + state.currentSessionCode);
  localStorage.removeItem(MY_SESSION_KEY);
  resetAll();
});

/* ================= ПАРТНЁР: РАСЧЁТ ================= */
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
        createdAt: Date.now(),
        sessionCode: state.currentSessionCode,
      };
    } else {
      const price = computeCompromisePrice(lo, hi);
      resultData = {
        deal: true,
        currency: session.currency,
        price,
        intersectMin: lo,
        intersectMax: hi,
        createdAt: Date.now(),
        sessionCode: state.currentSessionCode,
      };
      session.status = 'completed';
      session.resultCode = resultCode;
      await saveSession(state.currentSessionCode, session);
    }

    await saveResult(resultCode, resultData);
    state.resultCode = resultCode;
    showFinalResult(resultData);
  } catch (e) {
    toast('Не удалось связаться с базой. Попробуйте ещё раз', 'error');
  } finally {
    setLoading(btn, false);
  }
});

/* ================= РЕЗУЛЬТАТ ================= */
function showFinalResult(data) {
  const cur = data.currency || 'RUB';
  const successBlock = $('#result-success');
  const failBlock = $('#result-fail');

  if (data.deal) {
    successBlock.style.display = 'block';
    failBlock.style.display = 'none';
    $('#result-price').textContent = formatPrice(data.price, cur);
    $('#result-intersect').innerHTML =
      'Зона компромисса: <strong>' + formatPrice(data.intersectMin, cur) +
      ' — ' + formatPrice(data.intersectMax, cur) + '</strong>';
    if (state.resultCode) {
      $('#result-code').textContent = state.resultCode;
      $('#result-code-block').style.display = 'block';
    }
  } else {
    successBlock.style.display = 'none';
    failBlock.style.display = 'block';
    $('#fail-ranges-info').innerHTML =
      '<div>Диапазон партнёра: <strong>' + formatPrice(data.userRange[0], cur) +
      ' — ' + formatPrice(data.userRange[1], cur) + '</strong></div>' +
      '<div>Ваш диапазон: <strong>' + formatPrice(data.partnerRange[0], cur) +
      ' — ' + formatPrice(data.partnerRange[1], cur) + '</strong></div>';
  }
  showScreen('result');
}

$('#btn-copy-result').addEventListener('click', () => {
  copyText($('#result-code').textContent, 'Код результата скопирован');
});

$('#btn-retry').addEventListener('click', () => {
  if (state.currentSession) showScreen('partner-range');
  else resetAll();
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
   '#join-code-input', '#result-code-input'].forEach((s) => ($(s).value = ''));
  refreshResumeBanner();
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

function refreshResumeBanner() {
  const myCode = localStorage.getItem(MY_SESSION_KEY);
  const banner = $('#resume-banner');
  if (myCode) {
    banner.style.display = 'flex';
    $('#resume-code').textContent = 'Код: ' + myCode;
  } else {
    banner.style.display = 'none';
  }
}

$('#btn-resume').addEventListener('click', async () => {
  const myCode = localStorage.getItem(MY_SESSION_KEY);
  if (!myCode) { refreshResumeBanner(); return; }
  try {
    const session = await loadSession(myCode);
    if (!session) { localStorage.removeItem(MY_SESSION_KEY); refreshResumeBanner(); return; }
    if (session.status === 'completed' && session.resultCode) {
      const r = await loadResult(session.resultCode);
      if (r) {
        state.resultCode = session.resultCode;
        showFinalResult(r);
        return;
      }
    }
    openCreatorCode(session);
  } catch (e) {
    toast('Не удалось связаться с базой', 'error');
  }
});

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

/* -------------------- INIT -------------------- */
attachDigits($('#join-code-input'));
attachDigits($('#result-code-input'));
refreshResumeBanner();
showScreen('landing');

if (GH_TOKEN.includes('ВСТАВЬ')) {
  setTimeout(() => toast('⚙️ Вставьте токен GitHub в app.js (строка GH_TOKEN)', 'error'), 600);
}
