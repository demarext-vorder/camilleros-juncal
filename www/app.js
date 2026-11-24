'use strict';
/* Camilleros Juncal - app de camilleros. JS puro, sin dependencias. */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const plug = (n) => (NATIVE ? window.Capacitor.registerPlugin(n) : null);
const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };

const S = {
  server: NATIVE ? LS.get('cj_server') || '' : '',
  token: LS.get('cj_token'), user: null, ws: null,
  tab: null, traslados: [], hist: [], equipo: [], stats: null, lugares: [],
  alertados: new Set(), conectado: false, admin: 'usuarios',
  form: { pac: null, destino: '', prioridad: 'normal', req: [], nota: '', origen: '' },
  scanErr: '', nota: '', demo: false, embed: false, intro: false, introIdx: 0,
};
const REQS = ['Oxígeno', 'Aislamiento', 'Silla de ruedas', 'Camilla', 'Acompañante', 'Monitor'];


/* ---------- Íconos de línea animados (estilo Gastos) ---------- */
const spokes = [0,1,2,3,4,5,6,7].map((k) => { const a = k * Math.PI / 4, c = Math.cos(a), sn = Math.sin(a);
  return `<path d="M${(12 + 6.5 * c).toFixed(2)} ${(12 + 6.5 * sn).toFixed(2)}L${(12 + 9.5 * c).toFixed(2)} ${(12 + 9.5 * sn).toFixed(2)}"/>`; }).join('');
const ICONS = {
  list: '<path d="M6 7h13M6 12h9M6 17h11"/>',
  bed: '<path d="M3 12h16l3-3M7 12v5M15 12v5M3 9h4"/><circle cx="7" cy="19.5" r="1.4"/><circle cx="15" cy="19.5" r="1.4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9" r="2.4"/><path d="M17 14c2.6 0 4.5 2 4.5 5"/>',
  gear: `<g class="gear"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5"/>${spokes}</g>`,
  camera: '<rect x="3" y="7" width="18" height="12" rx="3.5"/><circle cx="12" cy="13" r="3.2"/><path d="M8 7l1.5-2.5h5L16 7"/>',
  scan: '<path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M4 12h16"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  hand: '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 10V5a1.5 1.5 0 0 1 3 0v6M14 10V6.5a1.5 1.5 0 0 1 3 0V13a7 7 0 0 1-7 7c-2.5 0-4-1.2-5.2-3.2L3 13.5a1.5 1.5 0 0 1 2.6-1.5L8 14.5"/>',
  mega: '<path d="M4 10v4h3.5L15 18V6L7.5 10H4z"/><path d="M18 9.5c1.6 1.2 1.6 3.8 0 5"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  coffee: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3"/>',
};
const ICON = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${(ICONS[n] || '').replace(/<(path|circle|rect|line)\b/g, '<$1 pathLength="1"')}</svg>`;
const live = () => `<i class="live ${S.conectado ? '' : 'off'}"></i>${S.conectado ? 'conectado' : 'sin conexión…'}`;
const bigIco = (n) => `<div class="bigico float">${ICON(n)}</div>`;
/** Números que cuentan hasta su valor. */
function contar() {
  document.querySelectorAll('.stat b[data-n]').forEach((el) => {
    const to = Number(el.dataset.n), dec = String(el.dataset.n).includes('.') ? 1 : 0, t0 = performance.now(), key = el.dataset.k;
    const from = (S.prevStats && S.prevStats[key]) || 0;
    const tick = (t) => { const k = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - k, 3), v = from + (to - from) * e;
      el.firstChild.nodeValue = dec ? v.toFixed(1) : Math.round(v); if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  S.prevStats = Object.fromEntries([...document.querySelectorAll('.stat b[data-n]')].map((e) => [e.dataset.k, Number(e.dataset.n)]));
}

/* ---------- API ---------- */
async function api(path, method = 'GET', body) {
  if (S.demo) {
    try { return await Demo.api(path, method, body, S.token); }
    catch (e) { if (e.code === 401 && path !== '/login') { salir(true); } throw e; }
  }
  let r;
  try {
    r = await fetch(S.server + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { S.conectado = false; throw new Error('Sin conexión con el servidor'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token && path !== '/login') { salir(true); throw new Error('Sesión vencida'); }
  if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
  return j;
}
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); }
function modal(html, onMount) {
  const root = $('#modal-root'); root.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
  $('.modal-bg', root).addEventListener('click', (e) => { if (e.target.classList.contains('modal-bg')) cerrarModal(); });
  onMount && onMount(root);
}
const cerrarModal = () => { $('#modal-root').innerHTML = ''; };
const hace = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`; };
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
const ESTADO = { EMITIDA: 'Pendiente', ACEPTADA: 'Aceptado', EN_TRASLADO: 'En traslado', COMPLETADA: 'Finalizado', CANCELADA: 'Cancelado' };
const esDespacho = () => S.user && (S.user.rol === 'conmutador' || S.user.rol === 'admin');

/* ---------- Nativo: notificaciones, servicio en segundo plano, escáner ---------- */
const Nat = {
  async init() {
    if (!NATIVE) return;
    try {
      const LN = plug('LocalNotifications');
      await LN.requestPermissions();
      await LN.createChannel({ id: 'traslados', name: 'Traslados nuevos', description: 'Avisos del conmutador', importance: 5, visibility: 1, vibration: true, lights: true });
    } catch (e) { console.warn('notif', e); }
  },
  async servicio(on) {
    if (!NATIVE) return;
    try {
      const FS = plug('ForegroundService');
      if (on) {
        try { await FS.requestPermissions(); } catch {}
        await FS.startForegroundService({ id: 1001, title: 'Camilleros Juncal · En turno', body: 'Esperando traslados del conmutador', smallIcon: 'ic_stat_camilleros', serviceType: 1 });
      } else await FS.stopForegroundService();
    } catch (e) { console.warn('fgs', e); }
  },
  async notificar(t) {
    if (!NATIVE) return;
    try {
      await plug('LocalNotifications').schedule({ notifications: [{ id: 2000 + (t.id % 1000), channelId: 'traslados',
        title: (t.prioridad === 'urgente' ? '🚨 URGENTE · ' : '🛏 ') + 'Nuevo traslado',
        body: `${t.paciente} → ${t.destino}`, smallIcon: 'ic_stat_camilleros' }] });
    } catch (e) { console.warn('notify', e); }
  },
};
/** Lee un código de barras o QR. En el celular abre el escáner; en PC pide el código a mano (modo prueba). */
async function escanear(titulo, demoCode) {
  if (S.demo && demoCode) return escaneoSimulado(titulo, demoCode);
  if (NATIVE) {
    const BS = plug('BarcodeScanner');
    try {
      const { available } = await BS.isGoogleBarcodeScannerModuleAvailable();
      if (!available) { await BS.installGoogleBarcodeScannerModule(); toast('Instalando módulo de escaneo de Google… reintentá en unos segundos', 6000); return null; }
      const { barcodes } = await BS.scan({ formats: [] });
      return barcodes && barcodes[0] ? barcodes[0].rawValue : null;
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('No se pudo abrir la cámara: ' + (e.message || e)); return null; }
  }
  return codigoManual(titulo + ' (modo prueba)');
}
function escaneoSimulado(titulo, code) {
  return new Promise((res) => {
    const d = document.createElement('div'); d.className = 'scanov';
    d.innerHTML = `<div class="scanbox"><i></i><i></i><i></i><i></i><div class="line"></div></div><b>${esc(titulo)}</b><small>Modo demo · escaneo simulado</small>`;
    document.body.appendChild(d); beep();
    setTimeout(() => { navigator.vibrate && navigator.vibrate(120); d.remove(); res(code); }, embedDelay(1500));
  });
}
const embedDelay = (ms) => ms;
function codigoManual(titulo) {
  return new Promise((res) => modal(`<h3>${esc(titulo)}</h3><p class="hint">Escribí o pegá el código de la pulsera / QR (DNI, código de pulsera o historia clínica).</p>
    <input id="cm" autocomplete="off" autofocus placeholder="Código"><div style="height:12px"></div>
    <button class="btn" id="cmok">Confirmar</button><button class="link" id="cmno" style="width:100%">Cancelar</button>`, () => {
    const done = (v) => { cerrarModal(); res(v); };
    $('#cmok').onclick = () => done($('#cm').value.trim() || null); $('#cmno').onclick = () => done(null);
    $('#cm').onkeydown = (e) => e.key === 'Enter' && done($('#cm').value.trim() || null);
  }));
}
function beep() {
  try { const a = beep.a || (beep.a = new (window.AudioContext || window.webkitAudioContext)()); const o = a.createOscillator(), g = a.createGain();
    o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.25); } catch {}
}

