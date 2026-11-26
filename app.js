'use strict';
/* Clóset Digital — PWA de clóset digitalizado para Ramiro y Nicole.
   Prendas con foto recortada (remove.bg), etiquetas y probador con
   Gemini, ideas de outfits según el clima (Open-Meteo).
   Colecciones propias en Firebase: 'closet_items', 'closet_outfits'
   y config en 'config/closet_app' (claves API + foto de la persona). */

const LS_KEY = 'closet-digital-v1';
const APP_VERSION = '1.0';

const CATS = [
  { id: 'top', name: 'Parte de arriba' },
  { id: 'bottom', name: 'Parte de abajo' },
  { id: 'dress', name: 'Vestidos' },
  { id: 'coat', name: 'Abrigos' },
  { id: 'shoes', name: 'Zapatos' },
  { id: 'accessory', name: 'Accesorios' }
];
const COLORS = ['Negro', 'Blanco', 'Gris', 'Beige', 'Café', 'Azul', 'Celeste', 'Verde', 'Rojo', 'Rosado', 'Morado', 'Amarillo', 'Naranjo', 'Estampado', 'Multicolor'];
const SEASONS = ['Verano', 'Invierno', 'Media estación', 'Todo el año'];
const NEUTRALS = ['Negro', 'Blanco', 'Gris', 'Beige', 'Café', 'Azul', 'Celeste'];

function catName(id) { const c = CATS.find(x => x.id === id); return c ? c.name : id; }
function norm(s) { return String(s || '').trim().toLowerCase(); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid(p) { return (p || 'x') + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ---------- Nube (Firebase) — mismo proyecto, colecciones propias ----------
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBa4XTJo47f3ZutCwIabO89SNTopQqTljc",
  authDomain: "finanzas-bugueno.firebaseapp.com",
  projectId: "finanzas-bugueno",
  storageBucket: "finanzas-bugueno.firebasestorage.app",
  messagingSenderId: "745240953305",
  appId: "1:745240953305:web:37595a80c087fef80799c8"
};
let db = null, cloudOn = false, cloudErr = '';
let currentView = 'clo';

// ---------- Estado ----------
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = Object.assign({ items: [], outfits: [], config: { removebgKey: '', geminiKey: '', personPhoto: '' } }, JSON.parse(raw));
      if (!Array.isArray(s.items)) s.items = [];
      if (!Array.isArray(s.outfits)) s.outfits = [];
      if (!s.config) s.config = { removebgKey: '', geminiKey: '', personPhoto: '' };
      return s;
    }
  } catch (e) {}
  return { items: [], outfits: [], config: { removebgKey: '', geminiKey: '', personPhoto: '' } };
}
function persistLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
}
let state = load();
function itemById(id) { return state.items.find(i => i.id === id) || null; }

// ---------- Operaciones (nube o local) ----------
async function saveItem(it) {
  const i = state.items.findIndex(x => x.id === it.id);
  if (i >= 0) state.items[i] = it; else state.items.push(it);
  if (cloudOn && db) { try { await db.collection('closet_items').doc(it.id).set(it); } catch (e) {} }
  persistLocal();
}
async function deleteItem(id) {
  state.items = state.items.filter(i => i.id !== id);
  if (cloudOn && db) { try { await db.collection('closet_items').doc(id).delete(); } catch (e) {} }
  persistLocal();
}
async function saveOutfit(o) {
  const i = state.outfits.findIndex(x => x.id === o.id);
  if (i >= 0) state.outfits[i] = o; else state.outfits.push(o);
  if (cloudOn && db) { try { await db.collection('closet_outfits').doc(o.id).set(o); } catch (e) {} }
  persistLocal();
}
async function deleteOutfit(id) {
  state.outfits = state.outfits.filter(o => o.id !== id);
  if (cloudOn && db) { try { await db.collection('closet_outfits').doc(id).delete(); } catch (e) {} }
  persistLocal();
}
async function saveConfig(patch) {
  Object.assign(state.config, patch);
  persistLocal();
  if (cloudOn && db) { try { await db.collection('config').doc('closet_app').set(patch, { merge: true }); } catch (e) {} }
}

// ---------- Acceso con correo y contraseña (compuerta) ----------
// Las reglas de Firestore (publicadas 2026-11-09) exigen sesión con correo:
// la sesión anónima recibe 403. Sin sesión válida, pantalla de ingreso.
let authUser = null, cloudStarted = false;

function loginMsg(txt, ok) {
  const e = document.getElementById('login-error');
  if (!e) return;
  e.textContent = txt;
  e.style.display = 'block';
  e.classList.toggle('login-ok', !!ok);
}

function initAuth(esperado) {
  try {
    if (typeof firebase === 'undefined') {
      esperado = esperado || 0;
      if (esperado < 5000) { setTimeout(() => initAuth(esperado + 500), 500); return; }
      loginMsg('Sin conexión para verificar tu sesión. Revisa internet y vuelve a abrir la app.');
      return;
    }
    if (!(firebase.apps && firebase.apps.length)) firebase.initializeApp(FIREBASE_CONFIG);
    firebase.auth().onAuthStateChanged(user => {
      if (!user || user.isAnonymous) {
        if (user) firebase.auth().signOut().catch(() => {});
        authUser = null;
        document.body.classList.remove('unlocked');
        return;
      }
      authUser = user;
      document.body.classList.add('unlocked');
      startCloud();
      if (currentView === 'set') renderSettings();
    });
  } catch (e) {
    cloudErr = (e && e.message) ? String(e.message).slice(0, 140) : 'error desconocido';
  }
}

