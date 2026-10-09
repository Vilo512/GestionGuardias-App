// ============================================================
// MÓDULO: CONFIG_ESTADO
// Exportar a: src/modules/config.js
// Líneas estimadas: ~70
// Dependencias externas: ninguna
// Helpers que usa: monthString, formatDateKey
// ============================================================
const SUPABASE_URL = 'https://elmpelhplacgkgfuiwno.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_xeqDUYHHiGZTMcCG4IQ8kA_JVPG38X0'; 
let supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

let state = {
  baseGroups: [], 
  baseMonth: 0, baseYear: 2025,
  customRotations: {}, 
  shifts: {},
  pedWhitelist: {}, // Conceptualmente ahora es: enabledDays
  festivos: {},
  skippedTurns: {}, 
  exceptionReasons: ['Baja médica', 'Vacaciones', 'Saliente guardia externa'],
  exceptionLogs: [],
  pendingExceptions: {},
  trades: [],
	bajasLargas: [],
	residentesFijos: [], // 💡 Almacenará los nombres de los residentes congelados al inicio
	habilitaciones: {}, // 💡 NUEVO: Control dinámico de todos los servicios manuales
  grantedTurn: {}, // 💡 Turno otorgado por admin: { [mk]: residentName }
};

// Guards anti-recursión: deben declararse antes de cualquier función que los use
// para evitar la Temporal Dead Zone (TDZ) de `let`.
let _computingTurn = false;
let _computingAnalisis = false;