/* ---------- Sesión / conexión ---------- */
function salir(silencioso) {
  if (S.token && !silencioso) api('/logout', 'POST').catch(() => {});
  if (!S.demo) Nat.servicio(false);
  S.demo = false; Demo.onMessage(null);
  if (S.ws) { S.ws.onclose = null; S.ws.close(); S.ws = null; }
  S.token = null; S.user = null; LS.del('cj_token'); S.tab = null; render();
}
function conectarWS() {
  if (S.demo) { S.conectado = true; Demo.onMessage(onMensaje); return; }
  if (S.ws) { S.ws.onclose = null; try { S.ws.close(); } catch {} }
  if (!S.token) return;
  const base = (S.server || location.origin).replace(/^http/, 'ws');
  const ws = new WebSocket(`${base}/ws?token=${S.token}`); S.ws = ws;
  ws.onopen = () => { S.conectado = true; cargar(); pintarEstado(); };
  ws.onmessage = (e) => { const m = JSON.parse(e.data); onMensaje(m); };
  ws.onclose = () => { S.conectado = false; pintarEstado(); if (S.token) setTimeout(conectarWS, 3000); };
}
const pintarEstado = () => { const el = $('#conn'); if (el) el.innerHTML = live(); };

function onMensaje(m) {
  if (m.tipo === 'nueva' && S.user.rol === 'camillero' && m.traslado && !S.alertados.has(m.traslado.id + m.traslado.emitido_en + (m.devuelta ? 'd' : ''))) {
    S.alertados.add(m.traslado.id + m.traslado.emitido_en + (m.devuelta ? 'd' : ''));
    if (!miActivo()) { alertaNueva(m.traslado); if (!S.demo) Nat.notificar(m.traslado); }
  }
  if (m.tipo === 'actualizada' && S.user.rol === 'camillero' && m.traslado && m.traslado.camillero_id !== S.user.id && !m.cancelada) {
    const a = $('.alert-bg'); if (a && a.dataset.id == m.traslado.id) { a.remove(); stopAlarm(); toast(`${m.traslado.camillero || 'Otro camillero'} tomó el traslado`); }
  }
  if (m.tipo === 'actualizada' && m.cancelada && S.user.rol === 'camillero' && m.traslado.camillero_id === S.user.id) toast('⚠ El conmutador canceló tu traslado', 6000);
  cargar();
}

async function cargar() {
  if (!S.token || !S.user) return;
  try {
    S.traslados = await api('/traslados');
    if (S.user.rol === 'camillero') S.hist = await api('/traslados?historial=1');
    else { S.equipo = await api('/equipo'); S.stats = await api('/estadisticas'); }
    if (!S.lugares.length) S.lugares = await api('/lugares');
    S.conectado = true;
  } catch (e) { if (S.token) S.conectado = false; }
  render(true);
}
const miActivo = () => S.traslados.find((t) => t.camillero_id === S.user.id && ['ACEPTADA', 'EN_TRASLADO'].includes(t.estado));

/* ---------- Alarma de traslado nuevo ---------- */
let alarmTimer;
function stopAlarm() { clearInterval(alarmTimer); alarmTimer = null; }
function alertaNueva(t) {
  stopAlarm(); document.querySelectorAll('.alert-bg').forEach((n) => n.remove());
  const d = document.createElement('div'); d.className = 'alert-bg ' + (t.prioridad === 'urgente' ? '' : 'norm'); d.dataset.id = t.id;
  d.innerHTML = `<div class="bell">${ICON('bell')}</div><small style="letter-spacing:1px;font-weight:700">${t.prioridad === 'urgente' ? 'TRASLADO URGENTE' : 'NUEVO TRASLADO'}</small>
    <div class="pn">${esc(t.paciente)}</div><div>${esc(t.origen || '')}</div>
    <div class="box"><small>DESTINO</small><div style="font-size:24px;font-weight:800">${esc(t.destino)}</div>${t.requisitos ? `<div style="margin-top:6px">${esc(t.requisitos)}</div>` : ''}${t.nota_emision ? `<div style="margin-top:6px">📝 ${esc(t.nota_emision)}</div>` : ''}</div>
    <button class="btn big" id="al-ok">${ICON('hand')} ME HAGO CARGO</button><button class="btn" id="al-no">Ver después</button>`;
  document.body.appendChild(d);
  const ring = () => { beep(); navigator.vibrate && navigator.vibrate([400, 200, 400]); };
  ring(); alarmTimer = setInterval(ring, 1800);
  $('#al-no', d).onclick = () => { stopAlarm(); d.remove(); S.tab = 'pend'; render(); };
  $('#al-ok', d).onclick = async () => { stopAlarm(); d.remove(); await accion(`/traslados/${t.id}/aceptar`, null, () => { S.tab = 'mio'; }); };
}
async function accion(path, body, ok) {
  try { await api(path, 'POST', body || {}); ok && ok(); await cargar(); }
  catch (e) { toast(e.message, 5000); cargar(); }
}