function intentarLogin() {
  const email = (document.getElementById('login-email').value || '').trim();
  const pass = document.getElementById('login-pass').value;
  if (!email || !pass) { loginMsg('Escribe tu correo y tu contraseña.'); return; }
  firebase.auth().signInWithEmailAndPassword(email, pass).catch(err => {
    if (err && err.code === 'auth/too-many-requests') loginMsg('Demasiados intentos seguidos. Espera unos minutos e inténtalo de nuevo.');
    else loginMsg('No pudimos ingresar: revisa el correo y la contraseña.');
  });
}

async function startCloud() {
  if (cloudStarted) return;
  cloudStarted = true;
  try {
    db = firebase.firestore();
    try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) {}
    cloudOn = true;
    await migrateLocalToCloud();
    renderCurrent();
    db.collection('closet_items').onSnapshot(snap => {
      if (!snap.empty || localStorage.getItem('closet-seeded') === '1') {
        const arr = [];
        snap.forEach(d => { const x = d.data(); x.id = d.id; arr.push(x); });
        state.items = arr;
        persistLocal();
      }
      renderCurrent();
    });
    db.collection('closet_outfits').onSnapshot(snap => {
      if (!snap.empty || localStorage.getItem('closet-seeded') === '1') {
        const arr = [];
        snap.forEach(d => { const x = d.data(); x.id = d.id; arr.push(x); });
        state.outfits = arr;
        persistLocal();
      }
      renderCurrent();
    });
    db.collection('config').doc('closet_app').onSnapshot(doc => {
      if (doc.exists) {
        const c = doc.data() || {};
        state.config = {
          removebgKey: c.removebgKey || '',
          geminiKey: c.geminiKey || '',
          personPhoto: c.personPhoto || state.config.personPhoto || ''
        };
        persistLocal();
        if (currentView === 'set') renderSettings();
        if (currentView === 'try') renderTry();
      }
    });
  } catch (e) {
    cloudOn = false; db = null;
    cloudErr = (e && e.message) ? String(e.message).slice(0, 140) : 'error desconocido';
    if (currentView === 'set') renderSettings();
  }
}

async function migrateLocalToCloud() {
  try {
    if (localStorage.getItem('closet-migrated') === '1') return;
    const is = await db.collection('closet_items').limit(1).get();
    const os = await db.collection('closet_outfits').limit(1).get();
    const batch = db.batch();
    let n = 0;
    if (is.empty) state.items.forEach(i => { batch.set(db.collection('closet_items').doc(i.id), i); n++; });
    if (os.empty) state.outfits.forEach(o => { batch.set(db.collection('closet_outfits').doc(o.id), o); n++; });
    if (n) await batch.commit();
    localStorage.setItem('closet-migrated', '1');
    localStorage.setItem('closet-seeded', '1');
  } catch (e) {}
}

// ---------- Imágenes: leer, redimensionar ----------
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
function resizeDataURL(durl, maxDim, type, quality) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL(type || 'image/jpeg', quality == null ? 0.82 : quality));
      } catch (e) { resolve(durl); }
    };
    img.onerror = () => resolve(durl);
    img.src = durl;
  });
}
function dataToInline(durl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(durl || '');
  if (!m) return null;
  return { mime: m[1], data: m[2] };
}

// ---------- remove.bg: recorte de la prenda ----------
async function removeBg(origDataUrl) {
  const key = state.config.removebgKey;
  if (!key) return null;
  const blob = await (await fetch(origDataUrl)).blob();
  const fd = new FormData();
  fd.append('image_file', blob, 'prenda.jpg');
  fd.append('size', 'auto');
  const r = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': key },
    body: fd
  });
  if (!r.ok) throw new Error('remove.bg respondió ' + r.status);
  const out = await r.blob();
  const durl = await blobToDataURL(out);
  return await resizeDataURL(durl, 800, 'image/png');
}

