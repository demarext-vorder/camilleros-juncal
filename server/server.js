'use strict';
/**
 * Servidor de traslados - Sanatorio Juncal
 * Node 22.5+ (usa node:sqlite integrado, sin compilar nada).
 * Sirve la API REST, WebSocket en tiempo real y la web del conmutador (../www).
 */
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT || 3000);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'camilleros.db');
const API_KEY = process.env.INGRESOS_API_KEY || ''; // para que el sector Ingresos empuje pacientes
const INGRESOS_URL = process.env.INGRESOS_URL || ''; // o que el servidor los consulte (JSON)
const INGRESOS_TOKEN = process.env.INGRESOS_TOKEN || '';
const INGRESOS_SYNC_MIN = Number(process.env.INGRESOS_SYNC_MIN || 5);
const SEED_DEMO = process.env.SEED_DEMO !== '0';

require('fs').mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('camillero','conmutador','admin')),
  salt TEXT NOT NULL, pin_hash TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  en_turno INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sesiones (
  token TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, creado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pacientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dni TEXT UNIQUE, historia TEXT, nombre TEXT NOT NULL,
  cama TEXT, sector TEXT, pulsera TEXT,
  aislamiento INTEGER DEFAULT 0, oxigeno INTEGER DEFAULT 0, movilidad TEXT DEFAULT 'camilla',
  actualizado TEXT
);
CREATE INDEX IF NOT EXISTS ix_pac_pulsera ON pacientes(pulsera);
CREATE TABLE IF NOT EXISTS lugares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL, sector TEXT, activo INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS traslados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  origen TEXT, destino_id INTEGER NOT NULL REFERENCES lugares(id),
  prioridad TEXT NOT NULL DEFAULT 'normal',
  requisitos TEXT DEFAULT '', nota_emision TEXT DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'EMITIDA',
  emitido_por INTEGER REFERENCES usuarios(id), emitido_en TEXT NOT NULL,
  camillero_id INTEGER REFERENCES usuarios(id), aceptado_en TEXT,
  retirado_en TEXT, completado_en TEXT,
  nota_final TEXT DEFAULT '', motivo_cancelacion TEXT
);
CREATE INDEX IF NOT EXISTS ix_tr_estado ON traslados(estado);
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  traslado_id INTEGER NOT NULL, ts TEXT NOT NULL, usuario TEXT, tipo TEXT NOT NULL, detalle TEXT
);
`);

/* ---------- utilidades ---------- */
const now = () => new Date().toISOString();
const rnd = (n = 24) => crypto.randomBytes(n).toString('hex');
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const norm = (s) => String(s ?? '').trim().toUpperCase();
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
function crearUsuario(usuario, nombre, rol, pin) {
  const salt = rnd(8);
  db.prepare('INSERT INTO usuarios (usuario,nombre,rol,salt,pin_hash) VALUES (?,?,?,?,?)')
    .run(usuario.toLowerCase(), nombre, rol, salt, hashPin(pin, salt));
}

/* ---------- datos de arranque ---------- */
if (db.prepare('SELECT COUNT(*) c FROM usuarios').get().c === 0) {
  crearUsuario('admin', 'Administrador', 'admin', '1234');
  if (SEED_DEMO) {
    crearUsuario('conmutador', 'Conmutador', 'conmutador', '1234');
    crearUsuario('carlos', 'Carlos Méndez', 'camillero', '1111');
    crearUsuario('lucia', 'Lucía Fernández', 'camillero', '1111');
    crearUsuario('marcos', 'Marcos Giménez', 'camillero', '1111');
    const L = db.prepare('INSERT INTO lugares (codigo,nombre,sector) VALUES (?,?,?)');
    [['LUG-RX01', 'Rayos X', 'Diagnóstico'], ['LUG-TC01', 'Tomografía', 'Diagnóstico'],
     ['LUG-RM01', 'Resonancia', 'Diagnóstico'], ['LUG-QX01', 'Quirófano 1', 'Quirófano'],
     ['LUG-QX02', 'Quirófano 2', 'Quirófano'], ['LUG-LAB1', 'Laboratorio', 'Diagnóstico'],
     ['LUG-HEM1', 'Hemodinamia', 'Cardiología'], ['LUG-UTI1', 'Terapia Intensiva', 'UTI'],
     ['LUG-GUA1', 'Guardia', 'Emergencias'], ['LUG-INT2', 'Internación 2° piso', 'Internación'],
     ['LUG-INT3', 'Internación 3° piso', 'Internación'], ['LUG-END1', 'Endoscopía', 'Diagnóstico']]
      .forEach((l) => L.run(...l));
    const P = db.prepare('INSERT INTO pacientes (dni,historia,nombre,cama,sector,pulsera,aislamiento,oxigeno,movilidad,actualizado) VALUES (?,?,?,?,?,?,?,?,?,?)');
    [['20345678', 'HC-10231', 'González, María Elena', '304-A', 'Internación 3° piso', '2034567801', 0, 1, 'camilla'],
     ['14876543', 'HC-10244', 'Pereyra, Roberto', '212-B', 'Internación 2° piso', '1487654301', 0, 0, 'silla'],
     ['31222444', 'HC-10250', 'Sosa, Valentina', 'UTI-04', 'Terapia Intensiva', '3122244401', 1, 1, 'camilla'],
     ['9876543', 'HC-10262', 'Rodríguez, Hugo Alberto', '306-A', 'Internación 3° piso', '987654301', 0, 0, 'camilla'],
     ['27111222', 'HC-10270', 'Acosta, Lidia', 'GUA-02', 'Guardia', '2711122201', 0, 0, 'silla'],
     ['36555111', 'HC-10281', 'Benítez, Tomás', '215-A', 'Internación 2° piso', '3655511101', 0, 0, 'camilla'],
     ['12345600', 'HC-10290', 'Molina, Carmen', '301-B', 'Internación 3° piso', '1234560001', 1, 0, 'camilla'],
     ['40100200', 'HC-10295', 'Ledesma, Julián', 'GUA-05', 'Guardia', '4010020001', 0, 0, 'camilla']]
      .forEach((p) => P.run(...p, now()));
  }
}

/* ---------- pacientes: importación desde Ingresos ---------- */
function upsertPacientes(lista) {
  const ins = db.prepare(`INSERT INTO pacientes (dni,historia,nombre,cama,sector,pulsera,aislamiento,oxigeno,movilidad,actualizado)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(dni) DO UPDATE SET historia=excluded.historia, nombre=excluded.nombre, cama=excluded.cama,
      sector=excluded.sector, pulsera=excluded.pulsera, aislamiento=excluded.aislamiento,
      oxigeno=excluded.oxigeno, movilidad=excluded.movilidad, actualizado=excluded.actualizado`);
  let n = 0;
  tx(() => {
    for (const r of lista) {
      const dni = String(r.dni ?? r.documento ?? '').replace(/\D/g, '');
      const nombre = r.nombre ?? r.apellido_nombre ?? r.paciente ?? '';
      if (!dni || !nombre) continue;
      const bool = (v) => (['1', 'true', 'si', 'sí', 's', 'x'].includes(String(v ?? '').toLowerCase()) ? 1 : 0);
      ins.run(dni, r.historia ?? r.hc ?? null, String(nombre).trim(), r.cama ?? null, r.sector ?? r.servicio ?? null,
        r.pulsera ?? r.codigo ?? null, bool(r.aislamiento), bool(r.oxigeno),
        ['silla', 'camilla'].includes(String(r.movilidad).toLowerCase()) ? String(r.movilidad).toLowerCase() : 'camilla', now());
      n++;
    }
  });
  return n;
}
async function syncIngresos() {
  if (!INGRESOS_URL) return;
  try {
    const r = await fetch(INGRESOS_URL, { headers: INGRESOS_TOKEN ? { Authorization: `Bearer ${INGRESOS_TOKEN}` } : {} });
    const j = await r.json();
    const n = upsertPacientes(Array.isArray(j) ? j : j.pacientes || []);
    console.log(`[ingresos] ${n} pacientes sincronizados`);
  } catch (e) { console.error('[ingresos] error:', e.message); }
}
if (INGRESOS_URL) { syncIngresos(); setInterval(syncIngresos, INGRESOS_SYNC_MIN * 60000); }

/** Busca un paciente a partir de lo leído en pulsera (barras o QR). */
function pacientePorCodigo(codigo) {
  const raw = norm(codigo);
  if (!raw) return null;
  const tokens = new Set([raw, raw.replace(/\D/g, ''), ...raw.split(/[^A-Z0-9-]+/).filter(Boolean)]);
  const q = db.prepare('SELECT * FROM pacientes WHERE UPPER(pulsera)=? OR dni=? OR UPPER(historia)=?');
  for (const t of tokens) { if (!t) continue; const p = q.get(t, t, t); if (p) return p; }
  return null;
}

/* ---------- traslados ---------- */
const SQL_TR = `SELECT t.*, p.nombre AS paciente, p.dni, p.historia, p.cama, p.sector AS paciente_sector,
  p.aislamiento, p.oxigeno, p.movilidad, l.nombre AS destino, l.codigo AS destino_codigo,
  c.nombre AS camillero, e.nombre AS emisor
  FROM traslados t JOIN pacientes p ON p.id=t.paciente_id JOIN lugares l ON l.id=t.destino_id
  LEFT JOIN usuarios c ON c.id=t.camillero_id LEFT JOIN usuarios e ON e.id=t.emitido_por`;
const getTraslado = (id) => db.prepare(`${SQL_TR} WHERE t.id=?`).get(id);
function evento(id, usuario, tipo, detalle) {
  db.prepare('INSERT INTO eventos (traslado_id,ts,usuario,tipo,detalle) VALUES (?,?,?,?,?)').run(id, now(), usuario, tipo, detalle || null);
}

/* ---------- WebSocket ---------- */
const clientes = new Set(); // {ws, user}
function emitir(tipo, traslado, extra = {}) {
  const msg = JSON.stringify({ tipo, traslado, ...extra });
  for (const c of clientes) {
    if (c.ws.readyState !== 1) continue;
    if (tipo === 'nueva' && c.user.rol === 'camillero' && !c.user.en_turno) continue;
    c.ws.send(msg);
  }
}

/* ---------- Express ---------- */
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api', (req, res, next) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const fallos = new Map();
app.post('/api/login', (req, res) => {
  const usuario = String(req.body.usuario || '').toLowerCase().trim();
  const clave = `${req.ip}|${usuario}`;
  const f = fallos.get(clave);
  if (f && f.n >= 5 && Date.now() - f.t < 60000) return res.status(429).json({ error: 'Demasiados intentos. Esperá 1 minuto.' });
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario=? AND activo=1').get(usuario);
  if (!u || hashPin(req.body.pin, u.salt) !== u.pin_hash) {
    fallos.set(clave, { n: (f && Date.now() - f.t < 60000 ? f.n : 0) + 1, t: Date.now() });
    return res.status(401).json({ error: 'Usuario o PIN incorrecto' });
  }
  fallos.delete(clave);
  const token = rnd();
  db.prepare('INSERT INTO sesiones (token,usuario_id,creado) VALUES (?,?,?)').run(token, u.id, now());
  res.json({ token, usuario: pub(u) });
});
const pub = (u) => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, en_turno: !!u.en_turno });

function auth(...roles) {
  return (req, res, next) => {
    const t = (req.get('Authorization') || '').replace('Bearer ', '') || req.query.token;
    const s = t && db.prepare('SELECT u.* FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id WHERE s.token=? AND u.activo=1').get(t);
    if (!s) return res.status(401).json({ error: 'Sesión vencida' });
    if (roles.length && !roles.includes(s.rol)) return res.status(403).json({ error: 'Sin permiso' });
    req.user = s; req.token = t; next();
  };
}
app.get('/api/me', auth(), (req, res) => res.json(pub(req.user)));
app.post('/api/logout', auth(), (req, res) => {
  db.prepare('DELETE FROM sesiones WHERE token=?').run(req.token);
  db.prepare('UPDATE usuarios SET en_turno=0 WHERE id=?').run(req.user.id);
  emitir('equipo', null); res.json({ ok: true });
});
app.post('/api/pin', auth(), (req, res) => {
  const nuevo = String(req.body.nuevo || '');
  if (!/^\d{4,8}$/.test(nuevo)) return res.status(400).json({ error: 'El PIN debe tener 4 a 8 números' });
  if (hashPin(req.body.actual, req.user.salt) !== req.user.pin_hash) return res.status(400).json({ error: 'PIN actual incorrecto' });
  const salt = rnd(8);
  db.prepare('UPDATE usuarios SET salt=?, pin_hash=? WHERE id=?').run(salt, hashPin(nuevo, salt), req.user.id);
  res.json({ ok: true });
});

/* Turno */
app.post('/api/turno', auth('camillero'), (req, res) => {
  const v = req.body.en_turno ? 1 : 0;
  db.prepare('UPDATE usuarios SET en_turno=? WHERE id=?').run(v, req.user.id);
  emitir('equipo', null); res.json({ en_turno: !!v });
});
app.get('/api/equipo', auth('conmutador', 'admin'), (req, res) => {
  const rows = db.prepare(`SELECT u.id,u.nombre,u.en_turno,
    (SELECT COUNT(*) FROM traslados t WHERE t.camillero_id=u.id AND t.estado IN ('ACEPTADA','EN_TRASLADO')) AS ocupado
    FROM usuarios u WHERE u.rol='camillero' AND u.activo=1 ORDER BY u.nombre`).all();
  res.json(rows.map((r) => ({ ...r, en_turno: !!r.en_turno, ocupado: !!r.ocupado })));
});

/* Pacientes y lugares */
app.get('/api/pacientes', auth('conmutador', 'admin'), (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  res.json(db.prepare(`SELECT * FROM pacientes WHERE nombre LIKE ? OR dni LIKE ? OR cama LIKE ? OR historia LIKE ?
    ORDER BY nombre LIMIT 30`).all(q, q, q, q));
});
app.post('/api/pacientes/import', (req, res, next) => {
  if (API_KEY && req.get('X-Api-Key') === API_KEY) { req.user = { rol: 'admin' }; return next(); }
  auth('admin')(req, res, next);
}, (req, res) => {
  const lista = Array.isArray(req.body) ? req.body : req.body.pacientes || [];
  res.json({ importados: upsertPacientes(lista) });
});
app.get('/api/lugares', auth(), (req, res) => res.json(db.prepare('SELECT * FROM lugares WHERE activo=1 ORDER BY nombre').all()));
app.post('/api/lugares', auth('admin'), (req, res) => {
  const { nombre, sector } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });
  const codigo = req.body.codigo ? norm(req.body.codigo) : `LUG-${rnd(3).toUpperCase()}`;
  try { db.prepare('INSERT INTO lugares (codigo,nombre,sector) VALUES (?,?,?)').run(codigo, nombre, sector || null); }
  catch { return res.status(409).json({ error: 'Ese código ya existe' }); }
  res.json({ ok: true });
});
app.delete('/api/lugares/:id', auth('admin'), (req, res) => {
  db.prepare('UPDATE lugares SET activo=0 WHERE id=?').run(req.params.id); res.json({ ok: true });
});
app.get('/api/lugares/:id/qr', auth(), async (req, res) => {
  const l = db.prepare('SELECT * FROM lugares WHERE id=?').get(req.params.id);
  if (!l) return res.sendStatus(404);
  res.json({ lugar: l, svg: await QRCode.toString(l.codigo, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) });
});

/* Usuarios */
app.get('/api/usuarios', auth('admin'), (req, res) =>
  res.json(db.prepare('SELECT id,usuario,nombre,rol,activo FROM usuarios ORDER BY rol,nombre').all()));
app.post('/api/usuarios', auth('admin'), (req, res) => {
  const { usuario, nombre, rol, pin } = req.body;
  if (!usuario || !nombre || !['camillero', 'conmutador', 'admin'].includes(rol) || !/^\d{4,8}$/.test(String(pin)))
    return res.status(400).json({ error: 'Datos incompletos (PIN de 4 a 8 números)' });
  try { crearUsuario(usuario, nombre, rol, pin); } catch { return res.status(409).json({ error: 'Ese usuario ya existe' }); }
  res.json({ ok: true });
});
app.patch('/api/usuarios/:id', auth('admin'), (req, res) => {
  if (req.body.pin) {
    if (!/^\d{4,8}$/.test(String(req.body.pin))) return res.status(400).json({ error: 'PIN inválido' });
    const salt = rnd(8);
    db.prepare('UPDATE usuarios SET salt=?, pin_hash=? WHERE id=?').run(salt, hashPin(req.body.pin, salt), req.params.id);
  }
  if (req.body.activo !== undefined) db.prepare('UPDATE usuarios SET activo=?, en_turno=0 WHERE id=?').run(req.body.activo ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

/* Traslados */
app.get('/api/traslados', auth(), (req, res) => {
  const u = req.user;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  let rows;
  if (u.rol === 'camillero') {
    rows = req.query.historial
      ? db.prepare(`${SQL_TR} WHERE t.camillero_id=? AND t.estado='COMPLETADA' ORDER BY t.completado_en DESC LIMIT 30`).all(u.id)
      : db.prepare(`${SQL_TR} WHERE t.estado='EMITIDA' OR (t.camillero_id=? AND t.estado IN ('ACEPTADA','EN_TRASLADO'))
          ORDER BY (t.prioridad='urgente') DESC, t.emitido_en`).all(u.id);
  } else {
    rows = db.prepare(`${SQL_TR} WHERE t.estado IN ('EMITIDA','ACEPTADA','EN_TRASLADO') OR t.emitido_en >= ?
      ORDER BY (t.estado IN ('EMITIDA','ACEPTADA','EN_TRASLADO')) DESC, t.emitido_en DESC LIMIT 100`).all(hoy.toISOString());
  }
  res.json(rows);
});

app.post('/api/traslados', auth('conmutador', 'admin'), (req, res) => {
  const { paciente_id, destino_id, prioridad, requisitos, nota, origen } = req.body;
  const p = db.prepare('SELECT * FROM pacientes WHERE id=?').get(paciente_id);
  const l = db.prepare('SELECT * FROM lugares WHERE id=? AND activo=1').get(destino_id);
  if (!p || !l) return res.status(400).json({ error: 'Paciente o destino inválido' });
  const dup = db.prepare(`SELECT id FROM traslados WHERE paciente_id=? AND estado IN ('EMITIDA','ACEPTADA','EN_TRASLADO')`).get(p.id);
  if (dup) return res.status(409).json({ error: 'Ese paciente ya tiene un traslado en curso' });
  const r = db.prepare(`INSERT INTO traslados (paciente_id,origen,destino_id,prioridad,requisitos,nota_emision,emitido_por,emitido_en)
    VALUES (?,?,?,?,?,?,?,?)`).run(p.id, origen || [p.sector, p.cama].filter(Boolean).join(' · '), l.id,
    prioridad === 'urgente' ? 'urgente' : 'normal', requisitos || '', nota || '', req.user.id, now());
  const id = Number(r.lastInsertRowid);
  evento(id, req.user.nombre, 'EMITIDA', nota);
  const t = getTraslado(id); emitir('nueva', t); res.json(t);
});

app.post('/api/traslados/:id/aceptar', auth('camillero'), (req, res) => {
  const u = req.user; const id = Number(req.params.id);
  if (!u.en_turno) return res.status(409).json({ error: 'Activá "En turno" para aceptar traslados' });
  const out = tx(() => {
    if (db.prepare(`SELECT 1 FROM traslados WHERE camillero_id=? AND estado IN ('ACEPTADA','EN_TRASLADO')`).get(u.id))
      return { code: 409, error: 'Ya tenés un traslado en curso' };
    const r = db.prepare(`UPDATE traslados SET estado='ACEPTADA', camillero_id=?, aceptado_en=? WHERE id=? AND estado='EMITIDA'`).run(u.id, now(), id);
    if (r.changes === 0) return { code: 409, error: 'Otro camillero ya tomó este traslado' };
    evento(id, u.nombre, 'ACEPTADA'); return { ok: true };
  });
  if (!out.ok) return res.status(out.code).json({ error: out.error });
  const t = getTraslado(id); emitir('actualizada', t); res.json(t);
});

app.post('/api/traslados/:id/liberar', auth('camillero'), (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare(`UPDATE traslados SET estado='EMITIDA', camillero_id=NULL, aceptado_en=NULL WHERE id=? AND camillero_id=? AND estado='ACEPTADA'`).run(id, req.user.id);
  if (!r.changes) return res.status(409).json({ error: 'No se puede devolver (ya retiraste al paciente o no es tuyo)' });
  evento(id, req.user.nombre, 'DEVUELTA', req.body.motivo);
  const t = getTraslado(id); emitir('nueva', t, { devuelta: true }); res.json(t);
});

app.post('/api/traslados/:id/retirar', auth('camillero'), (req, res) => {
  const id = Number(req.params.id);
  const t = getTraslado(id);
  if (!t || t.camillero_id !== req.user.id || t.estado !== 'ACEPTADA') return res.status(409).json({ error: 'Traslado no disponible para retirar' });
  const p = pacientePorCodigo(req.body.codigo);
  if (!p) return res.status(404).json({ error: 'Pulsera no reconocida. Probá de nuevo o ingresá el DNI.' });
  if (p.id !== t.paciente_id) {
    evento(id, req.user.nombre, 'PACIENTE_INCORRECTO', `Leyó: ${p.nombre}`);
    return res.status(409).json({ error: `⚠ PACIENTE INCORRECTO: la pulsera es de ${p.nombre}. No lo retires.` });
  }
  db.prepare(`UPDATE traslados SET estado='EN_TRASLADO', retirado_en=? WHERE id=?`).run(now(), id);
  evento(id, req.user.nombre, 'PACIENTE_VERIFICADO');
  const n = getTraslado(id); emitir('actualizada', n); res.json(n);
});

app.post('/api/traslados/:id/completar', auth('camillero'), (req, res) => {
  const id = Number(req.params.id);
  const t = getTraslado(id);
  if (!t || t.camillero_id !== req.user.id || t.estado !== 'EN_TRASLADO') return res.status(409).json({ error: 'Traslado no está en curso' });
  if (norm(req.body.codigo) !== norm(t.destino_codigo)) {
    const otro = db.prepare('SELECT nombre FROM lugares WHERE codigo=?').get(norm(req.body.codigo));
    return res.status(409).json({ error: otro ? `⚠ Ese es el QR de "${otro.nombre}". El destino es "${t.destino}".` : 'QR de destino no reconocido.' });
  }
  db.prepare(`UPDATE traslados SET estado='COMPLETADA', completado_en=?, nota_final=? WHERE id=?`).run(now(), String(req.body.nota || '').slice(0, 500), id);
  evento(id, req.user.nombre, 'COMPLETADA', req.body.nota);
  const n = getTraslado(id); emitir('actualizada', n); res.json(n);
});

app.post('/api/traslados/:id/cancelar', auth('conmutador', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare(`UPDATE traslados SET estado='CANCELADA', motivo_cancelacion=? WHERE id=? AND estado IN ('EMITIDA','ACEPTADA','EN_TRASLADO')`).run(req.body.motivo || '', id);
  if (!r.changes) return res.status(409).json({ error: 'No se puede cancelar' });
  evento(id, req.user.nombre, 'CANCELADA', req.body.motivo);
  const t = getTraslado(id); emitir('actualizada', t, { cancelada: true }); res.json(t);
});

app.get('/api/traslados/:id/eventos', auth('conmutador', 'admin'), (req, res) =>
  res.json(db.prepare('SELECT * FROM eventos WHERE traslado_id=? ORDER BY id').all(req.params.id)));

app.get('/api/estadisticas', auth('conmutador', 'admin'), (req, res) => {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const rows = db.prepare(`SELECT estado, emitido_en, aceptado_en, completado_en, camillero_id FROM traslados WHERE emitido_en >= ?`).all(hoy.toISOString());
  const min = (a, b) => (new Date(b) - new Date(a)) / 60000;
  const resp = rows.filter((r) => r.aceptado_en).map((r) => min(r.emitido_en, r.aceptado_en));
  const dur = rows.filter((r) => r.completado_en).map((r) => min(r.aceptado_en, r.completado_en));
  const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  res.json({
    total: rows.length, completados: rows.filter((r) => r.estado === 'COMPLETADA').length,
    pendientes: rows.filter((r) => r.estado === 'EMITIDA').length,
    en_curso: rows.filter((r) => ['ACEPTADA', 'EN_TRASLADO'].includes(r.estado)).length,
    min_respuesta: avg(resp), min_traslado: avg(dur),
  });
});


/* ---------- Actualizaciones de la app (toma el ultimo release de GitHub; el repo puede ser privado) ---------- */
const GH_REPO = process.env.GITHUB_REPO || 'demarext-vorder/camilleros-juncal';
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const ghHeaders = (extra = {}) => ({ 'User-Agent': 'camilleros-juncal-server', Accept: 'application/vnd.github+json', ...(GH_TOKEN ? { Authorization: 'Bearer ' + GH_TOKEN } : {}), ...extra });
let ultimoRelease = { t: 0, v: null };
async function releaseActual() {
  if (Date.now() - ultimoRelease.t < 60000) return ultimoRelease.v;
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}/releases/latest`, { headers: ghHeaders() });
  if (!r.ok) throw new Error('GitHub ' + r.status);
  const j = await r.json();
  const asset = (j.assets || []).find((a) => /\.apk$/i.test(a.name));
  const code = parseInt(String(j.tag_name || '').replace(/\D/g, ''), 10);
  if (!asset || !code) throw new Error('Release sin APK');
  ultimoRelease = { t: Date.now(), v: { code, version: j.name || j.tag_name, notas: j.body || '', size: asset.size, asset_id: asset.id, fecha: j.published_at } };
  return ultimoRelease.v;
}
app.get('/api/app/version', auth(), async (req, res) => {
  try { const { asset_id, ...v } = await releaseActual(); res.json(v); }
  catch (e) { res.status(502).json({ error: 'No se pudo consultar la última versión (' + e.message + ')' }); }
});
app.get('/api/app/apk', auth(), async (req, res) => {
  try {
    const v = await releaseActual();
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/releases/assets/${v.asset_id}`, { headers: ghHeaders({ Accept: 'application/octet-stream' }), redirect: 'follow' });
    if (!r.ok || !r.body) throw new Error('GitHub ' + r.status);
    res.set({ 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': v.size, 'Content-Disposition': 'attachment; filename="Camilleros-Juncal.apk"' });
    const { Readable } = require('node:stream');
    Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
  } catch (e) { if (!res.headersSent) res.status(502).json({ error: 'No se pudo bajar la actualización (' + e.message + ')' }); else res.destroy(); }
});

app.get('/api/health', (req, res) => res.json({ ok: true, hora: now() }));
app.use(express.static(path.join(__dirname, '..', 'www')));

/* ---------- arranque ---------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  const user = token && db.prepare('SELECT u.* FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id WHERE s.token=? AND u.activo=1').get(token);
  if (!user) return ws.close(4001, 'auth');
  const c = { ws, get user() { return db.prepare('SELECT * FROM usuarios WHERE id=?').get(user.id) || user; } };
  clientes.add(c);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => clientes.delete(c));
});
setInterval(() => wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 20000);

server.listen(PORT, '0.0.0.0', () => console.log(`Camilleros Juncal en http://0.0.0.0:${PORT}`));