/* ---------- Render ---------- */
function render(soft) {
  const app = $('#app');
  const ae = document.activeElement;
  if (soft && ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && app.contains(ae)) return; // no pisar lo que se está escribiendo
  if (S.intro) return vistaIntro(app);
  if (S.perm && NATIVE && !S.demo) return vistaPermisos(app);
  if (!S.demo && NATIVE && !S.server) return vistaServidor(app);
  if (!S.token || !S.user) return vistaLogin(app);
  const rol = S.user.rol;
  if (rol === 'camillero') vistaCamillero(app); else vistaDespacho(app);
  contar();
}
function header(sub) {
  return `<div class="hdr"><img src="logo.svg" alt=""><div class="t"><b>Camilleros Juncal</b><span class="who">${esc(sub)} <span id="conn" style="display:inline">${live()}</span></span></div>
  <button class="iconbtn" id="menu" aria-label="Menú">⋮</button></div>`;
}
function bindMenu() {
  const salirDemo = () => { S.token = null; S.user = null; S.demo = false; Demo.onMessage(null); S.tab = null; render(); };
  const m = $('#menu'); if (!m) return;
  m.onclick = () => modal(`<h3>${esc(S.user.nombre)}</h3><p class="hint">Rol: ${esc(S.user.rol)} · usuario ${esc(S.user.usuario)}</p>
    <button class="btn ghost" id="m-pin">🔒 Cambiar mi PIN</button><div style="height:8px"></div>
    ${NATIVE ? '<button class="btn ghost" id="m-srv">🌐 Servidor</button><div style="height:8px"></div>' : ''}
    <button class="btn red" id="m-out">${S.demo ? 'Salir de la demo' : 'Cerrar sesión'}</button>`, () => {
    $('#m-out').onclick = () => { cerrarModal(); S.demo ? salirDemo() : salir(); };
    $('#m-pin').onclick = cambiarPin;
    const s = $('#m-srv'); if (s) s.onclick = () => { cerrarModal(); salir(); S.server = ''; LS.del('cj_server'); render(); };
  });
}
function cambiarPin() {
  modal(`<h3>Cambiar PIN</h3><label>PIN actual</label><input id="p1" type="password" inputmode="numeric"><label>PIN nuevo (4 a 8 números)</label><input id="p2" type="password" inputmode="numeric"><div style="height:14px"></div><button class="btn" id="pok">Guardar</button>`, () => {
    $('#pok').onclick = async () => { try { await api('/pin', 'POST', { actual: $('#p1').value, nuevo: $('#p2').value }); cerrarModal(); toast('PIN actualizado ✔'); } catch (e) { toast(e.message); } };
  });
}

/* ----- Servidor (solo APK) ----- */
function vistaServidor(app) {
  app.innerHTML = `<div class="login"><div class="logo"><img src="logo.svg" alt=""><h1>Camilleros Juncal</h1><p>Primera configuración</p></div>
    <label>Dirección del servidor de traslados</label><input id="srv" inputmode="url" placeholder="http://192.168.1.50:3000" value="${esc(S.server)}">
    <p class="hint">La da el área de sistemas. Ejemplo: http://192.168.1.50:3000 o https://traslados.sanatorio.com</p><div style="height:10px"></div>
    <div id="e"></div><button class="btn" id="go">Guardar y continuar</button>
    <div class="row" style="justify-content:center;flex-wrap:wrap"><button class="link" id="s-demo">🎬 Probar demo sin servidor</button><button class="link" id="s-how">ℹ️ ¿Cómo funciona?</button></div></div>`;
  $('#s-demo').onclick = elegirDemo; $('#s-how').onclick = () => { S.intro = true; S.introIdx = 0; render(); };
  $('#go').onclick = async () => {
    const v = $('#srv').value.trim().replace(/\/+$/, ''); if (!/^https?:\/\//.test(v)) return ($('#e').innerHTML = '<div class="err">Debe empezar con http:// o https://</div>');
    try { const r = await fetch(v + '/api/health'); if (!r.ok) throw 0; S.server = v; LS.set('cj_server', v); render(); }
    catch { $('#e').innerHTML = '<div class="err">No se pudo conectar. Revisá la dirección y que el celular esté en la red del sanatorio.</div>'; }
  };
}

/* ----- Login ----- */
function vistaLogin(app) {
  app.innerHTML = `<div class="login"><div class="logo"><img src="logo.svg" alt=""><h1>Camilleros Juncal</h1><p>Traslados de pacientes · Sanatorio Juncal</p></div>
    <label>Usuario</label><input id="u" autocapitalize="none" autocomplete="username" value="${esc(LS.get('cj_user') || '')}">
    <label>PIN</label><input id="p" type="password" inputmode="numeric" autocomplete="current-password">
    <div id="e"></div><div style="height:6px"></div><button class="btn big" id="go">Ingresar</button>
    <div class="row" style="justify-content:center;flex-wrap:wrap"><button class="link" id="l-demo">🎬 Probar demo</button><button class="link" id="l-how">ℹ️ ¿Cómo funciona?</button></div>
    ${NATIVE ? '<button class="link" id="srv" style="width:100%">Cambiar servidor</button>' : ''}</div>`;
  $('#l-demo').onclick = elegirDemo; $('#l-how').onclick = () => { S.intro = true; S.introIdx = 0; render(); };
  const go = async () => {
    try {
      const r = await api('/login', 'POST', { usuario: $('#u').value, pin: $('#p').value });
      S.token = r.token; S.user = r.usuario; LS.set('cj_token', r.token); LS.set('cj_user', r.usuario.usuario); S.demo = false;
      S.tab = null; await iniciarSesion();
    } catch (e) { $('#e').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  };
  $('#go').onclick = go; $('#p').onkeydown = (e) => e.key === 'Enter' && go();
  const s = $('#srv'); if (s) s.onclick = () => { S.server = ''; LS.del('cj_server'); render(); };
}
async function iniciarSesion() {
  if (!S.demo) await Nat.init();
  conectarWS(); await cargar();
  if (!S.demo && S.user.rol === 'camillero' && S.user.en_turno) Nat.servicio(true);
  setTimeout(() => Upd.check(), 2500);
}
async function iniciarDemo(rol, opts = {}) {
  S.demo = true; S.intro = false; S.tab = null; S.finalizado = null; S.nota = ''; S.scanErr = '';
  S.alertados = new Set(); S.form = { pac: null, destino: '', prioridad: 'normal', req: [], nota: '', origen: '' };
  if (!opts.keep) Demo.reset(); else Demo.load();
  const r = await Demo.api('/login', 'POST', { usuario: rol === 'camillero' ? 'elias' : 'conmutador' });
  S.token = r.token; S.user = r.usuario;
  S.lugares = []; await iniciarSesion();
  if (!opts.nobots) Demo.bots(rol);
}
function elegirDemo() {
  modal(`<h3>🎬 Probar la demo</h3><p class="hint">Funciona sin servidor, con datos de ejemplo. ¿Cómo querés verla?</p>
    <button class="btn big" id="d-cam">👷 Soy camillero</button><div style="height:10px"></div>
    <button class="btn big navy" id="d-con">☎️ Soy conmutador</button>
    <p class="hint" style="margin-top:12px">Tip: abrí la demo en dos pestañas, una como conmutador y otra como camillero, y vas a ver cómo se comunican.</p>
    <button class="link" style="width:100%" onclick="cerrarModal()">Cancelar</button>`, () => {
    $('#d-cam').onclick = () => { cerrarModal(); iniciarDemo('camillero'); };
    $('#d-con').onclick = () => { cerrarModal(); iniciarDemo('conmutador'); };
  });
}

/* ----- Introducción ----- */
const SLIDES = [
  { ico: null, t: 'Traslados de pacientes, sin llamadas ni papeles', d: 'Camilleros Juncal conecta al conmutador con los camilleros en tiempo real y deja registro de cada traslado.' },
  { ico: '☎️ → 📣 → 👷', t: 'El conmutador emite, los camilleros reciben', d: 'La orden llega al instante a todos los camilleros en turno, con sonido y vibración. El primero que toca “Me hago cargo” se queda el traslado.' },
  { ico: '🧾 → 📷 → ✅', t: 'Primero, verificá al paciente', d: 'Escaneá la pulsera (código de barras o QR). Si no es el paciente de la orden, la app te frena antes de que lo retires.' },
  { ico: '📍 → 📷 → 📝', t: 'Entregá y dejá tu aviso', d: 'Escaneá el QR del lugar de destino, sumá una nota sobre el paciente y finalizá. Queda todo registrado con horarios.' },
];

/* ---------- Permisos (primer inicio) ---------- */
const PERMS = [
  { k: 'notif', ico: 'bell', t: 'Notificaciones', why: 'Para avisarte al instante cuando el conmutador emite un traslado, incluso con el teléfono bloqueado.' },
  { k: 'cam', ico: 'camera', t: 'Cámara', why: 'Para escanear la pulsera del paciente y el QR del destino.' },
  { k: 'bat', ico: 'gear', t: 'Batería sin restricciones', why: 'Evita que Android “duerma” la app y se pierdan avisos. Es clave para recibir traslados con la pantalla apagada.' },
  { k: 'inst', ico: 'folder', t: 'Instalar actualizaciones', why: 'Permite actualizar la app desde adentro cuando haya una versión nueva, sin buscar links.' },
];
async function estadoPerm() {
  const r = { notif: false, cam: false, bat: false, inst: false };
  try { r.notif = (await plug('LocalNotifications').checkPermissions()).display === 'granted'; } catch {}
  try { r.cam = (await plug('BarcodeScanner').checkPermissions()).camera === 'granted'; } catch {}
  try { const e = await plug('ApkUpdater').estadoPermisos(); r.bat = e.bateria; r.inst = e.instalar; } catch {}
  return r;
}
async function pedirPerm(k) {
  try {
    if (k === 'notif') await plug('LocalNotifications').requestPermissions();
    else if (k === 'cam') await plug('BarcodeScanner').requestPermissions();
    else if (k === 'bat') await plug('ApkUpdater').pedirBateria();
    else if (k === 'inst') await plug('ApkUpdater').pedirInstalar();
  } catch (e) { toast('No se pudo abrir el permiso'); }
}
async function vistaPermisos(app) {
  const est = S.permEst || (S.permEst = await estadoPerm());
  const todos = Object.values(est).every(Boolean);
  app.innerHTML = `<div class="intro perm"><div class="perm-h"><img src="logo.svg" alt=""><h1>Permisos de la app</h1><p>Para que no pierdas ningún aviso, activá estos permisos. Podés cambiarlos después desde los ajustes del teléfono.</p></div>
    <div class="perm-l">${PERMS.map((p) => `<div class="card perm-i ${est[p.k] ? 'ok' : ''}"><div class="upd-ico">${ICON(p.ico)}</div><div class="perm-t"><b>${p.t}</b><small>${p.why}</small></div>
      ${est[p.k] ? `<span class="perm-ok">${ICON('check')}</span>` : `<button class="btn" data-perm="${p.k}">Permitir</button>`}</div>`).join('')}
      <div class="hint" style="text-align:center">Tip: mantené el volumen de notificaciones alto y excluí la app del modo “No molestar”.</div></div>
    <div class="perm-f"><button class="btn big" id="perm-go">${todos ? 'Continuar' : 'Continuar de todos modos'}</button></div></div>`;
  app.querySelectorAll('[data-perm]').forEach((b) => (b.onclick = async () => { await pedirPerm(b.dataset.perm); S.permEst = null; render(); }));
  $('#perm-go').onclick = () => { LS.set('cj_perm', '1'); S.perm = false; S.permEst = null; render(); };
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.perm) { S.permEst = null; render(); } });