// ---------- Gemini: etiquetas, ideas y probador ----------
async function geminiCall(model, body) {
  const key = state.config.geminiKey;
  if (!key) throw new Error('sin-clave-gemini');
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('Gemini respondió ' + r.status);
  return await r.json();
}
function geminiText(json) {
  try {
    const parts = json.candidates[0].content.parts || [];
    return parts.map(p => p.text || '').join('');
  } catch (e) { return ''; }
}
async function geminiTag(imgDataUrl) {
  const inl = dataToInline(imgDataUrl);
  if (!inl) return null;
  const prompt = 'Mira esta prenda de ropa y responde SOLO un JSON válido, sin texto extra, con esta forma exacta: ' +
    '{"nombre":"nombre corto en español, ej: Suéter de lana beige","categoria":"top","color":"Beige","temporada":"Invierno"} ' +
    'categoria debe ser una de: top (parte de arriba), bottom (parte de abajo), dress (vestido o enterito), coat (abrigo o chaqueta), shoes (zapatos), accessory (cartera, joyas, cinturón, etc). ' +
    'color debe ser uno de: ' + COLORS.join(', ') + '. temporada debe ser una de: ' + SEASONS.join(', ') + '.';
  const json = await geminiCall('gemini-2.5-flash', {
    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: inl.mime, data: inl.data } }] }],
    generationConfig: { responseMimeType: 'application/json' }
  });
  const txt = geminiText(json);
  const obj = JSON.parse(txt);
  if (!obj || typeof obj !== 'object') return null;
  return {
    name: String(obj.nombre || '').slice(0, 60),
    cat: CATS.some(c => c.id === obj.categoria) ? obj.categoria : 'top',
    color: COLORS.includes(obj.color) ? obj.color : 'Multicolor',
    season: SEASONS.includes(obj.temporada) ? obj.temporada : 'Todo el año'
  };
}
async function geminiOutfits(wx) {
  const catalog = state.items.map(i => ({ id: i.id, nombre: i.name, categoria: i.cat, color: i.color, temporada: i.season }));
  const prompt = 'Eres una estilista personal. Este es el clóset completo de la persona (JSON): ' + JSON.stringify(catalog) +
    '. El clima de hoy: ' + wxSummary(wx) +
    '. Arma exactamente 3 outfits distintos usando SOLO prendas del clóset. Cada outfit debe tener zapatos y (un vestido) o (parte de arriba + parte de abajo); agrega abrigo si hace frío (menos de 10 grados) y un accesorio solo si combina. ' +
    'Responde SOLO un JSON válido, sin texto extra, con esta forma: [{"prendas":["id1","id2"],"porque":"una frase breve en español explicando la elección según el clima"}]';
  const json = await geminiCall('gemini-2.5-flash', {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' }
  });
  const arr = JSON.parse(geminiText(json));
  if (!Array.isArray(arr)) return null;
  const out = [];
  arr.forEach(o => {
    if (!o || !Array.isArray(o.prendas)) return;
    const ids = o.prendas.filter(id => itemById(id));
    if (ids.length >= 2) out.push({ ids, why: String(o.porque || '').slice(0, 220) });
  });
  return out.length ? out.slice(0, 3) : null;
}
async function geminiTryOn(personDataUrl, items) {
  const parts = [{
    text: 'La primera foto es una persona de cuerpo completo. Las fotos siguientes son prendas de ropa (algunas con fondo transparente). ' +
      'Genera UNA imagen fotorrealista de la MISMA persona vistiendo TODAS esas prendas juntas como un outfit completo. ' +
      'Mantén su rostro, su cuerpo, su pose y el fondo de la primera foto. La ropa debe verse puesta de forma natural, con calce realista.'
  }];
  const p = dataToInline(personDataUrl);
  if (!p) throw new Error('foto-persona-inválida');
  parts.push({ inlineData: { mimeType: p.mime, data: p.data } });
  items.slice(0, 5).forEach(it => {
    const g = dataToInline(it.img);
    if (g) parts.push({ inlineData: { mimeType: g.mime, data: g.data } });
  });
  const json = await geminiCall('gemini-2.5-flash-image', {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
  });
  const respParts = (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
  for (const part of respParts) {
    if (part.inlineData && part.inlineData.data) {
      return 'data:' + (part.inlineData.mimeType || 'image/png') + ';base64,' + part.inlineData.data;
    }
  }
  throw new Error('Gemini no devolvió imagen');
}

// ---------- Clima (Open-Meteo, sin clave) ----------
function getCoords() {
  try {
    const raw = localStorage.getItem('closet-coords');
    if (raw) { const c = JSON.parse(raw); if (c && c.lat) return c; }
  } catch (e) {}
  return { lat: 40.5622, lon: -111.9297, label: 'South Jordan' };
}
const WMO = {
  0: 'Despejado', 1: 'Casi despejado', 2: 'Parcialmente nublado', 3: 'Nublado',
  45: 'Niebla', 48: 'Niebla', 51: 'Llovizna leve', 53: 'Llovizna', 55: 'Llovizna',
  56: 'Llovizna helada', 57: 'Llovizna helada', 61: 'Lluvia leve', 63: 'Lluvia', 65: 'Lluvia fuerte',
  66: 'Lluvia helada', 67: 'Lluvia helada', 71: 'Nieve leve', 73: 'Nieve', 75: 'Nieve fuerte', 77: 'Nieve',
  80: 'Chubascos leves', 81: 'Chubascos', 82: 'Chubascos fuertes', 85: 'Nieve leve', 86: 'Nieve',
  95: 'Tormenta', 96: 'Tormenta con granizo', 99: 'Tormenta con granizo'
};
async function fetchWeather() {
  const c = getCoords();
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + c.lat + '&longitude=' + c.lon +
    '&current=temperature_2m,apparent_temperature,weather_code' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1';
  const r = await fetch(url);
  if (!r.ok) throw new Error('clima ' + r.status);
  const j = await r.json();
  return {
    place: c.label,
    temp: Math.round(j.current.temperature_2m),
    feels: Math.round(j.current.apparent_temperature),
    desc: WMO[j.current.weather_code] || 'Clima variable',
    tmax: Math.round(j.daily.temperature_2m_max[0]),
    tmin: Math.round(j.daily.temperature_2m_min[0]),
    rain: (j.daily.precipitation_probability_max && j.daily.precipitation_probability_max[0] != null) ? j.daily.precipitation_probability_max[0] : null
  };
}
function wxSummary(wx) {
  if (!wx) return 'sin datos de clima';
  return wx.place + ': ' + wx.desc + ', ahora ' + wx.temp + '°C (sensación ' + wx.feels + '°C), hoy entre ' + wx.tmin + '° y ' + wx.tmax + '°C' +
    (wx.rain != null ? ', probabilidad de lluvia ' + wx.rain + '%' : '');
}

// ---------- Motor de outfits por reglas (respaldo sin Gemini) ----------
function seasonForTemp(t) {
  if (t == null) return 'Media estación';
  if (t <= 5) return 'Invierno';
  if (t <= 23) return 'Media estación';
  return 'Verano';
}
function fitsSeason(item, target) {
  return item.season === target || item.season === 'Todo el año' || item.season === 'Media estación';
}
function colorScore(a, b) {
  if (!a || !b) return 0;
  const na = NEUTRALS.includes(a), nb = NEUTRALS.includes(b);
  if ((a === 'Estampado' || a === 'Multicolor') && (b === 'Estampado' || b === 'Multicolor')) return -4;
  if (na && nb) return 2;
  if (na || nb) return 2;
  if (a === b) return 1;
  return 0;
}
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function generateOutfits(wx) {
  const target = seasonForTemp(wx ? wx.tmax : null);
  const cold = wx ? wx.tmax <= 10 : false;
  const pool = cat => shuffled(state.items.filter(i => i.cat === cat && fitsSeason(i, target)));
  const tops = pool('top'), bottoms = pool('bottom'), dresses = pool('dress'),
    shoes = pool('shoes'), coats = pool('coat'), accs = pool('accessory');
  if (!shoes.length) return [];
  const candidates = [];
  const build = base => {
    const ids = base.slice();
    let score = 0;
    for (let i = 0; i < base.length; i++) for (let j = i + 1; j < base.length; j++) score += colorScore(base[i].color, base[j].color);
    const shoe = shoes[Math.floor(Math.random() * shoes.length)];
    ids.push(shoe); score += colorScore(base[0].color, shoe.color);
    if (cold && coats.length) { const c = coats[0]; ids.push(c); score += 1; }
    if (accs.length && Math.random() < 0.6) ids.push(accs[0]);
    return { ids: ids.map(x => x.id), score };
  };
  dresses.slice(0, 3).forEach(d => candidates.push(build([d])));
  tops.slice(0, 3).forEach(t => bottoms.slice(0, 3).forEach(b => candidates.push(build([t, b]))));
  candidates.sort((a, b) => b.score - a.score);
  const seen = new Set(), out = [];
  for (const c of candidates) {
    const sig = c.ids.slice().sort().join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ ids: c.ids, why: ruleWhy(wx, cold, c.ids) });
    if (out.length >= 3) break;
  }
  return out;
}
function ruleWhy(wx, cold, ids) {
  if (!wx) return 'Combinación según los colores y la temporada de tus prendas.';
  let s = 'Hoy en ' + wx.place + ': ' + wx.desc.toLowerCase() + ', máx ' + wx.tmax + '°. ';
  if (cold) s += 'Con abrigo, porque hace frío. ';
  else if (wx.tmax >= 24) s += 'Ligero y fresco para el calor. ';
  else s += 'Capas cómodas para todo el día. ';
  if (wx.rain != null && wx.rain >= 40) s += 'Ojo: ' + wx.rain + '% de probabilidad de lluvia.';
  return s;
}

