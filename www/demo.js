'use strict';
/* Modo demo: simula el servidor dentro del navegador/celular (sin conexión).
   El estado se guarda en localStorage y se sincroniza entre pestañas con BroadcastChannel,
   así se puede abrir "conmutador" en una pestaña y "camillero" en otra. */
const Demo = (() => {
  const KEY = 'cj_demo_state';
  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cj_demo') : null;
  let listener = null;
  const now = () => new Date().toISOString();
  const seed = () => ({
    seq: 1,
    usuarios: [
      { id: 1, usuario: 'conmutador', nombre: 'Conmutador', rol: 'conmutador', en_turno: 0 },
      { id: 2, usuario: 'elias', nombre: 'Elias Ferreira', rol: 'camillero', en_turno: 1 },
      { id: 3, usuario: 'lucia', nombre: 'Lucía Fernández', rol: 'camillero', en_turno: 1 },
      { id: 4, usuario: 'marcos', nombre: 'Marcos Giménez', rol: 'camillero', en_turno: 0 },
    ],
    lugares: [[1, 'LUG-RX01', 'Rayos X'], [2, 'LUG-TC01', 'Tomografía'], [3, 'LUG-RM01', 'Resonancia'], [4, 'LUG-QX01', 'Quirófano 1'],
      [5, 'LUG-LAB1', 'Laboratorio'], [6, 'LUG-HEM1', 'Hemodinamia'], [7, 'LUG-UTI1', 'Terapia Intensiva'], [8, 'LUG-GUA1', 'Guardia']]
      .map(([id, codigo, nombre]) => ({ id, codigo, nombre, activo: 1 })),
    pacientes: [
      [1, '20345678', 'HC-10231', 'González, María Elena', '304-A', 'Internación 3° piso', '2034567801', 0, 1, 'camilla'],
      [2, '14876543', 'HC-10244', 'Pereyra, Roberto', '212-B', 'Internación 2° piso', '1487654301', 0, 0, 'silla'],
      [3, '31222444', 'HC-10250', 'Sosa, Valentina', 'UTI-04', 'Terapia Intensiva', '3122244401', 1, 1, 'camilla'],
      [4, '9876543', 'HC-10262', 'Rodríguez, Hugo Alberto', '306-A', 'Internación 3° piso', '987654301', 0, 0, 'camilla'],
      [5, '27111222', 'HC-10270', 'Acosta, Lidia', 'GUA-02', 'Guardia', '2711122201', 0, 0, 'silla'],
    ].map(([id, dni, historia, nombre, cama, sector, pulsera, aislamiento, oxigeno, movilidad]) => ({ id, dni, historia, nombre, cama, sector, pulsera, aislamiento, oxigeno, movilidad })),
    traslados: [], eventos: [],
  });
  let st = null;
  const load = () => { try { st = JSON.parse(localStorage.getItem(KEY)); } catch { st = null; } if (!st) { st = seed(); save(); } return st; };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  const reset = () => { st = seed(); save(); };
  const err = (m, code = 409) => { const e = new Error(m); e.code = code; throw e; };
  const norm = (s) => String(s ?? '').trim().toUpperCase();
  const usr = (id) => st.usuarios.find((u) => u.id === id);
  const pub = (u) => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, en_turno: !!u.en_turno });
  const full = (t) => { const p = st.pacientes.find((x) => x.id === t.paciente_id), l = st.lugares.find((x) => x.id === t.destino_id);
    return { ...t, paciente: p.nombre, dni: p.dni, historia: p.historia, cama: p.cama, paciente_sector: p.sector, aislamiento: p.aislamiento, oxigeno: p.oxigeno, movilidad: p.movilidad,
      destino: l.nombre, destino_codigo: l.codigo, camillero: t.camillero_id ? usr(t.camillero_id).nombre : null, emisor: t.emitido_por ? usr(t.emitido_por).nombre : null }; };
  const ev = (id, u, tipo, detalle) => st.eventos.push({ id: st.eventos.length + 1, traslado_id: id, ts: now(), usuario: u, tipo, detalle: detalle || null });
  const emit = (tipo, traslado, extra = {}) => { const m = { tipo, traslado: traslado ? full(traslado) : null, ...extra };
    bc && bc.postMessage(m); listener && setTimeout(() => listener(m), 30); };
  const pacPorCodigo = (c) => { const raw = norm(c); const toks = [raw, raw.replace(/\D/g, ''), ...raw.split(/[^A-Z0-9-]+/)].filter(Boolean);
    for (const t of toks) { const p = st.pacientes.find((x) => norm(x.pulsera) === t || x.dni === t || norm(x.historia) === t); if (p) return p; } return null; };
  const activos = ['EMITIDA', 'ACEPTADA', 'EN_TRASLADO'];

  async function api(path, method, body, token) {
    await new Promise((r) => setTimeout(r, 120)); load();
    const [p, qs] = path.split('?'); const q = new URLSearchParams(qs || ''); const me = token ? usr(Number(String(token).split(':')[1])) : null;
    const m = (re) => p.match(re);
    if (p === '/health') return { ok: true };
    if (p === '/login') { const u = st.usuarios.find((x) => x.usuario === body.usuario); if (!u) err('Usuario inválido', 401); return { token: 'demo:' + u.id, usuario: pub(u) }; }
    if (!me) err('Sesión vencida', 401);
    if (p === '/me') return pub(me);
    if (p === '/logout') { if (me.rol === 'camillero') me.en_turno = 0; save(); emit('equipo', null); return { ok: true }; }
    if (p === '/pin') return { ok: true };
    if (p === '/turno') { me.en_turno = body.en_turno ? 1 : 0; save(); emit('equipo', null); return { en_turno: !!me.en_turno }; }
    if (p === '/equipo') return st.usuarios.filter((u) => u.rol === 'camillero').map((u) => ({ id: u.id, nombre: u.nombre, en_turno: !!u.en_turno,
      ocupado: st.traslados.some((t) => t.camillero_id === u.id && ['ACEPTADA', 'EN_TRASLADO'].includes(t.estado)) }));
    if (p === '/lugares') return st.lugares;
    if (p === '/pacientes') { const s = (q.get('q') || '').toLowerCase(); return st.pacientes.filter((x) => [x.nombre, x.dni, x.cama, x.historia].some((v) => String(v).toLowerCase().includes(s))); }
    if (p === '/estadisticas') { const T = st.traslados; const min = (a, b) => (new Date(b) - new Date(a)) / 60000; const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
      return { total: T.length, completados: T.filter((t) => t.estado === 'COMPLETADA').length, pendientes: T.filter((t) => t.estado === 'EMITIDA').length,
        en_curso: T.filter((t) => ['ACEPTADA', 'EN_TRASLADO'].includes(t.estado)).length, min_respuesta: avg(T.filter((t) => t.aceptado_en).map((t) => min(t.emitido_en, t.aceptado_en))),
        min_traslado: avg(T.filter((t) => t.completado_en).map((t) => min(t.aceptado_en, t.completado_en))) }; }
    if (p === '/traslados' && method === 'GET') {
      let r;
      if (me.rol === 'camillero') r = q.get('historial') ? st.traslados.filter((t) => t.camillero_id === me.id && t.estado === 'COMPLETADA').reverse()
        : st.traslados.filter((t) => t.estado === 'EMITIDA' || (t.camillero_id === me.id && ['ACEPTADA', 'EN_TRASLADO'].includes(t.estado)))
            .sort((a, b) => (b.prioridad === 'urgente') - (a.prioridad === 'urgente') || a.id - b.id);
      else r = [...st.traslados].sort((a, b) => (activos.includes(b.estado) - activos.includes(a.estado)) || b.id - a.id);
      return r.map(full);
    }
    if (p === '/traslados' && method === 'POST') {
      const pa = st.pacientes.find((x) => x.id === body.paciente_id), l = st.lugares.find((x) => x.id === body.destino_id);
      if (!pa || !l) err('Paciente o destino inválido', 400);
      if (st.traslados.some((t) => t.paciente_id === pa.id && activos.includes(t.estado))) err('Ese paciente ya tiene un traslado en curso');
      const t = { id: st.seq++, paciente_id: pa.id, origen: body.origen || [pa.sector, pa.cama].filter(Boolean).join(' · '), destino_id: l.id, prioridad: body.prioridad === 'urgente' ? 'urgente' : 'normal',
        requisitos: body.requisitos || '', nota_emision: body.nota || '', estado: 'EMITIDA', emitido_por: me.id, emitido_en: now(), camillero_id: null, aceptado_en: null, retirado_en: null, completado_en: null, nota_final: '' };
      st.traslados.push(t); ev(t.id, me.nombre, 'EMITIDA', body.nota); save(); emit('nueva', t); return full(t);
    }
    const mt = m(/^\/traslados\/(\d+)\/(\w+)$/);
    if (mt) {
      const t = st.traslados.find((x) => x.id === Number(mt[1])); const a = mt[2]; if (!t) err('No existe', 404);
      if (a === 'eventos') return st.eventos.filter((e) => e.traslado_id === t.id);
      if (a === 'aceptar') {
        if (!me.en_turno) err('Activá "En turno" para aceptar traslados');
        if (st.traslados.some((x) => x.camillero_id === me.id && ['ACEPTADA', 'EN_TRASLADO'].includes(x.estado))) err('Ya tenés un traslado en curso');
        if (t.estado !== 'EMITIDA') err('Otro camillero ya tomó este traslado');
        t.estado = 'ACEPTADA'; t.camillero_id = me.id; t.aceptado_en = now(); ev(t.id, me.nombre, 'ACEPTADA');
      } else if (a === 'liberar') { if (t.camillero_id !== me.id || t.estado !== 'ACEPTADA') err('No se puede devolver'); t.estado = 'EMITIDA'; t.camillero_id = null; t.aceptado_en = null; ev(t.id, me.nombre, 'DEVUELTA'); save(); emit('nueva', t, { devuelta: true }); return full(t); }
      else if (a === 'retirar') {
        if (t.camillero_id !== me.id || t.estado !== 'ACEPTADA') err('Traslado no disponible para retirar');
        const pa = pacPorCodigo(body.codigo); if (!pa) err('Pulsera no reconocida. Probá de nuevo o ingresá el DNI.', 404);
        if (pa.id !== t.paciente_id) err(`⚠ PACIENTE INCORRECTO: la pulsera es de ${pa.nombre}. No lo retires.`);
        t.estado = 'EN_TRASLADO'; t.retirado_en = now(); ev(t.id, me.nombre, 'PACIENTE_VERIFICADO');
      } else if (a === 'completar') {
        if (t.camillero_id !== me.id || t.estado !== 'EN_TRASLADO') err('Traslado no está en curso');
        const l = st.lugares.find((x) => x.id === t.destino_id); if (norm(body.codigo) !== norm(l.codigo)) err(`⚠ QR de otro lugar. El destino es "${l.nombre}".`);
        t.estado = 'COMPLETADA'; t.completado_en = now(); t.nota_final = String(body.nota || '').slice(0, 500); ev(t.id, me.nombre, 'COMPLETADA', body.nota);
      } else if (a === 'cancelar') { t.estado = 'CANCELADA'; ev(t.id, me.nombre, 'CANCELADA', body.motivo); save(); emit('actualizada', t, { cancelada: true }); return full(t); }
      else err('Acción desconocida', 404);
      save(); emit('actualizada', t); return full(t);
    }
    err('No disponible en la demo', 404);
  }

  /** Camilleros "virtuales": ayudan a que la demo tenga vida cuando se prueba solo. */
  async function bots(rol) {
    load();
    const tokL = 'demo:3';
    if (rol === 'camillero') { // el conmutador virtual emite un traslado urgente a los pocos segundos
      setTimeout(async () => { load(); if (!st.traslados.some((t) => activos.includes(t.estado)))
        await api('/traslados', 'POST', { paciente_id: 3, destino_id: 2, prioridad: 'urgente', requisitos: 'Oxígeno, Aislamiento, Monitor', nota: 'Control con médico de guardia al llegar' }, 'demo:1').catch(() => {}); }, 4000);
    }
  }
  /** Lucía (virtual) atiende lo que emite el conmutador en la demo, para que se vea el seguimiento. */
  function lucia(t) {
    const step = async (ms, fn) => new Promise((r) => setTimeout(async () => { try { await fn(); } catch {} r(); }, ms));
    (async () => {
      await step(5000, () => load() && st.traslados.find((x) => x.id === t.id).estado === 'EMITIDA' && api(`/traslados/${t.id}/aceptar`, 'POST', {}, 'demo:3'));
      const pa = () => st.pacientes.find((x) => x.id === t.paciente_id), lg = () => st.lugares.find((x) => x.id === t.destino_id);
      await step(6000, () => api(`/traslados/${t.id}/retirar`, 'POST', { codigo: pa().pulsera }, 'demo:3'));
      await step(9000, () => api(`/traslados/${t.id}/completar`, 'POST', { codigo: lg().codigo, nota: 'Paciente tranquilo' }, 'demo:3'));
    })();
  }
  if (bc) bc.onmessage = (e) => { listener && listener(e.data); };
  return { api, reset, load, bots, lucia, onMessage: (f) => { listener = f; }, pacienteCodigo: (id) => (st || load()).pacientes.find((x) => x.id === id)?.pulsera };
})();