function vistaIntro(app) {
  const i = S.introIdx, sl = SLIDES[i], ult = i === SLIDES.length - 1;
  app.innerHTML = `<div class="intro"><button class="link intro-skip" id="i-skip">${ult ? '' : 'Saltar'}</button>
    <div class="intro-body" key="${i}"><div class="ill">${sl.ico ? `<span>${sl.ico}</span>` : '<img src="logo.svg" alt="">'}</div><h1>${esc(sl.t)}</h1><p>${esc(sl.d)}</p></div>
    <div class="dots">${SLIDES.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
    <div class="intro-btns">${ult ? '<button class="btn big" id="i-demo">🎬 Probar la demo</button><button class="btn ghost" id="i-go">Ingresar con mi usuario</button>' : '<button class="btn big" id="i-next">Siguiente</button>'}</div></div>`;
  const fin = () => { LS.set('cj_intro', '1'); S.intro = false; S.introIdx = 0; };
  const sk = $('#i-skip'); if (sk) sk.onclick = () => { fin(); render(); };
  const nx = $('#i-next'); if (nx) nx.onclick = () => { S.introIdx++; render(); };
  const dm = $('#i-demo'); if (dm) dm.onclick = () => { fin(); render(); elegirDemo(); };
  const go = $('#i-go'); if (go) go.onclick = () => { fin(); render(); };
}


