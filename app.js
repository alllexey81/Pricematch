/* =======================================================
   PriceMatch v2.1 — SPA на чистом JS + localStorage
   ======================================================= */

const STORAGE_PREFIX = 'pm_session_';
const STORAGE_RESULT = 'pm_result_';
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

/* -------------------- STORAGE -------------------- */
function saveSession(code, data) {
  localStorage.setItem(STORAGE_PREFIX + code, JSON.stringify(data));
}
function loadSession(code) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + code);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveResult(code, data) {
  localStorage.setItem(STORAGE_RESULT + code, JSON.stringify(data));
}
function loadResult(code) {
  try {
    const raw = localStorage.getItem(STORAGE_RESULT + code);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function cleanupOldSessions() {
  const now = Date.now();
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith(STORAGE_PREFIX) || key.startsWith(STORAGE_RESULT)) {
      try {
        const data = JSON.parse(localStorage.getItem(key));
        if (data && data.createdAt && now - data.createdAt > TTL_MS) {
          localStorage.removeItem(key);
        }
      } catch { localStorage.removeItem(key); }
    }
  }
}

/* -------------------- UTIL -------------------- */
function generateUniqueCode() {
  for (let i = 0; i < 50; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!loadSession(code) && !loadResult(code)) return code;
  }
  return String(Date.now()).slice(-6);
}

/* =========================================================
   КОМПРОМИССНАЯ ЦЕНА (исправленный алгоритм)
   - строго ВНУТРИ пересечения (никогда на границах);
   - «красивый» шаг зависит от ширины диапазона;
   - точная середина исключена (непредсказуемость);
   - равновероятный случайный выбор из всех кандидатов.
   ========================================================= */
function computeCompromisePrice(lo, hi) {
  const width = hi - lo;
  const STEPS = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1];

  // «Красивый» шаг: крупнейший, при котором внутри диапазона
  // остаётся минимум ~6 интервалов (достаточно кандидатов)
  let step = 1;
  for (const s of STEPS) {
    if (width >= s * 6) { step = s; break; }
  }

  // Кандидаты — кратные шагу значения СТРОГО между lo и hi
  let candidates = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    if (v > lo && v < hi) candidates.push(v);
  }

  // Если шаг оказался слишком грубым — переходим на единицы
  if (candidates.length < 3 && step > 1) {
    candidates = [];
    for (let v = lo + 1; v < hi; v++) candidates.push(v);
  }

  // Вырожденный диапазон (ширина < 2) — берём округлённую середину
  if (candidates.length === 0) {
    return Math.round((lo + hi) / 2);
  }

  // Исключаем точную середину — цена не должна быть предсказуемой
  const mid = (lo + hi) / 2;
  const filtered = candidates.filter((v) => v !== mid);
  const pool = filtered.length ? filtered : candidates;

  return pool[Math.floor(Math.random() * pool.length)];
}

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

$('#btn-join').addEventListener('click', () => {
  joinByCode($('#join-code-input').value.trim());
});

function joinByCode(code) {
  if (!/^\d{6}$/.test(code)) { toast('Введите 6 цифр', 'error'); return; }
  const session = loadSession(code);
  if (!session) { toast('Сессия не найдена', 'error'); return; }

  // Защита: создатель вводит свой же код — открываем его экран кода
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

$('#btn-create').addEventListener('click', () => {
  const min = readInt('#creator-min');
  const max = readInt('#creator-max');
  if (min === null || max === null) { toast('Укажите обе границы диапазона', 'error'); return; }
  if (min < 0 || max < 0) { toast('Цена не может быть отрицательной', 'error'); return; }
  if (min >= max) { toast('«От» должно быть меньше «До»', 'error'); return; }

  const code = generateUniqueCode();
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
  saveSession(code, session);
  localStorage.setItem(MY_SESSION_KEY, code);

  openCreatorCode(session);
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

$('#btn-check-result').addEventListener('click', () => {
  const code = $('#result-code-input').value.trim();
  if (!/^\d{6}$/.test(code)) { toast('Введите 6-значный код', 'error'); return; }
  const result = loadResult(code);
  if (!result) { toast('Код не найден или срок истёк', 'error'); return; }
  state.resultCode = code;
  showFinalResult(result);
});

$('#btn-creator-cancel').addEventListener('click', () => {
  if (state.currentSessionCode) {
    localStorage.removeItem(STORAGE_PREFIX + state.currentSessionCode);
  }
  localStorage.removeItem(MY_SESSION_KEY);
  resetAll();
});

/* ================= ПАРТНЁР: РАСЧЁТ ================= */
$('#btn-calculate').addEventListener('click', () => {
  const session = state.currentSession;
  if (!session) { toast('Сессия не найдена', 'error'); return; }

  const pMin = readInt('#partner-min');
  const pMax = readInt('#partner-max');
  if (pMin === null || pMax === null) { toast('Укажите обе границы', 'error'); return; }
  if (pMin < 0 || pMax < 0) { toast('Цена не может быть отрицательной', 'error'); return; }
  if (pMin >= pMax) { toast('«От» должно быть меньше «До»', 'error'); return; }

  const uMin = session.min, uMax = session.max;
  const lo = Math.max(pMin, uMin);
  const hi = Math.min(pMax, uMax);

  const resultCode = generateUniqueCode();
  let resultData;

  if (lo > hi) {
    // Не пересеклись
    resultData = {
      deal: false,
      currency: session.currency,
      userRange: [uMin, uMax],
      partnerRange: [pMin, pMax],
      createdAt: Date.now(),
      sessionCode: state.currentSessionCode,
    };
  } else {
    // НОВАЯ логика: случайная цена строго внутри пересечения
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
    saveSession(state.currentSessionCode, session);
  }

  saveResult(resultCode, resultData);
  state.resultCode = resultCode;
  showFinalResult(resultData);
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
  if (state.currentSession) {
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
  const session = myCode ? loadSession(myCode) : null;
  const banner = $('#resume-banner');
  if (session) {
    banner.style.display = 'flex';
    $('#resume-code').textContent = 'Код: ' + session.code;
  } else {
    banner.style.display = 'none';
    if (myCode) localStorage.removeItem(MY_SESSION_KEY);
  }
}

$('#btn-resume').addEventListener('click', () => {
  const myCode = localStorage.getItem(MY_SESSION_KEY);
  const session = myCode ? loadSession(myCode) : null;
  if (!session) { refreshResumeBanner(); return; }
  if (session.status === 'completed' && session.resultCode) {
    const r = loadResult(session.resultCode);
    if (r) {
      state.resultCode = session.resultCode;
      showFinalResult(r);
      return;
    }
  }
  openCreatorCode(session);
});

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

/* -------------------- INIT -------------------- */
attachDigits($('#join-code-input'));
attachDigits($('#result-code-input'));
cleanupOldSessions();
refreshResumeBanner();
showScreen('landing');