// ---------- Estado de pantallas ----------
let closetFilter = 'all';
let closetMode = null; // null = lista · 'add' = prenda nueva · id = editar
let addDraft = null, addBusy = '', addNote = '';
let wxCache = null, wxLoading = false, wxErr = '';
let ideasList = [], ideasBusy = '', ideasErr = '';
let trySel = [], tryBusy = false, tryResult = '', tryErr = '';

function pickPhoto(cb) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) cb(f); };
  inp.click();
}
function itemImgOrPh(it, phClass) {
  if (it && it.img) return '<img src="' + it.img + '" alt="">';
  return '<div class="' + (phClass || 'gph') + '">' + esc((it && it.name || '?').charAt(0)) + '</div>';
}

// ---------- Vista Clóset ----------
function renderCloset() {
  const el = document.getElementById('clo');
  if (closetMode !== null) { renderItemForm(el); return; }
  let html = '<div class="hero"><img src="./images/splash.jpg" alt=""><div class="hero-txt"><div class="ht">¿Qué me pongo hoy?</div><div class="hs">Tu clóset completo, en el bolsillo</div></div></div>';
  html += '<button class="btn" id="cAdd" style="margin:0 0 14px">+ Agregar prenda</button>';
  html += '<div class="chips"><button class="chip' + (closetFilter === 'all' ? ' on' : '') + '" data-f="all">Todo (' + state.items.length + ')</button>';
  CATS.forEach(c => {
    const n = state.items.filter(i => i.cat === c.id).length;
    if (n) html += '<button class="chip' + (closetFilter === c.id ? ' on' : '') + '" data-f="' + c.id + '">' + esc(c.name) + ' (' + n + ')</button>';
  });
  html += '</div>';
  const items = state.items.filter(i => closetFilter === 'all' || i.cat === closetFilter)
    .slice().sort((a, b) => a.name.localeCompare(b.name));
  if (!state.items.length) {
    html += '<div class="card"><div class="empty">Tu clóset está vacío.<br>Toca <b>+ Agregar prenda</b>, saca una foto y la app la recorta y la etiqueta sola.</div></div>';
  } else if (!items.length) {
    html += '<div class="card"><div class="empty">Nada en esta categoría todavía.</div></div>';
  } else {
    html += '<div class="grid2">';
    items.forEach(it => {
      html += '<div class="gcard" data-item="' + it.id + '"><div class="gimg">' + itemImgOrPh(it) + '</div>' +
        '<div class="gbody"><div class="gname">' + esc(it.name) + '</div>' +
        '<div class="gmeta">' + esc(catName(it.cat)) + ' · ' + esc(it.color) + '<br>' + esc(it.season) + '</div></div></div>';
    });
    html += '</div>';
  }
  el.innerHTML = html;
  document.getElementById('cAdd').onclick = () => {
    closetMode = 'add';
    addDraft = { img: '', name: '', cat: 'top', color: 'Beige', season: 'Todo el año' };
    addBusy = ''; addNote = '';
    renderCloset();
  };
  el.querySelectorAll('[data-f]').forEach(b => { b.onclick = () => { closetFilter = b.getAttribute('data-f'); renderCloset(); }; });
  el.querySelectorAll('[data-item]').forEach(c => {
    c.onclick = () => {
      const it = itemById(c.getAttribute('data-item'));
      if (!it) return;
      closetMode = it.id;
      addDraft = { img: it.img || '', name: it.name, cat: it.cat, color: it.color, season: it.season };
      addBusy = ''; addNote = '';
      renderCloset();
    };
  });
}