/* ----- Camillero ----- */
function cardTraslado(t, opts = {}) {
  const rq = (t.requisitos || '').split(',').map((x) => x.trim()).filter(Boolean);
  const tiene = (w) => rq.some((x) => x.toLowerCase().includes(w));
  const flags = [(t.oxigeno && !tiene('oxígeno')) ? '<span class="chip warn">O₂ Oxígeno</span>' : '', (t.aislamiento && !tiene('aislamiento')) ? '<span class="chip warn">⚠ Aislamiento</span>' : '',
    (!tiene('silla') && !tiene('camilla')) ? `<span class="chip">${t.movilidad === 'silla' ? '♿ Silla de ruedas' : '🛏 Camilla'}</span>` : '',
    ...rq.map((x) => `<span class="chip ${/ox[ií]geno|aislamiento/i.test(x) ? 'warn' : ''}">${esc(x)}</span>`)].join('');
  return `<div class="card ${t.prioridad === 'urgente' && t.estado === 'EMITIDA' ? 'urg' : ''}">
    ${opts.compact ? '' : `<div class="row"><span class="pill ${t.prioridad === 'urgente' ? 'urg' : 'norm'}">${t.prioridad === 'urgente' ? '🚨 URGENTE' : 'NORMAL'}</span>
    <span class="pill e-${t.estado}">${ESTADO[t.estado]}</span><span class="sp"></span><span class="meta">${hace(t.emitido_en)}</span></div>`}
    <div class="pname">${esc(t.paciente)}</div><div class="meta">DNI ${esc(t.dni)} · Cama ${esc(t.cama || '—')}</div>
    ${opts.compact ? '' : `<div class="route"><div class="rl"><i></i><u></u><i class="d"></i></div><div class="rt"><div><small>Retirar de</small><b>${esc(t.origen || '—')}</b></div><div><small>Llevar a</small><b>${esc(t.destino)}</b></div></div></div>`}
    ${opts.compact ? `<div class="meta"><b>Llevar a:</b> ${esc(t.destino)}</div>` : ''}<div class="chips">${flags}</div>${t.camillero ? `<div class="resp">👷 Camillero responsable: <b>${esc(t.camillero)}</b></div>` : ''}${t.nota_emision ? `<div class="meta">📝 ${esc(t.nota_emision)}</div>` : ''}${opts.extra || ''}</div>`;
}
function vistaCamillero(app) {
  const act = miActivo();
  const pend = S.traslados.filter((t) => t.estado === 'EMITIDA');
  if (!S.tab) S.tab = act ? 'mio' : 'pend';
  const en = S.user.en_turno;
  let body = '';
  if (S.tab === 'pend') {
    body = `<div class="turno ${en ? 'on' : ''}"><span class="dot"></span><div class="txt"><b>${en ? 'En turno' : 'Fuera de turno'}</b><small>${en ? 'Recibís los avisos del conmutador' : 'Activá para recibir traslados'}</small></div><button class="sw ${en ? 'on' : ''}" id="turno" aria-label="Turno"></button></div>`;
    body += pend.length ? pend.map((t) => cardTraslado(t, { extra: `<div style="height:8px"></div><button class="btn big ${t.prioridad === 'urgente' ? 'red' : ''}" data-ac="${t.id}" ${act || !en ? 'disabled' : ''}>${ICON('hand')} ME HAGO CARGO</button>${act ? '<div class="hint" style="margin-top:6px">Terminá tu traslado actual para tomar otro.</div>' : !en ? '<div class="hint" style="margin-top:6px">Activá “En turno” para aceptar.</div>' : ''}` })).join('')
      : `<div class="empty">${bigIco('bed')}<b>Sin traslados pendientes</b><div>Te vamos a avisar apenas el conmutador emita uno.</div></div>`;
  } else if (S.tab === 'mio') body = vistaMiTraslado(act);
  else body = S.hist.length ? S.hist.map((t) => `<div class="card"><div class="row"><b>${esc(t.paciente)}</b><span class="sp"></span><span class="meta">${hora(t.completado_en)}</span></div><div class="meta">${esc(t.origen || '')} → <b>${esc(t.destino)}</b></div>${t.nota_final ? `<div class="meta">📝 ${esc(t.nota_final)}</div>` : ''}<div class="meta">Duración: ${Math.max(1, Math.round((new Date(t.completado_en) - new Date(t.aceptado_en)) / 60000))} min</div></div>`).join('')
    : `<div class="empty">${bigIco('folder')}Todavía no hiciste traslados.</div>`;
  app.innerHTML = `${header('👷 ' + S.user.nombre)}<div class="wrap">${body}</div>
    <nav class="tabs"><button data-t="pend" class="${S.tab === 'pend' ? 'on' : ''}">${ICON('list')}Pendientes${pend.length && !act ? `<i class="bd">${pend.length}</i>` : ''}</button>
    <button data-t="mio" class="${S.tab === 'mio' ? 'on' : ''}">${ICON('bed')}Mi traslado${act ? '<i class="bd">1</i>' : ''}</button>
    <button data-t="hist" class="${S.tab === 'hist' ? 'on' : ''}">${ICON('clock')}Historial</button></nav>`;
  bindMenu();
  app.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { S.tab = b.dataset.t; S.scanErr = ''; render(); }));
  const sw = $('#turno'); if (sw) sw.onclick = async () => {
    try { const r = await api('/turno', 'POST', { en_turno: !S.user.en_turno }); S.user.en_turno = r.en_turno; Nat.servicio(r.en_turno); render(); } catch (e) { toast(e.message); } };
  app.querySelectorAll('[data-ac]').forEach((b) => (b.onclick = () => accion(`/traslados/${b.dataset.ac}/aceptar`, null, () => { S.tab = 'mio'; })));
  bindMio(act);
}
function vistaMiTraslado(t) {
  if (S.finalizado) { const f = S.finalizado; return `<div class="card done-card"><div class="ck">${ICON('check')}</div><h2 style="margin:0">Traslado finalizado</h2><p class="meta">${esc(f.paciente)} entregado en <b>${esc(f.destino)}</b></p><p class="meta">Responsable: <b>${esc(f.camillero || S.user.nombre)}</b> · Duración: ${Math.max(1, Math.round((new Date(f.completado_en) - new Date(f.aceptado_en)) / 60000))} min</p><button class="btn" id="fin-ok">Listo</button></div>`; }
  if (!t) return `<div class="empty">${bigIco('check')}<b>No tenés un traslado en curso</b><div>Aceptá uno desde “Pendientes”.</div></div>`;
  const paso = t.estado === 'ACEPTADA' ? 1 : 2;
  const steps = `<div class="steps"><div class="done"><i></i>Aceptado</div><div class="${paso === 1 ? 'cur' : 'done'}"><i></i>Paciente</div><div class="${paso === 2 ? 'cur' : ''}"><i></i>Destino</div></div>`;
  const err = S.scanErr ? `<div class="err">${esc(S.scanErr)}</div>` : '';
  if (paso === 1) return `${steps}<div class="big-instr"><small>Paso 1 · Buscar al paciente</small><b>${esc(t.origen || '—')}</b></div>
    ${cardTraslado(t, { compact: true })}${err}
    <button class="btn big green" id="scan-pac">${ICON('camera')} ESCANEAR PULSERA</button>
    <div class="row" style="justify-content:center;margin:2px 0 10px"><button class="link" id="man-pac">Ingresar código a mano</button><button class="link" id="liberar" style="color:#9b1c1c">Devolver traslado</button></div>`;
  return `${steps}<div class="ok">✔ Paciente verificado: ${esc(t.paciente)}</div><div class="big-instr"><small>Paso 2 · Llevar a</small><b>${esc(t.destino)}</b></div>${err}
    <button class="btn big green" id="scan-dest">${ICON('scan')} ESCANEAR QR DEL DESTINO</button>
    <div class="row" style="justify-content:center;margin:2px 0 10px"><button class="link" id="man-dest">Ingresar código a mano</button></div>
    <div class="card"><label style="margin-top:0">Nota o aviso del paciente (opcional)</label>
    <div class="chips">${['Tranquilo', 'Con dolor', 'Con suero', 'Mareado', 'Familiar acompaña'].map((c) => `<button class="chip" data-nota="${c}">${c}</button>`).join('')}</div>
    <textarea id="nota" rows="2" placeholder="Ej.: llegó con suero colocado…">${esc(S.nota)}</textarea></div>`;
}
function bindMio(t) {
  const fin = $('#fin-ok'); if (fin) fin.onclick = () => { S.finalizado = null; S.tab = 'pend'; render(); };
  if (!t) return;
  const retirar = async (codigo) => {
    if (!codigo) return; S.scanErr = '';
    try { await api(`/traslados/${t.id}/retirar`, 'POST', { codigo }); navigator.vibrate && navigator.vibrate(150); await cargar(); }
    catch (e) { S.scanErr = e.message; navigator.vibrate && navigator.vibrate([300, 100, 300]); beep(); render(); }
  };
  const completar = async (codigo) => {
    if (!codigo) return; S.scanErr = '';
    try { const r = await api(`/traslados/${t.id}/completar`, 'POST', { codigo, nota: S.nota }); S.nota = ''; S.finalizado = r; navigator.vibrate && navigator.vibrate(200); await cargar(); }
    catch (e) { S.scanErr = e.message; navigator.vibrate && navigator.vibrate([300, 100, 300]); beep(); render(); }
  };
  const a = $('#scan-pac'); if (a) a.onclick = async () => retirar(await escanear('Escaneá la pulsera del paciente', S.demo ? Demo.pacienteCodigo(t.paciente_id) : null));
  const b = $('#man-pac'); if (b) b.onclick = async () => retirar(await codigoManual('Código de la pulsera'));
  const c = $('#scan-dest'); if (c) c.onclick = async () => { S.nota = $('#nota').value; completar(await escanear('Escaneá el QR del destino', S.demo ? t.destino_codigo : null)); };
  const d = $('#man-dest'); if (d) d.onclick = async () => { S.nota = $('#nota').value; completar(await codigoManual('Código del destino (ej. LUG-RX01)')); };
  const n = $('#nota'); if (n) n.oninput = () => (S.nota = n.value);
  document.querySelectorAll('[data-nota]').forEach((x) => (x.onclick = () => { S.nota = (S.nota ? S.nota + ', ' : '') + x.dataset.nota; $('#nota').value = S.nota; }));
  const l = $('#liberar'); if (l) l.onclick = () => modal(`<h3>¿Devolver el traslado?</h3><p class="hint">Vuelve a la lista para que lo tome otro camillero.</p><button class="btn red" id="lib-ok">Sí, devolver</button><button class="link" style="width:100%" onclick="cerrarModal()">No</button>`, () => {
    $('#lib-ok').onclick = () => { cerrarModal(); accion(`/traslados/${t.id}/liberar`, { motivo: 'Devuelto por camillero' }, () => { S.tab = 'pend'; }); }; });
}