/** Formatea año y mes a string "YYYY-MM" para claves de Supabase. */
function monthString(y, m) {
    return `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * Elimina las customRotations almacenadas para meses posteriores al dado en el plan activo.
 * Útil al reconfigurar el mes base para que los cálculos futuros partan desde cero.
 */
async function limpiarFuturos(y, m) {
    const planName = getCurrentRotPlan(formatDateKey(y, m, 1));
    const pr = state.planRotations?.[planName];
    if (!pr || !pr.customRotations) return;
    const baseVal = parseInt(y, 10) * 12 + parseInt(m, 10);
    let changed = false;
    for (const key of Object.keys(pr.customRotations)) {
        const parts = key.split('_');
        if (parts.length < 2) continue;
        const targetVal = parseInt(parts[0], 10) * 12 + parseInt(parts[1], 10);
        if (targetVal > baseVal) {
            delete pr.customRotations[key];
            changed = true;
        }
    }
    if (changed) await saveState();
}

// 📅 La app abre SIEMPRE en el mes real en curso (antes estaba fijada a enero de 2026,
// así que con el paso de los meses todos aterrizaban en el pasado y tenían que navegar
// con ◀▶ hasta hoy). El mes sigue siendo explícito y navegable (PRD §13.1).
let curDate = (() => { const _hoy = new Date(); return new Date(_hoy.getFullYear(), _hoy.getMonth(), 1); })();
let selectedRotPlan = null;
/**
 * Devuelve el nombre del plan de rotación activo para una dateKey dada.
 * Prioridad: 1) si hay simulación activa, el plan del residente simulado (toda la app
 * se ve desde su perspectiva); 2) si el delegado tiene un plan seleccionado manualmente,
 * ese; 3) el plan calculado del usuario logueado.
 * @param {string} dk - dateKey "YYYY_MM_DD"
 * @returns {string} nombre del plan
 */
function getCurrentRotPlan(dk) {
    if (simulatedViewUser !== null) {
        const sp = globalProfiles.find(pr => pr.nombre_mostrar === simulatedViewUser);
        if (sp) {
            const simPlan = getPlanForUserOnDate(sp, dk);
            if (simPlan) return simPlan.nombre;
        }
    }
    if (isDelegado && selectedRotPlan && selectedRotPlan !== "AUTO") return selectedRotPlan;
    const p = getPlanForUserOnDate(currentUserProfile, dk);
    return p ? p.nombre : (promoConfig.planes?.[0]?.nombre || "Plan Base");
}
let isAdmin = false;
let isDelegado = false;
// Dueño = creador de la especialidad. NO es un rol (PRD §3.2): hasta que
// existió «Hacer Admin», el único `rol:'admin'` era el Dueño y daba igual
// confundirlos. Ya no: lo que es de toda la especialidad —borrarla, cambiar
// hospital/nombre— se cierra con esto, no con isAdmin.
let esDueño = false;
let loggedInUser = null;
let simulatedViewUser = null;
let currentAdminView = 'pediatria';
let editingGroups = null; 
let showOnlyMine = false;
let perfilHorasFiltroY = new Date().getFullYear();
let perfilHorasFiltroM = new Date().getMonth(); // 0-indexed
let promoConfig = { servicios: [] };
let notificaciones = []; // Per-user, loaded from notificaciones table, NOT in state{}
let notifPanelOpen = false;
let _lastNotifTurnKey = null; // Session-level dedup key for turno_asignacion
let globalProfiles = []; // Almacena las fechas de inicio/cambio de todos los residentes activos

// ============================================================
// MÓDULO: HELPERS_UTILS
// Exportar a: src/modules/helpers.js
// Líneas estimadas: ~65
// Dependencias externas: state.festivos
// Helpers que usa: formatDateKey
// ============================================================
/** Devuelve hasta 3 iniciales en mayúscula del nombre dado. */
function getInitials(name) {
  if (!name) return "";
  return name.trim().split(/\s+/).map(word => word[0].toUpperCase()).join('').substring(0, 3);
}

/**
 * Actualiza el badge de estado con un mensaje; muestra advertencia visual si tarda >10 min.
 * @param {string} msg
 * @param {boolean} [isError=false]
 */
function setStatus(msg, isError = false) {
  const b = document.getElementById('status-badge');
  b.textContent = msg;
  b.className = isError ? 'status-error' : 'status-ok';
  b.style.background = ''; // Resetea colores personalizados previos
  
  // Aviso visual suave: No rompe el código, solo avisa si tarda mucho
  if (msg.includes('...') && !isError) {
      setTimeout(() => { 
          if (b.textContent === msg) { 
              b.textContent = "Sincronizando (Espera)... ⏳"; 
              b.style.background = "#f59e0b"; // Naranja amigable
          } 
      }, 600000);
  }
}

/** Muestra u oculta el campo libre de razón cuando el select tiene valor "Otros". */
function toggleOtherReasonInput() {
  const sel = document.getElementById('user-skip-reason');
  const inpBlock = document.getElementById('user-skip-reason-other-block');
  if (sel && inpBlock) inpBlock.style.display = sel.value === 'Otros' ? 'block' : 'none';
}

/** Convierte dateKey "YYYY_MM_DD" a string legible "D/M/YYYY". */
function formatDK(dk) { const parts = dk.split('_'); return `${parseInt(parts[2])}/${parseInt(parts[1])}/${parts[0]}`; }
/** Devuelve true si la dateKey es anterior a hoy (medianoche local). */
function isPastDate(dk) {
  const parts = dk.split('_');
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const today = new Date(); today.setHours(0, 0, 0, 0); 
  return d < today;
}

/** @returns {number} número de días del mes (considera años bisiestos). */
function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
/** @returns {number} desplazamiento del primer día (0=lunes … 6=domingo, estilo ISO). */
function getFirstDayOffset(y, m) { const d = new Date(y, m, 1).getDay(); return d === 0 ? 6 : d - 1; }
/** Construye la clave canónica de fecha "YYYY_MM_DD" con ceros de relleno. */
function formatDateKey(y, m, d) { return `${y}_${String(m+1).padStart(2,'0')}_${String(d).padStart(2,'0')}`; }
/** Devuelve true si el usuario tiene alguna guardia asignada en state.shifts ese día. */
function isUserBusyOnDay(user, dateKey) { return !!(state.shifts[dateKey] && state.shifts[dateKey][user]); }

// NÚCLEO ICS: Clasificador Inteligente de Días
/**
 * Clasifica un día según el sistema ICS: 'fin_de_semana', 'festivo_intersemanal', 'vispera' o 'laborable'.
 * @param {number} y
 * @param {number} m - 0-indexed
 * @param {number} d
 * @returns {'fin_de_semana'|'festivo_intersemanal'|'vispera'|'laborable'}
 */
function getDayTag(y, m, d) {
    const dk = formatDateKey(y, m, d);
    const date = new Date(y, m, d);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const isFest = !!state.festivos[dk];
    
    if (isWeekend) return 'fin_de_semana';
    if (isFest) return 'festivo_intersemanal';

    const tomorrow = new Date(y, m, d + 1);
    const tDk = formatDateKey(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
    const tIsWeekend = tomorrow.getDay() === 0 || tomorrow.getDay() === 6;
    const tIsFest = !!state.festivos[tDk];
    
    if (tIsWeekend || tIsFest) return 'vispera';
    return 'laborable';
}

// ============================================================
// MÓDULO: PERSISTENCIA
// Exportar a: src/modules/persistencia.js
// Líneas estimadas: ~135
// Dependencias externas: supabaseClient, state, promoConfig, currentUserProfile, authSession
// Helpers que usa: setStatus, formatDateKey, promoConfig.planes
// ============================================================
/**
 * Persiste state en Supabase (tabla estados_promocion). Incluye un cliente "ninja"
 * de reserva que bypasea el sistema de locks del SDK si la petición principal supera 3 s.
 */
async function saveState() {
  if (!currentUserProfile || !currentUserProfile.promocion_id) return;
  setStatus('Guardando...');
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout de red")), 3000));
    const peticionGuardado = supabaseClient.from('estados_promocion').upsert({ promocion_id: currentUserProfile.promocion_id, datos: state });
    
    const { error } = await Promise.race([peticionGuardado, timeout]);
    if (error) throw error;
    setStatus('Sincronizado ✅');
    
  } catch (err) {
    if (err.message === "Timeout de red") {
        // El candado principal está bloqueado. Desplegamos el Cliente Ninja.
        setStatus('Forzando guardado...');
        try {
            // Creamos un cliente que BYPASSEA el sistema de locks y usa la memoria RAM directamente
            const ninjaClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
                auth: { persistSession: false }, // Apaga el sistema de candados
                global: { headers: { Authorization: `Bearer ${authSession.access_token}` } } // Inyecta el token manualmente
            });
            
            const { error: retryErr } = await ninjaClient.from('estados_promocion').upsert({ promocion_id: currentUserProfile.promocion_id, datos: state });
            
            if (retryErr) throw retryErr;
            setStatus('Sincronizado ✅');
            
        } catch (ninjaErr) {
             console.error("Fallo del cliente ninja:", ninjaErr);
             setStatus('Error de red ❌', true);
             alert("La pestaña está bloqueada profundamente por el navegador. Recarga la página (F5) para seguir guardando.");
        }
    } else {
        console.error("Error al guardar:", err);
        setStatus('Error de red ❌', true);
    }
  }
}

// ============================================================
// MÓDULO: NOTIFICACIONES
// Tabla Supabase: notificaciones (id uuid PK, usuario_id uuid FK→auth.users, tipo text, payload jsonb, leida bool, timestamp timestamptz)
// ============================================================

/** Inserts a notification for a user into the notificaciones table. Fire-and-forget; silently ignores errors (table may not exist yet). */
async function insertNotificacion(usuarioId, tipo, payload) {
    if (!usuarioId) return;
    try {
        await supabaseClient.from('notificaciones').insert({ usuario_id: usuarioId, tipo, payload, leida: false });
        if (currentUserProfile && usuarioId === currentUserProfile.id) await loadNotificaciones();
    } catch (e) { console.warn('[Notif] insert:', e?.message); }
}

/** Loads the most recent notifications for the current user from Supabase. */
async function loadNotificaciones() {
    if (!currentUserProfile?.id) return;
    try {
        const { data } = await supabaseClient.from('notificaciones').select('*').eq('usuario_id', currentUserProfile.id).order('timestamp', { ascending: false }).limit(60);
        notificaciones = data || [];
    } catch (e) { console.warn('[Notif] load:', e?.message); notificaciones = []; }
    renderNotifBadge();
    if (notifPanelOpen) renderNotifPanel();
}

/** Marks one notification as read locally and in Supabase. */
async function markNotifRead(id) {
    const n = notificaciones.find(x => x.id === id);
    if (n && !n.leida) {
        n.leida = true;
        try { await supabaseClient.from('notificaciones').update({ leida: true }).eq('id', id); } catch (e) {}
    }
    renderNotifBadge();
    if (notifPanelOpen) renderNotifPanel();
}

/** Marks all current user's unread notifications as read. */
async function markAllNotifsRead() {
    const anyUnread = notificaciones.some(n => !n.leida);
    if (!anyUnread) return;
    notificaciones.forEach(n => { n.leida = true; });
    renderNotifBadge();
    renderNotifPanel();
    try { await supabaseClient.from('notificaciones').update({ leida: true }).eq('usuario_id', currentUserProfile.id).eq('leida', false); } catch (e) {}
}

/** Updates the bell badge unread count. */
function renderNotifBadge() {
    const count = notificaciones.filter(n => !n.leida).length;
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.style.display = count > 0 ? 'flex' : 'none';
}

/** Formats a timestamp as a relative Spanish string ("hace 5 min", "ayer", …). */
function timeAgo(ts) {
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return 'hace un momento';
    if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
    if (diff < 172800) return 'ayer';
    return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

/** Returns icon, background color, icon color and title for a notification type. */
function getNotifMeta(tipo) {
    const M = {
        turno_asignacion:    { icon: '🕐', bg: '#B5D4F4', color: '#0C447C', title: 'Es tu turno' },
        guardia_forzada:     { icon: '⚠️', bg: '#F5C4B3', color: '#993C1D', title: 'Guardia asignada' },
        ventana_voluntaria:  { icon: '📅', bg: '#B5D4F4', color: '#0C447C', title: 'Ventana voluntaria abierta' },
        propuesta_mercadillo:{ icon: '🔄', bg: '#C0DD97', color: '#3B6D11', title: 'Propuesta recibida' },
        propuesta_resuelta:  { icon: '✅', bg: '#C0DD97', color: '#3B6D11', title: 'Propuesta resuelta' },
        hueco_sin_candidato: { icon: '🚨', bg: '#F7C1C1', color: '#A32D2D', title: 'Hueco sin candidato' },
    };
    return M[tipo] || { icon: '🔔', bg: '#e2e8f0', color: '#475569', title: 'Notificación' };
}

/** Builds the human-readable description from a notification's payload. */
function getNotifDesc(tipo, payload) {
    const p = payload || {};
    switch (tipo) {
        case 'turno_asignacion':    return `Te toca elegir guardias de ${p.mes || ''}.`;
        case 'guardia_forzada':     return `Se te ha asignado una guardia de ${p.servicio || ''} el ${p.fecha || ''}.`;
        case 'ventana_voluntaria':  return `La ventana voluntaria de ${p.servicio || ''} en ${p.mes || ''} está abierta. Puedes reclamar huecos libremente.`;
        case 'propuesta_mercadillo':return `${p.proponente || 'Alguien'} te propone un ${p.tipo || 'cambio'} el ${p.fecha || ''}.`;
        case 'propuesta_resuelta':  return `Tu propuesta del ${p.fecha || ''} fue ${p.resultado || 'procesada'}.`;
        case 'hueco_sin_candidato': return `${p.count || 1} hueco(s) de ${p.servicio || ''} sin candidato válido.`;
        default: return '';
    }
}

/** Renders the notification dropdown panel into #notif-panel. */
function renderNotifPanel() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const unread = notificaciones.filter(n => !n.leida).length;
    let html = `<div class="notif-panel__header"><span class="notif-panel__title">Notificaciones</span>${unread > 0 ? `<a class="notif-panel__read-all" onclick="markAllNotifsRead()">marcar todas como leídas</a>` : ''}</div><div class="notif-panel__list">`;
    if (notificaciones.length === 0) {
        html += `<div class="notif-empty">No tienes notificaciones</div>`;
    } else {
        for (const n of notificaciones) {
            const meta = getNotifMeta(n.tipo);
            const desc = getNotifDesc(n.tipo, n.payload);
            const isAction = n.tipo === 'propuesta_mercadillo' && n.payload?.trade_id;
            html += `<div class="notif-item${n.leida ? '' : ' notif-item--unread'}" onclick="handleNotifClick('${n.id}','${n.tipo}')">`;
            html += `<div class="notif-item__icon" style="background:${meta.bg};"><span style="color:${meta.color};">${meta.icon}</span></div>`;
            html += `<div class="notif-item__content"><div class="notif-item__title">${meta.title}</div><div class="notif-item__desc">${desc}</div><div class="notif-item__time">${timeAgo(n.timestamp)}</div>`;
            if (isAction) {
                html += `<div class="notif-item__actions" onclick="event.stopPropagation()"><button class="primary" style="background:var(--ped);" onclick="notifAceptarTrade(${n.payload.trade_id},'${n.id}')">Aceptar</button><button class="danger" onclick="notifRechazarTrade(${n.payload.trade_id},'${n.id}')">Rechazar</button></div>`;
            }
            html += `</div>${!n.leida ? '<div class="notif-item__dot"></div>' : ''}</div>`;
        }
    }
    html += `</div>`;
    panel.innerHTML = html;
}

/** Handles clicking a notification: marks read, closes panel, navigates to context. */
async function handleNotifClick(id, tipo) {
    const n = notificaciones.find(x => x.id === id);
    if (!n) return;
    await markNotifRead(id);
    if (notifPanelOpen) toggleNotifPanel();
    const p = n.payload || {};
    if (p.year !== undefined && p.month !== undefined) curDate = new Date(p.year, p.month, 1);
    if (['turno_asignacion', 'guardia_forzada', 'ventana_voluntaria'].includes(tipo)) nav('cal');
    else if (['propuesta_mercadillo', 'propuesta_resuelta'].includes(tipo)) nav('merc');
    else if (tipo === 'hueco_sin_candidato' && isDelegado) nav('admin');
}

/** Accepts a pending trade from the notification panel. */
async function notifAceptarTrade(tradeId, notifId) {
    await processTrade(tradeId, true);
    await markNotifRead(notifId);
}

/** Rejects a pending trade from the notification panel. */
async function notifRechazarTrade(tradeId, notifId) {
    await processTrade(tradeId, false);
    await markNotifRead(notifId);
}

/** Toggles the notification panel open/closed. */
function toggleNotifPanel() {
    notifPanelOpen = !notifPanelOpen;
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    if (notifPanelOpen) {
        renderNotifPanel();
        panel.style.display = 'flex';
        // Defer so this click doesn't immediately close the panel
        setTimeout(() => document.addEventListener('click', _closeNotifOnOutside, { capture: true }), 0);
    } else {
        panel.style.display = 'none';
        document.removeEventListener('click', _closeNotifOnOutside, { capture: true });
    }
}

function _closeNotifOnOutside(e) {
    const panel = document.getElementById('notif-panel');
    const btn = document.getElementById('notif-btn');
    if (panel && panel.contains(e.target)) return; // Click inside panel — keep open
    if (btn && btn.contains(e.target)) return;      // Click on the bell button — toggleNotifPanel handles it
    panel.style.display = 'none';
    notifPanelOpen = false;
    document.removeEventListener('click', _closeNotifOnOutside, { capture: true });
}

/** Fires a turno_asignacion notification when the turn holder changes (session-level dedup). */
async function maybeNotifyTurnChange(y, m) {
    const turnUser = getCurrentTurn(y, m);
    if (!turnUser) return;
    const key = `${y}_${m}_${turnUser}`;
    if (key === _lastNotifTurnKey) return;
    _lastNotifTurnKey = key;
    const profile = globalProfiles.find(p => p.nombre_mostrar === turnUser);
    if (!profile) return;
    await insertNotificacion(profile.id, 'turno_asignacion', { year: y, month: m, mes: MONTHS[m] + ' ' + y, residente: turnUser });
}

/** Sends propuesta_mercadillo to the trade target when a new pending trade is created. */
async function _notifyNewTrade(trade) {
    if (!trade || trade.target === 'Externo' || trade.status !== 'pending') return;
    const targetProf = globalProfiles.find(p => p.nombre_mostrar === trade.target);
    if (!targetProf) return;
    const parts = (trade.d1 || '').split('_');
    const year = parseInt(parts[0]) || curDate.getFullYear();
    const month = (parseInt(parts[1]) || (curDate.getMonth() + 1)) - 1;
    await insertNotificacion(targetProf.id, 'propuesta_mercadillo', { trade_id: trade.id, proponente: trade.requester, tipo: trade.type, fecha: formatDK(trade.d1), year, month });
}

/** Sends propuesta_resuelta to the trade requester after a pending trade is approved or rejected. */
async function _notifyTradeResolved(tradeId) {
    const t = state.trades.find(x => x.id === tradeId);
    if (!t || !['approved', 'rejected'].includes(t.status)) return;
    if (t.requester === loggedInUser) return; // Requester is the one approving — skip
    const reqProf = globalProfiles.find(p => p.nombre_mostrar === t.requester);
    if (!reqProf) return;
    const parts = (t.d1 || '').split('_');
    const year = parseInt(parts[0]) || curDate.getFullYear();
    const month = (parseInt(parts[1]) || (curDate.getMonth() + 1)) - 1;
    await insertNotificacion(reqProf.id, 'propuesta_resuelta', { trade_id: t.id, tipo: t.type, fecha: formatDK(t.d1), resultado: t.status === 'approved' ? 'aceptada' : 'rechazada', year, month });
}

/**
 * Rellena campos opcionales de una configuración de promoción con valores por defecto.
 * También realiza la migración desde el formato antiguo (config.servicios) al nuevo (config.planes).
 * @param {Object} config - objeto configuracion de la tabla promociones
 * @returns {Object} configuración normalizada
 */
function normalizeConfig(config) {
    if (!config.ventana_voluntaria_horas || config.ventana_voluntaria_horas < 24 || config.ventana_voluntaria_horas > 48) config.ventana_voluntaria_horas = 48;
    if (!config.planes) {
        config.planes = [{ id: 'plan-' + Date.now(), nombre: "Plan R1 (Año 1)", servicios: config.servicios || [] }];
        delete config.servicios;
    }

    // 1. Preparamos variables para agrupar servicios globales
    let serviciosUnicos = [];
    let nombresUnicos = new Set();

    config.planes.forEach(plan => {
        if (!plan.servicios) plan.servicios = [];
        plan.servicios.forEach(s => {
            if (s.cupoMensualTotal === undefined) s.cupoMensualTotal = s.cupo || 0;
            if (s.plazasPorDia === undefined) s.plazasPorDia = s.soloAdmin ? 5 : 1; 
            if (s.requiereHabilitacion === undefined) s.requiereHabilitacion = (s.nombre === 'Pediatría');
            
            if (s.generaSaliente && !s.pernocta) s.pernocta = s.generaSaliente; 
            if (!s.pernocta) s.pernocta = { laborable: true, vispera: true, fin_de_semana: (s.nombre!=='PAC Balaguer'), festivo_intersemanal: (s.nombre!=='PAC Balaguer') };
            if (!s.horas) s.horas = { laborable: 17, vispera: 17, festivo: 24 };

            if (!s.reglasObligatorias) s.reglasObligatorias = [];
            if (!s.color || !/^#[0-9A-F]{6}$/i.test(s.color)) s.color = '#3b82f6';
            if (!s.reglaIntercambio) s.reglaIntercambio = 'superior';

            // 2. Extraemos el servicio único
            if (!nombresUnicos.has(s.nombre)) {
                nombresUnicos.add(s.nombre);
                serviciosUnicos.push(s);
            }
        });
    });

    // 👉 PARCHE MAESTRO: Restaurar la lista global para que Mercadillo y Salientes no colapsen
    config.servicios = serviciosUnicos;

    return config;
}

/** Descarga y normaliza la configuración de la promoción desde Supabase; rellena promoConfig. */
async function loadPromoConfig() {
  if (!currentUserProfile?.promocion_id) { esDueño = false; return; }
  try {
    const { data, error } = await supabaseClient.from('promociones').select('configuracion, creador_id').eq('id', currentUserProfile.promocion_id).single();
    esDueño = !!(data && data.creador_id === currentUserProfile.id);
    if (data && data.configuracion) promoConfig = normalizeConfig(data.configuracion);
    else promoConfig = normalizeConfig({});
  } catch (e) { console.error("Error cargando config", e); esDueño = false; promoConfig = normalizeConfig({}); }
}
	
/**
 * Descarga globalProfiles y state desde Supabase; inicializa defaults si no existe estado previo.
 * Ejecuta checkAutomaticGraduation() y renderAll() al finalizar.
 */
async function loadState() {
  if (!currentUserProfile || !currentUserProfile.promocion_id) return;
  setStatus('Cargando calendario...');
  try {
    // Descargamos los perfiles aprobados para nutrir al simulador temporal
    const { data: profs } = await supabaseClient.from('perfiles').select('*').eq('promocion_id', currentUserProfile.promocion_id).in('estado', ['aprobado', 'historico']);
    globalProfiles = profs || [];

    const { data, error } = await supabaseClient.from('estados_promocion').select('datos').eq('promocion_id', currentUserProfile.promocion_id).single();
    if (error && error.code !== 'PGRST116') throw error; 
    
    if (data && data.datos) {
      let loaded = data.datos;
      state = { ...state, ...loaded };
      if (!state.exceptionReasons) state.exceptionReasons = ['Baja médica', 'Vacaciones', 'Saliente guardia externa'];
      if (!state.exceptionLogs) state.exceptionLogs = [];
      if (!state.pendingExceptions) state.pendingExceptions = {};
      if (!state.trades) state.trades = [];
      // Limpieza de seguridad: si planRotations no tiene grupos reales configurados,
      // los "graduados" automáticos son falsos positivos → los descartamos para que aparezcan en el turno
      const _hayRotReal = state.planRotations && Object.values(state.planRotations).some(pr => pr.baseGroups && pr.baseGroups.flat().filter(Boolean).length > 1);
      if (!_hayRotReal && state.graduados && state.graduados.length > 0) {
          console.warn('[Safety] Limpiando state.graduados falsos – planRotations sin grupos reales configurados.');
          state.graduados = [];
      }
      // 🧭 B7: migración única de habilitaciones a claves por plan (svc@@plan)
      if (migrarHabilitacionesPorPlan()) {
          console.log('🧭 [B7] state.habilitaciones migrado a claves por plan. Persistiendo...');
          saveState(); // fire-and-forget; la migración es idempotente
      }
    } else {
      state.shifts = {}; state.customRotations = {}; state.pedWhitelist = {}; state.festivos = {}; state.trades = [];
      const _initPlanName = promoConfig.planes?.[0]?.nombre || "Plan Base";
      state.planRotations = {};
      state.planRotations[_initPlanName] = {
          baseGroups: [[currentUserProfile.nombre_mostrar]],
          baseYear: curDate.getFullYear(),
          baseMonth: curDate.getMonth(),
          customRotations: {},
          residentesFijos: []
      };
      state.baseGroups = [[currentUserProfile.nombre_mostrar]]; // compat
    }
    setStatus('Sincronizado ✅');
    checkAutomaticGraduation();
    renderAll();
    loadNotificaciones(); // N1: load per-user notifications (fire-and-forget)
  } catch (err) {
    console.error("Error al cargar:", err);
    setStatus('Error de red ❌', true);
    alert("La conexión con el servidor ha fallado.");
  }
}