function renderItemForm(el) {
  const isNew = closetMode === 'add';
  const d = addDraft;
  const opt = (list, val) => list.map(x => '<option value="' + esc(x) + '"' + (x === val ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
  const catOpt = CATS.map(c => '<option value="' + c.id + '"' + (c.id === d.cat ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
  el.innerHTML = '<div class="card"><h2>' + (isNew ? 'Nueva prenda' : 'Editar prenda') + '</h2>' +
    '<div class="photoprev">' + (d.img ? '<img src="' + d.img + '" alt="">' : '<div class="empty">Sin foto todavía</div>') + '</div>' +
    '<button class="btn ghost" id="gPhoto" style="margin-top:14px">' + (d.img ? 'Cambiar foto' : '📸 Sacar o elegir foto') + '</button>' +
    (addBusy ? '<div class="busy"><span class="pulse">●</span> ' + esc(addBusy) + '</div>' : '') +
    (addNote ? '<div class="hint" style="color:var(--amber)">' + esc(addNote) + '</div>' : '') +
    '<label>Nombre</label><input id="gName" type="text" maxlength="60" value="' + esc(d.name) + '" placeholder="Ej: Suéter de lana beige">' +
    '<label>Categoría</label><select id="gCat">' + catOpt + '</select>' +
    '<label>Color principal</label><select id="gColor">' + opt(COLORS, d.color) + '</select>' +
    '<label>Temporada</label><select id="gSeason">' + opt(SEASONS, d.season) + '</select>' +
    '<button class="btn" id="gSave">Guardar prenda</button>' +
    '<button class="btn ghost" id="gCancel">Cancelar</button>' +
    (!isNew ? '<button class="btn danger" id="gDelete">Eliminar prenda</button>' : '') +
    '<div class="hint">' + (state.config.removebgKey ? 'Con foto nueva: remove.bg recorta el fondo' : 'Sin clave de remove.bg la foto queda tal cual (puedes agregarla en Ajustes)') +
    (state.config.geminiKey ? ' y Gemini completa nombre, categoría, color y temporada.' : ' y sin clave de Gemini completas los datos a mano.') + '</div></div>';
  const sync = () => {
    d.name = document.getElementById('gName').value;
    d.cat = document.getElementById('gCat').value;
    d.color = document.getElementById('gColor').value;
    d.season = document.getElementById('gSeason').value;
  };
  ['gName', 'gCat', 'gColor', 'gSeason'].forEach(id => {
    const n = document.getElementById(id);
    n.addEventListener('input', sync);
    n.addEventListener('change', sync);
  });
  document.getElementById('gPhoto').onclick = () => pickPhoto(processGarmentPhoto);
  document.getElementById('gSave').onclick = () => {
    sync();
    const name = d.name.trim() || catName(d.cat);
    const it = { id: isNew ? uid('pr-') : closetMode, name, cat: d.cat, color: d.color, season: d.season, img: d.img || '' };
    closetMode = null; addDraft = null;
    saveItem(it).then(() => renderCloset());
    renderCloset();
  };
  document.getElementById('gCancel').onclick = () => { closetMode = null; addDraft = null; renderCloset(); };
  const del = document.getElementById('gDelete');
  if (del) del.onclick = () => {
    if (confirm('¿Eliminar esta prenda del clóset?')) {
      const id = closetMode;
      closetMode = null; addDraft = null;
      deleteItem(id).then(() => renderCloset());
      renderCloset();
    }
  };
}

async function processGarmentPhoto(file) {
  addBusy = 'Leyendo la foto…'; renderCloset();
  try {
    const raw = await fileToDataURL(file);
    const orig = await resizeDataURL(raw, 1000, 'image/jpeg', 0.85);
    addDraft.img = orig;
    if (state.config.removebgKey) {
      addBusy = 'Recortando el fondo con remove.bg…'; renderCloset();
      try {
        const cut = await removeBg(orig);
        if (cut) addDraft.img = cut;
      } catch (e) { addNote = 'remove.bg no pudo recortar (revisa la clave en Ajustes). Quedó la foto original.'; }
    }
    if (state.config.geminiKey) {
      addBusy = 'Gemini está identificando la prenda…'; renderCloset();
      try {
        const tag = await geminiTag(addDraft.img);
        if (tag) {
          if (tag.name) addDraft.name = tag.name;
          addDraft.cat = tag.cat; addDraft.color = tag.color; addDraft.season = tag.season;
        }
      } catch (e) { addNote = (addNote ? addNote + ' ' : '') + 'Gemini no pudo etiquetar; completa los datos a mano.'; }
    }
  } catch (e) { addNote = 'No se pudo leer esa foto. Intenta con otra.'; }
  addBusy = ''; renderCloset();
}

// ---------- Vista Ideas ----------
function outfitImgsHtml(ids) {
  const items = ids.map(itemById).filter(Boolean);
  if (!items.length) return '';
  return '<div class="oimgs">' + items.slice(0, 5).map(it => '<div class="oitem">' + itemImgOrPh(it) + '</div>').join('') + '</div>';
}
function outfitNames(ids) {
  return ids.map(itemById).filter(Boolean).map(i => i.name).join(' · ');
}
function renderIdeas() {
  const el = document.getElementById('ide');
  let html = '';
  if (wxCache) {
    html += '<div class="wxcard"><h2>Clima de hoy · ' + esc(wxCache.place) + '</h2>' +
      '<div class="wbig">' + wxCache.temp + '° · ' + esc(wxCache.desc) + '</div>' +
      '<div class="wsub">Hoy entre ' + wxCache.tmin + '° y ' + wxCache.tmax + '° · sensación ' + wxCache.feels + '°' +
      (wxCache.rain != null ? ' · lluvia ' + wxCache.rain + '%' : '') + '</div>' +
      '<button class="login-link" id="wLoc" style="margin:6px 0 0;padding:0">Usar mi ubicación</button></div>';
  } else if (wxErr) {
    html += '<div class="wxcard"><h2>Clima de hoy</h2><div class="wsub">' + esc(wxErr) + ' Las ideas se generan solo con tu clóset.</div></div>';
  } else {
    html += '<div class="wxcard"><h2>Clima de hoy</h2><div class="wsub">Cargando el clima…</div></div>';
    if (!wxLoading) {
      wxLoading = true;
      fetchWeather().then(w => { wxCache = w; wxLoading = false; if (currentView === 'ide') renderIdeas(); })
        .catch(() => { wxLoading = false; wxErr = 'No se pudo cargar el clima.'; if (currentView === 'ide') renderIdeas(); });
    }
  }
  html += '<button class="btn" id="iGen" style="margin:0 0 14px"' + (ideasBusy ? ' disabled' : '') + '>✨ ' + (ideasBusy ? 'Pensando…' : '¿Qué me pongo hoy? Generar ideas') + '</button>';
  if (ideasBusy) html += '<div class="busy"><span class="pulse">●</span> ' + esc(ideasBusy) + '</div>';
  if (ideasErr) html += '<div class="card"><div class="empty">' + esc(ideasErr) + '</div></div>';
  ideasList.forEach((o, idx) => {
    html += '<div class="outfit">' + outfitImgsHtml(o.ids) +
      '<div class="oname">Idea ' + (idx + 1) + '</div>' +
      '<div class="owhy">' + esc(o.why || '') + '</div>' +
      '<div class="owhy" style="color:var(--faint)">' + esc(outfitNames(o.ids)) + '</div>' +
      '<div class="oacts"><button class="btn" data-save-idea="' + idx + '">Guardar outfit</button>' +
      '<button class="btn ghost small" data-try-idea="' + idx + '">Probar</button></div></div>';
  });
  const saved = state.outfits.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  html += '<div class="card"><h2>Outfits guardados · ' + saved.length + '</h2>';
  if (!saved.length) html += '<div class="empty">Sin outfits guardados todavía.<br>Genera ideas y guarda tus favoritos.</div>';
  html += '</div>';
  saved.forEach(o => {
    html += '<div class="outfit">' +
      (o.img ? '<div class="tryresult" style="margin-bottom:12px"><img src="' + o.img + '" alt=""></div>' : outfitImgsHtml(o.ids)) +
      '<div class="owhy">' + esc(outfitNames(o.ids) || 'Outfit del probador') + '</div>' +
      '<div class="oacts"><button class="btn ghost" data-del-outfit="' + o.id + '">Eliminar</button></div></div>';
  });
  el.innerHTML = html;
  const loc = document.getElementById('wLoc');
  if (loc) loc.onclick = () => {
    if (!navigator.geolocation) { alert('Este teléfono no comparte ubicación.'); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      try { localStorage.setItem('closet-coords', JSON.stringify({ lat: Math.round(pos.coords.latitude * 10000) / 10000, lon: Math.round(pos.coords.longitude * 10000) / 10000, label: 'Tu ubicación' })); } catch (e) {}
      wxCache = null; renderIdeas();
    }, () => alert('No se pudo obtener tu ubicación. Queda South Jordan por defecto.'));
  };
  document.getElementById('iGen').onclick = generarIdeas;
  el.querySelectorAll('[data-save-idea]').forEach(b => {
    b.onclick = () => {
      const o = ideasList[Number(b.getAttribute('data-save-idea'))];
      if (o) { saveOutfit({ id: uid('o-'), ids: o.ids.slice(), img: '', createdAt: Date.now() }).then(() => renderIdeas()); renderIdeas(); }
    };
  });
  el.querySelectorAll('[data-try-idea]').forEach(b => {
    b.onclick = () => {
      const o = ideasList[Number(b.getAttribute('data-try-idea'))];
      if (o) { trySel = o.ids.slice(); tryResult = ''; tryErr = ''; showView('try'); }
    };
  });
  el.querySelectorAll('[data-del-outfit]').forEach(b => {
    b.onclick = () => { if (confirm('¿Eliminar este outfit guardado?')) { deleteOutfit(b.getAttribute('data-del-outfit')).then(() => renderIdeas()); renderIdeas(); } };
  });
}

async function generarIdeas() {
  ideasBusy = state.config.geminiKey ? 'Gemini está armando tus outfits según el clima…' : 'Armando outfits con tu clóset…';
  ideasErr = ''; renderIdeas();
  let list = null;
  if (state.config.geminiKey) {
    try { list = await geminiOutfits(wxCache); } catch (e) { list = null; }
  }
  if (!list || !list.length) list = generateOutfits(wxCache);
  ideasBusy = '';
  ideasList = list || [];
  if (!ideasList.length) ideasErr = 'Todavía no se puede armar un outfit: agrega zapatos y un vestido, o una parte de arriba con una de abajo.';
  renderIdeas();
}

// ---------- Vista Probador ----------
function renderTry() {
  const el = document.getElementById('try');
  const hasPerson = !!state.config.personPhoto;
  let html = '';
  if (!hasPerson) {
    html += '<div class="personbox"><div class="empty" style="padding:6px 0 12px">Para el probador virtual, sube <b>una foto tuya de cuerpo completo</b>, con buena luz.<br>Se guarda una sola vez.</div>' +
      '<button class="btn" id="tPerson" style="margin-top:0">Subir mi foto</button></div>';
  } else {
    html += '<div class="personbox"><img src="' + state.config.personPhoto + '" alt="Tu foto">' +
      '<div><button class="login-link" id="tPerson" style="display:inline-block">Cambiar foto</button>' +
      '<button class="login-link" id="tPersonDel" style="display:inline-block;color:var(--red)">Quitar</button></div></div>';
  }
  if (!state.config.geminiKey) {
    html += '<div class="card"><div class="empty">El probador usa Gemini para generar la imagen.<br>Agrega tu clave de Gemini en la pestaña <b>Ajustes</b> y vuelve.</div></div>';
  }
  html += '<div class="card"><h2>Elige las prendas del outfit · ' + trySel.length + ' elegidas</h2>';
  if (!state.items.length) html += '<div class="empty">Primero agrega prendas en la pestaña Clóset.</div>';
  CATS.forEach(c => {
    const items = state.items.filter(i => i.cat === c.id);
    if (!items.length) return;
    html += '<div class="hint" style="margin:12px 0 6px"><b>' + esc(c.name) + '</b></div><div class="selgrid">';
    items.forEach(it => {
      html += '<button class="selitem' + (trySel.includes(it.id) ? ' on' : '') + '" data-sel="' + it.id + '">' + itemImgOrPh(it) + '</button>';
    });
    html += '</div>';
  });
  html += '</div>';
  html += '<button class="btn" id="tGen"' + ((hasPerson && trySel.length && state.config.geminiKey && !tryBusy) ? '' : ' disabled') + '>👗 ' + (tryBusy ? 'Generando…' : 'Generar probador') + '</button>';
  if (tryBusy) html += '<div class="busy"><span class="pulse">●</span> Gemini está vistiendo tu foto… puede tardar unos 20 a 40 segundos.</div>';
  if (tryErr) html += '<div class="hint" style="color:var(--red)">' + esc(tryErr) + '</div>';
  if (tryResult) {
    html += '<div class="tryresult" style="margin-top:14px"><img src="' + tryResult + '" alt="Probador"></div>' +
      '<div style="display:flex;gap:8px"><button class="btn" id="tSave" style="flex:1">Guardar como outfit</button>' +
      '<button class="btn ghost" id="tDiscard" style="flex:0 0 auto;width:auto;padding:16px 20px">Descartar</button></div>' +
      '<div class="hint">Es una aproximación de IA: el calce y los detalles pueden variar de la realidad.</div>';
  }
  el.innerHTML = html;
  const up = document.getElementById('tPerson');
  if (up) up.onclick = () => pickPhoto(async file => {
    try {
      const raw = await fileToDataURL(file);
      const small = await resizeDataURL(raw, 900, 'image/jpeg', 0.8);
      await saveConfig({ personPhoto: small });
    } catch (e) { alert('No se pudo leer esa foto.'); }
    renderTry();
  });
  const del = document.getElementById('tPersonDel');
  if (del) del.onclick = () => { if (confirm('¿Quitar tu foto del probador?')) { saveConfig({ personPhoto: '' }).then(() => renderTry()); renderTry(); } };
  el.querySelectorAll('[data-sel]').forEach(b => {
    b.onclick = () => {
      const id = b.getAttribute('data-sel');
      const i = trySel.indexOf(id);
      if (i >= 0) trySel.splice(i, 1); else trySel.push(id);
      renderTry();
    };
  });
  const gen = document.getElementById('tGen');
  if (gen) gen.onclick = generarProbador;
  const sv = document.getElementById('tSave');
  if (sv) sv.onclick = () => {
    saveOutfit({ id: uid('o-'), ids: trySel.slice(), img: tryResult, createdAt: Date.now() }).then(() => { tryResult = ''; showView('ide'); });
  };
  const dc = document.getElementById('tDiscard');
  if (dc) dc.onclick = () => { tryResult = ''; renderTry(); };
}

async function generarProbador() {
  const items = trySel.map(itemById).filter(Boolean);
  if (!state.config.personPhoto || !items.length) return;
  tryBusy = true; tryErr = ''; tryResult = ''; renderTry();
  try {
    const img = await geminiTryOn(state.config.personPhoto, items);
    tryResult = await resizeDataURL(img, 1000, 'image/jpeg', 0.85);
  } catch (e) {
    tryErr = 'El probador no pudo generar la imagen. Revisa que tu clave de Gemini en Ajustes sea válida e inténtalo de nuevo.';
  }
  tryBusy = false; renderTry();
}

// ---------- Ajustes ----------
function renderSettings() {
  const el = document.getElementById('set');
  el.innerHTML =
    '<div class="card"><h2>Claves de IA</h2>' +
    '<label style="margin-top:0">remove.bg (recorte de fotos)</label>' +
    '<input id="kRemovebg" type="password" autocomplete="off" placeholder="Pega tu clave de remove.bg" value="' + esc(state.config.removebgKey || '') + '">' +
    '<div class="hint">Cuenta gratis en <b>remove.bg</b> → menú API → API Key. Trae 50 recortes gratis al mes.</div>' +
    '<label>Google Gemini (etiquetas, ideas y probador)</label>' +
    '<input id="kGemini" type="password" autocomplete="off" placeholder="Pega tu clave de Gemini" value="' + esc(state.config.geminiKey || '') + '">' +
    '<div class="hint">Clave gratis en <b>Google AI Studio</b> (aistudio.google.com → Get API key). No es la suscripción de la app: es la clave de API.</div>' +
    '<button class="btn" id="kSave">Guardar claves</button>' +
    '<div class="hint">Las claves se guardan en tu nube privada, detrás de este login. Nunca quedan en el código de la app.</div></div>' +
    '<div class="card"><h2>Sincronización</h2>' +
    '<div class="hint" style="margin-top:0">' +
    (cloudOn
      ? '☁️ <b>Nube activada.</b> Lo que agreguen tú o Nicole aparece en ambos teléfonos.'
      : '📱 <b>Modo local.</b> Los datos viven solo en este teléfono.') +
    ((!cloudOn && cloudErr) ? '<br><span style="color:var(--red)">No se pudo conectar: ' + esc(cloudErr) + '</span>' : '') +
    '</div></div>' +
    '<div class="card"><h2>Sesión</h2>' +
    '<div class="hint" style="margin-top:0">' + (authUser ? 'Ingresaste como <b>' + esc(authUser.email || '') + '</b>.' : 'Sin sesión de correo: la app parte en modo local.') + '</div>' +
    '<button class="btn ghost" id="sSignOut">Cerrar sesión</button></div>' +
    '<div class="card"><h2>Respaldo</h2>' +
    '<button class="btn ghost" id="sExport">Exportar datos (JSON)</button>' +
    '<button class="btn danger" id="sWipe" style="margin-top:10px">Borrar todo (clóset y outfits)</button>' +
    '<div class="hint">El respaldo no incluye las fotos en tamaño completo si exportas desde el teléfono; úsalo como registro.</div></div>' +
    '<div class="ver">Clóset Digital · v' + APP_VERSION + '</div>';
  document.getElementById('kSave').onclick = () => {
    const patch = {
      removebgKey: document.getElementById('kRemovebg').value.trim(),
      geminiKey: document.getElementById('kGemini').value.trim()
    };
    saveConfig(patch).then(() => { alert('Claves guardadas. Ya puedes agregar prendas con recorte e ideas con IA.'); renderSettings(); });
  };
  const so = document.getElementById('sSignOut');
  if (so) so.onclick = () => {
    try { firebase.auth().signOut().then(() => location.reload()).catch(() => location.reload()); }
    catch (e) { location.reload(); }
  };
  document.getElementById('sExport').onclick = () => {
    const blob = new Blob([JSON.stringify({ items: state.items, outfits: state.outfits }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'closet-respaldo-' + todayISO() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  document.getElementById('sWipe').onclick = async () => {
    if (confirm('¿Borrar TODO el clóset y los outfits guardados?') &&
        confirm('¿Seguro? No se puede deshacer.')) {
      if (cloudOn && db) {
        try {
          for (const col of ['closet_items', 'closet_outfits']) {
            const snap = await db.collection(col).get();
            const batch = db.batch();
            snap.forEach(d => batch.delete(d.ref));
            await batch.commit();
          }
          localStorage.removeItem('closet-migrated');
        } catch (e) {}
      }
      state.items = []; state.outfits = [];
      persistLocal(); renderCurrent();
    }
  };
}

// ---------- Navegación ----------
const VIEW_IDS = { clo: 'vclo', ide: 'vide', try: 'vtry', set: 'vset' };
function showView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  document.getElementById(VIEW_IDS[name]).classList.add('on');
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.getAttribute('data-v') === name));
  renderCurrent();
  window.scrollTo(0, 0);
}
function renderCurrent() {
  if (currentView === 'clo') renderCloset();
  if (currentView === 'ide') renderIdeas();
  if (currentView === 'try') renderTry();
  if (currentView === 'set') renderSettings();
}
document.querySelectorAll('nav button').forEach(b => {
  b.onclick = () => showView(b.getAttribute('data-v'));
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

showView('clo');
initAuth();
// Splash con foto: se muestra al abrir y se desvanece cuando la app cargó.
(function () {
  let hidden = false;
  const hide = () => {
    if (hidden) return;
    hidden = true;
    const sp = document.getElementById('splash');
    if (!sp) return;
    sp.classList.add('hide');
    setTimeout(() => { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 700);
  };
  window.addEventListener('load', () => setTimeout(hide, 900));
  setTimeout(hide, 3200); // respaldo por si 'load' ya pasó
})();
document.getElementById('btn-login').addEventListener('click', intentarLogin);
document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') intentarLogin(); });
document.getElementById('login-olvide').addEventListener('click', () => {
  const email = (document.getElementById('login-email').value || '').trim();
  if (!email) { loginMsg('Escribe primero tu correo y después toca «Olvidé mi contraseña».'); return; }
  firebase.auth().sendPasswordResetEmail(email).then(() => {
    loginMsg('Te enviamos un correo para crear una contraseña nueva. Revisa la bandeja de ' + email + '.', true);
  }).catch(() => { loginMsg('No pudimos enviar el correo. Revisa que la dirección esté bien escrita.'); });
});
checkForUpdate();
if (!window.__updWatch) window.__updWatch = setInterval(checkForUpdate, 60000);

// ---------- Actualización visible con un toque (limpieza total) ----------
async function checkForUpdate() {
  try {
    const r = await fetch('./version.json', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (!j.v || j.v === APP_VERSION || document.getElementById('updBtn')) return;
    const target = j.v;
    const b = document.createElement('button');
    b.id = 'updBtn';
    b.textContent = '↓ Hay una versión nueva — toca para actualizar';
    b.onclick = async () => {
      b.textContent = 'Actualizando…';
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
        const names = await caches.keys();
        await Promise.all(names.map(k => caches.delete(k)));
      } catch (e) {}
      setTimeout(() => {
        window.location.replace('./index.html?upd=' + target + '-' + Date.now());
      }, 400);
    };
    document.body.appendChild(b);
  } catch (e) {}
}