/* ----- Conmutador / Admin ----- */
function vistaDespacho(app) {
  const admin = S.user.rol === 'admin';
  if (!S.tab) S.tab = 'nuevo';
  const activos = S.traslados.filter((t) => ['EMITIDA', 'ACEPTADA', 'EN_TRASLADO'].includes(t.estado));
  const tabs = [['nuevo', 'plus', 'Nuevo'], ['curso', 'bed', 'En curso'], ['equipo', 'users', 'Equipo']].concat(admin ? [['admin', 'gear', 'Admin']] : []);
  let body = S.tab === 'nuevo' ? vistaNuevo() : S.tab === 'curso' ? vistaCurso(activos) : S.tab === 'equipo' ? vistaEquipo() : vistaAdmin();
  app.innerHTML = `${header((S.user.rol === 'admin' ? '⚙️ ' : '☎️ ') + S.user.nombre)}
    <nav class="tabs">${tabs.map(([k, i, n]) => `<button data-t="${k}" class="${S.tab === k ? 'on' : ''}">${ICON(i)}${n}${k === 'curso' && activos.length ? `<i class="bd">${activos.length}</i>` : ''}</button>`).join('')}</nav>
    <div class="wrap wide">${body}</div>`;
  app.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { S.tab = b.dataset.t; render(); }));
  bindMenu();
  if (S.tab === 'nuevo') bindNuevo(); if (S.tab === 'curso') bindCurso(); if (S.tab === 'admin') bindAdmin();
}
function tiles() {
  const s = S.stats; if (!s) return '';
  const T = (k, v, label, unit) => `<div class="stat"><b ${v == null ? '' : `data-k="${k}" data-n="${v}"`}>${v == null ? '–' : 0}${unit ? `<small> ${unit}</small>` : ''}</b><span>${label}</span></div>`;
  return `<div class="stats">${T('p', s.pendientes, 'Pendientes')}${T('c', s.en_curso, 'En curso')}${T('f', s.completados, 'Finalizados hoy')}${T('r', s.min_respuesta, 'Respuesta media', 'min')}${T('t', s.min_traslado, 'Traslado medio', 'min')}</div>`;
}
function vistaNuevo() {
  const F = S.form; const turno = S.equipo.filter((e) => e.en_turno); const libres = turno.filter((e) => !e.ocupado).length;
  return `${tiles()}<div class="grid2"><div><div class="card"><h3 style="margin:0 0 4px">Emitir traslado</h3>
    <div class="hint">${turno.length} camilleros en turno · ${libres} disponibles</div>
    <label>Paciente (nombre, DNI o cama)</label>
    ${F.pac ? `<div class="sel-pac"><div class="row"><b>${esc(F.pac.nombre)}</b><span class="sp"></span><button class="link" id="pac-x" style="padding:0">cambiar</button></div><div class="meta">DNI ${esc(F.pac.dni)} · ${esc(F.pac.historia || '')} · ${esc(F.pac.sector || '')} cama ${esc(F.pac.cama || '—')}</div></div>`
      : `<input id="q" autocomplete="off" placeholder="Buscar paciente…"><div id="res"></div>`}
    <label>Retirar de</label><input id="origen" value="${esc(F.origen || (F.pac ? [F.pac.sector, F.pac.cama].filter(Boolean).join(' · ') : ''))}" placeholder="Sector / cama">
    <label>Destino</label><select id="dest"><option value="">Elegir destino…</option>${S.lugares.map((l) => `<option value="${l.id}" ${String(F.destino) === String(l.id) ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}</select>
    <label>Prioridad</label><div class="seg"><button data-pr="normal" class="${F.prioridad === 'normal' ? 'on' : ''}">Normal</button><button data-pr="urgente" class="${F.prioridad === 'urgente' ? 'on u' : ''}">🚨 Urgente</button></div>
    <label>Requerimientos</label><div class="chips">${REQS.map((r) => `<button class="chip ${F.req.includes(r) ? 'sel' : ''}" data-rq="${r}">${r}</button>`).join('')}</div>
    <label>Nota para el camillero</label><textarea id="nota-e" placeholder="Opcional">${esc(F.nota)}</textarea>
    <div id="err"></div><div style="height:10px"></div><button class="btn big" id="emitir">${ICON('mega')} EMITIR AVISO A CAMILLEROS</button></div></div>
    <div><div class="card"><b>Últimos traslados</b>${S.traslados.slice(0, 6).map((t) => `<div class="team"><div style="flex:1"><b>${esc(t.paciente)}</b><div class="meta">→ ${esc(t.destino)} · ${t.camillero ? esc(t.camillero) : 'sin asignar'}</div></div><span class="pill e-${t.estado}">${ESTADO[t.estado]}</span></div>`).join('') || '<div class="meta" style="padding:10px 0">Sin movimientos hoy.</div>'}</div></div></div>`;
}
function bindNuevo() {
  const F = S.form;
  const q = $('#q'); let tm;
  if (q) q.oninput = () => { clearTimeout(tm); tm = setTimeout(async () => {
    if (q.value.trim().length < 2) return ($('#res').innerHTML = '');
    const r = await api('/pacientes?q=' + encodeURIComponent(q.value.trim())).catch(() => []);
    $('#res').innerHTML = r.map((p) => `<button class="pick" data-p='${esc(JSON.stringify(p))}'><b>${esc(p.nombre)}</b><div class="meta">DNI ${esc(p.dni)} · ${esc(p.sector || '')} cama ${esc(p.cama || '—')}</div></button>`).join('') || '<div class="hint">Sin resultados</div>';
    document.querySelectorAll('.pick').forEach((b) => (b.onclick = () => { F.pac = JSON.parse(b.dataset.p); F.origen = ''; if (F.pac.oxigeno && !F.req.includes('Oxígeno')) F.req.push('Oxígeno'); if (F.pac.aislamiento && !F.req.includes('Aislamiento')) F.req.push('Aislamiento'); render(); }));
  }, 250); };
  const x = $('#pac-x'); if (x) x.onclick = () => { F.pac = null; render(); };
  const keep = () => { F.origen = $('#origen').value; F.destino = $('#dest').value; F.nota = $('#nota-e').value; };
  document.querySelectorAll('[data-pr]').forEach((b) => (b.onclick = () => { keep(); F.prioridad = b.dataset.pr; render(); }));
  document.querySelectorAll('[data-rq]').forEach((b) => (b.onclick = () => { keep(); const r = b.dataset.rq; F.req = F.req.includes(r) ? F.req.filter((y) => y !== r) : [...F.req, r]; render(); }));
  $('#emitir').onclick = async () => {
    keep(); if (!F.pac) return ($('#err').innerHTML = '<div class="err">Elegí un paciente</div>'); if (!F.destino) return ($('#err').innerHTML = '<div class="err">Elegí el destino</div>');
    try { const nt = await api('/traslados', 'POST', { paciente_id: F.pac.id, destino_id: Number(F.destino), prioridad: F.prioridad, requisitos: F.req.join(', '), nota: F.nota, origen: F.origen });
      if (S.demo && !S.embed) Demo.lucia(nt); S.form = { pac: null, destino: '', prioridad: 'normal', req: [], nota: '', origen: '' }; toast('Aviso enviado a los camilleros en turno ✔'); S.tab = 'curso'; await cargar(); }
    catch (e) { $('#err').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  };
}
function vistaCurso(activos) {
  const fin = S.traslados.filter((t) => ['COMPLETADA', 'CANCELADA'].includes(t.estado));
  const tarj = (t) => cardTraslado(t, { extra: `<div class="row" style="margin-top:8px"><span class="meta">${t.camillero ? '' : '<b style="color:#8a5a00">👷 Esperando camillero…</b>'}${t.aceptado_en ? 'Aceptó ' + hora(t.aceptado_en) : ''}</span><span class="sp"></span>
    <button class="btn sm ghost" data-ev="${t.id}">Detalle</button>${['EMITIDA', 'ACEPTADA', 'EN_TRASLADO'].includes(t.estado) ? `<button class="btn sm red" data-cn="${t.id}">Cancelar</button>` : ''}</div>` });
  return `${tiles()}<h3 style="margin:4px 0 10px">En curso (${activos.length})</h3><div class="grid2"><div>${activos.filter((_, i) => i % 2 === 0).map(tarj).join('')}</div><div>${activos.filter((_, i) => i % 2).map(tarj).join('')}</div></div>
    ${activos.length ? '' : `<div class="empty">${bigIco('coffee')}No hay traslados en curso.</div>`}
    <h3 style="margin:14px 0 10px">Finalizados hoy (${fin.length})</h3><div class="grid2"><div>${fin.slice(0, 20).map(tarj).join('')}</div></div>`;
}
function bindCurso() {
  document.querySelectorAll('[data-cn]').forEach((b) => (b.onclick = () => modal(`<h3>Cancelar traslado</h3><label>Motivo</label><input id="mot" placeholder="Ej.: estudio suspendido"><div style="height:12px"></div><button class="btn red" id="cok">Cancelar traslado</button>`, () => {
    $('#cok').onclick = () => { const m = $('#mot').value; cerrarModal(); accion(`/traslados/${b.dataset.cn}/cancelar`, { motivo: m }); }; })));
  document.querySelectorAll('[data-ev]').forEach((b) => (b.onclick = async () => {
    const ev = await api(`/traslados/${b.dataset.ev}/eventos`).catch(() => []);
    modal(`<h3>Historial del traslado</h3><div class="tl">${ev.map((e) => `<div><b>${esc(e.tipo.replaceAll('_', ' '))}</b> · ${esc(e.usuario || '')}<small>${hora(e.ts)}${e.detalle ? ' — ' + esc(e.detalle) : ''}</small></div>`).join('')}</div>`);
  }));
}
function vistaEquipo() {
  return `${tiles()}<div class="card"><b>Camilleros</b>${S.equipo.map((e) => `<div class="team"><div class="av">${esc(e.nombre.split(' ').map((x) => x[0]).slice(0, 2).join(''))}</div><div style="flex:1"><b>${esc(e.nombre)}</b></div>
    <span class="meta"><i class="dot" style="background:${!e.en_turno ? '#aab6bf' : e.ocupado ? 'var(--amber)' : 'var(--green)'}"></i>${!e.en_turno ? 'Fuera de turno' : e.ocupado ? 'En traslado' : 'Disponible'}</span></div>`).join('') || '<div class="meta">Sin camilleros cargados.</div>'}</div>`;
}

/* ----- Admin ----- */
function vistaAdmin() {
  const sub = [['usuarios', 'Usuarios'], ['lugares', 'Destinos y QR'], ['pacientes', 'Pacientes']];
  return `<div class="seg" style="margin-bottom:12px">${sub.map(([k, n]) => `<button data-ad="${k}" class="${S.admin === k ? 'on' : ''}">${n}</button>`).join('')}</div><div id="adm">Cargando…</div>`;
}
async function bindAdmin() {
  document.querySelectorAll('[data-ad]').forEach((b) => (b.onclick = () => { S.admin = b.dataset.ad; render(); }));
  const box = $('#adm');
  if (S.admin === 'usuarios') {
    const us = await api('/usuarios');
    box.innerHTML = `<div class="card"><table><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th></th></tr>${us.map((u) => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.usuario)}</td><td>${u.rol}</td><td style="text-align:right"><button class="chip" data-pin="${u.id}">PIN</button> <button class="chip" data-act="${u.id}|${u.activo ? 0 : 1}">${u.activo ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('')}</table></div>
      <div class="card"><b>Nuevo usuario</b><label>Nombre completo</label><input id="n-nom"><label>Usuario</label><input id="n-usr" autocapitalize="none"><label>Rol</label><select id="n-rol"><option value="camillero">Camillero</option><option value="conmutador">Conmutador</option><option value="admin">Administrador</option></select><label>PIN (4 a 8 números)</label><input id="n-pin" inputmode="numeric"><div style="height:10px"></div><div id="n-e"></div><button class="btn" id="n-ok">Crear usuario</button></div>`;
    $('#n-ok').onclick = async () => { try { await api('/usuarios', 'POST', { nombre: $('#n-nom').value, usuario: $('#n-usr').value, rol: $('#n-rol').value, pin: $('#n-pin').value }); toast('Usuario creado ✔'); render(); } catch (e) { $('#n-e').innerHTML = `<div class="err">${esc(e.message)}</div>`; } };
    box.querySelectorAll('[data-pin]').forEach((b) => (b.onclick = () => modal(`<h3>Nuevo PIN</h3><input id="np" inputmode="numeric" placeholder="4 a 8 números"><div style="height:10px"></div><button class="btn" id="npok">Guardar</button>`, () => { $('#npok').onclick = async () => { try { await api('/usuarios/' + b.dataset.pin, 'PATCH', { pin: $('#np').value }); cerrarModal(); toast('PIN actualizado ✔'); } catch (e) { toast(e.message); } }; })));
    box.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => { const [id, v] = b.dataset.act.split('|'); await api('/usuarios/' + id, 'PATCH', { activo: v === '1' }); render(); }));
  } else if (S.admin === 'lugares') {
    const ls = await api('/lugares');
    box.innerHTML = `<div class="card"><div class="row"><b>Destinos (${ls.length})</b><span class="sp"></span><button class="btn sm" id="imp-qr">🖨 Imprimir todos los QR</button></div>
      <table>${ls.map((l) => `<tr><td>${esc(l.nombre)}<div class="meta">${esc(l.sector || '')}</div></td><td><code>${esc(l.codigo)}</code></td><td style="text-align:right"><button class="chip" data-qr="${l.id}">Ver QR</button> <button class="chip" data-del="${l.id}">Quitar</button></td></tr>`).join('')}</table></div>
      <div class="card"><b>Nuevo destino</b><label>Nombre</label><input id="l-nom" placeholder="Ej.: Quirófano 3"><label>Sector</label><input id="l-sec"><div style="height:10px"></div><div id="l-e"></div><button class="btn" id="l-ok">Agregar</button></div>`;
    $('#l-ok').onclick = async () => { try { await api('/lugares', 'POST', { nombre: $('#l-nom').value, sector: $('#l-sec').value }); S.lugares = []; render(); } catch (e) { $('#l-e').innerHTML = `<div class="err">${esc(e.message)}</div>`; } };
    box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await api('/lugares/' + b.dataset.del, 'DELETE'); S.lugares = []; render(); }));
    box.querySelectorAll('[data-qr]').forEach((b) => (b.onclick = async () => { const r = await api(`/lugares/${b.dataset.qr}/qr`); modal(`<div style="text-align:center"><h3>${esc(r.lugar.nombre)}</h3><div style="width:240px;margin:auto">${r.svg}</div><code>${esc(r.lugar.codigo)}</code></div>`); }));
    $('#imp-qr').onclick = async () => {
      const all = await Promise.all(ls.map((l) => api(`/lugares/${l.id}/qr`)));
      const w = window.open('', '_blank'); if (!w) return toast('Permití ventanas emergentes para imprimir');
      w.document.write(`<title>QR de destinos</title><style>body{font-family:sans-serif}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.c{border:2px solid #000;border-radius:12px;padding:12px;text-align:center;break-inside:avoid}.c svg{width:100%}h2{margin:6px 0}</style><div class="g">${all.map((r) => `<div class="c"><h2>${esc(r.lugar.nombre)}</h2>${r.svg}<small>${esc(r.lugar.codigo)}</small></div>`).join('')}</div>`); w.document.close(); setTimeout(() => w.print(), 400);
    };
  } else {
    box.innerHTML = `<div class="card"><b>Base de pacientes (desde Ingresos)</b><p class="hint">Se actualiza sola si el servidor tiene configurada la variable <code>INGRESOS_URL</code>, o cuando Ingresos envía los datos a <code>POST /api/pacientes/import</code>. También podés cargar un CSV acá.</p>
      <p class="hint">Columnas: <code>dni, nombre, historia, cama, sector, pulsera, oxigeno, aislamiento, movilidad</code></p>
      <input type="file" id="csv" accept=".csv,text/csv"><div style="height:10px"></div><div id="c-e"></div></div>`;
    $('#csv').onchange = async (e) => {
      const txt = await e.target.files[0].text(); const lines = txt.split(/\r?\n/).filter(Boolean); const sep = lines[0].includes(';') ? ';' : ',';
      const norm = (h) => h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); const cols = lines[0].split(sep).map(norm);
      const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(sep).map((v, i) => [cols[i], v.trim()])));
      try { const r = await api('/pacientes/import', 'POST', { pacientes: rows }); $('#c-e').innerHTML = `<div class="ok">${r.importados} pacientes importados ✔</div>`; } catch (er) { $('#c-e').innerHTML = `<div class="err">${esc(er.message)}</div>`; }
    };
  }
}


/* ---------- Actualizaciones de la app (ventana flotante) ---------- */
const REPO = 'demarext-vorder/camilleros-juncal';
const Upd = {
  omitida: 0, abierta: false,
  async check() {
    if (!NATIVE || S.demo || S.perm || this.abierta) return;
    try {
      const P = plug('ApkUpdater');
      const cur = (await P.getVersion()).code;
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return;
      const j = await r.json();
      const a = (j.assets || []).find((x) => /\.apk$/i.test(x.name));
      const code = parseInt(String(j.tag_name || '').replace(/\D/g, ''), 10);
      if (!a || !code) return;
      const v = { code, version: j.name || j.tag_name, size: a.size, url: a.browser_download_url };
      if (v.code > cur && v.code !== this.omitida) this.mostrar(v);
    } catch { /* sin conexión o repo sin release: se reintenta luego */ }
  },
  mostrar(v) {
    this.abierta = true;
    const el = document.createElement('div'); el.id = 'upd'; el.className = 'upd';
    const mb = v.size ? ` · ${(v.size / 1048576).toFixed(1)} MB` : '';
    el.innerHTML = `<div class="upd-card"><div class="upd-ico">${ICON('bell')}</div><div class="upd-tx"><b>Nueva versión disponible</b><small>Camilleros Juncal ${esc(String(v.version).replace(/^Camilleros Juncal\s*/, ''))}${mb}</small></div>
      <div class="upd-bar" hidden><i></i></div><div class="upd-msg" hidden></div>
      <div class="upd-btns"><button class="btn big" id="upd-go">Actualizar ahora</button><button class="link" id="upd-later">Más tarde</button></div></div>`;
    document.body.appendChild(el);
    const cerrar = () => { el.remove(); this.abierta = false; };
    $('#upd-later', el).onclick = () => { this.omitida = v.code; cerrar(); };
    const go = $('#upd-go', el), bar = $('.upd-bar', el), msg = $('.upd-msg', el), P = plug('ApkUpdater');
    let bajado = false;
    const say = (t) => { msg.hidden = false; msg.textContent = t; };
    const instalar = async () => {
      const r = await P.install();
      if (r.permiso) { say('Habilitá “Permitir desde esta fuente” y volvé a la app; después tocá Instalar.'); go.disabled = false; go.textContent = 'Instalar'; }
      else say('Abriendo el instalador de Android…');
    };
    go.onclick = async () => {
      go.disabled = true;
      try {
        if (!bajado) {
          bar.hidden = false; $('.upd-bar i', el).style.width = '0%'; go.textContent = 'Descargando…';
          const h = await P.addListener('progress', (e) => { $('.upd-bar i', el).style.width = e.pct + '%'; go.textContent = 'Descargando… ' + e.pct + '%'; });
          try { await P.download({ url: v.url }); } finally { h.remove(); }
          bajado = true;
        }
        go.textContent = 'Instalar'; await instalar();
      } catch (e) { say('No se pudo actualizar: ' + (e.message || e)); go.disabled = false; go.textContent = bajado ? 'Instalar' : 'Reintentar'; }
    };
  },
};
setInterval(() => Upd.check(), 5 * 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) Upd.check(); });

/* ---------- Arranque ---------- */
setInterval(() => { if (S.user && !document.querySelector('.modal-bg')) cargar(); }, 20000);
(async () => {
  const q = new URLSearchParams(location.search);
  S.embed = q.get('embed') === '1';
  if (q.get('demo')) { await iniciarDemo(q.get('demo'), { keep: q.get('keep') === '1', nobots: S.embed }); render(); return; }
  if (S.token && (!NATIVE || S.server)) {
    try { S.user = await api('/me'); await iniciarSesion(); } catch { S.token = null; }
  }
  if (!S.token && !LS.get('cj_intro')) S.intro = true;
  if (NATIVE && !LS.get('cj_perm')) S.perm = true;
  setTimeout(() => Upd.check(), 3000);
  render();
})();
