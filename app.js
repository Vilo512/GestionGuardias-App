
// REVISAR: podría pertenecer a HELPERS_SERVICIOS
/**
 * Genera el estilo CSS de fondo de una celda de calendario según festivos y servicios habilitados.
 * @param {string} dk  - dateKey "YYYY_MM_DD"
 * @param {number} filterLevel - nombre del plan activo o 'ALL'
 * @returns {string} regla CSS inline (background / gradient)
 */
function getCellBackgroundStyle(dk, y, m, d, filterLevel = 'ALL') {
    const dateObj = new Date(y, m, d);
    const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
    let colors = [];
    
    // Si es festivo
    if (state.festivos[dk] || isWeekend) {
        colors.push('#fee2e2'); // Rojo clarito
    }
    
    // Si hay servicios habilitados
    if (promoConfig && promoConfig.planes) {
        promoConfig.planes.forEach(plan => {
            if (filterLevel !== 'ALL' && plan.nombre !== filterLevel) return;
            if (plan.servicios) {
                plan.servicios.forEach(svc => {
                    if (svc.requiereHabilitacion && isServiceEnabledOnDate(svc.nombre, dk, plan.nombre)) {
                        // color con algo de transparencia
                        colors.push(svc.color + '40'); 
                    }
                });
            }
        });
    }
    
    if (colors.length === 0) return '';
    if (colors.length === 1) return `background: ${colors[0]};`;
    
    // Gradient stripes for multiple colors
    let gradient = [];
    let step = 100 / colors.length;
    for (let i = 0; i < colors.length; i++) {
        gradient.push(`${colors[i]} ${i * step}%`);
        gradient.push(`${colors[i]} ${(i + 1) * step}%`);
    }
    return `background: linear-gradient(135deg, ${gradient.join(', ')}); border-color: ${colors[0]}; border-width: 2px;`;
}

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

let curDate = new Date(2026, 0, 1);
let selectedRotPlan = null;
/**
 * Devuelve el nombre del plan de rotación activo para una dateKey dada.
 * Si el delegado tiene un plan seleccionado manualmente, tiene prioridad sobre el calculado.
 * @param {string} dk - dateKey "YYYY_MM_DD"
 * @returns {string} nombre del plan
 */
function getCurrentRotPlan(dk) {
    if (isDelegado && selectedRotPlan && selectedRotPlan !== "AUTO") return selectedRotPlan;
    const p = getPlanForUserOnDate(currentUserProfile, dk);
    return p ? p.nombre : (promoConfig.planes?.[0]?.nombre || "Plan Base");
}
let isAdmin = false;
let isDelegado = false;
let loggedInUser = null;
let simulatedViewUser = null;
let currentAdminView = 'pediatria';
let editingGroups = null; 
let showOnlyMine = false;
let perfilHorasFiltroY = new Date().getFullYear();
let perfilHorasFiltroM = new Date().getMonth(); // 0-indexed
let promoConfig = { servicios: [] };
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
  if (!currentUserProfile?.promocion_id) return;
  try {
    const { data, error } = await supabaseClient.from('promociones').select('configuracion').eq('id', currentUserProfile.promocion_id).single();
    if (data && data.configuracion) promoConfig = normalizeConfig(data.configuracion);
    else promoConfig = normalizeConfig({});
  } catch (e) { console.error("Error cargando config", e); promoConfig = normalizeConfig({}); }
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
  } catch (err) {
    console.error("Error al cargar:", err);
    setStatus('Error de red ❌', true);
    alert("La conexión con el servidor ha fallado.");
  }
}
// ============================================================
// MÓDULO: AUTH_SESION
// Exportar a: src/modules/auth.js
// Líneas estimadas: ~120
// Dependencias externas: supabaseClient, currentUserProfile, loggedInUser, isAdmin, isDelegado
// Helpers que usa: setStatus, renderUserHeader, evaluarEstadoUsuario, loadPromoConfig, loadState, nav, renderAll, renderGruposView, renderAccountsList, renderAdminExceptions
// ============================================================
let authSession = null;
let currentUserProfile = null; 

/**
 * Punto de entrada de la aplicación: recupera la sesión activa, suscribe al canal de auth
 * y registra el destructor de bloqueos al volver a la pestaña.
 */
async function initApp() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        await handleSession(session);
        
        supabaseClient.auth.onAuthStateChange(async (event, newSession) => {
            if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
                await handleSession(newSession);
            } else {
                authSession = newSession;
            }
        });


    } catch (err) {
        setStatus("Error de sesión", true);
    }
    
    // DESTRUCTOR DE BLOQUEOS V2 (Silencioso): Recrea la conexión para evitar que Supabase se congele al volver a la pestaña, pero sin lanzar bucles de recarga.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            
            if (document.getElementById('pane-grupos') && document.getElementById('pane-grupos').style.display === 'block') {
                renderGruposView();
            }
            if (document.getElementById('pane-admin') && document.getElementById('pane-admin').style.display === 'block') {
                if (typeof currentAdminView !== 'undefined' && currentAdminView === 'cuentas') {
                    renderAccountsList();
                } else if (typeof currentAdminView !== 'undefined' && currentAdminView === 'excepciones') {
                    renderAdminExceptions();
                }
            }
        }
    });
}

/**
 * Procesa un cambio de sesión OAuth: sincroniza loggedInUser / currentUserProfile
 * y delega el renderizado al evaluador de estado.
 * @param {Object|null} session - sesión Supabase o null si el usuario cerró sesión
 */
async function handleSession(session) {
    authSession = session;
    if (session) {
        loggedInUser = session.user.user_metadata.full_name || session.user.email;
        await syncUserProfile(session.user);
    } else {
        loggedInUser = null; currentUserProfile = null;
        document.querySelector('.tabs').style.display = 'none';
        nav('help'); 
    }
    renderUserHeader();
}

/**
 * Busca el perfil del usuario en Supabase; lo crea si no existe (primer login).
 * Actualiza currentUserProfile y loggedInUser, luego llama a evaluarEstadoUsuario().
 * @param {Object} user - objeto usuario de Supabase Auth
 */
async function syncUserProfile(user) {
  try {
    // Restauramos el chivato visual para saber cuándo se consulta la base de datos
    setStatus('Verificando perfil...');
    
    const { data, error } = await supabaseClient.from('perfiles').select('*').eq('id', user.id).single();

    if (error && error.code === 'PGRST116') {
      const newProfile = { id: user.id, nombre_mostrar: user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Residente', estado: 'pendiente' };
      const { error: insertError } = await supabaseClient.from('perfiles').insert(newProfile);
      if (insertError) alert("Error al crear tu perfil en la base de datos.");
      else currentUserProfile = newProfile;
    } else if (data) {
      currentUserProfile = data;
      loggedInUser = data.nombre_mostrar;
    }
    
    setStatus('Conectado ✅');
    await evaluarEstadoUsuario(); 
  } catch (err) { 
    setStatus('Error ❌', true); 
  }
}

/**
 * Muestra el panel correcto según el estado del perfil (sin grupo, pendiente, aprobado).
 * Carga roles, configuración y estado cuando el perfil está aprobado.
 */
async function evaluarEstadoUsuario() {
  try {
      ['cal','merc','rot','help','admin', 'onboarding', 'pending'].forEach(t => {
          const el = document.getElementById(`pane-${t}`); if(el) el.style.display = 'none';
      });
      document.querySelector('.tabs').style.display = 'none'; 

      if (!currentUserProfile) {
          document.querySelector('.tabs').style.display = 'flex';
          nav('help'); return;
      }

      if (!currentUserProfile.promocion_id) {
          document.getElementById('onb-name').textContent = currentUserProfile.nombre_mostrar;
          document.getElementById('pane-onboarding').style.display = 'block';
          cargarListaPromociones();
      } 
      else if (currentUserProfile.estado === 'pendiente') {
          document.getElementById('pane-pending').style.display = 'block';
      } 
      else if (currentUserProfile.estado === 'aprobado') {
          document.querySelector('.tabs').style.display = 'flex';
          isAdmin = (currentUserProfile.rol === 'admin');
          isDelegado = (currentUserProfile.rol === 'admin' || currentUserProfile.rol === 'delegado');
          const tabAdmin = document.getElementById('tab-admin');
          if (tabAdmin) tabAdmin.style.display = isDelegado ? 'inline-block' : 'none';
          await loadPromoConfig();
          await loadState(); 
          nav('cal');
      }
  } catch (err) {
      document.body.innerHTML = `<div style="padding:3rem; text-align:center; font-family:sans-serif;"><h2>⚠️ Error de carga</h2><p style="color:#64748b;">${err.message}</p><button style="margin-top:20px; padding:10px 20px; background:#1e293b; color:white; border-radius:8px; border:none; cursor:pointer;" onclick="window.location.reload()">Recargar Aplicación</button></div>`;
  }
}

initApp();

// ============================================================
// MÓDULO: USUARIOS_ACCESOS
// Exportar a: src/modules/usuarios.js
// Líneas estimadas: ~115
// Dependencias externas: supabaseClient, currentUserProfile, todasLasPromociones
// Helpers que usa: setStatus, evaluarEstadoUsuario, ejecutarSalidaFinal, activateSimulationMode, renderAll, nav, getRotationKey, saveState
// ============================================================
let todasLasPromociones = []; 
/** Descarga todas las promociones y rellena el selector de hospitales del formulario de onboarding. */
async function cargarListaPromociones() {
  const { data, error } = await supabaseClient.from('promociones').select('*');
  const selHosp = document.getElementById('sel-hospital');
  if (error || !data || data.length === 0) { selHosp.innerHTML = '<option value="">No hay hospitales registrados</option>'; return; }
  todasLasPromociones = data;
  const hospitalesUnicos = [...new Set(data.map(p => p.hospital))].sort();
  selHosp.innerHTML = '<option value="">-- Selecciona Hospital --</option>' + hospitalesUnicos.map(h => `<option value="${h}">${h}</option>`).join('');
}

/** Filtra las especialidades disponibles al cambiar el hospital seleccionado en el onboarding. */
function onHospitalChange() {
  const hospElegido = document.getElementById('sel-hospital').value;
  const selServ = document.getElementById('sel-servicio');
  if (!hospElegido) { selServ.disabled = true; selServ.innerHTML = '<option value="">Primero elige un hospital</option>'; return; }
  const serviciosFiltrados = todasLasPromociones.filter(p => p.hospital === hospElegido);
  selServ.disabled = false;
  // TEXTO ACTUALIZADO: Adiós al "Año"
  selServ.innerHTML = '<option value="">-- Elige Especialidad --</option>' + serviciosFiltrados.map(p => `<option value="${p.id}">${p.servicio} (${p.nombre})</option>`).join('');
}
/** Valida el formulario de onboarding y delega en ejecutarSalidaFinal para unirse a una promoción. */
async function solicitarUnirse() {
  const promoId = document.getElementById('sel-servicio').value;
  const fechaInicio = document.getElementById('onb-fecha-inicio').value;
  
  if (!promoId) return alert("Por favor, selecciona una especialidad.");
  if (!fechaInicio) return alert("Por favor, establece tu fecha real de inicio de residencia.");

  // Guardamos las fechas primero en memoria local para que ejecutarSalidaFinal las use indirectamente
  currentUserProfile.fecha_inicio_residencia = fechaInicio;
  currentUserProfile.fecha_cambio_contrato = fechaInicio;

  // Delegamos en el motor para que verifique si el grupo está vacío y te corone admin
  await ejecutarSalidaFinal(promoId);
}

/** Solicita hospital y especialidad mediante prompts y crea una nueva promoción unificada. */
function abrirCrearPromocion() {
  const hospital = prompt("Nombre del Hospital (ej: Hospital Universitari Arnau de Vilanova, procura poner el nombre completo del hospital con mayúsculas apropiadas):"); if (!hospital) return;
  const servicio = prompt("Especialidad (ej: Medicina Familiar y Comunitaria, Traumatología, procura poner el nombre completo de la especialidad según el BOE):"); if (!servicio) return;
  
  crearNuevaPromocionMaster(hospital, servicio, "Especialidad Completa");
}
/**
 * Inserta la nueva promoción en Supabase y asigna al usuario actual como admin con la fecha de inicio indicada.
 * @param {string} h - hospital
 * @param {string} s - especialidad (servicio)
 * @param {string} n - nombre del contenedor
 */
async function crearNuevaPromocionMaster(h, s, n) {
  const fechaInicio = document.getElementById('onb-fecha-inicio').value;
  if (!fechaInicio) return alert("Por favor, establece tu fecha real de inicio de residencia en el formulario antes de crear el grupo.");

  setStatus('Creando contenedor...');
  const { data: nuevaP, error: pErr } = await supabaseClient.from('promociones').insert({ hospital: h, servicio: s, nombre: n, creador_id: currentUserProfile.id }).select().single();
  if (pErr) return alert("Error: " + pErr.message);
  
  const { error: uErr } = await supabaseClient.from('perfiles').update({ 
      promocion_id: nuevaP.id, 
      estado: 'aprobado', 
      rol: 'admin',
      fecha_inicio_residencia: fechaInicio,
      fecha_cambio_contrato: fechaInicio
  }).eq('id', currentUserProfile.id);
  
  if (uErr) return alert("Error al asignarte admin: " + uErr.message);
  alert("¡Promoción unificada creada! Eres el Dueño de " + s); window.location.reload(); 
}
	
/** Inicia el flujo OAuth con Google forzando siempre la selección de cuenta. */
async function loginWithGoogle() { const { error } = await supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { queryParams: { prompt: 'select_account' } } }); if (error) alert("Error: " + error.message); }
/** Cierra la sesión y recarga la página para limpiar el estado en memoria. */
async function logoutUser() { setStatus('Cerrando sesión...'); await supabaseClient.auth.signOut(); window.location.reload(); }
/** Alias para activar el modo simulación desde botones de la UI. */
function impersonateUser(user) { activateSimulationMode(user); }

/**
 * Activa el modo de visualización simulada: hace que toda la app se renderice
 * desde la perspectiva del residente indicado sin alterar datos.
 * @param {string} nombre - nombre_mostrar del residente a simular
 */
function activateSimulationMode(nombre) {
    simulatedViewUser = nombre;
    document.getElementById('simulation-banner-name').textContent = nombre;
    document.getElementById('simulation-banner').classList.add('active');
    const h = document.querySelector('.header')?.offsetHeight || 62;
    document.body.style.setProperty('--header-h', h + 'px');
    nav('cal');
    renderAll();
}

/** Desactiva el modo simulación y devuelve la vista al usuario real. */
function exitSimulationMode() {
    simulatedViewUser = null;
    document.getElementById('simulation-banner').classList.remove('active');
    renderAll();
}

/** Muestra u oculta el selector de residente según la acción de admin elegida (grant/simulate). */
function onAdminModeChange() {
    const mode = document.getElementById('sel-admin-mode')?.value;
    const residentRow = document.getElementById('admin-action-resident-row');
    const confirmBtn = document.getElementById('admin-action-confirm-btn');
    if (!residentRow || !confirmBtn) return;
    if (mode) {
        residentRow.classList.add('visible');
        confirmBtn.className = 'admin-action-toolbar__confirm-btn' + (mode === 'grant' ? ' mode-grant' : '');
        confirmBtn.textContent = mode === 'grant' ? 'Otorgar' : 'Visualizar';
    } else {
        residentRow.classList.remove('visible');
    }
}

/**
 * Ejecuta la acción de admin seleccionada: otorga turno (grantedTurn) o activa simulación.
 * @param {number} y
 * @param {number} m - 0-indexed
 */
function onAdminActionConfirm(y, m) {
    const mode = document.getElementById('sel-admin-mode')?.value;
    const res = document.getElementById('sel-admin-resident')?.value;
    if (!mode || !res) return alert('Selecciona una acción y un residente.');
    if (mode === 'grant') {
        if (simulatedViewUser !== null) { alert('⚠️ Estás en modo visualización. Sal de la simulación para realizar cambios.'); return; }
        if (!state.grantedTurn) state.grantedTurn = {};
        state.grantedTurn[getRotationKey(y, m)] = res;
        if (!state.exceptionLogs) state.exceptionLogs = [];
        state.exceptionLogs.push({ user: res, monthStr: `${MONTHS[m]} ${y}`, reason: 'Turno otorgado manualmente por admin', shiftsSummary: '', timestamp: new Date().toLocaleString('es-ES') });
        saveState(); renderAll();
    } else if (mode === 'simulate') {
        activateSimulationMode(res);
    }
}
/** Actualiza el widget de cabecera con el badge del usuario o el botón de login. */
function renderUserHeader() {
  const el = document.getElementById('user-display');
  if (authSession) el.innerHTML = `<div class="user-badge">👤 ${getInitials(loggedInUser)} <button onclick="logoutUser()" style="padding:2px 6px; font-size:0.7rem; margin-left:4px; border:none; background:rgba(0,0,0,0.1); color:var(--dark); border-radius:4px;">Salir</button></div>`;
  else el.innerHTML = `<button onclick="loginWithGoogle()" class="primary" style="padding:0.3rem 0.8rem; font-size:0.8rem; background: #ea4335; border:none; color:white;">Entrar con Google</button>`;
}

// ============================================================
// MÓDULO: MOTOR_TEMPORAL
// Exportar a: src/modules/motorTemporal.js
// Líneas estimadas: ~70
// Dependencias externas: globalProfiles, promoConfig, currentUserProfile, loggedInUser
// Helpers que usa: getUserLevelOnDate, getPlanForUserOnDate, getSvcConfig
// ============================================================
/**
 * Calcula el nivel de residencia (R1, R2, …) de un usuario en una fecha dada,
 * usando fecha_inicio_residencia y fecha_cambio_contrato del perfil.
 * @param {Object} userProfile - perfil de Supabase
 * @param {string} dateKey - "YYYY_MM_DD"
 * @returns {number} nivel (0 = antes de empezar, 1 = R1, 2 = R2, …)
 */
function getUserLevelOnDate(userProfile, dateKey) {
    // Si no hay perfil o no tiene fecha de inicio, por defecto es R1
    if (!userProfile || !userProfile.fecha_inicio_residencia) return 1;
    
    const targetParts = dateKey.split('_');
    const targetDate = new Date(parseInt(targetParts[0]), parseInt(targetParts[1]) - 1, parseInt(targetParts[2]));
    
    const startParts = userProfile.fecha_inicio_residencia.split('-');
    const startDate = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
    
    if (targetDate < startDate) return 0; // Fecha anterior a ser residente

    // EL SALVAVIDAS: Si no ha configurado el cambio de contrato, usamos su fecha de inicio
    let savedDate = userProfile.fecha_cambio_contrato || userProfile.fecha_inicio_residencia;
    const cambioParts = savedDate.split('-');
    const targetChangeDate = new Date(targetDate.getFullYear(), parseInt(cambioParts[1]) - 1, parseInt(cambioParts[2]));

    let level = targetDate.getFullYear() - startDate.getFullYear() + 1;
    if (targetDate < targetChangeDate) level--; // Aún no ha cruzado su fecha este año
    
    return Math.max(1, level);
}

/**
 * Devuelve el objeto plan (de promoConfig.planes) que corresponde al nivel del usuario en esa fecha.
 * @param {Object} userProfile
 * @param {string} dateKey
 * @returns {Object|null} plan o null si el usuario aún no ha comenzado la residencia
 */
function getPlanForUserOnDate(userProfile, dateKey) {
    if (!promoConfig.planes || promoConfig.planes.length === 0) return { nombre: "Plan Base", servicios: promoConfig.servicios || [] };

    const level = getUserLevelOnDate(userProfile, dateKey);
    if (level === 0) return null;

    const planIndex = Math.min(level - 1, promoConfig.planes.length - 1);
    return promoConfig.planes[planIndex];
}

/**
 * Devuelve la config de un servicio dentro de un plan dado.
 * @param {string} svcName
 * @param {string} planName
 * @returns {Object|null}
 */
function getSvcConfig(svcName, planName) {
    const plan = (promoConfig.planes || []).find(p => p.nombre === planName);
    return plan?.servicios.find(s => s.nombre === svcName) || null;
}

/**
 * Resuelve automáticamente el plan del usuario en la fecha dada y devuelve la config del servicio.
 * @param {string} svcName
 * @param {Object} userProfile
 * @param {string} dateKey
 * @returns {Object|null}
 */
function getSvcConfigForUser(svcName, userProfile, dateKey) {
    const plan = getPlanForUserOnDate(userProfile, dateKey);
    return plan ? getSvcConfig(svcName, plan.nombre) : null;
}

/**
 * Valida si targetUser puede recibir/tomar la guardia de sourceUser según la reglaIntercambio del servicio.
 * Los usuarios 'Externo' siempre pasan la validación.
 * @param {string} targetUserName
 * @param {string} sourceUserName
 * @param {string} dateKey
 * @param {string} svcName
 * @returns {boolean}
 */
function canUserTakeShift(targetUserName, sourceUserName, dateKey, svcName) {
    if (targetUserName === 'Externo' || sourceUserName === 'Externo') return true; 

    const targetProfile = globalProfiles.find(p => p.nombre_mostrar === targetUserName) || (targetUserName === loggedInUser ? currentUserProfile : null);
    const sourceProfile = globalProfiles.find(p => p.nombre_mostrar === sourceUserName) || (sourceUserName === loggedInUser ? currentUserProfile : null);
    
    if (!targetProfile || !sourceProfile) return true;

    const targetLevel = getUserLevelOnDate(targetProfile, dateKey);
    const sourceLevel = getUserLevelOnDate(sourceProfile, dateKey);

    const sourcePlanIndex = Math.min(sourceLevel - 1, (promoConfig.planes || []).length - 1);
    const sourcePlan = promoConfig.planes ? promoConfig.planes[sourcePlanIndex] : null;
    if (!sourcePlan) return true;

    const svcConfig = sourcePlan.servicios.find(s => s.nombre === svcName);
    if (!svcConfig) return true; 

    if (svcConfig.reglaIntercambio === 'solo_mismo') return targetLevel === sourceLevel;
    if (svcConfig.reglaIntercambio === 'superior') return targetLevel >= sourceLevel;
    if (svcConfig.reglaIntercambio === 'no_r1') return targetLevel > 1 && sourceLevel > 1; // 💡 Nadie que sea R1 puede darla ni cogerla
    return true; // 'cualquiera'
}

// ============================================================
// MÓDULO: MOTOR_SALIENTES
// Exportar a: src/modules/motorSalientes.js
// Líneas estimadas: ~90
// Dependencias externas: state.shifts, state.shiftModifiers, globalProfiles
// Helpers que usa: getSvcConfigForUser, getDayTag, formatDateKey, getIllegalShiftsForUser
// ============================================================
/**
 * Calcula los días de saliente que genera una guardia (día siguiente y, si es sábado, lunes).
 * Respeta el modo de modalidad diurna/partida_primera para omitir el saliente.
 * @param {string} dateKey
 * @param {string} svcName
 * @param {string} user - nombre_mostrar
 * @returns {string[]} array de dateKeys que son salientes
 */
function getSalienteDaysForShift(dateKey, svcName, user) {
    // 🛑 CONTROL DE MODALIDAD: Si es Diurna o la 1ª Mitad de una partida, no hay pernocta -> No hay saliente
    const mod = state.shiftModifiers?.[dateKey]?.[user];
    if (mod && (mod.tipo === 'diurna' || mod.tipo === 'partida_primera')) {
        return [];
    }

    const uProfile = globalProfiles.find(p => p.nombre_mostrar === user) || currentUserProfile;
    const svcConfig = getSvcConfigForUser(svcName, uProfile, dateKey);
    if (!svcConfig) return [];
    
    const matriz = svcConfig.pernocta || svcConfig.generaSaliente;
    if (!matriz) return [];

    const [yStr, mStr, dStr] = dateKey.split('_');
    const y = parseInt(yStr), m = parseInt(mStr)-1, d = parseInt(dStr);
    const tag = getDayTag(y, m, d);
    
    if (!matriz[tag]) return []; 

    let salientes = [];
    const nextDay = new Date(y, m, d + 1);
    salientes.push(formatDateKey(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate()));

    // Regla ICS: Sábados desplazan saliente al lunes
    const dateObj = new Date(y, m, d);
    if (dateObj.getDay() === 6) { 
        const nextMonday = new Date(y, m, d + 2);
        const mondayKey = formatDateKey(nextMonday.getFullYear(), nextMonday.getMonth(), nextMonday.getDate());
        if (!salientes.includes(mondayKey)) salientes.push(mondayKey);
    }
    return salientes;
}

/**
 * Calcula las horas de una guardia según tipo de día (ICS) y modalidad (diurna/partida).
 * @param {string} dateKey
 * @param {string} svcName
 * @param {string} user - nombre_mostrar
 * @returns {number} horas (0 si no hay config)
 */
function getShiftHours(dateKey, svcName, user) {
    const uProfile = globalProfiles.find(p => p.nombre_mostrar === user) || currentUserProfile;
    const svcConfig = getSvcConfigForUser(svcName, uProfile, dateKey);
    if (!svcConfig) return 0;

    const [yStr, mStr, dStr] = dateKey.split('_');
    const y = parseInt(yStr), m = parseInt(mStr)-1, d = parseInt(dStr);
    const tag = getDayTag(y, m, d); // 'laborable', 'vispera', 'fin_de_semana', 'festivo_intersemanal'

    // Asignamos las horas base configuradas en el plan
    let horasBase = svcConfig.horas?.laborable || 17;
    if (tag === 'vispera') horasBase = svcConfig.horas?.vispera || 17;
    if (tag === 'fin_de_semana' || tag === 'festivo_intersemanal') horasBase = svcConfig.horas?.festivo || 24;

    // Verificamos si la guardia está partida por la mitad
    const mod = state.shiftModifiers?.[dateKey]?.[user];
    if (mod && (mod.tipo === 'partida_primera' || mod.tipo === 'partida_segunda')) {
        return horasBase / 2; // Divide el valor en horas a la mitad exactas
    }

    return horasBase;
}

/**
 * Detecta conflictos de saliente ilegal para un usuario en un mapa de guardias dado.
 * @param {string} user
 * @param {Object} shiftsObj - mapa dk → { user: svcNombre } (puede ser computedShifts o proyección)
 * @returns {string[]} mensajes de conflicto
 */
function getIllegalShiftsForUser(user, shiftsObj) {
    let userShifts = [];
    for (let dk in shiftsObj) {
        for (let u in shiftsObj[dk]) {
            if (u === user) userShifts.push({ dateKey: dk, svc: shiftsObj[dk][u] });
        }
    }
    let salienteDays = {}; 
    for (let shift of userShifts) {
        // 🛠️ Pasamos el usuario a la función para que verifique si la marcó como diurna
        let sDays = getSalienteDaysForShift(shift.dateKey, shift.svc, user);
        for (let sd of sDays) {
            if (!salienteDays[sd]) salienteDays[sd] = [];
            salienteDays[sd].push(shift);
        }
    }
    let conflicts = [];
    for (let shift of userShifts) {
        if (salienteDays[shift.dateKey]) {
            let causes = salienteDays[shift.dateKey];
            for (let cause of causes) {
               conflicts.push(`Día ${formatDK(shift.dateKey)} (${shift.svc}) choca con el SALIENTE de ${formatDK(cause.dateKey)} (${cause.svc})`);
            }
        }
    }
    return conflicts;
}

// ============================================================
// MÓDULO: MOTOR_ROTACION
// Exportar a: src/modules/motorRotacion.js
// Líneas estimadas: ~180
// Dependencias externas: state.planRotations, state.historialEventos, globalProfiles, promoConfig
// Helpers que usa: formatDateKey, getRotationKey, getPlanForUserOnDate, getUserLevelOnDate, reempaquetarGruposPlan
// ============================================================
/** Construye la clave canónica de mes "YYYY_MM" para indexar customRotations. */
function getRotationKey(y, m) { return `${y}_${String(m).padStart(2,'0')}`; }
/**
 * Alias explícito para obtener la rotación de un plan concreto (facilita llamadas desde el editor).
 * @param {string} planName
 * @param {number} y
 * @param {number} m
 * @returns {string[][]}
 */
function getRotationForPlan(planName, y, m) {
    return getRotation(y, m, planName);
}
/**
 * Calcula el orden de rotación de grupos para un mes dado, aplicando la rotación matemática
 * desde la base configurada. Soporta customRotations por mes y migración desde estado antiguo.
 * @param {number} y
 * @param {number} m - 0-indexed
 * @param {string} [forcedPlanName] - si se omite, usa getCurrentRotPlan
 * @returns {string[][]} array de grupos ordenados para ese mes
 */
function getRotation(y, m, forcedPlanName) {
    const dkStep = formatDateKey(y, m, 1);
    const planName = forcedPlanName || getCurrentRotPlan(dkStep);
    
    // Migración Inicial si venimos de la versión antigua sin partición por Plan
    if (!state.planRotations) {
        state.planRotations = {};
        const pName = promoConfig.planes?.[0]?.nombre || "Plan Base";
        state.planRotations[pName] = {
            baseGroups: state.baseGroups || [],
            baseYear: state.baseYear || 2026,
            baseMonth: state.baseMonth || 0,
            customRotations: state.customRotations || {},
            residentesFijos: state.residentesFijos || []
        };
        // No borramos las propiedades antiguas para no romper otros lectores
    }
    
    if (!state.planRotations[planName]) {
        state.planRotations[planName] = {
            baseGroups: [],
            baseYear: 2025,
            baseMonth: 0,
            customRotations: {},
            residentesFijos: []
        };
    }
    
    const pr = state.planRotations[planName];
    const targetKey = getRotationKey(y, m);
    if (pr.customRotations && pr.customRotations[targetKey]) return pr.customRotations[targetKey];
    
    const targetVal = parseInt(y, 10) * 12 + parseInt(m, 10);
    const bY = parseInt(pr.baseYear, 10);
    const bM = parseInt(pr.baseMonth, 10);
    const baseVal = (isNaN(bY) || isNaN(bM)) ? targetVal : (bY * 12 + bM);
    
    if (targetVal <= baseVal) return pr.baseGroups || [];
    
    if (!state.historialEventos) state.historialEventos = {};
    let currentGroups = JSON.parse(JSON.stringify(pr.baseGroups || []));
    
    for (let v = baseVal + 1; v <= targetVal; v++) {
        const curY = Math.floor(v / 12);
        const curM = v % 12;
        const iterDk = formatDateKey(curY, curM, 1);
        
        // 1. Calcular quiénes pertenecen matemáticamente a este Plan en este mes
        const eligible = globalProfiles.filter(p => {
            if (p.estado === 'historico') {
                const ev = state.historialEventos[p.nombre_mostrar];
                if (ev && ev.salida) {
                    const parts = ev.salida.split('-');
                    const salVal = parseInt(parts[0], 10) * 12 + parseInt(parts[1], 10) - 1;
                    if (v > salVal) return false;
                }
            }
            const userPlan = getPlanForUserOnDate(p, iterDk);
            return userPlan && userPlan.nombre === planName;
        }).map(p => p.nombre_mostrar);
        
        // 2. Extraer a los que ya no pertenecen manteniendo los grupos. Los residentes virtuales (que no están en globalProfiles) se mantienen para que sigan rotando de forma indefinida en su plan original.
        currentGroups = currentGroups.map(g => g.filter(n => {
            const esReal = globalProfiles.some(p => p.nombre_mostrar === n);
            return esReal ? eligible.includes(n) : true;
        })).filter(g => g.length > 0);
        
        // 3. Añadir a los rezagados o nuevos al último grupo
        const existingMembers = currentGroups.flat();
        const newMembers = eligible.filter(n => !existingMembers.includes(n));
        
        if (newMembers.length > 0) {
            if (currentGroups.length > 0) {
                currentGroups[currentGroups.length - 1].push(...newMembers);
            } else {
                currentGroups.push(newMembers);
            }
        }
        
        // 4. Separar fijos de móviles
        let fijos = [];
        let movilesGroups = [];
        
        for (let g of currentGroups) {
            let gFijos = g.filter(x => (pr.residentesFijos || []).includes(x));
            let gMoviles = g.filter(x => !(pr.residentesFijos || []).includes(x));
            fijos.push(...gFijos);
            if (gMoviles.length > 0) movilesGroups.push(gMoviles);
        }
        
        // 5. Rotar 1 paso hacia adelante (internamente en los grupos y los grupos entre sí)
        if (fijos.length > 1) {
            fijos.unshift(fijos.pop());
        }
        
        movilesGroups = movilesGroups.map(g => {
            if (g.length > 1) g.unshift(g.pop());
            return g;
        });
        
        if (movilesGroups.length > 1) {
            movilesGroups.unshift(movilesGroups.pop());
        }
        
        // 6. Reconstruir los grupos para este mes
        currentGroups = [];
        if (fijos.length > 0) currentGroups.push(fijos);
        currentGroups.push(...movilesGroups);
    }
    
    return currentGroups;
}

/**
 * Reagrupa una lista plana de residentes en sub-grupos separando fijos de móviles,
 * respetando la política residentesFijos del plan.
 * @param {string[]} lista - array plano de nombres
 * @param {Object} pr - objeto planRotation (contiene residentesFijos)
 * @returns {string[][]}
 */
function reempaquetarGruposPlan(lista, pr) {
    if (!lista || lista.length === 0) return [[]];
    let fijos = lista.filter(n => (pr.residentesFijos || []).includes(n));
    let moviles = lista.filter(n => !(pr.residentesFijos || []).includes(n));
    
    let gruposMoviles = _reempaquetarGrupos(moviles);
    if (fijos.length > 0) return [fijos, ...gruposMoviles];
    else return gruposMoviles;
}

/**
 * Devuelve los nombres presentes en baseGroups de cualquier plan que no tienen perfil real en globalProfiles.
 * Estos "residentes virtuales" participan en el motor de rotación pero no tienen cuenta Supabase.
 * @returns {string[]}
 */
function getVirtualResidents() {
    let list = [];
    if (state.planRotations) {
        for (const planName of Object.keys(state.planRotations)) {
            const pr = state.planRotations[planName];
            const flatGroups = (pr.baseGroups || []).flat();
            for (const n of flatGroups) {
                const exists = globalProfiles.some(p => p.nombre_mostrar === n);
                if (!exists && !list.includes(n)) {
                    list.push(n);
                }
            }
        }
    }
    return list;
}

/**
 * Devuelve todos los residentes activos (perfiles reales + virtuales) excluyendo graduados.
 * @returns {string[]} array de nombre_mostrar
 */
function getAllResidents() {
    let list = [];
    if (!globalProfiles || globalProfiles.length === 0) return list;
    list = globalProfiles.map(p => p.nombre_mostrar);
    
    // Añadir residentes virtuales para que participen de las rotaciones y cálculos
    const virtuals = getVirtualResidents();
    for (const v of virtuals) {
        if (!list.includes(v)) list.push(v);
    }
    
    if (state.graduados) {
        list = list.filter(u => !state.graduados.includes(u));
    }
    return list;
}


// ============================================================
// MÓDULO: MOTOR_EVALUACION
// Exportar a: src/modules/motorEvaluacion.js
// Líneas estimadas: ~185
// Dependencias externas: state.shifts, state.skippedTurns, promoConfig, globalProfiles
// Helpers que usa: getDaysInMonth, formatDateKey, getDayTag, getPlazasForDay, isServiceEnabledOnDate, isUserBusyOnDay, getIllegalShiftsForUser, getComputedShifts, getAnalisisFestivos, calcularViabilidadFestivosMensual, getPlanForUserOnDate
// ============================================================

// Escáner de Válvula de Escape: Busca si queda AL MENOS UN hueco legal en el mes
/**
 * Comprueba si existe al menos un día legal donde el usuario puede cumplir una regla obligatoria específica.
 * Usado para decidir si una regla incumplida debe "perdonarse" por falta de huecos.
 * @param {string} user
 * @param {number} y
 * @param {number} m
 * @param {Object} svc - config del servicio
 * @param {Object} rule - objeto reglasObligatorias
 * @param {string|null} planName
 * @returns {boolean}
 */
function hasAvailableLegalSlots(user, y, m, svc, rule, planName = null) {
    for (let d = 1; d <= getDaysInMonth(y, m); d++) {
        const dk = formatDateKey(y, m, d);
        const tag = getDayTag(y, m, d);

        // 1. ¿El día encaja con las etiquetas de la regla?
        if (!rule.etiquetas.includes(tag)) continue;

        // 2. ¿El día está habilitado si el candado está activo?
        if (svc.requiereHabilitacion && !isServiceEnabledOnDate(svc.nombre, dk, planName)) continue;
        
        const dayShifts = state.shifts[dk] || {};
        
        // 3. Ya tiene este servicio hoy (no puede doblar slot)
        if (dayShifts[user] === svc.nombre) continue;
        
        // 4. Ya está ocupado en OTRA guardia hoy
        if (isUserBusyOnDay(user, dk)) continue;

        // 5. ¿El servicio está lleno este día?
        let currentAssigned = Object.keys(dayShifts || {}).filter(u => dayShifts[u] === svc.nombre).length;
        let pd = getPlazasForDay(svc, dk);
        if (pd > 0 && currentAssigned >= pd) continue; 

        // 6. ¿Genera conflicto de saliente si se lo pongo?
        let tempShifts = JSON.parse(JSON.stringify(state.shifts || {}));
        if (!tempShifts[dk]) tempShifts[dk] = {};
        tempShifts[dk][user] = svc.nombre;
        if (getIllegalShiftsForUser(user, tempShifts).length > 0) continue;

        // ¡Si sobrevive a todo, hay hueco legal!
        return true; 
    }
    return false;
}

/**
 * Igual que hasAvailableLegalSlots pero sin restricción de etiqueta: verifica si queda algún hueco
 * legal para el servicio en conjunto (para perdonar el cupoMensualTotal total).
 * @param {string} user
 * @param {number} y
 * @param {number} m
 * @param {Object} svc
 * @param {string|null} planName
 * @returns {boolean}
 */
function hasAvailableLegalSlotsForService(user, y, m, svc, planName = null) {
    for (let d = 1; d <= getDaysInMonth(y, m); d++) {
        const dk = formatDateKey(y, m, d);

        if (svc.requiereHabilitacion && !isServiceEnabledOnDate(svc.nombre, dk, planName)) continue;
        
        const dayShifts = state.shifts[dk] || {};
        if (dayShifts[user] === svc.nombre) continue;
        if (isUserBusyOnDay(user, dk)) continue;
        
        let currentAssigned = Object.keys(dayShifts || {}).filter(u => dayShifts[u] === svc.nombre).length;
        let pd = getPlazasForDay(svc, dk);
        if (pd > 0 && currentAssigned >= pd) continue;

        let projected = JSON.parse(JSON.stringify(state.shifts || {}));
        if (!projected[dk]) projected[dk] = {};
        projected[dk][user] = svc.nombre;
        const conflicts = getIllegalShiftsForUser(user, projected);
        
        if (conflicts.length === 0) {
            return true;
        }
    }
    return false;
}

/**
 * Calcula el progreso de guardias de un usuario para un mes dado.
 * Verifica cuotas, reglas obligatorias y mínimo de festivos globales.
 * @param {string} user - nombre_mostrar
 * @param {number} y
 * @param {number} m - 0-indexed
 * @returns {{ progress: Object, isFinished: boolean, messages: string[] }}
 */
// Evaluador Maestro de un usuario
function getUserProgress(user, y, m) {
    let progress = {};
    let isFinished = true; 
    let messages = [];

    let uProfile = globalProfiles.find(p => p.nombre_mostrar === user);
    let activePlan = null;
    if (uProfile) {
        const referenceDk = formatDateKey(y, m, 15);
        activePlan = getPlanForUserOnDate(uProfile, referenceDk);
    } else {
        // Es un residente virtual. Buscamos en qué plan de state.planRotations está su nombre en baseGroups
        if (state.planRotations) {
            for (const planName of Object.keys(state.planRotations)) {
                const pr = state.planRotations[planName];
                const flatBase = (pr.baseGroups || []).flat();
                if (flatBase.includes(user)) {
                    activePlan = (promoConfig.planes || []).find(pl => pl.nombre === planName);
                    break;
                }
            }
        }
        if (!activePlan) {
            const referenceDk = formatDateKey(y, m, 15);
            activePlan = getPlanForUserOnDate(currentUserProfile, referenceDk);
        }
    }
    const serviciosActivos = activePlan ? activePlan.servicios : [];

    let totalFestivosHacidos = 0;
    const computedShifts = getComputedShifts();

    serviciosActivos.forEach(svc => {
        let countTotal = 0;
        let shiftsByTag = { 'laborable': 0, 'vispera': 0, 'fin_de_semana': 0, 'festivo_intersemanal': 0 };
        
        for (let d = 1; d <= getDaysInMonth(y, m); d++) {
            const dk = formatDateKey(y, m, d);
            if (computedShifts[dk] && computedShifts[dk][user] === svc.nombre) {
                countTotal++;
                shiftsByTag[getDayTag(y, m, d)]++;
            }
        }

        let missingTotal = Math.max(0, svc.cupoMensualTotal - countTotal);
        let totalForgiven = false;
        let isSecretaria = !!svc.dadasPorSecretaria;
        
        if (missingTotal > 0) {
            if (isSecretaria) {
                totalForgiven = true;
            } else if (!hasAvailableLegalSlotsForService(user, y, m, svc, activePlan?.nombre)) {
                totalForgiven = true;
            }
        }
        
        let missingRules = [];
        let rulesOk = true;

        svc.reglasObligatorias.forEach(rule => {
            let matchingShifts = 0;
            rule.etiquetas.forEach(tag => matchingShifts += shiftsByTag[tag]);
            let missingForRule = Math.max(0, rule.minimo - matchingShifts);
            
            if (missingForRule > 0) {
                if (hasAvailableLegalSlots(user, y, m, svc, rule, activePlan?.nombre)) {
                    missingRules.push(rule);
                    rulesOk = false;
                } else {
                    missingRules.push({ ...rule, forgiven: true });
                }
            }
        });

        if ((missingTotal > 0 && !totalForgiven) || !rulesOk) isFinished = false;
        progress[svc.nombre] = { countTotal, missingTotal, missingRules, rulesOk, totalForgiven, isSecretaria };
        if (missingTotal > 0) {
            if (totalForgiven) {
                if (isSecretaria) {
                    messages.push(`<span style="color:var(--fest);"><s>${missingTotal} ${svc.nombre}</s> (Secretaría)</span>`);
                } else {
                    messages.push(`<span style="color:var(--fest);"><s>${missingTotal} ${svc.nombre}</s> (Perdonado: sin huecos compatibles)</span>`);
                }
            } else {
                messages.push(`<b>${missingTotal} ${svc.nombre}</b>`);
            }
        }
    });

    // REGLA TRANSVERSAL
    for (let d = 1; d <= getDaysInMonth(y, m); d++) {
        const tag = getDayTag(y, m, d);
        if (tag === 'fin_de_semana' || tag === 'festivo_intersemanal') {
            const dk = formatDateKey(y, m, d);
            if (computedShifts[dk] && computedShifts[dk][user]) {
                totalFestivosHacidos++;
            }
        }
    }

    // El cerebro ajusta la exigencia según la subasta
    // USA: motorSubastas.getAnalisisFestivos()
    const analisis = getAnalisisFestivos(y, m);
    // USA: motorSubastas.calcularViabilidadFestivosMensual()
    const viabilidad = calcularViabilidadFestivosMensual(y, m);
    let minimoExigibleEsteMes = viabilidad.minimoExigible || 0;

    // Si la subasta ha fracasado o el mes es inasumible, exigimos el +1 a los nominados
    if (analisis.estado === 'critico' || analisis.estado === 'subasta_cerrada') {
        if (analisis.nominados.includes(user)) {
            minimoExigibleEsteMes = (viabilidad.minimoExigible || 0) + 1; 
        }
    }

    if (totalFestivosHacidos < minimoExigibleEsteMes) {
        isFinished = false;
        let msgExtra = (analisis.nominados.includes(user) && (analisis.estado === 'critico' || analisis.estado === 'subasta_cerrada')) 
            ? ' <i>(+1 por Justicia Histórica)</i>' 
            : '';
        messages.push(`⚠️ Festivos globales: Llevas <b>${totalFestivosHacidos}/${minimoExigibleEsteMes}</b>${msgExtra}`);
    }

    return { progress, isFinished, messages };
}
// ============================================================
// MÓDULO: MOTOR_MERCADILLO
// Exportar a: src/modules/motorMercadillo.js
// Líneas estimadas: ~95
// Dependencias externas: state.trades, state.shifts
// Helpers que usa: getIllegalShiftsForUser, formatDK
// ============================================================
/**
 * Devuelve el mapa de guardias con todas las operaciones aprobadas del mercadillo aplicadas.
 * Las ventas a "Externo" se marcan como VRE_<id>. No muta state.shifts.
 * @returns {Object} mapa dk → { user: svcNombre }
 */
function getComputedShifts() {
  let computed = JSON.parse(JSON.stringify(state.shifts || {}));
  const activeTrades = (state.trades || []).filter(t => t.status === 'approved' || t.status === 'undo_pending');
  for (let t of activeTrades) {
    if (t.type === 'venta') {
      if (computed[t.d1] && computed[t.d1][t.requester] === t.s1) {
        delete computed[t.d1][t.requester];
        if (t.target === 'Externo') { computed[t.d1][`VRE_${t.id}`] = t.s1; } 
        else { if (!computed[t.d1]) computed[t.d1] = {}; computed[t.d1][t.target] = t.s1; }
      }
    } else if (t.type === 'compra') {
      if (t.target === 'Externo') { if (!computed[t.d1]) computed[t.d1] = {}; computed[t.d1][t.requester] = t.s1; } 
      else { if (computed[t.d1] && computed[t.d1][t.target] === t.s1) { delete computed[t.d1][t.target]; if (!computed[t.d1]) computed[t.d1] = {}; computed[t.d1][t.requester] = t.s1; } }
    } else if (t.type === 'cambio') {
      if (t.target === 'Externo') { if (computed[t.d1] && computed[t.d1][t.requester] === t.s1) { delete computed[t.d1][t.requester]; if (!computed[t.d2]) computed[t.d2] = {}; computed[t.d2][t.requester] = t.s1; } } 
      else { 
        let s1 = computed[t.d1]?.[t.requester]; let s2 = computed[t.d2]?.[t.target];
        if (s1 === t.s1 && s2 === t.s2) {
          delete computed[t.d1][t.requester]; delete computed[t.d2][t.target];
          if (!computed[t.d1]) computed[t.d1] = {}; if (!computed[t.d2]) computed[t.d2] = {};
          computed[t.d1][t.target] = t.s1; computed[t.d2][t.requester] = t.s2;
        }
      }
    }
  }
  return computed;
}

/**
 * Valida que una operación de mercadillo no genere conflictos de guardia doble ni saliente ilegal.
 * @param {Object} newTrade - objeto trade a evaluar
 * @returns {string[]} lista de mensajes de conflicto (vacía = sin conflictos)
 */
function checkTradeConflicts(newTrade) {
    const computed = getComputedShifts(); let overlaps = [];
    const hasShift = (dk, user) => computed[dk] && computed[dk][user] && !computed[dk][user].startsWith('VRE');

    if (newTrade) {
        if (newTrade.type === 'compra' && newTrade.target !== 'Externo') { if (hasShift(newTrade.d1, newTrade.requester)) overlaps.push(`${newTrade.requester} ya tiene guardia el ${formatDK(newTrade.d1)}.`); } 
        else if (newTrade.type === 'compra' && newTrade.target === 'Externo') { if (hasShift(newTrade.d1, newTrade.requester)) overlaps.push(`${newTrade.requester} ya tiene guardia el ${formatDK(newTrade.d1)}.`); } 
        else if (newTrade.type === 'venta' && newTrade.target !== 'Externo') { if (hasShift(newTrade.d1, newTrade.target)) overlaps.push(`${newTrade.target} ya tiene guardia el ${formatDK(newTrade.d1)}.`); } 
        else if (newTrade.type === 'cambio') {
            if (newTrade.target !== 'Externo') {
                if (newTrade.d1 !== newTrade.d2 && hasShift(newTrade.d2, newTrade.requester)) overlaps.push(`${newTrade.requester} ya tiene guardia el ${formatDK(newTrade.d2)}.`);
                if (newTrade.d1 !== newTrade.d2 && hasShift(newTrade.d1, newTrade.target)) overlaps.push(`${newTrade.target} ya tiene guardia el ${formatDK(newTrade.d1)}.`);
            } else {
                if (hasShift(newTrade.d2, newTrade.requester)) overlaps.push(`${newTrade.requester} ya tiene guardia el ${formatDK(newTrade.d2)}.`);
            }
        }
    }
    if (overlaps.length > 0) return overlaps;

    let projected = JSON.parse(JSON.stringify(computed)); let activeTrades = newTrade ? [newTrade] : []; 
    for (let t of activeTrades) {
        if (t.type === 'venta') {
            if (projected[t.d1] && projected[t.d1][t.requester] === t.s1) {
                delete projected[t.d1][t.requester];
                if (t.target !== 'Externo') { if (!projected[t.d1]) projected[t.d1] = {}; projected[t.d1][t.target] = t.s1; }
            }
        } else if (t.type === 'compra') {
             if (t.target === 'Externo') { if (!projected[t.d1]) projected[t.d1] = {}; projected[t.d1][t.requester] = t.s1; } 
             else { if (projected[t.d1] && projected[t.d1][t.target] === t.s1) { delete projected[t.d1][t.target]; if (!projected[t.d1]) projected[t.d1] = {}; projected[t.d1][t.requester] = t.s1; } }
        } else if (t.type === 'cambio') {
            if (t.target === 'Externo') {
                delete projected[t.d1][t.requester]; if (!projected[t.d2]) projected[t.d2] = {}; projected[t.d2][t.requester] = t.s1;
            } else {
                delete projected[t.d1][t.requester]; delete projected[t.d2][t.target];
                if (!projected[t.d1]) projected[t.d1] = {}; if (!projected[t.d2]) projected[t.d2] = {};
                projected[t.d1][t.target] = t.s1; projected[t.d2][t.requester] = t.s2;
            }
        }
    }

    let conflicts = []; let usersToCheck = [newTrade.requester];
    if (newTrade.target && newTrade.target !== 'Externo') usersToCheck.push(newTrade.target);
    for (let u of usersToCheck) { let c = getIllegalShiftsForUser(u, projected); if (c.length > 0) conflicts.push(...c.map(msg => `[${u}]: ${msg}`)); }
    return conflicts;
}

// ============================================================
// MÓDULO: GRUPOS_HOSPITALARIOS
// Exportar a: src/modules/grupos.js
// Líneas estimadas: ~230
// Dependencias externas: supabaseClient, currentUserProfile, state
// Helpers que usa: setStatus, evaluarEstadoUsuario, saveState, limpiarFuturos, renderGruposView
// ============================================================
/** Renderiza el panel de grupos: estado actual del usuario y listado de otros grupos por hospital. */
async function renderGruposView() {
    const currentContainer = document.getElementById('grupos-current-info');
    const listContainer = document.getElementById('grupos-list-container');
    
    currentContainer.innerHTML = '<p style="color:#64748b;">Cargando...</p>';
    listContainer.innerHTML = '<p style="color:#64748b;">Cargando...</p>';

    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout de red")), 5000));
    const fetchPromos = supabaseClient.from('promociones').select('*');
    
    let promos;
    try {
        const { data, error } = await Promise.race([fetchPromos, timeout]);
        if (error) throw error;
        promos = data;
    } catch (err) {
        return currentContainer.innerHTML = `<p style="color:red;">Error de conexión: ${err.message}</p>`;
    }

    // 1. DIBUJAR GRUPO ACTUAL
    if (currentUserProfile.promocion_id) {
        const myPromo = promos.find(p => p.id === currentUserProfile.promocion_id);
        if (myPromo) {
            let statusBadge = currentUserProfile.estado === 'aprobado' 
                ? `<span style="background:var(--ped); color:white; padding:4px 10px; border-radius:12px; font-size:0.8rem; font-weight:bold;">✅ Acceso Activo</span>`
                : `<span style="background:#f59e0b; color:white; padding:4px 10px; border-radius:12px; font-size:0.8rem; font-weight:bold;">⏳ Pendiente de aprobación</span>`;

            currentContainer.innerHTML = `
                <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:15px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom: 15px;">
                    <div>
                        <h4 style="margin:0; color:var(--dark); font-size:1.1rem;">${myPromo.hospital}</h4>
                        <div style="color:#475569; font-size:0.95rem; margin-top:4px;">${myPromo.servicio} <span style="color:#94a3b8;">(${myPromo.nombre})</span></div>
                        <div style="margin-top:10px;">${statusBadge}</div>
                    </div>
                    <button class="danger" style="background:white;" onclick="abandonarGrupo()">🚪 Salir de este grupo</button>
                </div>
                `;
        	}
    } else {
        currentContainer.innerHTML = `<p style="color:#64748b; font-style:italic;">No estás en ningún grupo actualmente.</p>`;
    }

    // 2. DIBUJAR LISTA DE OTROS GRUPOS
    const otherPromos = promos.filter(p => p.id !== currentUserProfile.promocion_id);
    if (otherPromos.length === 0) {
        listContainer.innerHTML = `<p style="color:#64748b; background:#f1f5f9; padding:15px; border-radius:8px;">No hay otros grupos registrados en el sistema.</p>`;
        return;
    }

    const byHospital = {};
    otherPromos.forEach(p => {
        if (!byHospital[p.hospital]) byHospital[p.hospital] = [];
        byHospital[p.hospital].push(p);
    });

    let html = '';
    for (const hosp in byHospital) {
        html += `<div style="margin-bottom:1.5rem;">
            <h4 style="color:var(--dark); border-bottom:2px solid #e2e8f0; padding-bottom:6px; margin-bottom:10px;">🏥 ${hosp}</h4>
            <div style="display:flex; flex-direction:column; gap:8px;">`;
        
        byHospital[hosp].forEach(p => {
            html += `<div style="background:white; border:1px solid #e2e8f0; border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div>
                    <strong style="color:var(--adu); font-size:1rem;">${p.servicio}</strong>
                    <span style="color:#64748b; font-size:0.85rem; margin-left:6px;">Contenedor: ${p.nombre}</span>
                </div>
                <button class="primary icon-btn" style="background:white; color:var(--adu); border:1px solid var(--adu);" onclick="solicitarCambioGrupo('${p.id}')">Solicitar Acceso</button>
            </div>`;
        });
        html += `</div></div>`;
    }
    listContainer.innerHTML = html;
}

/**
 * Persiste el día y mes de cambio de contrato del usuario usando el año 2000 como base inerte
 * (garantiza soporte de 29-Feb sin depender del año actual).
 */
async function guardarFechaGraduacion() {
    const dia = document.getElementById('input-dia-cambio').value;
    const mes = document.getElementById('input-mes-cambio').value;
    
    // Usamos el año 2000 (bisiesto) como base para soportar 29 de Febrero y cumplir el formato DATE de Supabase
    const dummyDate = `2000-${mes}-${dia}`;

    setStatus('Guardando fecha...');
    const { error } = await supabaseClient
        .from('perfiles')
        .update({ fecha_cambio_contrato: dummyDate })
        .eq('id', currentUserProfile.id);

    if (error) {
        alert("Error al guardar en la base de datos: " + error.message);
    } else {
        currentUserProfile.fecha_cambio_contrato = dummyDate;
        alert("Día y mes de cambio actualizados correctamente.");
        setStatus('Sincronizado ✅');

		// Cirugía técnica: Refresca el chivato visual inmediatamente sin F5
        renderGruposView();
    }
}
	
// ==========================================
// FASE 1: PROTECCIÓN DE GRUPOS Y SUCESIÓN
// ==========================================

/** Inicia el flujo de salida del grupo actual (sin destino alternativo). */
async function abandonarGrupo() {
    if(!confirm("¿Seguro que quieres salir? Perderás el acceso al calendario actual.")) return;
    iniciarProcesoSalida(null); // null significa que solo sale, no cambia a otro
}

/**
 * Solicita el cambio a otra promoción: inicia el proceso de salida con destinoId para que
 * se evalúe si hay sucesión pendiente antes de ejecutar el movimiento.
 * @param {string} destinoId - id de la promoción destino
 */
async function solicitarCambioGrupo(destinoId) {
  if (!confirm("¿Seguro que deseas solicitar el cambio a este grupo? Tu estado volverá a estar pendiente o se evaluará si está vacío.")) return;
  await iniciarProcesoSalida(destinoId);
}

/**
 * Punto de control de salida: determina si el usuario es el dueño del grupo y gestiona
 * tres caminos — salida libre, hibernación (último miembro) o sucesión automática.
 * @param {string|null} destinoId - id de la promoción destino, o null para salida simple
 */
async function iniciarProcesoSalida(destinoId) {
    if (!currentUserProfile.promocion_id) return ejecutarSalidaFinal(destinoId);

    setStatus('Comprobando estado del grupo...');
    
    // 1. Descargamos a todos los aprobados del grupo
    const { data: poblacion, error } = await supabaseClient
        .from('perfiles')
        .select('id, nombre_mostrar, rol')
        .eq('promocion_id', currentUserProfile.promocion_id)
        .in('estado', ['aprobado', 'historico']);

    if (error) return alert("Error al leer el grupo: " + error.message);

    // 2. Averiguamos quiénes somos nosotros en el organigrama
    const { data: promo } = await supabaseClient.from('promociones').select('creador_id').eq('id', currentUserProfile.promocion_id).single();
    const isDueño = promo && promo.creador_id === currentUserProfile.id;
    
    const otrosUsuarios = poblacion.filter(u => u.id !== currentUserProfile.id);

    // CAMINO A: Salida Libre (Si eres residente normal o delegado)
    if (!isDueño) {
        return ejecutarSalidaFinal(destinoId);
    }

    // CAMINO B: Hibernación (Eres el Dueño, pero estás solo)
    if (otrosUsuarios.length === 0) {
        alert("ℹ️ Eres el último miembro. El grupo quedará en 'Modo Hibernación' conservando sus reglas hasta que una nueva generación lo reclame.");
        return ejecutarSalidaFinal(destinoId);
    }

    // CAMINO C: Sucesión Obligatoria Automática (Eres el Dueño y hay gente dentro)
    const delegados = otrosUsuarios.filter(u => u.rol === 'delegado');
    const residentes = otrosUsuarios.filter(u => u.rol !== 'admin' && u.rol !== 'delegado');
    const sucesor = delegados.length > 0 ? delegados[0] : residentes[0];
    
    alert(`👑 Traspaso Automático: Como eras el administrador principal, al abandonar el grupo la corona ha sido transferida automáticamente a ${sucesor.nombre_mostrar}.`);
    
    setStatus('Transfiriendo poderes...');
    
    // Coronar al sucesor como Dueño en la tabla de promociones
    const { error: errPromo } = await supabaseClient.from('promociones').update({ creador_id: sucesor.id }).eq('id', promo.id);
    if (errPromo) return alert("Error al transferir la propiedad: " + errPromo.message);
    
    // Asegurarnos de que el sucesor tiene rol 'admin'
    await supabaseClient.from('perfiles').update({ rol: 'admin' }).eq('id', sucesor.id);

    return ejecutarSalidaFinal(destinoId);
}

/**
 * Puerta única de entrada/salida de grupo: gestiona el protocolo "primer colono" si el destino
 * está vacío, o envía la solicitud de acceso si está ocupado. destinoId=null produce salida simple.
 * @param {string|null} destinoId
 */
async function ejecutarSalidaFinal(destinoId) {
    setStatus(destinoId ? 'Procesando entrada...' : 'Saliendo del grupo...');

    // 1. ESCÁNER DE HIBERNACIÓN (Solo si entramos a un nuevo grupo)
    if (destinoId) {
        const { data: poblacion } = await supabaseClient.from('perfiles')
            .select('id').eq('promocion_id', destinoId).in('estado', ['aprobado', 'historico']);

        if (!poblacion || poblacion.length === 0) {
            if (!confirm("ℹ️ El contenedor está vacío (hibernando). Al entrar, serás coronado automáticamente como Dueño/Administrador. ¿Aceptas el cargo?")) {
                setStatus('Conectado ✅');
                return; // Aborta la operación si le da miedo el poder
            }

            // A. PROTOCOLO PRIMER COLONO: Le damos la medalla y guardamos fechas
            await supabaseClient.from('promociones').update({ creador_id: currentUserProfile.id }).eq('id', destinoId);

            const { error } = await supabaseClient.from('perfiles').update({
                promocion_id: destinoId,
                estado: 'aprobado',
                rol: 'admin',
                fecha_inicio_residencia: currentUserProfile.fecha_inicio_residencia, 
                fecha_cambio_contrato: currentUserProfile.fecha_cambio_contrato || null 
            }).eq('id', currentUserProfile.id);

            if (error) return alert("Error: " + error.message);

            // Actualizamos la memoria local
            currentUserProfile.promocion_id = destinoId;
            currentUserProfile.estado = 'aprobado';
            currentUserProfile.rol = 'admin';
            isAdmin = true;
            isDelegado = true;

            alert("¡Has despertado el contenedor! Ahora eres el Administrador principal.");
            return evaluarEstadoUsuario();
        }
    }

    // 2. EJECUCIÓN DE SALIDA O SOLICITUD NORMAL
    // Esta parte cubre tanto la salida simple (destinoId = null) como la solicitud a un grupo ocupado
    const { error } = await supabaseClient.from('perfiles').update({ 
        promocion_id: destinoId || null, 
        estado: 'pendiente',
        fecha_inicio_residencia: currentUserProfile.fecha_inicio_residencia, 
        fecha_cambio_contrato: currentUserProfile.fecha_cambio_contrato || null 
    }).eq('id', currentUserProfile.id);
    
    if (error) return alert("Error al actualizar perfil: " + error.message);
    
    // Actualizamos la memoria local
    currentUserProfile.promocion_id = destinoId || null;
    currentUserProfile.estado = 'pendiente';
    isAdmin = false;
    isDelegado = false;

    alert(destinoId ? "Solicitud enviada al nuevo grupo." : "Has salido del grupo correctamente.");
    evaluarEstadoUsuario(); 
}

// ============================================================
// MÓDULO: NAVEGACION
// Exportar a: src/modules/navegacion.js
// Líneas estimadas: ~120
// Dependencias externas: isAdmin, isDelegado, currentAdminView, loggedInUser, simulatedViewUser
// Helpers que usa: renderAll, renderGruposView, renderPerfilUsuario, renderAdminCalendar, renderAdminExceptions, renderAdminAjustes, renderAdminSeguridad, renderAdminHoras, renderAccountsList, checkAutomaticGraduation
// ============================================================
/**
 * Muestra el panel solicitado y oculta el resto; dispara el renderizado específico del panel.
 * @param {'cal'|'merc'|'rot'|'grupos'|'help'|'admin'|'perfil'} tab
 */
function nav(tab) {
  if (tab === 'admin' && !isDelegado) return;

  // Añadimos 'perfil' a la lista para que oculte las demás
  ['cal','merc','rot','grupos','help','admin', 'perfil'].forEach(t => {
    const el = document.getElementById(`pane-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
    const tb = document.getElementById(`tab-${t}`);
    if (tb) tb.className = `tab ${t === tab ? 'active' : ''}`;
  });
  
  if (tab === 'admin' && isDelegado) {
      document.getElementById('admin-panel').style.display = 'block';
      navAdmin(currentAdminView || 'excepciones');
  }
  
  if (tab === 'grupos') renderGruposView();
  else if (tab === 'perfil') renderPerfilUsuario();
  else if (tab !== 'help' && tab !== 'perfil') checkAutomaticGraduation();
    renderAll();
}

/**
 * Navega entre las sub-secciones del panel de admin; oculta las pestañas solo-admin si no es admin.
 * @param {'calendario'|'excepciones'|'export'|'cuentas'|'horas'|'seguridad'|'ajustes'} sub
 */
function navAdmin(sub) {
  const adminOnlySubs = ['calendario', 'ajustes', 'seguridad'];
  if (adminOnlySubs.includes(sub) && !isAdmin) sub = 'excepciones';
  currentAdminView = sub;
  ['calendario','excepciones','export','cuentas','horas','seguridad','ajustes'].forEach(t => {
    const view = document.getElementById(`aview-${t}`); if (view) view.style.display = t === sub ? 'block' : 'none';
    const tab = document.getElementById(`atab-${t}`);
    if (tab) {
      tab.className = `tab ${t === sub ? 'active' : ''}`;
      if (adminOnlySubs.includes(t)) tab.style.display = isAdmin ? '' : 'none';
    }
  });
  document.getElementById('admin-nav-header').style.display = (sub === 'calendario' || sub === 'horas') ? 'block' : 'none';
  document.getElementById('admin-cal-views').style.display = (sub === 'calendario') ? 'block' : 'none';
  if (sub === 'cuentas') renderAccountsList();
  if (sub === 'calendario') renderAdminCalendar();
  if (sub === 'excepciones') renderAdminExceptions();
  if (sub === 'ajustes') renderAdminAjustes();
  if (sub === 'seguridad') renderAdminSeguridad();
  if (sub === 'horas') renderAdminHoras();
}

/** Rellena el formulario de seguridad con los datos actuales de la promoción desde Supabase. */
async function renderAdminSeguridad() {
    const { data: promo, error } = await supabaseClient.from('promociones').select('servicio').eq('id', currentUserProfile.promocion_id).single();
    if (!error && promo) {
        document.getElementById('edit-promo-servicio').value = promo.servicio || '';
    }
}

/** Guarda el nuevo nombre de especialidad de la promoción en Supabase y recarga la página. */
async function adminUpdatePromoDetails() {
    const newServicio = document.getElementById('edit-promo-servicio').value.trim();
    if (!newServicio) return alert("El campo de la especialidad no puede estar vacío.");
    
    setStatus('Guardando...');
    const { error } = await supabaseClient.from('promociones').update({
        servicio: newServicio
    }).eq('id', currentUserProfile.promocion_id);
    
    if (error) {
        alert("Error al actualizar: " + error.message);
        setStatus('Error ❌');
    } else {
        alert("¡Datos de la promoción actualizados correctamente!");
        setStatus('Conectado ✅');
        window.location.reload(); // Reload to refresh headers
    }
}

/**
 * Avanza o retrocede el mes visible en la aplicación.
 * @param {1|-1} delta
 */
function changeMonth(delta) {
  let m = curDate.getMonth() + delta; let y = curDate.getFullYear();
  if (m > 11) { m = 0; y++; } if (m < 0) { m = 11; y--; }
  curDate = new Date(y, m, 1); editingGroups = null; checkAutomaticGraduation();
    renderAll();
}

/** Re-renderiza todos los paneles activos del mes actual (cabecera, calendarios, rotación, admin). */
function renderAll() {
  renderUserHeader();
  const y = curDate.getFullYear(), m = curDate.getMonth();
  const key = getRotationKey(y, m);
  const _curPlanName = getCurrentRotPlan(formatDateKey(y, m, 1));
  const _curPr = state.planRotations?.[_curPlanName];
  const isCustom = _curPr?.customRotations?.[key] || state.customRotations?.[key];
  const title = `${MONTHS[m]} ${y} ${isCustom ? '⚙️' : ''}`;
  
  document.getElementById('main-cal-title').textContent = title;
  document.getElementById('merc-cal-title').textContent = title;
  document.getElementById('rot-title').textContent = title;
  document.getElementById('admin-cal-title').textContent = title;

  renderMainCalendar();
  renderMercadoCalendar();
  renderMercadoInboxAndLog();
  renderRotationView();
  
  if (isDelegado) {
    if (currentAdminView === 'cuentas') renderAccountsList();
    else if (currentAdminView === 'calendario') renderAdminCalendar();
    else if (currentAdminView === 'excepciones') renderAdminExceptions();
    else if (currentAdminView === 'horas') renderAdminHoras();
  }
}

/** Alterna el modo "ver solo mis guardias" y actualiza el estilo de los botones de filtro. */
function toggleFilter() {
  if (!loggedInUser) { alert("⚠️ Identifícate primero arriba a la derecha para poder filtrar tus guardias."); return; }
  showOnlyMine = !showOnlyMine;
  const btnMain = document.getElementById('btn-filter'); const btnMerc = document.getElementById('btn-filter-merc');
  if (showOnlyMine) {
    if(btnMain) { btnMain.style.background = 'var(--dark)'; btnMain.style.color = 'white'; btnMain.innerHTML = '👁️ Viendo SOLO las mías'; }
    if(btnMerc) { btnMerc.style.background = 'var(--merc)'; btnMerc.style.color = 'white'; btnMerc.innerHTML = '👁️ Viendo SOLO las mías'; }
  } else {
    if(btnMain) { btnMain.style.background = 'transparent'; btnMain.style.color = 'var(--dark)'; btnMain.innerHTML = '👁️ Ver solo mis guardias'; }
    if(btnMerc) { btnMerc.style.background = 'transparent'; btnMerc.style.color = 'var(--merc)'; btnMerc.innerHTML = '👁️ Ver solo mis guardias'; }
  }
  checkAutomaticGraduation();
    renderAll();
}
	
// ============================================================
// MÓDULO: HELPERS_SERVICIOS
// Exportar a: src/modules/helpersServicios.js
// Líneas estimadas: ~55
// Dependencias externas: promoConfig, state.habilitaciones, state.pedWhitelist
// Helpers que usa: getSvcConfig
// NOTA: getCellBackgroundStyle también pertenece aquí (ver línea 2)
// ============================================================
/** Devuelve la lista deduplicada de todos los servicios definidos en cualquier plan de promoConfig. */
function getAllUniqueServices() {
    let unique = []; let names = new Set();
    if (!promoConfig.planes) return [];
    promoConfig.planes.forEach(plan => {
        plan.servicios.forEach(s => {
            if (!names.has(s.nombre)) { names.add(s.nombre); unique.push(s); }
        });
    });
    return unique;
}

/**
 * Devuelve el color hex configurado para un servicio; '#3b82f6' como fallback.
 * @param {string} svcName
 * @returns {string} color hex
 */
function getServiceColor(svcName) {
    if (!promoConfig.planes) return '#3b82f6';
    for (let plan of promoConfig.planes) {
        let svc = plan.servicios.find(s => s.nombre === svcName);
        if (svc && svc.color) return svc.color;
    }
    return '#3b82f6';
}

/**
 * Devuelve true si el servicio está habilitado para ese día (consulta state.habilitaciones y pedWhitelist).
 * Pasar siempre planName para evitar el fallback legacy de búsqueda por nombre.
 * @param {string} svcName
 * @param {string} dk - dateKey
 * @param {string|null} planName
 * @returns {boolean}
 */
function isServiceEnabledOnDate(svcName, dk, planName = null) {
    let svc;
    if (planName) {
        svc = getSvcConfig(svcName, planName);
    } else {
        // Fallback legacy: encuentra el primer plan que contenga el servicio.
        // Puede devolver el plan equivocado si el nombre es compartido entre planes.
        // Pasar siempre planName en código nuevo.
        const pData = (promoConfig.planes || []).find(p => p.servicios.some(s => s.nombre === svcName));
        svc = pData?.servicios.find(s => s.nombre === svcName);
    }
    if (!svc) return false;
    if (!svc.requiereHabilitacion) return true;
    if (state.habilitaciones?.[dk]?.[svcName] !== false && state.habilitaciones?.[dk]?.[svcName] !== undefined) return true;
    if (svcName === 'Pediatría' && state.pedWhitelist?.[dk] !== false && state.pedWhitelist?.[dk] !== undefined) return true;
    return false;
}

/**
 * Devuelve el número de plazas disponibles para un servicio en un día dado.
 * Si el servicio tiene habilitación dinámica con un valor numérico, lo usa; si no, usa plazasPorDia.
 * @param {Object} svc - config del servicio
 * @param {string} dk - dateKey
 * @returns {number}
 */
function getPlazasForDay(svc, dk) {
    if (svc.requiereHabilitacion && state.habilitaciones && state.habilitaciones[dk] && state.habilitaciones[dk][svc.nombre] !== undefined && state.habilitaciones[dk][svc.nombre] !== false) {
        let val = state.habilitaciones[dk][svc.nombre];
        if (typeof val === 'number') return val;
    }
    return svc.plazasPorDia >= 0 ? svc.plazasPorDia : 1;
}

// ============================================================
// MÓDULO: CALENDARIO
// Exportar a: src/modules/calendario.js
// Líneas estimadas: ~225
// Dependencias externas: state, curDate, promoConfig, loggedInUser, simulatedViewUser, isDelegado
// Helpers que usa: getRotationKey, getCurrentTurn, getAnalisisFestivos, getUserProgress, getAllUniqueServices, getPlazasForDay, getCellBackgroundStyle, getFirstDayOffset, getDaysInMonth, formatDateKey, getInitials, renderAlertaCargaMensual
// ============================================================
/**
 * Renderiza el calendario principal del mes actual: banner de turno/subasta y grid de días con badges.
 * Adapta el banner según el rol (admin/delegado/residente) y el estado de la subasta.
 */
function renderMainCalendar() {
  const y = curDate.getFullYear(), m = curDate.getMonth();
  const banner = document.getElementById('turn-banner');

  if (!currentUserProfile || currentUserProfile.estado !== 'aprobado') {
    banner.innerHTML = "<div style='background:#f1f5f9; color:#475569; padding:8px 12px; border-radius:8px; margin-bottom:1rem; font-size:0.85rem; border: 1px solid #cbd5e1;'>🔒 Inicia sesión y únete a un grupo para ver de quién es el turno.</div>"; 
  } else {
    const monthKey = getRotationKey(y, m); 
    const turnUser = getCurrentTurn(y, m); 
    const skipped = state.skippedTurns[monthKey] || [];
    
    let pendingReasonForTurn = null;
    if (turnUser && state.pendingExceptions && state.pendingExceptions[monthKey]) { 
      pendingReasonForTurn = state.pendingExceptions[monthKey][turnUser]; 
    }
    
    if (isDelegado && simulatedViewUser === null) {
       if (!state.grantedTurn) state.grantedTurn = {};
       const granted = state.grantedTurn[monthKey];
       let html = `<div style="background:#f1f5f9; border:1px solid #cbd5e1; color:#475569; padding:10px 12px; border-radius:8px; margin-bottom:1rem; font-size:0.85rem; display:flex; flex-direction:column; gap:8px;">`;
       const af = !turnUser ? getAnalisisFestivos(y, m) : null;
       let turnLabel;
       if (granted) {
           turnLabel = `🎁 Turno <b>otorgado</b> a: <b style="color:#7c3aed">${turnUser || 'Nadie'}</b> <span style="font-size:0.7rem;color:#7c3aed">(turno especial)</span>`;
       } else if (!turnUser) {
           if (af.estado === 'subasta_abierta') {
               turnLabel = `${isAdmin ? '👑 <b>Modo Admin</b>' : '⭐ <b>Modo Delegado</b>'}. 📢 <b>Subasta Voluntaria</b> en curso — <b>${af.svcNombre}</b> (<b>${af.horasRestantes || 0}h</b> restantes)`;
           } else if (af.estado === 'subasta_cerrada' || af.estado === 'critico') {
               turnLabel = `${isAdmin ? '👑 <b>Modo Admin</b>' : '⭐ <b>Modo Delegado</b>'}. ⚖️ <b>Subasta cerrada</b> — <b>${af.svcNombre}</b> pendiente de asignación forzosa`;
           } else {
               turnLabel = `${isAdmin ? '👑 <b>Modo Admin</b>' : '⭐ <b>Modo Delegado</b>'}. 🎉 Mes <b>${MONTHS[m]} ${y}</b> completado`;
           }
       } else {
           turnLabel = `${isAdmin ? '👑 <b>Modo Admin</b>' : '⭐ <b>Modo Delegado</b>'}. Turno de: <b>${turnUser}</b> ${pendingReasonForTurn ? '<span style="color:var(--fest);">(🛑 PENDIENTE)</span>' : ''}`;
       }
       html += `<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;"><span>${turnLabel}</span><div style="display:flex; gap:8px;">`;
       if (turnUser) {
         html += `<button class="danger" style="padding:4px 8px; font-size:0.75rem;" onclick="adminSkipTurn('${turnUser}', ${y}, ${m})">Saltar turno ⏭️</button>`;
         if (granted) html += `<button class="primary" style="padding:4px 8px; font-size:0.75rem; background:#7c3aed;" onclick="adminClearGrantedTurn(${y}, ${m})">❌ Cancelar turno otorgado</button>`;
       } else if (af && (af.estado === 'subasta_cerrada' || af.estado === 'critico')) {
           html += `<button class="primary" style="padding:4px 8px; font-size:0.75rem; background:var(--fest); color:white;" onclick="ejecutarAsignacionForzosa(${y}, ${m}, '${af.svcNombre}')">⚡ Forzosa</button>`;
       }
       html += `<button class="danger" style="padding:4px 8px; font-size:0.75rem; background:var(--fest); color:white;" onclick="adminResetMonth(${y}, ${m})">⚠️ Reset Mes</button></div></div>`;
       // Toolbar unificado: Otorgar turno / Visualizar como
       const activosToolbar = getResidentesActivosEnMes(y, m);
       const optsToolbar = activosToolbar.map(r => `<option value="${r}">${r}</option>`).join('');
       html += `<div class="admin-action-toolbar">
           <div class="admin-action-toolbar__mode-row">
               <span class="admin-action-toolbar__mode-label">Acción:</span>
               <select id="sel-admin-mode" class="admin-action-toolbar__mode-select" onchange="onAdminModeChange()">
                   <option value="">— Seleccionar acción —</option>
                   <option value="grant">🎁 Otorgar turno a...</option>
                   <option value="simulate">👁 Visualizar como...</option>
               </select>
           </div>
           <div id="admin-action-resident-row" class="admin-action-toolbar__resident-row">
               <select id="sel-admin-resident" class="admin-action-toolbar__resident-select">
                   <option value="">— Residente —</option>
                   ${optsToolbar}
               </select>
               <button id="admin-action-confirm-btn" class="admin-action-toolbar__confirm-btn" onclick="onAdminActionConfirm(${y}, ${m})">Confirmar</button>
           </div>`;
       if (skipped.length > 0) {
           html += `<div class="admin-action-toolbar__skipped-row"><span class="admin-action-toolbar__skipped-label">Saltados: ${skipped.join(', ')}</span><button class="primary icon-btn" style="background:var(--ped);" onclick="adminResetSkips(${y}, ${m})">Restaurar saltados 🔄</button></div>`;
       }
       html += `</div></div>`;
       banner.innerHTML = html;
    } else if (turnUser) {
       const effectiveUser = simulatedViewUser ?? loggedInUser;
       if (turnUser === effectiveUser) {
         if (pendingReasonForTurn) {
           banner.innerHTML = `<div style="background:#fef3c7; color:#854d0e; border:1px solid #fde047; padding:10px 12px; border-radius:8px; margin-bottom:1rem; font-size:0.85rem;">⏳ <b>Validación pendiente:</b> Has solicitado saltar el turno por el motivo "<i>${pendingReasonForTurn}</i>".<br><br>⚠️ Tu turno está <b>pausado y bloqueado</b>. Debes avisar al Admin.</div>`;
         } else {
           const pData = getUserProgress(effectiveUser, y, m);
           
           let bannerHtml = `<div style="background:#fef9c3; color:#854d0e; border:1px solid #fde047; padding:8px 12px; border-radius:8px; margin-bottom:1rem; font-size:0.85rem;">✨ <b>¡Es tu turno de elección!</b><br>`;
           
           if (pData.messages.length > 0) bannerHtml += `Te falta escoger: ${pData.messages.join(' y ')}.<br>`;
           
           Object.values(pData.progress).forEach(p => {
               p.missingRules.forEach(r => {
                   if (r.forgiven) bannerHtml += `<span style="color:var(--ped); font-weight:bold; display:block; margin-top:4px;">ℹ️ Te has librado de la regla: "${r.mensaje}" porque no quedan huecos compatibles libres.</span>`;
                   else bannerHtml += `<span style="color:var(--fest); font-weight:bold; display:block; margin-top:4px;">⚠️ Recuerda: ${r.mensaje}</span>`;
               });
           });

           let reasonsHtml = (state.exceptionReasons || []).map(r => `<option value="${r}">${r}</option>`).join(''); reasonsHtml += `<option value="Otros">Otros (especificar)...</option>`;
           bannerHtml += `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #fde047; display: flex; flex-direction: column; gap: 8px;"><div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><span style="font-size:0.8rem; color:#854d0e; font-weight:bold;">¿Fuerza mayor?</span><select id="user-skip-reason" onchange="toggleOtherReasonInput()" style="margin:0; padding:4px; font-size:0.8rem; width:auto; flex:1; min-width:150px; background:white; border:1px solid #cbd5e1; border-radius:4px;"><option value="">-- Elige motivo para saltar turno --</option>${reasonsHtml}</select><button class="danger" style="padding:4px 8px; font-size:0.75rem;" onclick="userSkipTurn(${y}, ${m})">Saltar mi turno</button></div><div id="user-skip-reason-other-block" style="display:none; margin-top:4px;"><input type="text" id="user-skip-reason-other" maxlength="150" placeholder="Escribe tu motivo (máx 150 caracteres)..." style="margin:0; padding:6px; font-size:0.8rem; width:100%; border-radius:4px; border:1px solid #cbd5e1;"><span style="font-size:0.75rem; color:var(--fest);">⚠️ Si usas "Otros", el turno NO se pasará automáticamente. Requerirá validación del Admin.</span></div></div></div>`;
           banner.innerHTML = bannerHtml;
         }
       } else {
         if (pendingReasonForTurn) banner.innerHTML = `<div style="background:#f1f5f9; color:#64748b; padding:8px 12px; border-radius:8px; margin-bottom:1rem; font-size:0.85rem;">⏳ Turno de elección: <b>${turnUser}</b>.<br>🛑 Su turno está temporalmente pausado (Solicitó una excepción).</div>`;
         else banner.innerHTML = `<div style="background:#f1f5f9; color:#64748b; padding:8px 12px; border-radius:8px; margin-bottom:1rem; font-size:0.85rem;">⏳ Turno de elección: <b>${turnUser}</b>.<br>Debes esperar a que termine sus guardias o el Admin le salte.</div>`;
       }
    } else { 
        // turnUser === null → todos eligieron. Ahora comprobamos si la Subasta también está resuelta
        const analisisFinal = getAnalisisFestivos(y, m);

        if (analisisFinal.estado === 'subasta_abierta') {
            // Fase 2: turnos completos pero quedan guardias en subasta voluntaria
            const horasRestantes = analisisFinal.horasRestantes || 0;
            if (isDelegado && simulatedViewUser === null) {
                banner.innerHTML = `<div style="background:#fff7ed; border:2px dashed #f97316; color:#c2410c; padding:10px 14px; border-radius:10px; margin-bottom:1rem; font-size:0.85rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <span>📢 <b>Todos eligieron.</b> Quedan <b>${Math.ceil(analisisFinal.exceso)}</b> guardia(s) de <b>${analisisFinal.svcNombre}</b> en Subasta Voluntaria. Tiempo restante: <b>${horasRestantes}h</b>.</span>
                    <div style="display:flex;gap:6px;">
                        <button class="danger" style="padding:4px 8px; font-size:0.75rem; background:var(--fest); color:white;" onclick="adminResetMonth(${y}, ${m})">⚠️ Reset</button>
                    </div>
                </div>`;
            } else {
                banner.innerHTML = `<div style="background:#fff7ed; border:1px solid #fed7aa; color:#c2410c; padding:8px 12px; border-radius:8px; margin-bottom:1rem; font-size:0.85rem;">
                    📢 <b>Has terminado de elegir.</b> Quedan <b>${Math.ceil(analisisFinal.exceso)}</b> guardia(s) de <b>${analisisFinal.svcNombre}</b> en Subasta Voluntaria. Tienes <b>${horasRestantes}h</b> para adjudicártela(s) voluntariamente.
                </div>`;
            }

        } else if (analisisFinal.estado === 'subasta_cerrada' || analisisFinal.estado === 'critico') {
            // Fase 3: subasta cerrada forzosa, pendiente de inyección
            if (isDelegado && simulatedViewUser === null) {
                banner.innerHTML = `<div style="background:#fef2f2; border:2px dashed #ef4444; color:#b91c1c; padding:10px 14px; border-radius:10px; margin-bottom:1rem; font-size:0.85rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <span>⚖️ <b>Subasta Cerrada.</b> Quedan <b>${Math.ceil(analisisFinal.exceso)}</b> guardia(s) de <b>${analisisFinal.svcNombre}</b> pendientes de asignación forzosa.</span>
                    <div style="display:flex;gap:6px;">
                        <button class="primary" style="padding:4px 8px; font-size:0.75rem; background:var(--fest); color:white;" onclick="ejecutarAsignacionForzosa(${y}, ${m}, '${analisisFinal.svcNombre}')">⚡ Asignación Forzosa</button>
                        <button class="danger" style="padding:4px 8px; font-size:0.75rem;" onclick="adminResetMonth(${y}, ${m})">⚠️ Reset</button>
                    </div>
                </div>`;
            } else {
                banner.innerHTML = `<div style="background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; padding:8px 12px; border-radius:8px; margin-bottom:1rem; font-size:0.85rem;">
                    ⚖️ <b>La subasta ha cerrado.</b> El administrador asignará forzosamente las guardias de <b>${analisisFinal.svcNombre}</b> que quedaron sin cubrir.
                </div>`;
            }

        } else {
            // ✅ Fase final: todos eligieron Y la subasta está resuelta → Mes completamente cerrado
            const mesNombre = `${MONTHS[m]} ${y}`;
            if (isDelegado && simulatedViewUser === null) {
                banner.innerHTML = `<div style="background: linear-gradient(135deg, #064e3b, #065f46); color:white; padding:14px 18px; border-radius:12px; margin-bottom:1rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                    <div>
                        <div style="font-size:1rem; font-weight:bold; margin-bottom:4px;">🎉 Asignación de ${mesNombre} completada</div>
                        <div style="font-size:0.8rem; opacity:0.85;">Todos los residentes han elegido y todas las guardias están cubiertas. ¡Listo para exportar a RRHH!</div>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button onclick="navAdmin('export')" style="padding:6px 12px; font-size:0.8rem; background:white; color:#064e3b; border:none; border-radius:6px; font-weight:bold; cursor:pointer;">📊 Exportar Excel</button>
                        <button class="danger" style="padding:4px 8px; font-size:0.75rem;" onclick="adminResetMonth(${y}, ${m})">⚠️ Reset</button>
                    </div>
                </div>`;
            } else {
                banner.innerHTML = `<div style="background: linear-gradient(135deg, #064e3b, #065f46); color:white; padding:12px 16px; border-radius:12px; margin-bottom:1rem;">
                    <div style="font-size:0.95rem; font-weight:bold; margin-bottom:3px;">🎉 Asignación de ${mesNombre} completada</div>
                    <div style="font-size:0.8rem; opacity:0.85;">Todos los residentes han terminado de elegir. Si quieres hacer algún cambio, usa el <b>Mercadillo 🛒</b>.</div>
                </div>`;
            }
        }
    }
  }

  const grid = document.getElementById('main-cal-body'); 
  grid.innerHTML = '';
  for(let i=0; i<getFirstDayOffset(y,m); i++) grid.innerHTML += `<div class="cal-cell empty"></div>`;
  
  // Obtenemos todos los servicios disponibles globalmente para pintar los iconos
  const todosLosServicios = getAllUniqueServices();
  
  let userLevelName = 'ALL';
  if (currentUserProfile) {
      const plan = getPlanForUserOnDate(currentUserProfile, formatDateKey(y, m, 1));
      if (plan) userLevelName = plan.nombre;
  }
  
  for(let d=1; d<=getDaysInMonth(y,m); d++) {
    const dateKey = formatDateKey(y, m, d);
    const dayShifts = state.shifts[dateKey] || {};
    const isFest = state.festivos[dateKey];
    
    // Verificación de si el día está habilitado (para la clase CSS)
    // Nota: Aquí usamos una comprobación genérica ya que no estamos en el contexto de un solo servicio
    const cell = document.createElement('div');
    
    let cClass = 'cal-cell';
    if (isFest) cClass += ' is-festivo';
    cell.className = cClass;
    const bgStyle = getCellBackgroundStyle(dateKey, y, m, d, userLevelName);
    if (bgStyle) cell.setAttribute('style', bgStyle);
    
    let html = `<div class="day-number">${d}</div>`;
    const multihuecoItems = [];

    // 🛡️ AQUÍ ESTABA EL ERROR: Recorremos los servicios definidos arriba
    todosLosServicios.forEach(svc => {
        let assigned = Object.keys(dayShifts || {}).filter(u => dayShifts[u] === svc.nombre);
        if (showOnlyMine && (simulatedViewUser || loggedInUser)) assigned = assigned.filter(u => u === (simulatedViewUser ?? loggedInUser));
        assigned.forEach(u => {
            html += `<div class="shift-badge" style="background:${svc.color};">👤 ${getInitials(u)}</div>`;
        });
        const pd = getPlazasForDay(svc, dateKey);
        if (pd > 1) {
            const filled = Object.keys(dayShifts || {}).filter(u => dayShifts[u] === svc.nombre).length;
            multihuecoItems.push({ color: svc.color, filled, pd });
        }
    });

    cell.innerHTML = html;

    if (multihuecoItems.length > 0) {
        cell.style.position = 'relative';
        const badgeDiv = document.createElement('div');
        badgeDiv.setAttribute('style', 'font-size:0.6rem; background:rgba(255,255,255,0.7); border-radius:3px; padding:1px 4px; position:absolute; bottom:2px; right:2px; display:flex; flex-direction:column; align-items:flex-end; gap:1px;');
        badgeDiv.innerHTML = multihuecoItems.map(item =>
            `<span style="color:${item.color}; font-weight:bold; white-space:nowrap;">${item.filled}/${item.pd}</span>`
        ).join('');
        cell.appendChild(badgeDiv);
    }

    cell.onclick = () => openShiftModal(y, m, d, dateKey);
    grid.appendChild(cell);
  }

  // Llamada de Asignación Transversal
  renderAlertaCargaMensual();
}

// ============================================================
// MÓDULO: MODALES_CALENDARIO
// Exportar a: src/modules/modalesCalendario.js
// Líneas estimadas: ~185
// Dependencias externas: state, loggedInUser, simulatedViewUser, isDelegado, isAdmin
// Helpers que usa: getCurrentTurn, getAnalisisFestivos, getUserProgress, getPlanForUserOnDate, getDayTag, getPlazasForDay, isServiceEnabledOnDate, isUserBusyOnDay, getIllegalShiftsForUser, saveState, renderMainCalendar, renderAll, MONTHS, getAllResidents
// ============================================================
/**
 * Abre el modal de asignación de guardia para un día concreto.
 * Controla permisos según si es el turno del usuario, si hay subasta abierta, o si es admin.
 * @param {number} y
 * @param {number} m - 0-indexed
 * @param {number} d
 * @param {string} dateKey
 */
function openShiftModal(y, m, d, dateKey) {
  if (!isDelegado && !loggedInUser) { alert("⚠️ Inicia sesión para usar el calendario."); loginWithGoogle(); return; }
  const dayShifts = state.shifts[dateKey] || {};
  const monthKey = getRotationKey(y, m);
  const viewUser = simulatedViewUser ?? loggedInUser;
  const turnUser = getCurrentTurn(y, m);
  const isMyTurn = turnUser === viewUser;
  const isUserPending = !!(state.pendingExceptions && state.pendingExceptions[monthKey] && state.pendingExceptions[monthKey][viewUser]);
  const _analisisModal = getAnalisisFestivos(y, m);
  const isSubastaAbierta = _analisisModal.estado === 'subasta_abierta';

  // DETERMINACIÓN DIARIA: ¿Qué plan tengo yo HOY en el calendario?
  const myPlanOnDate = getPlanForUserOnDate(currentUserProfile, dateKey);
  const serviciosDisponibles = myPlanOnDate ? myPlanOnDate.servicios : [];
  const pDataFull = getUserProgress(viewUser, y, m).progress;
  const theTag = getDayTag(y, m, d);

  const modal = document.createElement('div'); modal.className = 'modal-overlay'; modal.id = 'shift-modal';
  let html = `<div class="modal"><h3 style="margin-bottom:0.5rem;">${d} de ${MONTHS[m]} ${y}</h3>`;
  if (simulatedViewUser !== null) html += `<p style="margin-bottom:1.5rem; color:#7c3aed; font-weight:bold;">👁 Viendo como: ${simulatedViewUser}</p>`;
  else if (isAdmin) html += `<p style="margin-bottom:1.5rem; color:var(--fest); font-weight:bold;">👑 MODO ADMIN (Control Total)</p>`;
  else if (isDelegado) html += `<p style="margin-bottom:1.5rem; color:var(--adu); font-weight:bold;">⭐ MODO DELEGADO</p>`;
  else html += `<p style="margin-bottom:1.5rem; color:#64748b; font-size:0.9rem;">Usuario actual: <b>${loggedInUser}</b> (Evaluando: ${myPlanOnDate ? myPlanOnDate.nombre : 'Sin Plan'})</p>`;
  
  // Cambiamos el bucle para que recorra SOLO tus servicios autorizados para esta fecha
serviciosDisponibles.forEach((svc, svcIdx) => {
    html += `<div class="shift-option" style="flex-direction:column; align-items:stretch;"><div class="shift-option-header"><strong style="color:${svc.color};">${svc.nombre}</strong></div>`;
    const holders = Object.keys(dayShifts || {}).filter(u => dayShifts[u] === svc.nombre);
    
    if (isDelegado && simulatedViewUser === null) {
// A) INTERFAZ PARA ADMIN/DELEGADO
holders.forEach(h => { 
    let currentMode = state.shiftModifiers?.[dateKey]?.[h]?.tipo || 'normal';
    html += `<div style="background:#f8fafc; border:1px solid #e2e8f0; padding:10px; border-radius:6px; margin-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:0.85rem; color:#64748b;">Asignado: <b>${h}</b></span>
            <button class="danger icon-btn" onclick="adminForceRemove('${dateKey}', '${h}', ${y}, ${m}, ${d})">Quitar</button>
        </div>
        <label style="font-size:0.75rem; color:#475569; display:block; margin-bottom:2px;">Regimen de Guardia:</label>
        <select onchange="updateShiftMode('${dateKey}', '${h}', this.value)" style="margin:0; padding:4px; font-size:0.8rem; width:100%; background:white;">
            <option value="normal" ${currentMode === 'normal' ? 'selected' : ''}>Guardia Normal</option>
            <option value="partida_primera" ${currentMode === 'partida_primera' ? 'selected' : ''}>Partida Diurna (50% H / Sin Saliente)</option>
            <option value="partida_segunda" ${currentMode === 'partida_segunda' ? 'selected' : ''}>Partida Nocturna (50% H / Con Saliente)</option>
        </select>
    </div>`;
	}); // ⚠️ ESTE CIERRE ES EL QUE HABÍAS BORRADO
        html += `<div style="display:flex; gap:4px; margin-top:12px; border-top:1px solid #e2e8f0; padding-top:8px;"><select id="force-sel-${svcIdx}" style="margin:0; padding:4px; font-size:0.8rem;"><option value="">Añadir Residente...</option>${getAllResidents().map(r => `<option value="${r}">${r}</option>`).join('')}</select><button class="primary" style="background:var(--dark); color:white;" onclick="adminForceAssign('${dateKey}', '${svc.nombre}', ${y}, ${m}, ${d}, 'force-sel-${svcIdx}')">Poner</button></div>`;
    } else {
        const isMine = dayShifts[viewUser] === svc.nombre;
        let isIllegal = false; let tempShifts = JSON.parse(JSON.stringify(state.shifts || {}));
        if (!tempShifts[dateKey]) tempShifts[dateKey] = {}; tempShifts[dateKey][viewUser] = svc.nombre;
        if (getIllegalShiftsForUser(viewUser, tempShifts).length > 0) isIllegal = true;
        
        let disabled = false; let reason = "";
        let pData = pDataFull[svc.nombre];
        let pd = getPlazasForDay(svc, dateKey);

        if (isUserPending && !isMine) { disabled = true; reason = "Turno bloqueado (Pendiente Admin)."; }
        else if (isIllegal && !isMine) { disabled = true; reason = "Ilegal: Choca con Saliente"; }
        else if (svc.requiereHabilitacion && !isServiceEnabledOnDate(svc.nombre, dateKey, myPlanOnDate ? myPlanOnDate.nombre : null) && !isMine) { disabled = true; reason = "Día no habilitado."; }
        else if (isUserBusyOnDay(viewUser, dateKey) && !isMine) { disabled = true; reason = "Ya tienes guardia hoy."; }
        else if (!isMyTurn && !isMine && !(isSubastaAbierta && svc.nombre === _analisisModal.svcNombre)) { disabled = true; reason = `Bloqueado (Toca a ${turnUser}).`; }
        else if (pd > 0 && holders.length >= pd && !isMine) { disabled = true; reason = `Completo (${holders.length}/${pd}).`; }
        else if (isMyTurn && !isMine && !isUserPending) {
            if (pData && pData.countTotal >= svc.cupoMensualTotal) { disabled = true; reason = "Cupo mensual completado."; }
            if (!disabled && pData && pData.missingTotal === 1 && !pData.rulesOk) {
                 let breaksRule = pData.missingRules.some(r => !r.forgiven && !r.etiquetas.includes(theTag));
                 if (breaksRule) { disabled = true; reason = "Debes elegir un día que cumpla tus reglas pendientes."; }
            }
        }

        let occStr = holders.length > 0 ? `Ocupado (${holders.length}${pd > 0 ? '/' + pd : ''})` : 'Libre';
        
// B) INTERFAZ PARA EL RESIDENTE LOGUEADO
if (isMine) {
    let currentMode = state.shiftModifiers?.[dateKey]?.[viewUser]?.tipo || 'normal';
    html += `<div style="display:flex; flex-direction:column; gap:6px; margin-top:8px; background:#fffbeb; padding:10px; border-radius:6px; border:1px solid #fde047;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:0.85rem; color:#713f12;"><b>Tu Guardia Seleccionada</b></span>
            <button class="danger" ${simulatedViewUser !== null ? 'disabled style="opacity:0.4"' : ''} onclick="toggleShift('${dateKey}', '${svc.nombre}')">Quitar</button>
        </div>
        <div style="margin-top:4px;">
            <label style="font-size:0.75rem; color:#713f12; display:block; margin-bottom:2px; font-weight:bold;">Ajustar Modalidad:</label>
            <select ${simulatedViewUser !== null ? 'disabled' : `onchange="updateShiftMode('${dateKey}', '${viewUser}', this.value)"`} style="margin:0; padding:6px; font-size:0.8rem; width:100%; background:white; border:1px solid #ca8a04; border-radius:4px;">
                <option value="normal" ${currentMode === 'normal' ? 'selected' : ''}>Guardia Normal</option>
                <option value="partida_primera" ${currentMode === 'partida_primera' ? 'selected' : ''}>Partida Diurna (50% Horas / Sin Saliente)</option>
                <option value="partida_segunda" ${currentMode === 'partida_segunda' ? 'selected' : ''}>Partida Nocturna (50% Horas / Con Saliente)</option>
            </select>
        </div>
    </div>`;
} else {
            html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;"><span style="font-size:0.85rem; color:${isIllegal && !isMine ? 'var(--fest)' : '#64748b'}; font-weight:${isIllegal && !isMine ? 'bold' : 'normal'}">${reason || occStr}</span>`;
            html += `<button class="primary" ${(disabled || simulatedViewUser !== null) ? 'disabled style="opacity:0.4"' : ''} onclick="toggleShift('${dateKey}', '${svc.nombre}')">Elegir</button></div>`;
        }
    }
    html += `</div>`;
  });
  html += `<div style="text-align:right; margin-top:1rem;"><button onclick="document.getElementById('shift-modal').remove()">Cerrar</button></div></div>`;
  modal.innerHTML = html; document.body.appendChild(modal);
}

/**
 * Añade o quita la guardia del usuario logueado en un día. Persiste y re-renderiza.
 * @param {string} dateKey
 * @param {string} svc - nombre del servicio
 */
async function toggleShift(dateKey, svc) {
  if (simulatedViewUser !== null) { alert('⚠️ Estás en modo visualización. Sal de la simulación para realizar cambios.'); return; }
  if (!state.shifts[dateKey]) state.shifts[dateKey] = {};
  if (state.shifts[dateKey][loggedInUser] === svc) delete state.shifts[dateKey][loggedInUser];
  else state.shifts[dateKey][loggedInUser] = svc;
  if (Object.keys(state.shifts[dateKey] || {}).length === 0) delete state.shifts[dateKey];
  document.getElementById('shift-modal').remove(); renderMainCalendar(); await saveState();
}
/**
 * Asigna forzosamente una guardia a un residente seleccionado desde el modal de admin.
 * Avisa si hay conflictos de saliente y pide confirmación antes de sobrescribir.
 */
async function adminForceAssign(dateKey, svc, y, m, d, selectId) {
  if (simulatedViewUser !== null) { alert('⚠️ Estás en modo visualización. Sal de la simulación para realizar cambios.'); return; }
  const res = document.getElementById(selectId).value; if (!res) return;
  let tempShifts = JSON.parse(JSON.stringify(state.shifts || {}));
  if (!tempShifts[dateKey]) tempShifts[dateKey] = {};
  tempShifts[dateKey][res] = svc;
  const conflicts = getIllegalShiftsForUser(res, tempShifts);
  if (conflicts.length > 0) {
    const msg = conflicts.join('\n• ');
    if (!confirm(`⚠️ Conflicto de salientes/entrantes para ${res}:\n• ${msg}\n\n¿Asignar de todas formas?`)) return;
  }
  if (isUserBusyOnDay(res, dateKey)) { if (!confirm(`⚠️ ${res} ya tiene otra guardia este día. ¿Asignarle también ${svc}?`)) return; }
  if (!state.shifts[dateKey]) state.shifts[dateKey] = {}; state.shifts[dateKey][res] = svc;
  document.getElementById('shift-modal').remove(); renderMainCalendar(); await saveState(); openShiftModal(y, m, d, dateKey);
}
/** Elimina la guardia de un residente desde el modal admin y reabre el modal actualizado. */
async function adminForceRemove(dateKey, resToRemove, y, m, d) {
  if (simulatedViewUser !== null) { alert('⚠️ Estás en modo visualización. Sal de la simulación para realizar cambios.'); return; }
  if (state.shifts[dateKey]) { delete state.shifts[dateKey][resToRemove]; if (Object.keys(state.shifts[dateKey] || {}).length === 0) delete state.shifts[dateKey]; }
  document.getElementById('shift-modal').remove(); renderMainCalendar(); await saveState(); openShiftModal(y, m, d, dateKey);
}
/**
 * Permite al residente autenticado saltar su turno, registrando el motivo.
 * Si el motivo es "Otros", queda en pendingExceptions para validación del admin.
 * @param {number} y
 * @param {number} m
 */
async function userSkipTurn(y, m) {
    if (simulatedViewUser !== null) { alert('⚠️ Estás en modo visualización. Sal de la simulación para realizar cambios.'); return; }
    const sel = document.getElementById('user-skip-reason'); const val = sel.value === 'Otros' ? document.getElementById('user-skip-reason-other').value.trim() : sel.value;
    if (!val) return alert("Selecciona o escribe un motivo.");
    if (sel.value === 'Otros') {
        if (!state.pendingExceptions) state.pendingExceptions = {}; const monthKey = getRotationKey(y, m);
        if (!state.pendingExceptions[monthKey]) state.pendingExceptions[monthKey] = {};
        state.pendingExceptions[monthKey][loggedInUser] = val; await saveState(); checkAutomaticGraduation();
    renderAll(); return;
    }
    const monthKey = getRotationKey(y, m);
    if (!state.skippedTurns[monthKey]) state.skippedTurns[monthKey] = [];
    if (!state.skippedTurns[monthKey].includes(loggedInUser)) state.skippedTurns[monthKey].push(loggedInUser);
    let chosenShifts = []; for(let d=1; d<=getDaysInMonth(y, m); d++) { const dk = formatDateKey(y, m, d); if (state.shifts[dk] && state.shifts[dk][loggedInUser]) chosenShifts.push(`Día ${d} (${state.shifts[dk][loggedInUser]})`); }
    if (!state.exceptionLogs) state.exceptionLogs = []; state.exceptionLogs.push({ user: loggedInUser, monthStr: `${MONTHS[m]} ${y}`, reason: val, shiftsSummary: chosenShifts.length > 0 ? chosenShifts.join(', ') : 'Ninguna', timestamp: new Date().toLocaleString('es-ES') });
    await saveState(); checkAutomaticGraduation();
    renderAll();
}
/**
 * Fuerza el salto de turno de otro residente desde el panel admin.
 * @param {string} turnUser - nombre_mostrar del residente a saltar
 * @param {number} y
 * @param {number} m
 */
async function adminSkipTurn(turnUser, y, m) {
   if (simulatedViewUser !== null) { alert('⚠️ Estás en modo visualización. Sal de la simulación para realizar cambios.'); return; }
   if(!confirm(`¿Saltar forzosamente el turno de ${turnUser}?`)) return;
   const monthKey = getRotationKey(y, m);
   if (!state.skippedTurns[monthKey]) state.skippedTurns[monthKey] = [];
   if (!state.skippedTurns[monthKey].includes(turnUser)) state.skippedTurns[monthKey].push(turnUser);
   let chosenShifts = []; for(let d=1; d<=getDaysInMonth(y, m); d++) { const dk = formatDateKey(y, m, d); if (state.shifts[dk] && state.shifts[dk][turnUser]) chosenShifts.push(`Día ${d} (${state.shifts[dk][turnUser]})`); }
   if (!state.exceptionLogs) state.exceptionLogs = []; state.exceptionLogs.push({ user: turnUser, monthStr: `${MONTHS[m]} ${y}`, reason: "Admin Override", shiftsSummary: chosenShifts.length > 0 ? chosenShifts.join(', ') : 'Ninguna', timestamp: new Date().toLocaleString('es-ES') });
   await saveState(); checkAutomaticGraduation();
    renderAll();
}

// ============================================================
// MÓDULO: ADMIN_TURNO (sub-sección de MODALES_CALENDARIO)
// Exportar a: src/modules/modalesCalendario.js  ← mismo archivo
// Líneas estimadas: ~30
// Dependencias externas: state.grantedTurn, simulatedViewUser
// Helpers que usa: getRotationKey, saveState, renderAll, MONTHS
// ============================================================
/**
 * Otorga manualmente el turno de elección a un residente específico este mes (grantedTurn).
 * @param {number} y
 * @param {number} m
 */
async function adminGrantTurn(y, m) {
    if (simulatedViewUser !== null) { alert('⚠️ Estás en modo visualización. Sal de la simulación para realizar cambios.'); return; }
    const sel = document.getElementById('sel-grant-turn');
    const residente = sel?.value;
    if (!residente) { alert('Selecciona un residente al que otorgar el turno.'); return; }
    const monthKey = getRotationKey(y, m);
    if (!state.grantedTurn) state.grantedTurn = {};
    state.grantedTurn[monthKey] = residente;
    if (!state.exceptionLogs) state.exceptionLogs = [];
    state.exceptionLogs.push({
        user: residente, monthStr: `${MONTHS[m]} ${y}`,
        reason: `Turno otorgado manualmente por admin`,
        shiftsSummary: '', timestamp: new Date().toLocaleString('es-ES')
    });
    await saveState();
    renderAll();
}

/** Cancela el turno especial otorgado para este mes, volviendo al turno natural. */
async function adminClearGrantedTurn(y, m) {
    const monthKey = getRotationKey(y, m);
    if (state.grantedTurn) delete state.grantedTurn[monthKey];
    await saveState();
    renderAll();
}

// ============================================================
// MÓDULO: MERCADILLO_RENDER
// Exportar a: src/modules/mercadillo.js
// Líneas estimadas: ~200
// Dependencias externas: state.trades, loggedInUser, simulatedViewUser, promoConfig
// Helpers que usa: getComputedShifts, checkTradeConflicts, canUserTakeShift, getServiceColor, getAllUniqueServices, getAllResidents, isPastDate, formatDK, saveState, renderAll, checkAutomaticGraduation
// ============================================================
/** Renderiza el calendario del Mercadillo con las guardias computadas (incluyendo trades aprobados). */
function renderMercadoCalendar() {
  const y = curDate.getFullYear(), m = curDate.getMonth();
  const grid = document.getElementById('merc-cal-body'); grid.innerHTML = '';
  const computed = getComputedShifts();
  if (loggedInUser) { document.getElementById('merc-logged-zone').style.display = 'block'; document.getElementById('merc-unlogged-zone').style.display = 'none'; } 
  else { document.getElementById('merc-logged-zone').style.display = 'none'; document.getElementById('merc-unlogged-zone').style.display = 'block'; }
  for(let i=0; i<getFirstDayOffset(y,m); i++) grid.innerHTML += `<div class="cal-cell empty"></div>`;
  
  let userLevelName = 'ALL';
  if (currentUserProfile) {
      const plan = getPlanForUserOnDate(currentUserProfile, formatDateKey(y, m, 1));
      if (plan) userLevelName = plan.nombre;
  }
  for(let d=1; d<=getDaysInMonth(y,m); d++) {
    const dk = formatDateKey(y, m, d);
    const dayShifts = computed[dk] || {};
    const cell = document.createElement('div');
    cell.className = `cal-cell ${state.festivos[dk]?'is-festivo':''}`;
    const bgStyle = getCellBackgroundStyle(dk, y, m, d, userLevelName);
    if (bgStyle) cell.setAttribute('style', bgStyle);
    let html = `<div class="day-number">${d}</div>`;
    
    promoConfig.servicios.forEach(svc => {
        let assigned = Object.keys(dayShifts || {}).filter(u => dayShifts[u] === svc.nombre);
        if (showOnlyMine && (simulatedViewUser || loggedInUser)) assigned = assigned.filter(u => u === (simulatedViewUser ?? loggedInUser));
        assigned.forEach(u => {
            let isVre = u.startsWith('VRE');
            html += `<div class="shift-badge ${isVre ? 'bg-vre' : ''}" style="background:${isVre ? '#94a3b8' : svc.color};">👤 ${isVre ? 'VRE' : getInitials(u)}</div>`;
        });
    });
    
    cell.innerHTML = html;
    cell.onclick = () => openMercadoModal(y, m, d, dk, dayShifts);
    grid.appendChild(cell);
  }
}

// ============================================================
// MÓDULO: MERCADILLO_MODALES (sub-sección de MERCADILLO_RENDER)
// Exportar a: src/modules/mercadillo.js  ← mismo archivo
// Líneas estimadas: ~115
// Dependencias externas: state, loggedInUser, curDate
// Helpers que usa: canUserTakeShift, getComputedShifts, checkTradeConflicts, isPastDate, formatDK, getServiceColor, getAllResidents, saveState, renderAll
// ============================================================
/**
 * Abre el modal del Mercadillo para un día: muestra opciones de venta/cambio si el usuario
 * tiene guardia, o de compra/cambio si no la tiene.
 */
function openMercadoModal(y, m, d, dk, dayShifts) {
  if (!loggedInUser) return alert("Debes identificarte para usar el Mercadillo.");
  let myShift = null; for (let u in dayShifts) { if (u === loggedInUser) myShift = dayShifts[u]; }
  const past = isPastDate(dk);
  const modal = document.createElement('div'); modal.className = 'modal-overlay'; modal.id = 'mercado-modal';
  let html = `<div class="modal"><h3 style="color:var(--merc); border-bottom:2px solid var(--merc); padding-bottom:5px; margin-bottom:1rem;">🛒 Mercadillo: ${d}/${m+1}/${y}</h3><div id="mercado-dynamic">`;
  
  if (myShift) {
    const sColor = getServiceColor(myShift);
    html += `<div style="background:#f1f5f9; padding:10px; border-radius:8px; margin-bottom:1rem;"><strong>Tienes guardia de:</strong> <span class="shift-badge" style="background:${sColor}; display:inline-block; margin-left:8px; padding: 4px 8px;">${myShift}</span></div>`;
    
    if (past) html += `<p style="color:#64748b; font-size:0.85rem; font-weight:bold; text-align:center;">Esta guardia ya se ha realizado en el mundo real.</p>`;
    else html += `<button class="primary" style="width:100%; margin-bottom:10px;" onclick="renderMercadoVender('${dk}','${myShift}')">💵 Vender guardia</button><button class="merc" style="width:100%;" onclick="renderMercadoCambiar('${dk}','${myShift}')">🔄 Cambiar por otra fecha / residente</button>`;
  } else {
    let canBuy = false;
    
    // Bucle restaurado: Evaluamos a cada compañero que tiene guardia este día
    for (let u in dayShifts) {
			if (u !== loggedInUser && !u.startsWith('VRE')) {
            html += `<div style="display:flex; justify-content:space-between; align-items:center; border:1px solid #e2e8f0; padding:8px; border-radius:8px; margin-bottom:8px;">`;
            html += `<div><span style="font-size:0.85rem; font-weight:bold;">${u}</span> <span class="shift-badge" style="background:${getServiceColor(dayShifts[u])}; margin-left:4px;">${dayShifts[u]}</span></div>`;

            if (past) {
                html += `<span style="font-size:0.75rem; color:#94a3b8; font-weight:bold;">Pasada</span>`;
            } else {
                // Inyección de la regla de intercambio temporal
                let iCanTake = canUserTakeShift(loggedInUser, u, dk, dayShifts[u]);
                if (iCanTake) {
                    html += `<div style="display:flex; gap:4px;"><button class="merc icon-btn" onclick="executeBuyRequest('${dk}', '${dayShifts[u]}', '${u}')">Comprar</button><button class="primary icon-btn" style="background:var(--adu);" onclick="renderMercadoCambiarAjena('${dk}', '${dayShifts[u]}', '${u}')">Cambiar</button></div>`;
                } else {
                    html += `<span style="font-size:0.75rem; color:var(--fest); font-weight:bold; background:#fee2e2; padding:2px 6px; border-radius:4px;">Incompatible por R</span>`;
                }
            }
            html += `</div>`;
        }
    }

    if(!canBuy) html += `<p style="font-size:0.85rem; color:#64748b; margin-bottom:1rem;">No hay guardias de compañeros disponibles en este día.</p>`;
    
    if (!past) {
        html += `<div style="margin-top:1rem; padding-top:1rem; border-top:1px dashed #cbd5e1;"><h4 style="margin-bottom:0.5rem; color:#64748b;">Comprar a Externo (Añadir guardia)</h4><div style="display:flex; gap:8px; flex-wrap:wrap;">`;
        getAllUniqueServices().forEach(svc => { 
            html += `<button class="primary" style="flex:1; background:${getServiceColor(svc.nombre)}; font-size:0.8rem;" onclick="executeBuyRequest('${dk}', '${svc.nombre}', 'Externo')">+ ${svc.nombre}</button>`; 
        });
        html += `</div></div>`;
    }
  }
  html += `</div><div style="text-align:right; margin-top:1.5rem;"><button onclick="document.getElementById('mercado-modal').remove()">Cancelar</button></div></div>`;
  modal.innerHTML = html; document.body.appendChild(modal);
}

/** Reemplaza la zona dinámica del modal con el formulario de venta de guardia. */
function renderMercadoVender(dk, svc) {
    const res = getAllResidents().filter(r => r !== loggedInUser && canUserTakeShift(r, loggedInUser, dk, svc));
    document.getElementById('mercado-dynamic').innerHTML = `<h4 style="margin-bottom:1rem;">Vender guardia de ${svc}</h4><label style="font-size:0.85rem; color:#64748b;">¿A quién se la vendes?</label><select id="vender-to-user"><option value="">-- Selecciona --</option><option value="Externo">👽 Otro Residente (Externo)</option>${res.map(r => `<option value="${r}">${r}</option>`).join('')}</select><button class="primary" style="width:100%" onclick="executeSellRequest('${dk}', '${svc}')">Confirmar Venta</button>`; 
}
/** Crea y procesa un trade de tipo 'venta'; si es a Externo, se aprueba directamente. */
function executeSellRequest(dk, svc) { const target = document.getElementById('vender-to-user').value; if (!target) return alert("Selecciona a quién vender."); const trade = { id: Date.now(), type: 'venta', requester: loggedInUser, target: target, d1: dk, s1: svc, timestamp: new Date().toLocaleString('es-ES') }; let conflicts = checkTradeConflicts(trade); if (conflicts.length > 0) { if (!confirm("⚠️ ATENCIÓN: Conflictos:\n\n" + conflicts.join("\n") + "\n\n¿Proponer de todos modos?")) return; } if (target === 'Externo') { trade.status = 'approved'; alert("Venta a externo realizada."); } else { trade.status = 'pending'; alert(`Solicitud enviada a ${target}.`); } if(!state.trades) state.trades = []; state.trades.push(trade); saveState(); document.getElementById('mercado-modal').remove(); checkAutomaticGraduation();
    renderAll(); }



/** Crea y procesa un trade de tipo 'cambio' directo entre dos días/residentes. */
function executeSwapRequestDirect(myDk, mySvc, targetDk, targetSvc, targetUser) { const trade = { id: Date.now(), type: 'cambio', requester: loggedInUser, target: targetUser, d1: myDk, s1: mySvc, d2: targetDk, s2: targetSvc, timestamp: new Date().toLocaleString('es-ES') }; let conflicts = checkTradeConflicts(trade); if (conflicts.length > 0) { if (!confirm("⚠️ Conflictos:\n" + conflicts.join("\n") + "\n¿Proponer de todos modos?")) return; } if (targetUser === 'Externo') { trade.status = 'approved'; alert("Cambio con externo realizado."); } else { trade.status = 'pending'; alert(`Solicitud enviada a ${targetUser}.`); } if(!state.trades) state.trades = []; state.trades.push(trade); saveState(); document.getElementById('mercado-modal').remove(); checkAutomaticGraduation();
    renderAll(); }
/** Crea y procesa un trade de tipo 'compra'; si es de Externo, se aprueba directamente. */
function executeBuyRequest(dk, svc, targetUser) { if (targetUser !== 'Externo' && !confirm(`¿Comprar ${svc} a ${targetUser}?`)) return; if (targetUser === 'Externo' && !confirm(`¿Añadir guardia de ${svc} desde Externo?`)) return; const trade = { id: Date.now(), type: 'compra', requester: loggedInUser, target: targetUser, d1: dk, s1: svc, timestamp: new Date().toLocaleString('es-ES') }; let conflicts = checkTradeConflicts(trade); if (conflicts.length > 0) { if (!confirm("⚠️ Conflictos:\n" + conflicts.join("\n") + "\n¿Solicitar de todos modos?")) return; } if (targetUser === 'Externo') { trade.status = 'approved'; alert("Comprada a externo."); } else { trade.status = 'pending'; alert(`Solicitud enviada a ${targetUser}.`); } if(!state.trades) state.trades = []; state.trades.push(trade); saveState(); document.getElementById('mercado-modal').remove(); checkAutomaticGraduation();
    renderAll(); }
// ============================================================
// MÓDULO: ADMIN_AJUSTES
// Exportar a: src/modules/adminAjustes.js
// Líneas estimadas: ~440
// Dependencias externas: promoConfig, supabaseClient, currentUserProfile
// Helpers que usa: syncConfigFromUI, saveState, setStatus, renderAll, checkAutomaticGraduation, MONTHS
// ============================================================
/** Renderiza el formulario de ajustes de la promoción: planes, servicios, reglas y pernoctas. */
function renderAdminAjustes() {
  const container = document.getElementById('admin-config-container');
  let html = ``;

  if (!promoConfig.planes) promoConfig.planes = [];

  // ── Configuración general del contenedor (solo admin) ──
  html += `
  <div class="cfg-card" style="border-left:4px solid #7c3aed; margin-bottom:20px;">
    <h3 style="margin-bottom:0.75rem; color:#7c3aed;">⚙️ Configuración General</h3>
    <div style="display:flex; align-items:flex-end; gap:16px; flex-wrap:wrap;">
      <div>
        <label style="font-size:0.8rem; color:#64748b; display:block; margin-bottom:4px;">Duración ventana voluntaria (horas)</label>
        <input type="number" id="cfg-ventana-horas" value="${promoConfig.ventana_voluntaria_horas || 48}" min="24" max="48" style="margin:0; width:90px;">
      </div>
      <p style="font-size:0.78rem; color:#94a3b8; margin:0; flex:1; min-width:180px;">Tiempo disponible para reclamar voluntariamente una guardia desierta antes del forzamiento automático. Entre 24 y 48 horas.</p>
    </div>
  </div>`;

  promoConfig.planes.forEach((plan, pIdx) => {
    html += `
    <details style="background:#f1f5f9; border:2px solid #cbd5e1; border-radius:12px; padding:15px; margin-bottom:20px;"><summary style="font-weight:bold; cursor:pointer; font-size:1.1rem; color:var(--dark);">👉 Desplegar/Ocultar: ${plan.nombre}</summary><div style="margin-top: 15px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:2px solid #94a3b8; padding-bottom:10px; flex-wrap:wrap; gap:10px;">
            <input type="text" id="cfg-plan-nom-${pIdx}" value="${plan.nombre}" style="margin:0; font-size:1.2rem; font-weight:bold; color:var(--dark); border:1px solid transparent; background:transparent; max-width:250px;">
            <div style="display:flex; gap:8px;">
                <button class="primary icon-btn" style="background:var(--adu);" onclick="adminAddService(${pIdx})">+ Servicio al ${plan.nombre}</button>
                <button class="danger icon-btn" onclick="adminRemovePlan(${pIdx})">Borrar Plan</button>
            </div>
        </div>`;
    
    if (plan.servicios.length === 0) {
        html += `<p style="color:#64748b; font-size:0.85rem; font-style:italic; padding-bottom:10px;">No hay servicios en este plan.</p>`;
    }

    plan.servicios.forEach((svc, i) => {
        html += `
        <div class="cfg-card" id="cfg-card-${pIdx}-${i}" style="border-left: 4px solid ${svc.color || 'var(--dark)'};">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid #e2e8f0; padding-bottom:10px;">
             <input type="text" id="cfg-nom-${pIdx}-${i}" value="${svc.nombre}" style="margin:0; font-size:1.1rem; font-weight:bold; border:none; background:transparent; max-width:200px;">
             <button class="danger icon-btn" onclick="adminRemoveService(${pIdx}, ${i})">Borrar Servicio 🗑️</button>
          </div>
          
          <div style="display:flex; gap:15px; flex-wrap:wrap; margin-bottom:15px;">
             <div style="flex:1; min-width:120px;">
                <label style="font-size:0.8rem; color:#64748b; display:block; margin-bottom:4px;">Cupo total/mes</label>
                <input type="number" id="cfg-cupo-${pIdx}-${i}" value="${svc.cupoMensualTotal}" min="0" style="margin:0;">
             </div>
             <div style="flex:1; min-width:120px;">
                <label style="font-size:0.8rem; color:#64748b; display:block; margin-bottom:4px;">Plazas por día (0 = ilimitado)</label>
                <input type="number" id="cfg-plazas-${pIdx}-${i}" value="${svc.plazasPorDia}" min="0" style="margin:0;">
             </div>
				<div style="flex:1; min-width:80px; display:flex; flex-direction:column;">
                <label style="font-size:0.8rem; color:#64748b; margin-bottom:4px;">Color</label>
                <input type="color" id="cfg-col-${pIdx}-${i}" value="${svc.color}" 
                   onchange="syncConfigFromUI()" 
                   oninput="document.getElementById('cfg-card-${pIdx}-${i}').style.borderLeftColor = this.value" 
                   style="width:100%; height:38px; padding:0; cursor:pointer; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box;">
             </div>
             <div style="flex:1; min-width:120px;">
                <label style="font-size:0.8rem; color:#64748b; display:block; margin-bottom:4px; font-weight:bold;">Prioridad / Orden Subasta</label>
                <input type="number" id="cfg-prio-${pIdx}-${i}" value="${svc.ordenSubasta !== undefined ? svc.ordenSubasta : (i + 1)}" min="1" style="margin:0; border: 1px solid #3b82f6;">
             </div>
          </div>
          
           <div style="margin-bottom:15px; padding:10px; background:#f8fafc; border-radius:6px; border:1px dashed #cbd5e1;">
             <label style="font-size:0.85rem; font-weight:bold; display:flex; align-items:center; gap:8px;">
                <input type="checkbox" id="cfg-hab-${pIdx}-${i}" ${svc.requiereHabilitacion ? 'checked' : ''} style="width:auto; margin:0;">
                🔒 Requiere Habilitación Manual (Pintar en Calendario Admin)
             </label>
             <label style="font-size:0.85rem; font-weight:bold; display:flex; align-items:center; gap:8px; margin-top:8px;">
                <input type="checkbox" id="cfg-sec-${pIdx}-${i}" ${svc.dadasPorSecretaria ? 'checked' : ''} style="width:auto; margin:0;">
                👩‍💼 Guardias dadas por secretaría (NO obliga a elegir en mercadillo)
             </label>
           </div>
           
           <div style="margin-bottom:15px; padding:10px; background:#fff7ed; border-radius:6px; border:1px solid #fed7aa;">
             <label style="font-size:0.85rem; font-weight:bold; display:block; margin-bottom:6px; color:#9a3412;">🏛️ Subasta y Justicia Distributiva</label>
             <div style="margin-bottom: 8px;">
                 <label style="font-size:0.8rem; color:#9a3412; display:block; margin-bottom:4px;">Activar inyección forzosa para huecos desiertos en días de tipo:</label>
                 <div style="display:flex; gap:8px; flex-wrap:wrap;">
                     <label style="font-size:0.75rem;"><input type="checkbox" id="cfg-sub-lab-${pIdx}-${i}" ${(svc.subastaTrigger||[]).includes('laborable') ? 'checked' : ''}> Laborable</label>
                     <label style="font-size:0.75rem;"><input type="checkbox" id="cfg-sub-vis-${pIdx}-${i}" ${(svc.subastaTrigger||[]).includes('vispera') ? 'checked' : ''}> Víspera</label>
                     <label style="font-size:0.75rem;"><input type="checkbox" id="cfg-sub-fin-${pIdx}-${i}" ${(svc.subastaTrigger||[]).includes('fin_de_semana') ? 'checked' : ''}> Finde</label>
                     <label style="font-size:0.75rem;"><input type="checkbox" id="cfg-sub-fes-${pIdx}-${i}" ${(svc.subastaTrigger||[]).includes('festivo_intersemanal') ? 'checked' : ''}> Festivo Inter.</label>
                 </div>
             </div>
             <div style="margin-bottom:8px;">
                 <label style="font-size:0.8rem; color:#9a3412; display:block; margin-bottom:4px;">Criterio de reparto automático (quién recibe la guardia):</label>
                 <select id="cfg-sub-crit-${pIdx}-${i}" style="font-size:0.8rem; width:100%; border:1px solid #fdba74; border-radius:4px; padding:4px;" onchange="document.getElementById('cfg-sub-crit-svc-container-${pIdx}-${i}').style.display = (this.value === 'historico_servicio_dinamico') ? 'block' : 'none';">
                     <option value="historico_festivos" ${svc.subastaCriterio === 'historico_festivos' ? 'selected' : ''}>A quien tenga menos Festivos (Globales)</option>
                     <option value="historico_laborables" ${svc.subastaCriterio === 'historico_laborables' ? 'selected' : ''}>A quien tenga menos Laborables (Globales)</option>
                     <option value="historico_intersemanales" ${svc.subastaCriterio === 'historico_intersemanales' ? 'selected' : ''}>A quien tenga menos Fest. Intersemanales (Globales)</option>
                     <option value="historico_total" ${svc.subastaCriterio === 'historico_total' ? 'selected' : ''}>A quien tenga menos Guardias Totales (Globales)</option>
                     <option value="historico_servicio" ${svc.subastaCriterio === 'historico_servicio' ? 'selected' : ''}>A quien haya hecho menos guardias de éste servicio</option>
                     <option value="historico_servicio_dinamico" ${svc.subastaCriterio === 'historico_servicio_dinamico' ? 'selected' : ''}>A quien haya hecho menos guardias en (Servicio Específico)...</option>
                     <option value="aleatorio" ${svc.subastaCriterio === 'aleatorio' ? 'selected' : ''}>Aleatorio (Sorteo ciego)</option>
                 </select>
                 <div id="cfg-sub-crit-svc-container-${pIdx}-${i}" style="margin-top:4px; display:${svc.subastaCriterio === 'historico_servicio_dinamico' ? 'block' : 'none'};">
                     <select id="cfg-sub-crit-svc-${pIdx}-${i}" style="font-size:0.8rem; width:100%; border:1px dashed #fdba74; border-radius:4px; padding:4px;">
                         ${plan.servicios.map(s => `<option value="${s.nombre}" ${(svc.subastaCriterioServicio === s.nombre) ? 'selected' : ''}>${s.nombre}</option>`).join('')}
                     </select>
                 </div>
             </div>
             <div>
                 <label style="font-size:0.8rem; color:#9a3412; display:block; margin-bottom:4px;">Criterio secundario de Desempate (opcional):</label>
                 <select id="cfg-sub-desempate-${pIdx}-${i}" style="font-size:0.8rem; width:100%; border:1px solid #fdba74; border-radius:4px; padding:4px;" onchange="document.getElementById('cfg-sub-desempate-svc-container-${pIdx}-${i}').style.display = (this.value === 'historico_servicio_dinamico') ? 'block' : 'none';">
                     <option value="aleatorio" ${(!svc.subastaDesempate || svc.subastaDesempate === 'aleatorio') ? 'selected' : ''}>Aleatorio (Sorteo ciego)</option>
                     <option value="historico_total" ${svc.subastaDesempate === 'historico_total' ? 'selected' : ''}>A quien tenga menos Guardias Totales (Globales)</option>
                     <option value="historico_festivos" ${svc.subastaDesempate === 'historico_festivos' ? 'selected' : ''}>A quien tenga menos Festivos (Globales)</option>
                     <option value="historico_laborables" ${svc.subastaDesempate === 'historico_laborables' ? 'selected' : ''}>A quien tenga menos Laborables (Globales)</option>
                     <option value="historico_intersemanales" ${svc.subastaDesempate === 'historico_intersemanales' ? 'selected' : ''}>A quien tenga menos Fest. Intersemanales (Globales)</option>
                     <option value="historico_servicio" ${svc.subastaDesempate === 'historico_servicio' ? 'selected' : ''}>A quien haya hecho menos guardias de éste servicio</option>
                     <option value="historico_servicio_dinamico" ${svc.subastaDesempate === 'historico_servicio_dinamico' ? 'selected' : ''}>A quien haya hecho menos guardias en (Servicio Específico)...</option>
                 </select>
                 <div id="cfg-sub-desempate-svc-container-${pIdx}-${i}" style="margin-top:4px; display:${svc.subastaDesempate === 'historico_servicio_dinamico' ? 'block' : 'none'};">
                     <select id="cfg-sub-desempate-svc-${pIdx}-${i}" style="font-size:0.8rem; width:100%; border:1px dashed #fdba74; border-radius:4px; padding:4px;">
                         ${plan.servicios.map(s => `<option value="${s.nombre}" ${(svc.subastaDesempateServicio === s.nombre) ? 'selected' : ''}>${s.nombre}</option>`).join('')}
                     </select>
                 </div>
             </div>
           </div>

		  <div style="margin-bottom:15px; padding:10px; background:#f8fafc; border-radius:6px; border:1px dashed #cbd5e1;">
             <label style="font-size:0.85rem; font-weight:bold; display:block; margin-bottom:6px;">🤝 Reglas del Mercadillo (Intercambio)</label>
             <select id="cfg-intercambio-${pIdx}-${i}" style="margin:0; padding:6px; font-size:0.85rem; width:100%; border:1px solid #cbd5e1; border-radius:4px;">
                 <option value="superior" ${svc.reglaIntercambio === 'superior' ? 'selected' : ''}>Permitir intercambios entre el mismo año y superiores</option>
                 <option value="solo_mismo" ${svc.reglaIntercambio === 'solo_mismo' ? 'selected' : ''}>Bloquear intercambios SÓLO entre la misma promoción</option>
                 <option value="cualquiera" ${svc.reglaIntercambio === 'cualquiera' ? 'selected' : ''}>Permitir intercambios a todos sin restricción (PELIGRO)</option>
								 <option value="no_r1" ${svc.reglaIntercambio === 'no_r1' ? 'selected' : ''}>Permitir a todos EXCEPTO a los R1 (Protección de pequeños)</option>
             </select>
          </div>

			<div style="margin-bottom:15px; padding:10px; background:#f8fafc; border-radius:6px; border:1px dashed #cbd5e1;">
             <label style="font-size:0.85rem; font-weight:bold; display:block; margin-bottom:6px;">⏱️ Horas Computables por Guardia (Huelga)</label>
             <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <div style="flex:1; min-width:80px;"><label style="font-size:0.75rem; color:#64748b;">Laborable</label><input type="number" id="cfg-h-lab-${pIdx}-${i}" value="${svc.horas.laborable}" style="margin:0; padding:6px;"></div>
                <div style="flex:1; min-width:80px;"><label style="font-size:0.75rem; color:#64748b;">Viernes/Víspera</label><input type="number" id="cfg-h-vis-${pIdx}-${i}" value="${svc.horas.vispera}" style="margin:0; padding:6px;"></div>
                <div style="flex:1; min-width:80px;"><label style="font-size:0.75rem; color:#64748b;">Finde/Festivo</label><input type="number" id="cfg-h-fes-${pIdx}-${i}" value="${svc.horas.festivo}" style="margin:0; padding:6px;"></div>
             </div>
          </div>

          <div style="margin-bottom:15px;">
             <label style="font-size:0.85rem; font-weight:bold; display:block; margin-bottom:6px;">🌙 ¿Qué días generan saliente?</label>
             <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <label style="font-size:0.8rem; display:flex; align-items:center; gap:4px;"><input type="checkbox" id="cfg-sal-lab-${pIdx}-${i}" ${svc.pernocta.laborable ? 'checked' : ''} style="width:auto; margin:0;"> Laborable</label>
                <label style="font-size:0.8rem; display:flex; align-items:center; gap:4px;"><input type="checkbox" id="cfg-sal-vis-${pIdx}-${i}" ${svc.pernocta.vispera ? 'checked' : ''} style="width:auto; margin:0;"> Víspera/Vier</label>
                <label style="font-size:0.8rem; display:flex; align-items:center; gap:4px;"><input type="checkbox" id="cfg-sal-fin-${pIdx}-${i}" ${svc.pernocta.fin_de_semana ? 'checked' : ''} style="width:auto; margin:0;"> Finde</label>
                <label style="font-size:0.8rem; display:flex; align-items:center; gap:4px;"><input type="checkbox" id="cfg-sal-fes-${pIdx}-${i}" ${svc.pernocta.festivo_intersemanal ? 'checked' : ''} style="width:auto; margin:0;"> Festivo Inter.</label>
             </div>
          </div>
          
          <div>
             <label style="font-size:0.85rem; font-weight:bold; display:block; margin-bottom:6px;">🛡️ Reglas Obligatorias</label>
             <div id="cfg-rules-${pIdx}-${i}">`;
             
             svc.reglasObligatorias.forEach((rule, rIdx) => {
                 html += `
                 <div style="background:#fefce8; border:1px solid #fef08a; padding:10px; border-radius:6px; margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                       <span style="font-size:0.8rem; font-weight:bold; color:#854d0e;">Mínimo <input type="number" id="cfg-r-min-${pIdx}-${i}-${rIdx}" value="${rule.minimo}" style="width:50px; padding:2px; margin:0; text-align:center;"> guardias en:</span>
                       <button class="danger icon-btn" style="padding:2px 6px;" onclick="adminRemoveRule(${pIdx}, ${i}, ${rIdx})">X</button>
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
                       <button class="tag-btn ${rule.etiquetas.includes('laborable') ? 'active' : ''}" onclick="adminToggleRuleTag(${pIdx}, ${i}, ${rIdx}, 'laborable')">Laborable</button>
                       <button class="tag-btn ${rule.etiquetas.includes('vispera') ? 'active' : ''}" onclick="adminToggleRuleTag(${pIdx}, ${i}, ${rIdx}, 'vispera')">Víspera</button>
                       <button class="tag-btn ${rule.etiquetas.includes('fin_de_semana') ? 'active' : ''}" onclick="adminToggleRuleTag(${pIdx}, ${i}, ${rIdx}, 'fin_de_semana')">Finde</button>
                       <button class="tag-btn ${rule.etiquetas.includes('festivo_intersemanal') ? 'active' : ''}" onclick="adminToggleRuleTag(${pIdx}, ${i}, ${rIdx}, 'festivo_intersemanal')">Festivo</button>
                    </div>
                    <input type="text" id="cfg-r-msg-${pIdx}-${i}-${rIdx}" value="${rule.mensaje}" placeholder="Mensaje de error..." style="margin:0; font-size:0.8rem; padding:4px;">
                 </div>`;
             });

        html += `</div>
             <button class="primary icon-btn" style="background:#64748b; font-size:0.75rem;" onclick="adminAddRule(${pIdx}, ${i})">+ Añadir Regla</button>
          </div>
        </div>`;
    });
    
    // 🌍 UBICACIÓN INTEGRADA: Reglas Transversales del PLAN específico (dentro del bucle)
    html += `
    <div class="card" style="margin-top:1.5rem; margin-bottom:1rem; border: 2px solid var(--merc); background: #faf5ff;">
        <h3 style="color:var(--merc); margin-bottom:1rem; font-size:1.05rem;">🌍 Reglas Transversales de este Plan (Mes Completo)</h3>
        <div style="display:grid; gap:12px; grid-template-columns: 1fr 1fr;">
            <div>
                <label style="font-size:0.85rem; font-weight:bold;">🎯 Mínimo Festivos/Fines de Semana globales al mes:</label>
                <input type="number" id="cfg-plan-min-festivos-${pIdx}" value="${plan.minGlobalFestivos !== undefined ? plan.minGlobalFestivos : 1}" min="0" style="width:100%; margin-top:4px;">
            </div>
        </div>
    </div>`;

    html += `</div></details>`; // Fin del contenedor del plan específico
  });
	
  container.innerHTML = html;
}

/** Añade un nuevo plan vacío al final de promoConfig.planes y re-renderiza ajustes. */
function adminAddPlan() {
    syncConfigFromUI();
    let numPlanes = promoConfig.planes.length + 1;
    promoConfig.planes.push({ id: 'plan-' + Date.now(), nombre: `Plan R${numPlanes}`, servicios: [] });
    renderAdminAjustes();
}
/** Elimina el plan en la posición pIdx y todos sus servicios tras confirmación. */
function adminRemovePlan(pIdx) {
    if(!confirm("¿Seguro que quieres borrar este PLAN entero y todos sus servicios?")) return;
    syncConfigFromUI(); promoConfig.planes.splice(pIdx, 1); renderAdminAjustes();
}
	
/** Añade un servicio con valores por defecto al plan indicado y re-renderiza ajustes. */
function adminAddService(pIdx) {
  syncConfigFromUI();
  promoConfig.planes[pIdx].servicios.push({ 
      nombre: "Nuevo Servicio", cupoMensualTotal: 1, plazasPorDia: 1, color: "#94a3b8", 
      requiereHabilitacion: false, 
      dadasPorSecretaria: false,
      subastaTrigger: [],
      subastaCriterio: 'historico_festivos',
      pernocta: { laborable: true, vispera: true, fin_de_semana: false, festivo_intersemanal: false },
      horas: { laborable: 17, vispera: 17, festivo: 24 },
      reglasObligatorias: [],
      reglaIntercambio: 'superior'
  });
  renderAdminAjustes();
}
	
/** Elimina el servicio en posición i del plan pIdx tras confirmación. */
function adminRemoveService(pIdx, i) { if(!confirm("¿Borrar servicio?")) return; syncConfigFromUI(); promoConfig.planes[pIdx].servicios.splice(i, 1); renderAdminAjustes(); }

/** Añade una regla obligatoria vacía al servicio indicado. */
function adminAddRule(pIdx, svcIdx) {
    syncConfigFromUI();
    promoConfig.planes[pIdx].servicios[svcIdx].reglasObligatorias.push({ id: Date.now(), minimo: 1, etiquetas: [], mensaje: "Debes cumplir esta regla." });
    renderAdminAjustes();
}
/** Elimina la regla en ruleIdx del servicio dado. */
function adminRemoveRule(pIdx, svcIdx, ruleIdx) { syncConfigFromUI(); promoConfig.planes[pIdx].servicios[svcIdx].reglasObligatorias.splice(ruleIdx, 1); renderAdminAjustes(); }
/** Activa o desactiva una etiqueta ICS en la regla obligatoria indicada. */
function adminToggleRuleTag(pIdx, svcIdx, ruleIdx, tag) {
    syncConfigFromUI();
    let tags = promoConfig.planes[pIdx].servicios[svcIdx].reglasObligatorias[ruleIdx].etiquetas;
    if (tags.includes(tag)) tags.splice(tags.indexOf(tag), 1);
    else tags.push(tag);
    renderAdminAjustes();
}

/**
 * Lee todos los inputs del formulario de ajustes y los persiste en promoConfig en memoria.
 * Debe llamarse antes de cualquier guardado o exportación de configuración.
 */
function syncConfigFromUI() {
  if (!promoConfig) promoConfig = {};
  if (!promoConfig.planes) promoConfig.planes = [];

  // 0. Configuración general del contenedor
  const ventanaInput = document.getElementById('cfg-ventana-horas');
  if (ventanaInput) {
    const v = parseInt(ventanaInput.value) || 48;
    promoConfig.ventana_voluntaria_horas = Math.min(48, Math.max(24, v));
  }

  // 1. Recorremos cada plan configurado en la interfaz
  promoConfig.planes.forEach((plan, pIdx) => {
    // Sincronizar nombre del Plan
    const nomInput = document.getElementById(`cfg-plan-nom-${pIdx}`);
    if (nomInput) plan.nombre = nomInput.value;

    // 🌍 NUEVA CAPTURA INTEGRADA: Reglas Transversales por cada Plan específico
    const minFestivosInput = document.getElementById(`cfg-plan-min-festivos-${pIdx}`);
    const excesoModoSelect = document.getElementById(`cfg-plan-exceso-modo-${pIdx}`);
    
    if (minFestivosInput) {
        plan.minGlobalFestivos = parseInt(minFestivosInput.value) >= 0 ? parseInt(minFestivosInput.value) : 1;
    }
    if (excesoModoSelect) {
        plan.excesoModo = excesoModoSelect.value;
    }

    // 2. Recorremos los servicios que pertenecen a este plan concreto
    if (!plan.servicios) plan.servicios = [];
    plan.servicios.forEach((svc, i) => {
      const nomSvc = document.getElementById(`cfg-nom-${pIdx}-${i}`);
      if (nomSvc) svc.nombre = nomSvc.value;

      const cupoSvc = document.getElementById(`cfg-cupo-${pIdx}-${i}`);
      if (cupoSvc) svc.cupoMensualTotal = parseInt(cupoSvc.value) || 0;

      const plazasSvc = document.getElementById(`cfg-plazas-${pIdx}-${i}`);
      if (plazasSvc) svc.plazasPorDia = parseInt(plazasSvc.value) >= 0 ? parseInt(plazasSvc.value) : 1;

      const colSvc = document.getElementById(`cfg-col-${pIdx}-${i}`);
      if (colSvc) svc.color = colSvc.value;

      const habSvc = document.getElementById(`cfg-hab-${pIdx}-${i}`);
      if (habSvc) svc.requiereHabilitacion = habSvc.checked;
      
      const secSvc = document.getElementById(`cfg-sec-${pIdx}-${i}`);
      if (secSvc) svc.dadasPorSecretaria = secSvc.checked;

      const prioSvc = document.getElementById(`cfg-prio-${pIdx}-${i}`);
      if (prioSvc) svc.ordenSubasta = parseInt(prioSvc.value) || (i + 1);

      // NUEVO: Sincronizar Reglas de Subasta Bespoke
      svc.subastaTrigger = [];
      if (document.getElementById(`cfg-sub-lab-${pIdx}-${i}`)?.checked) svc.subastaTrigger.push('laborable');
      if (document.getElementById(`cfg-sub-vis-${pIdx}-${i}`)?.checked) svc.subastaTrigger.push('vispera');
      if (document.getElementById(`cfg-sub-fin-${pIdx}-${i}`)?.checked) svc.subastaTrigger.push('fin_de_semana');
      if (document.getElementById(`cfg-sub-fes-${pIdx}-${i}`)?.checked) svc.subastaTrigger.push('festivo_intersemanal');
      
      const subCrit = document.getElementById(`cfg-sub-crit-${pIdx}-${i}`);
      if (subCrit) svc.subastaCriterio = subCrit.value;
      const subCritSvc = document.getElementById(`cfg-sub-crit-svc-${pIdx}-${i}`);
      if (subCritSvc) svc.subastaCriterioServicio = subCritSvc.value;
      
      const subDes = document.getElementById(`cfg-sub-desempate-${pIdx}-${i}`);
      if (subDes) svc.subastaDesempate = subDes.value;
      const subDesSvc = document.getElementById(`cfg-sub-desempate-svc-${pIdx}-${i}`);
      if (subDesSvc) svc.subastaDesempateServicio = subDesSvc.value;
      const interSvc = document.getElementById(`cfg-intercambio-${pIdx}-${i}`);
      if (interSvc) svc.reglaIntercambio = interSvc.value;

    // Sincronizar la Matriz de Pernocta y Horas
      if (!svc.pernocta) svc.pernocta = {};
      const chkLab = document.getElementById(`cfg-sal-lab-${pIdx}-${i}`);
      const chkVis = document.getElementById(`cfg-sal-vis-${pIdx}-${i}`);
      const chkFin = document.getElementById(`cfg-sal-fin-${pIdx}-${i}`);
      const chkFes = document.getElementById(`cfg-sal-fes-${pIdx}-${i}`);

      if (chkLab) svc.pernocta.laborable = chkLab.checked;
      if (chkVis) svc.pernocta.vispera = chkVis.checked;
      if (chkFin) svc.pernocta.fin_de_semana = chkFin.checked;
      if (chkFes) svc.pernocta.festivo_intersemanal = chkFes.checked;

      if (!svc.horas) svc.horas = {};
      const hLab = document.getElementById(`cfg-h-lab-${pIdx}-${i}`);
      const hVis = document.getElementById(`cfg-h-vis-${pIdx}-${i}`);
      const hFes = document.getElementById(`cfg-h-fes-${pIdx}-${i}`);
      
      if (hLab) svc.horas.laborable = parseFloat(hLab.value) || 0;
      if (hVis) svc.horas.vispera = parseFloat(hVis.value) || 0;
      if (hFes) svc.horas.festivo = parseFloat(hFes.value) || 0;

      // Sincronizar las Reglas Obligatorias internas de este servicio
      if (!svc.reglasObligatorias) svc.reglasObligatorias = [];
      svc.reglasObligatorias.forEach((rule, rIdx) => {
        const minRule = document.getElementById(`cfg-r-min-${pIdx}-${i}-${rIdx}`);
        if (minRule) rule.minimo = parseInt(minRule.value) || 0;

        const msgRule = document.getElementById(`cfg-r-msg-${pIdx}-${i}-${rIdx}`);
        if (msgRule) rule.mensaje = msgRule.value;
      });
    });
  });
}

/** Genera y descarga un archivo .txt con el resumen de reglas y prioridades de subasta de todos los planes. */
function exportarReglasTexto() {
    if (!promoConfig || !promoConfig.planes || promoConfig.planes.length === 0) {
        alert("No hay planes configurados para exportar.");
        return;
    }
    
    syncConfigFromUI();
    
    let texto = "=========================================\n";
    texto += "   REGLAS Y PRIORIDADES DE SUBASTA\n";
    texto += "=========================================\n\n";
    
    const translateCriterio = (crit, svcName) => {
        if (!crit) return "No definido";
        switch(crit) {
            case 'historico_festivos': return "A quien tenga menos Festivos (Globales)";
            case 'historico_laborables': return "A quien tenga menos Laborables (Globales)";
            case 'historico_intersemanales': return "A quien tenga menos Fest. Intersemanales (Globales)";
            case 'historico_total': return "A quien tenga menos Guardias Totales (Globales)";
            case 'historico_servicio': return "A quien haya hecho menos guardias de éste servicio";
            case 'historico_servicio_dinamico': return `A quien haya hecho menos guardias en el servicio: ${svcName || 'No definido'}`;
            case 'aleatorio': return "Aleatorio (Sorteo ciego)";
            default: return crit;
        }
    };
    
    promoConfig.planes.forEach(plan => {
        texto += `--- PLAN: ${plan.nombre || 'Sin nombre'} ---\n`;
        texto += `Mínimo de Festivos Globales exigido al mes: ${plan.minGlobalFestivos}\n\n`;
        
        if (!plan.servicios || plan.servicios.length === 0) {
            texto += "  No hay servicios configurados.\n\n";
            return;
        }
        
        const serviciosOrdenados = [...plan.servicios].sort((a, b) => (a.ordenSubasta || 0) - (b.ordenSubasta || 0));
        
        serviciosOrdenados.forEach((svc, index) => {
            texto += `  Prioridad ${index + 1} (Orden numérico: ${svc.ordenSubasta || (index+1)}) -> SERVICIO: ${svc.nombre}\n`;
            texto += `    - Cupo exigido por mes: ${svc.cupoMensualTotal || 0} guardias\n`;
            texto += `    - Slots por día por defecto: ${svc.plazasPorDia || 0} residente(s)\n`;
            
            let triggers = (svc.subastaTrigger || []).join(", ");
            if (triggers === "") triggers = "Ninguno (No lanza subasta)";
            texto += `    - Días en los que se lanza subasta: ${triggers}\n`;
            
            if (svc.subastaTrigger && svc.subastaTrigger.length > 0) {
                texto += `    - CRITERIO PRINCIPAL: ${translateCriterio(svc.subastaCriterio, svc.subastaCriterioServicio)}\n`;
                if (svc.subastaDesempate && svc.subastaDesempate !== 'aleatorio') {
                    texto += `    - CRITERIO DESEMPATE: ${translateCriterio(svc.subastaDesempate, svc.subastaDesempateServicio)}\n`;
                }
            }
            texto += "\n";
        });
        
        texto += "-----------------------------------------\n\n";
    });
    
    const blob = new Blob([texto], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Reglas_Subastas_GestionGuardias.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/** Sincroniza promoConfig desde la UI y lo persiste en Supabase (tabla promociones). */
async function adminSaveConfig() {
  syncConfigFromUI();
  setStatus('Guardando ajustes...');
  try {
      const { error } = await supabaseClient.from('promociones').update({ configuracion: promoConfig }).eq('id', currentUserProfile.promocion_id);
      if (error) throw error;
      
      alert("Planes de guardia guardados en la nube correctamente."); 
      setStatus('Sincronizado ✅'); 
      
      // Actualizamos el parche temporal para que el calendario no falle
      if (promoConfig.planes && promoConfig.planes.length > 0) {
          promoConfig.servicios = promoConfig.planes[0].servicios;
      }
      
      checkAutomaticGraduation();
    renderAll(); 
  } catch (err) {
      console.error("Error al guardar admin config:", err);
      setStatus('Error ❌', true); 
      alert("Error al guardar: La conexión ha fallado.");
  }
}

// ============================================================
// MÓDULO: EXPORTACION
// Exportar a: src/modules/exportacion.js
// Líneas estimadas: ~195
// Dependencias externas: state.shifts, state.trades, state.planRotations, promoConfig, XLSX
// Helpers que usa: getComputedShifts, getAllResidents, getDaysInMonth, formatDateKey, MONTHS, getRotationKey
// ============================================================
/** Abre el modal de exportación y rellena los selectores de plan, servicio y período disponibles. */
function openExportModal() {
    if (!promoConfig || !promoConfig.planes || promoConfig.planes.length === 0) {
        alert("No hay ningún Plan de Guardias configurado.");
        return;
    }
    
    // 1. Llenar Planes
    const planSel = document.getElementById('exp-plan');
    planSel.innerHTML = '';
    promoConfig.planes.forEach(p => {
        planSel.innerHTML += `<option value="${p.nombre}">${p.nombre}</option>`;
    });
    
    // 2. Llenar Servicios
    updateExportServices();
    
    // 3. Llenar Meses (buscando en el historial de shifts guardado o en los 12 meses)
    const periodSel = document.getElementById('exp-period');
    periodSel.innerHTML = '<option value="ALL">Todo el Histórico Disponible</option>';
    
    // Recopilar meses únicos del state.shifts
    let uniqueMonths = new Set();
    if (state.shifts) {
        for (let dk in state.shifts) {
            uniqueMonths.add(dk.substring(0, 7)); // "2024_01"
        }
    }
    let sortedMonths = Array.from(uniqueMonths).sort().reverse(); // Más recientes primero
    sortedMonths.forEach(mStr => {
        const [y, m] = mStr.split('_');
        periodSel.innerHTML += `<option value="${mStr}">${MONTHS[parseInt(m) - 1]} ${y}</option>`;
    });

    document.getElementById('export-modal').style.display = 'flex';
}

/** Actualiza el selector de servicios del modal de exportación al cambiar el plan seleccionado. */
function updateExportServices() {
    const planName = document.getElementById('exp-plan').value;
    const plan = promoConfig.planes.find(p => p.nombre === planName);
    const svcSel = document.getElementById('exp-svc');
    
    svcSel.innerHTML = '<option value="ALL">Todos los servicios del Plan</option>';
    if (plan && plan.servicios) {
        plan.servicios.forEach(s => {
            svcSel.innerHTML += `<option value="${s.nombre}">${s.nombre}</option>`;
        });
    }
}

/**
 * Genera y descarga un archivo Excel (.xlsx) con las guardias del plan/servicio/período seleccionados.
 * Soporta exportación de turnos originales o con trades del mercadillo aplicados.
 */
function executeExport() {
    const planName = document.getElementById('exp-plan').value;
    const svcName = document.getElementById('exp-svc').value;
    const period = document.getElementById('exp-period').value;
    const isMercado = document.getElementById('exp-type').value === 'merc';
    
    const plan = promoConfig.planes.find(p => p.nombre === planName);
    if (!plan) return;

    const shiftsToUse = isMercado ? getComputedShifts() : state.shifts;
    const suffix = isMercado ? "Mercadillo" : "Original";
    
    // Averiguar qué residentes pertenecen al plan usando state.planRotations como fuente de verdad
    const _residentesDePlan = new Set();
    if (state.planRotations?.[planName]) {
        (state.planRotations[planName].baseGroups || []).flat().forEach(n => _residentesDePlan.add(n));
    }
    const residents = getAllResidents().filter(u => {
        if (_residentesDePlan.has(u)) return true;
        // Fallback: si no aparece en ningún planRotations, asignar al primer plan
        const enAlgunPlan = state.planRotations && Object.values(state.planRotations).some(pr => (pr.baseGroups || []).flat().includes(u));
        if (!enAlgunPlan) return planName === promoConfig.planes[0].nombre;
        return false;
    });

    if (residents.length === 0) {
        alert("No se han encontrado residentes asignados a este Plan de Guardias.");
        return;
    }

    const wb = XLSX.utils.book_new();
    const STYLE_FESTIVO = { fill: { fgColor: { rgb: "FEE2E2" } }, font: { color: { rgb: "EF4444" }, bold: true } };

    // Determinar qué meses exportar
    let monthsToExport = [];
    if (period === 'ALL') {
        let uniqueMonths = new Set();
        if (shiftsToUse) {
            for (let dk in shiftsToUse) uniqueMonths.add(dk.substring(0, 7));
        }
        monthsToExport = Array.from(uniqueMonths).sort();
    } else {
        monthsToExport = [period];
    }

    if (monthsToExport.length === 0) {
        alert("No hay datos de guardias para exportar.");
        return;
    }

    monthsToExport.forEach(mStr => {
        const [yStr, mStrIdx] = mStr.split('_');
        const y = parseInt(yStr, 10), m = parseInt(mStrIdx, 10) - 1;
        const days = getDaysInMonth(y, m);
        const sheetName = `${MONTHS[m].substring(0,3)} ${y}`;

        // Construir la tabla de este mes
        const dataGlobal = []; 
        const hGlobal = ["Residente"];
        
        // Determinar qué servicios mostrar
        let targetServices = svcName === 'ALL' ? plan.servicios.map(s => s.nombre) : [svcName];
        
        // Cabecera de días
        for (let d = 1; d <= days; d++) hGlobal.push(`${d}`);
        hGlobal.push("Total");
        dataGlobal.push(hGlobal);

        residents.forEach(user => { 
            const row = [user]; let total = 0; 
            for(let d=1; d<=days; d++) { 
                const ds = shiftsToUse[formatDateKey(y, m, d)] || {}; 
                let mySvc = ds[user];
                if (!mySvc && isMercado) { 
                    const vre = Object.keys(ds).find(k => k.startsWith('VRE_') && ds[k]); 
                    if(vre && targetServices.includes(ds[vre])) mySvc = ds[vre]; 
                }
                
                if (mySvc && targetServices.includes(mySvc)) {
                    total++; 
                    row.push(mySvc.substring(0,3).toUpperCase()); 
                } else {
                    row.push(""); 
                }
            } 
            row.push(total); dataGlobal.push(row); 
        });

        const ws = XLSX.utils.aoa_to_sheet(dataGlobal); 
        for(let d=1; d<=days; d++) { 
            if (state.festivos && state.festivos[formatDateKey(y, m, d)]) { 
                for (let r = 0; r <= residents.length; r++) { 
                    const cell = ws[XLSX.utils.encode_cell({r: r, c: d})]; 
                    if (cell) cell.s = STYLE_FESTIVO; 
                } 
            } 
        }
        
        // Solo añadimos la hoja si hay residentes (ya filtrados arriba)
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    let filename = `Guardias_${planName}_${svcName === 'ALL' ? 'Todos' : svcName}_${suffix}.xlsx`;
    XLSX.writeFile(wb, filename);
    document.getElementById('export-modal').style.display = 'none';
}

// ============================================================
// MÓDULO: ADMIN_CALENDARIO
// Exportar a: src/modules/adminCalendario.js
// Líneas estimadas: ~155
// Dependencias externas: state.festivos, state.habilitaciones, state.pedWhitelist, promoConfig, curDate
// Helpers que usa: getFirstDayOffset, getDaysInMonth, formatDateKey, getCellBackgroundStyle, isServiceEnabledOnDate, getPlazasForDay, saveState, renderAdminCalendar, setStatus, supabaseClient
// ============================================================
/**
 * Renderiza el calendario de administración: grid mensual con controles de festivos,
 * habilitaciones de servicios por día y whitelist de PEDs.
 */
function renderAdminCalendar() {
    const grid = document.getElementById('admin-cal-body');
    grid.innerHTML = '';
    const y = curDate.getFullYear(), m = curDate.getMonth();
    
    const selectTool = document.getElementById('admin-paint-tool');
    let currentVal = selectTool.value;
    
    // NUEVO: Filtro por Nivel/Año
    if (!document.getElementById('admin-level-filter')) {
        const filterHtml = `<select id="admin-level-filter" style="margin-right:10px; padding:6px; border-radius:6px; border:1px solid #cbd5e1;" onchange="renderAdminCalendar()">
            <option value="ALL">Todos los Niveles</option>
            ${(promoConfig.planes || []).map(p => `<option value="${p.nombre}">${p.nombre}</option>`).join('')}
        </select>`;
        selectTool.insertAdjacentHTML('beforebegin', filterHtml);
    }
    const levelFilter = document.getElementById('admin-level-filter').value;

    // 1. Construcción dinámica del desplegable
    let optionsHtml = `<option value="festivos">🔴 Pintar Festivos Oficiales</option>`;
    
    if (promoConfig.planes) {
        promoConfig.planes.forEach(plan => {
            if (levelFilter !== 'ALL' && plan.nombre !== levelFilter) return;
            if (plan.servicios) {
                plan.servicios.forEach(svc => {
                    if (svc.requiereHabilitacion) {
                        const optionValue = `svc_${svc.nombre}_${plan.nombre}`;
                        optionsHtml += `<option value="${optionValue}">🛡️ Habilitar: ${svc.nombre} (${plan.nombre})</option>`;
                    }
                });
            }
        });
    }
    
    selectTool.innerHTML = optionsHtml;
    if (currentVal && selectTool.querySelector(`option[value="${currentVal}"]`)) {
        selectTool.value = currentVal;
    } else {
        currentVal = 'festivos';
        selectTool.value = 'festivos';
    }
    selectTool.onchange = renderAdminCalendar; // Hacer reactivo al cambiar de pincel

    
    // 2. Pintado del calendario
    for(let i=0; i<getFirstDayOffset(y,m); i++) grid.innerHTML += `<div class="cal-cell empty"></div>`;
    
    for(let d=1; d<=getDaysInMonth(y,m); d++) {
        const dateKey = formatDateKey(y, m, d);
        const cell = document.createElement('div');
        cell.className = 'cal-cell';
        cell.innerHTML = `<div class="day-number">${d}</div>`;
        
        const levelFilter = document.getElementById('admin-level-filter') ? document.getElementById('admin-level-filter').value : 'ALL';
        const bgStyle = getCellBackgroundStyle(dateKey, y, m, d, levelFilter);
        if (bgStyle) {
            const existingStyle = cell.getAttribute("style") || "";
            cell.setAttribute("style", existingStyle + (existingStyle.endsWith(';') ? '' : ';') + bgStyle);
        }
        
        // Lógica de habilitación
        if (currentVal.startsWith('svc_')) {
            const parts = currentVal.replace('svc_', '').split('_');
            const svcName = parts[0]; 
            const planName = parts[1];
            
            const isEnabled = isServiceEnabledOnDate(svcName, dateKey, planName);
            
            const targetPlan = promoConfig.planes.find(p => p.nombre === planName);
            const targetSvc = targetPlan ? targetPlan.servicios.find(s => s.nombre === svcName) : null;
            const colorHex = targetSvc ? targetSvc.color : '#fde047';
            
            if (isEnabled && targetSvc) {
                let pd = getPlazasForDay(targetSvc, dateKey);
                let dayShifts = state.shifts && state.shifts[dateKey] ? Object.keys(state.shifts[dateKey]).filter(u => state.shifts[dateKey][u] === svcName).length : 0;
                cell.innerHTML += `<div style="font-size:0.65rem; background:rgba(255,255,255,0.7); border-radius:3px; padding:1px 3px; display:inline-block; position:absolute; bottom:2px; right:2px;">${dayShifts}${pd > 0 ? '/' + pd : ''}</div>`;
                cell.style.position = 'relative';
            }

            let longPressTimer;
            const clearTimer = () => clearTimeout(longPressTimer);
            
            cell.onmousedown = (e) => {
                // Ignore right click
                if (e.button !== 0) return;
                
                longPressTimer = setTimeout(() => {
                    // LONG PRESS: Custom value
                    if (!state.habilitaciones) state.habilitaciones = {};
                    if (!state.habilitaciones[dateKey]) state.habilitaciones[dateKey] = {};
                    
                    const current = state.habilitaciones[dateKey][svcName];
                    let num = prompt("Introduce el número de plazas PERSONALIZADO para este día (o 0 para ilimitado, o deja vacío para cancelar):", typeof current === 'number' ? current : (targetSvc ? targetSvc.plazasPorDia : 1));
                    if (num === null || num.trim() === '') return;
                    
                    let parsed = parseInt(num, 10);
                    if (!isNaN(parsed) && parsed >= 0) {
                        state.habilitaciones[dateKey][svcName] = parsed;
                    }
                    
                    if (svcName === 'Pediatría') state.pedWhitelist[dateKey] = state.habilitaciones[dateKey][svcName] !== false;
                    
                    saveState(); 
                    renderAdminCalendar();
                }, 600);
            };
            
            cell.onmouseup = (e) => {
                if (e.button !== 0) return;
                clearTimer();
            };
            
            cell.onmouseleave = clearTimer;
            cell.ondragstart = clearTimer;

            cell.onclick = (e) => {
                if (e.detail === 0) return; // sometimes triggered by long press cancel
                
                if (!state.habilitaciones) state.habilitaciones = {};
                if (!state.habilitaciones[dateKey]) state.habilitaciones[dateKey] = {};
                
                const actual = state.habilitaciones[dateKey][svcName];
                const currentlyEnabled = actual !== undefined && actual !== false;
                
                state.habilitaciones[dateKey][svcName] = currentlyEnabled ? false : (targetSvc ? targetSvc.plazasPorDia : 1);
                
                if (svcName === 'Pediatría') state.pedWhitelist[dateKey] = !!state.habilitaciones[dateKey][svcName];
                
                saveState(); 
                renderAdminCalendar(); 
            };
        } else if (currentVal === 'festivos') {
            cell.onclick = () => {
                state.festivos[dateKey] = !state.festivos[dateKey];
                saveState(); 
                renderAdminCalendar();
            };
        }
        grid.appendChild(cell);
    }
}

// ============================================================
// MÓDULO: ADMIN_EXCEPCIONES
// Exportar a: src/modules/adminExcepciones.js
// Líneas estimadas: ~60
// Dependencias externas: state.pendingExceptions, state.exceptionLogs, state.exceptionReasons, state.skippedTurns
// Helpers que usa: getRotationKey, getDaysInMonth, formatDateKey, saveState, renderAdminExceptions, renderAll, checkAutomaticGraduation, MONTHS
// ============================================================

/** Renderiza el panel de excepciones: solicitudes pendientes, motivos configurados y log histórico. */
function renderAdminExceptions() {
  const y = curDate.getFullYear(), m = curDate.getMonth(); const monthKey = getRotationKey(y, m);
  const pendList = document.getElementById('admin-pending-list'); const pendings = state.pendingExceptions && state.pendingExceptions[monthKey] ? state.pendingExceptions[monthKey] : {};
  let pendHtml = '';
  for (const [u, reason] of Object.entries(pendings)) { pendHtml += `<div style="background:white; border:1px solid #cbd5e1; padding:10px; border-radius:8px; margin-bottom:8px;"><div style="font-weight:bold; margin-bottom:4px; color:var(--dark);">👤 Residente: ${u}</div><div style="font-size:0.85rem; color:#475569; margin-bottom:10px; background:#f1f5f9; padding:6px; border-radius:4px; border-left:3px solid var(--fest);">"${reason}"</div><div style="display:flex; gap:8px;"><button class="primary" style="padding:4px 10px; font-size:0.8rem; background:var(--ped);" onclick="adminApproveException('${u}', '${monthKey}')">✅ Validar y Saltar</button><button class="danger" style="padding:4px 10px; font-size:0.8rem;" onclick="adminRejectException('${u}', '${monthKey}')">❌ Rechazar</button></div></div>`; }
  if (!pendHtml) pendHtml = '<p style="font-size:0.85rem; color:#64748b;">No hay solicitudes pendientes.</p>'; pendList.innerHTML = pendHtml;
  const rList = document.getElementById('admin-reasons-list'); rList.innerHTML = (state.exceptionReasons || []).map((r, i) => `<div class="editor-row" style="justify-content:space-between; border-bottom:1px solid #e2e8f0; padding:6px 0;"><span style="color:#475569; font-size:0.9rem;">${r}</span><button class="danger icon-btn" style="padding:2px 6px; font-size:0.8rem;" onclick="adminRemoveExceptionReason(${i})">Borrar</button></div>`).join('');
  const lList = document.getElementById('admin-logs-list'); if (!state.exceptionLogs || state.exceptionLogs.length === 0) { lList.innerHTML = "<p style='font-size:0.85rem; color:#64748b;'>Sin registros.</p>"; } else { lList.innerHTML = state.exceptionLogs.slice().reverse().map((l, revIdx) => { const origIdx = state.exceptionLogs.length - 1 - revIdx; return `<div style="background:#f1f5f9; padding:10px; border-radius:8px; margin-bottom:8px; font-size:0.85rem; border:1px solid #e2e8f0;"><div style="display:flex; justify-content:space-between; margin-bottom:4px;"><strong>👤 ${l.user}</strong><div><span style="color:#94a3b8; font-size:0.75rem; margin-right:8px;">🗓️ ${l.timestamp}</span><button class="danger icon-btn" style="padding:2px 6px; font-size:0.7rem;" onclick="adminDeleteLog(${origIdx})">Borrar</button></div></div><div>Mes: <b>${l.monthStr}</b></div><div style="color:var(--fest);">Motivo: <b>${l.reason}</b></div><div style="color:#475569; font-style:italic;">Retenidas: ${l.shiftsSummary}</div></div>`}).join(''); }
}
/** Elimina una entrada del log de excepciones por su índice. */
async function adminDeleteLog(idx) { if (!confirm("¿Borrar?")) return; state.exceptionLogs.splice(idx, 1); await saveState(); renderAdminExceptions(); }
/** Valida la solicitud de excepción del residente y le salta el turno automáticamente. */
async function adminApproveException(u, monthKey) { if(!confirm(`¿Validar?`)) return; const reason = state.pendingExceptions[monthKey][u]; const [yStr, mStr] = monthKey.split('_'); const y = parseInt(yStr, 10), m = parseInt(mStr, 10); let chosenShifts = []; for(let d=1; d<=getDaysInMonth(y, m); d++) { const dk = formatDateKey(y, m, d); if (state.shifts[dk] && state.shifts[dk][u]) chosenShifts.push(`Día ${d} (${state.shifts[dk][u]})`); } const shiftsSummary = chosenShifts.length > 0 ? chosenShifts.join(', ') : 'Ninguna'; if (!state.exceptionLogs) state.exceptionLogs = []; state.exceptionLogs.push({ user: u, monthStr: `${MONTHS[m]} ${y}`, reason: `(Validado) Otros: ${reason}`, shiftsSummary: shiftsSummary, timestamp: new Date().toLocaleString('es-ES') }); if (!state.skippedTurns[monthKey]) state.skippedTurns[monthKey] = []; if (!state.skippedTurns[monthKey].includes(u)) state.skippedTurns[monthKey].push(u); delete state.pendingExceptions[monthKey][u]; await saveState(); checkAutomaticGraduation();
    renderAll(); }
/** Rechaza la solicitud de excepción y devuelve el turno al residente. */
async function adminRejectException(u, monthKey) { if(!confirm(`¿Rechazar?`)) return; delete state.pendingExceptions[monthKey][u]; await saveState(); checkAutomaticGraduation();
    renderAll(); }
/** Añade un motivo de excepción a la lista configurable de la promoción. */
async function adminAddExceptionReason() { const v = document.getElementById('new-reason-input').value.trim(); if (!v) return; if (!state.exceptionReasons) state.exceptionReasons = []; state.exceptionReasons.push(v); document.getElementById('new-reason-input').value = ''; await saveState(); renderAdminExceptions(); }
/** Elimina un motivo de excepción de la lista por índice. */
async function adminRemoveExceptionReason(idx) { if (!confirm("¿Borrar?")) return; state.exceptionReasons.splice(idx, 1); await saveState(); renderAdminExceptions(); }

/** Renderiza la tabla de horas por residente (mes actual, año, histórico) en el panel admin. */
function renderAdminHoras() {
    const y = curDate.getFullYear(), m = curDate.getMonth();
    const residentes = (globalProfiles || [])
        .filter(p => p.estado === 'aprobado')
        .map(p => {
            const res = calcHorasResidente(p.nombre_mostrar, y, m);
            return { nombre: p.nombre_mostrar, ...res };
        })
        .sort((a, b) => b.horasMes - a.horasMes);

    let tablaHtml = '';
    if (residentes.length > 0) {
        const filas = residentes.map(r =>
            `<tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:10px 12px; font-weight:bold; color:var(--dark);">${r.nombre}</td>
                <td style="padding:10px 12px; text-align:right; font-weight:bold;">${r.horasMes.toFixed(1)} h</td>
                <td style="padding:10px 12px; text-align:right; color:#475569;">${r.completasMes} / ${r.partidasMes}</td>
                <td style="padding:10px 12px; text-align:right; color:#475569;">${r.horasAnio.toFixed(1)} h</td>
                <td style="padding:10px 12px; text-align:right; color:#94a3b8;">${r.horasTotal.toFixed(1)} h</td>
            </tr>`).join('');
        tablaHtml = `<div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                <thead>
                    <tr style="background:#f1f5f9;">
                        <th style="padding:10px 12px; font-size:0.78rem; color:#64748b; font-weight:600; border-bottom:2px solid #e2e8f0; text-align:left;">RESIDENTE</th>
                        <th style="padding:10px 12px; font-size:0.78rem; color:#64748b; font-weight:600; border-bottom:2px solid #e2e8f0; text-align:right;">HORAS MES</th>
                        <th style="padding:10px 12px; font-size:0.78rem; color:#64748b; font-weight:600; border-bottom:2px solid #e2e8f0; text-align:right;">COMPLETAS / PARTIDAS</th>
                        <th style="padding:10px 12px; font-size:0.78rem; color:#64748b; font-weight:600; border-bottom:2px solid #e2e8f0; text-align:right;">TOTAL ${y}</th>
                        <th style="padding:10px 12px; font-size:0.78rem; color:#64748b; font-weight:600; border-bottom:2px solid #e2e8f0; text-align:right;">HISTÓRICO</th>
                    </tr>
                </thead>
                <tbody>${filas}</tbody>
            </table>
        </div>`;
    } else {
        tablaHtml = '<p style="color:#94a3b8; font-style:italic;">No hay residentes aprobados.</p>';
    }
    const _elHoras = document.getElementById('aview-horas');
    if (!_elHoras) return;
    _elHoras.innerHTML =
        `<h3 style="margin-bottom:16px; font-size:1.1rem; color:var(--dark);">⏱️ Horas por Residente — ${MONTHS[m]} ${y}</h3>${tablaHtml}`;
}

/** Restaura todos los turnos saltados del mes, devolviendo al grupo su turno natural. */
async function adminResetSkips(y, m) { const monthKey = getRotationKey(y, m); if (state.skippedTurns[monthKey]) { delete state.skippedTurns[monthKey]; await saveState(); checkAutomaticGraduation();
    renderAll(); } }
/** Borra todas las guardias, skips, subastas y excepciones del mes. Acción destructiva con confirmación. */
async function adminResetMonth(y, m) { if (!confirm(`¡PELIGRO! ¿Borrar todas las guardias de este mes?`)) return; const days = getDaysInMonth(y, m); for(let d = 1; d <= days; d++) { const dk = formatDateKey(y, m, d); delete state.shifts[dk]; } const monthKey = getRotationKey(y, m); delete state.skippedTurns[monthKey]; if (state.pendingExceptions && state.pendingExceptions[monthKey]) delete state.pendingExceptions[monthKey]; if (state.configMes && state.configMes[monthKey]) delete state.configMes[monthKey]; if (state.subastasCerradasForzosas) { Object.keys(state.subastasCerradasForzosas).forEach(k => { if (k.startsWith(`${y}_${m}_`)) delete state.subastasCerradasForzosas[k]; }); } if (state.subastaNominados) { Object.keys(state.subastaNominados).forEach(k => { if (k.startsWith(`${y}_${m}_`)) delete state.subastaNominados[k]; }); } await saveState(); checkAutomaticGraduation();
    renderAll(); }
/**
 * Expulsa a todos los residentes no-admin de la promoción y limpia el estado del calendario completo.
 * Mantiene las reglas de promoConfig. Requiere confirmación doble con texto "VACIAR".
 */
async function adminVaciarGeneracion() {
    if (!confirm("⚠️ ATENCIÓN: Vas a expulsar a todos los residentes normales y borrar todas las guardias y calendarios. Las reglas se mantendrán. ¿Estás seguro?")) return;
    if (prompt("Escribe VACIAR en mayúsculas para confirmar:") !== "VACIAR") return;

    setStatus('Vaciando contenedor...');

    // 1. Expulsamos de la promoción a todos los usuarios que NO sean administradores
    const { error: errPerfiles } = await supabaseClient
        .from('perfiles')
        .update({ promocion_id: null, estado: 'pendiente' })
        .eq('promocion_id', currentUserProfile.promocion_id)
        .neq('rol', 'admin');

    if (errPerfiles) return alert("Error al expulsar usuarios: " + errPerfiles.message);

    // 2. Limpiamos por completo el estado del calendario (mantenemos vacío o por defecto)
    state.shifts = {};
    state.customRotations = {};
    state.pedWhitelist = {};
    state.festivos = {};
    state.skippedTurns = {};
    state.exceptionLogs = [];
    state.pendingExceptions = {};
    state.trades = [];
    state.subastasCerradasForzosas = {};
    state.subastaNominados = {};

    // 3. Reseteamos la rotación para que solo quede el Admin actual
    const _vacPlanName = promoConfig.planes?.[0]?.nombre || "Plan Base";
    state.planRotations = {};
    state.planRotations[_vacPlanName] = {
        baseGroups: [[currentUserProfile.nombre_mostrar]],
        baseYear: curDate.getFullYear(),
        baseMonth: curDate.getMonth(),
        customRotations: {},
        residentesFijos: []
    };
    state.baseGroups = [[currentUserProfile.nombre_mostrar]]; // compat
    state.baseMonth = curDate.getMonth();
    state.baseYear = curDate.getFullYear();

    // Guardamos el estado limpio en la nube
    await saveState();
    
    alert("Contenedor vaciado con éxito. Listo para la nueva generación.");
    window.location.reload();
}
/** Borra permanentemente toda la promoción de Supabase. Requiere confirmación doble con texto "BORRAR". */
async function adminDeletePromotion() { if (!confirm("⚠️ ¡ALERTA ROJA! ⚠️\nEstás a punto de borrar TODA la promoción y sus calendarios.\nNO se puede deshacer.")) return; if (prompt("Escribe BORRAR en mayúsculas para confirmar:") !== "BORRAR") return; setStatus('Destruyendo grupo...'); const { error } = await supabaseClient.from('promociones').delete().eq('id', currentUserProfile.promocion_id); if (error) alert("Error: " + error.message); else window.location.reload(); }

/** Actualiza el buzón de solicitudes entrantes y el historial de operaciones del Mercadillo. */
function renderMercadoInboxAndLog() {
  if (!loggedInUser) return; const inb = document.getElementById('merc-inbox'); const log = document.getElementById('merc-log'); let myInbox = (state.trades || []).filter(t => (t.status === 'pending' && t.target === loggedInUser) || (t.status === 'undo_pending' && t.undoRequester !== loggedInUser && (t.requester === loggedInUser || t.target === loggedInUser))); if (myInbox.length === 0) inb.innerHTML = `<span style="font-size:0.85rem; color:#94a3b8;">No tienes solicitudes pendientes.</span>`; else { inb.innerHTML = myInbox.map(t => { let desc = ""; if (t.status === 'undo_pending') desc = `⚠️ <b>${t.undoRequester}</b> quiere DESHACER la operación del ${t.timestamp}.`; else if (t.type === 'venta') desc = `💵 <b>${t.requester}</b> te quiere VENDER su guardia de ${t.s1} (${formatDK(t.d1)}).`; else if (t.type === 'compra') desc = `🛒 <b>${t.requester}</b> te quiere COMPRAR tu guardia de ${t.s1} (${formatDK(t.d1)}).`; else if (t.type === 'cambio') desc = `🔄 <b>${t.requester}</b> quiere CAMBIAR su ${t.s1} (${formatDK(t.d1)}) por tu ${t.s2} (${formatDK(t.d2)}).`; return `<div class="trade-row" style="border-left:3px solid var(--merc);"><div>${desc}</div><div style="display:flex; gap:8px;"><button class="primary" style="background:var(--ped); font-size:0.75rem;" onclick="processTrade(${t.id}, true)">✅ Aceptar</button><button class="danger" style="font-size:0.75rem;" onclick="processTrade(${t.id}, false)">❌ Rechazar</button></div></div>`; }).join(''); } let allLogs = (state.trades || []).filter(t => {
    if (!['approved', 'undone', 'undo_pending', 'pending'].includes(t.status)) return false;
    
    let dates = [t.d1];
    if (t.d2) dates.push(t.d2);
    
    let maxDateObj = null;
    dates.forEach(dk => {
        if (!dk) return;
        const parts = dk.split('_');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const d = parseInt(parts[2], 10);
        const dt = new Date(y, m, d);
        if (!maxDateObj || dt > maxDateObj) maxDateObj = dt;
    });
    
    if (maxDateObj) {
        if (maxDateObj.getMonth() !== curDate.getMonth() || maxDateObj.getFullYear() !== curDate.getFullYear()) return false;
    }
    return true;
}); if (allLogs.length === 0) log.innerHTML = `<span style="font-size:0.85rem; color:#94a3b8;">El historial de mercado está vacío.</span>`; else { log.innerHTML = allLogs.slice().reverse().map(t => { let desc = ""; let isPending = t.status === 'pending'; if (t.type === 'venta') desc = isPending ? `⏳ <b>${t.requester}</b> quiere VENDER su ${t.s1} (${formatDK(t.d1)}) a <b>${t.target}</b>.` : `💵 <b>${t.requester}</b> vendió su ${t.s1} (${formatDK(t.d1)}) a <b>${t.target}</b>.`; else if (t.type === 'compra') desc = isPending ? `⏳ <b>${t.requester}</b> quiere COMPRAR ${t.s1} (${formatDK(t.d1)}) a <b>${t.target}</b>.` : `🛒 <b>${t.requester}</b> compró ${t.s1} (${formatDK(t.d1)}) de <b>${t.target}</b>.`; else if (t.type === 'cambio') desc = isPending ? `⏳ <b>${t.requester}</b> quiere CAMBIAR su ${t.s1} (${formatDK(t.d1)}) por la de <b>${t.target}</b> (${formatDK(t.d2)}).` : `🔄 <b>${t.requester}</b> cambió su ${t.s1} (${formatDK(t.d1)}) por la de <b>${t.target}</b> (${formatDK(t.d2)}).`; let actionBtn = ""; if (t.status === 'approved' && (t.requester === loggedInUser || t.target === loggedInUser)) actionBtn = `<button class="danger icon-btn" style="font-size:0.7rem; padding:2px 6px;" onclick="requestTradeUndo(${t.id})">Deshacer</button>`; else if (isPending && t.requester === loggedInUser) actionBtn = `<button class="danger icon-btn" style="font-size:0.7rem; padding:2px 6px;" onclick="cancelPendingTrade(${t.id})">Cancelar Solicitud</button>`; let statusStyle = ""; let statusLabel = ""; if (t.status === 'undone') { statusStyle = "opacity:0.5; background:#f1f5f9;"; statusLabel = '<b style="color:var(--fest);">(DESHECHO)</b>'; } else if (t.status === 'undo_pending') { statusStyle = "border-left: 3px solid var(--pac);"; statusLabel = '<b style="color:var(--pac);">(DESHACER PENDIENTE)</b>'; } else if (t.status === 'pending') { statusStyle = "border-left: 3px solid #cbd5e1; background:#f8fafc;"; statusLabel = '<b style="color:#64748b;">(PENDIENTE)</b>'; } return `<div class="trade-row" style="${statusStyle}"><div style="display:flex; justify-content:space-between; align-items:flex-start;"><span>${desc} ${statusLabel}</span>${actionBtn}</div><span style="font-size:0.7rem; color:#94a3b8;">${t.timestamp}</span></div>`; }).join(''); }
}
/** Cancela una solicitud de trade pendiente enviada por el usuario. */
async function cancelPendingTrade(id) { if (!confirm("¿Cancelar solicitud?")) return; state.trades = state.trades.filter(t => t.id !== id); await saveState(); checkAutomaticGraduation();
    renderAll(); }
/**
 * Aprueba o rechaza una solicitud de trade (o un undo_pending).
 * Verifica que las guardias involucradas aún existen antes de aprobar.
 */
async function processTrade(id, isApprove) { let t = state.trades.find(x => x.id === id); if (!t) return; if (t.status === 'pending') { if(isApprove) { const computed = getComputedShifts(); if (t.type === 'cambio' && (!computed[t.d1]?.[t.requester] || !computed[t.d2]?.[t.target])) { alert("Error: Las guardias ya no existen."); t.status = 'rejected'; } else if (t.type === 'venta' && !computed[t.d1]?.[t.requester]) { alert("Error: La guardia ya no existe."); t.status = 'rejected'; } else if (t.type === 'compra' && t.target !== 'Externo' && !computed[t.d1]?.[t.target]) { alert("Error: La guardia ya no existe."); t.status = 'rejected'; } else { let conflicts = checkTradeConflicts(t); if (conflicts.length > 0) { if (!confirm("Generará conflictos:\n" + conflicts.join("\n") + "\n¿Continuar?")) return; } t.status = 'approved'; } } else t.status = 'rejected'; } else if (t.status === 'undo_pending') t.status = isApprove ? 'undone' : 'approved'; await saveState(); checkAutomaticGraduation();
    renderAll(); }
/** Solicita deshacer un trade aprobado. Si es con Externo, se deshace directamente; si no, queda pendiente de confirmación. */
async function requestTradeUndo(id) { let t = state.trades.find(x => x.id === id); if (!t) return; if (t.target === 'Externo') { if(!confirm("¿Deshacer operación con externo?")) return; t.status = 'undone'; } else { if(!confirm(`¿Enviar solicitud de deshacer?`)) return; t.status = 'undo_pending'; t.undoRequester = loggedInUser; } await saveState(); checkAutomaticGraduation();
    renderAll(); }

/** Muestra el formulario de cambio propio: elige la fecha destino para intercambiar la guardia del usuario. */
function renderMercadoCambiar(dk, svc) { const container = document.getElementById('mercado-dynamic'); container.innerHTML = `<h4 style="margin-bottom:1rem;">Cambiar guardia de ${svc}</h4><label style="font-size:0.85rem; color:#64748b;">1. Elige la fecha objetivo:</label><input type="date" id="cambio-date" onchange="loadCambioTargets('${dk}', '${svc}')"><div id="cambio-targets-area" style="margin-top:1rem;"></div>`; }
/** Carga el selector de contrapartes disponibles para la fecha destino elegida en el cambio propio. */
function loadCambioTargets(myDk, mySvc) { const dateVal = document.getElementById('cambio-date').value; if (!dateVal) return; const [y, mStr, dStr] = dateVal.split('-'); const targetDk = `${y}_${mStr}_${dStr}`; if (isPastDate(targetDk)) { document.getElementById('cambio-targets-area').innerHTML = `<p style="color:var(--fest); font-size:0.85rem;">No puedes seleccionar una fecha del pasado para hacer un cambio.</p>`; return; } const computed = getComputedShifts(); const dayShifts = computed[targetDk] || {}; let html = `<label style="font-size:0.85rem; color:#64748b;">2. ¿Con quién la cambias?</label><select id="cambio-to-user"><option value="">-- Selecciona opción --</option>`; html += `<option value="Externo|">👽 Mover a este día (Otro Residente Externo)</option>`; for (let u in dayShifts) { if (u !== loggedInUser && !u.startsWith('VRE')) { if (canUserTakeShift(u, loggedInUser, myDk, mySvc) && canUserTakeShift(loggedInUser, u, targetDk, dayShifts[u])) { html += `<option value="${u}|${dayShifts[u]}">🔄 ${u} (Su ${dayShifts[u]})</option>`; } } } html += `</select><button class="merc" style="width:100%; margin-top:10px;" onclick="proxySwapRequest('${myDk}', '${mySvc}', '${targetDk}')">Solicitar Cambio</button>`; document.getElementById('cambio-targets-area').innerHTML = html; }
/** Lee el select de contrapartes y delega en executeSwapRequestDirect con los parámetros correctos. */
function proxySwapRequest(myDk, mySvc, targetDk) { const val = document.getElementById('cambio-to-user').value; if (!val) return alert("Selecciona una opción de cambio."); const [targetUser, targetSvc] = val.split('|'); executeSwapRequestDirect(myDk, mySvc, targetDk, targetSvc, targetUser); }
/** Muestra el formulario para proponer un cambio sobre la guardia de otro residente: elige tu guardia a ofrecer. */
function renderMercadoCambiarAjena(targetDk, targetSvc, targetUser) { const container = document.getElementById('mercado-dynamic'); if (!canUserTakeShift(loggedInUser, targetUser, targetDk, targetSvc)) { container.innerHTML = `<p style="color:var(--fest); padding:10px; background:#fee2e2; border-radius:8px;">⚠️ Tu nivel actual no te permite asumir esta guardia de ${targetSvc}.</p>`; return; } const computed = getComputedShifts(); let myFutureShifts = []; for (let dk in computed) { if (!isPastDate(dk) && computed[dk][loggedInUser]) { if (canUserTakeShift(targetUser, loggedInUser, dk, computed[dk][loggedInUser])) { myFutureShifts.push({dk: dk, svc: computed[dk][loggedInUser]}); } } } let html = `<h4 style="margin-bottom:1rem; color:var(--adu);">Ofrecer cambio a ${targetUser}</h4><div style="background:#f8fafc; padding:8px; border-radius:8px; margin-bottom:1rem; font-size:0.85rem; border:1px solid #cbd5e1;">Te quedarías su: <b>${targetSvc} (${formatDK(targetDk)})</b></div>`; if (myFutureShifts.length === 0) { html += `<p style="font-size:0.85rem; color:var(--fest); font-weight:bold;">No tienes guardias futuras programadas para ofrecerle a cambio.</p>`; } else { html += `<label style="font-size:0.85rem; color:#64748b;">¿Qué guardia tuya le ofreces a cambio?</label><select id="cambio-ajena-sel"><option value="">-- Selecciona una de tus guardias --</option>${myFutureShifts.map(s => `<option value="${s.dk}|${s.svc}">${formatDK(s.dk)} - ${s.svc}</option>`).join('')}</select><button class="primary" style="width:100%; margin-top:10px; background:var(--adu);" onclick="executeSwapRequestAjena('${targetDk}', '${targetSvc}', '${targetUser}')">Enviar Propuesta de Cambio</button>`; } container.innerHTML = html; }
/** Lee el select de "mi guardia a ofrecer" y ejecuta el cambio con la guardia ajena. */
function executeSwapRequestAjena(targetDk, targetSvc, targetUser) { const val = document.getElementById('cambio-ajena-sel').value; if(!val) return alert("Selecciona una guardia tuya para ofrecer."); const [myDk, mySvc] = val.split('|'); executeSwapRequestDirect(myDk, mySvc, targetDk, targetSvc, targetUser); }
// ============================================================
// MÓDULO: ADMIN_CUENTAS
// Exportar a: src/modules/adminCuentas.js
// Líneas estimadas: ~250
// Dependencias externas: supabaseClient, currentUserProfile, state, globalProfiles, curDate
// Helpers que usa: setStatus, saveState, renderAccountsList, renderRotationView, reempaquetarGruposPlan, invalidateConfigMes, limpiarFuturos, formatDateKey, getCurrentRotPlan, MONTHS
// ============================================================
/** Descarga y renderiza la lista de usuarios de la promoción con acciones de aprobar, expulsar y cambiar rol. */
async function renderAccountsList() {
  const el = document.getElementById('accounts-list');
  if (!el) return;
  el.innerHTML = '<span style="color:#64748b;">Cargando lista de usuarios...</span>';

  // 1. Cargamos usuarios con timeout anti-congelamiento
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout de red")), 5000));
  const fetchUsers = supabaseClient.from('perfiles').select('*').eq('promocion_id', currentUserProfile.promocion_id).order('estado', { ascending: false });
  
  let usuarios;
  try {
      const { data, error } = await Promise.race([fetchUsers, timeout]);
      if (error) throw error;
      usuarios = data;
  } catch (err) {
      return el.innerHTML = `<span style="color:var(--fest); font-weight:bold;">Error de red: ${err.message}</span>`;
  }

  if (!usuarios || usuarios.length === 0) return el.innerHTML = `<span style="color:#854d0e;">No hay NADIE vinculado a esta promoción aún.</span>`;

  // 2. Comprobamos si somos el "Dueño" legítimo del contenedor
  const { data: promo } = await supabaseClient.from('promociones').select('creador_id').eq('id', currentUserProfile.promocion_id).single();
  const isDueño = promo && promo.creador_id === currentUserProfile.id;

  // === LA MAGIA DEL DATALIST ===
  const datalist = document.getElementById('lista-usuarios-aprobados');
  if (datalist) datalist.innerHTML = usuarios.filter(u => u.estado === 'aprobado').map(u => `<option value="${u.nombre_mostrar}">`).join('');

  // --- RENDER DE SOLICITUDES PENDIENTES ---
  let html = `<h4 style="margin-bottom:10px; color:var(--dark);">🔔 Solicitudes Pendientes</h4>`;
  const pendientes = usuarios.filter(u => u.estado === 'pendiente');
  
  if(pendientes.length === 0) {
      html += `<p style="font-size:0.85rem; color:#64748b; margin-bottom:20px;">No hay nadie en la sala de espera.</p>`;
  } else {
      pendientes.forEach(u => {
         html += `<div class="account-row" style="background:#fffbeb; border:1px solid #fde047; border-radius:8px; margin-bottom:8px; padding:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div><strong>${u.nombre_mostrar}</strong> <span style="font-size:0.8rem; color:#854d0e; margin-left:10px;">⏳ Esperando acceso</span></div>
            <div style="display:flex; gap:8px;">
              <button class="primary icon-btn" style="background:var(--ped); border:none; color:white;" onclick="adminAprobarUsuario('${u.id}', '${u.nombre_mostrar}')">✅ Aprobar</button>
              <button class="danger icon-btn" onclick="adminRechazarUsuario('${u.id}')">❌ Rechazar</button>
            </div>
         </div>`;
      });
  }
  
  // --- RENDER DE MIEMBROS APROBADOS (LA ABDICACIÓN Y DELEGADOS) ---
  html += `<h4 style="margin-top:20px; margin-bottom:10px; color:var(--dark);">🏥 Miembros de la Promoción</h4>`;
  const aprobados = usuarios.filter(u => u.estado === 'aprobado');
  
  aprobados.forEach(u => {
      // Etiquetas visuales de Rango
      let rolBadge = '✅ Residente';
      if (u.rol === 'admin') rolBadge = '👑 Dueño';
      else if (u.rol === 'delegado') rolBadge = '⭐ Delegado';
      
      let acciones = '';

      if (u.id === currentUserProfile.id) {
          // Acciones para TI MISMO
          if (isDueño && aprobados.length > 1) {
              acciones = `<span style="font-size:0.75rem; color:#854d0e;">No puedes abdicar sin traspasar la corona primero.</span>`;
          } else {
              acciones = `<button class="danger icon-btn" style="border:1px solid var(--fest);" onclick="adminRenunciarPrivilegios()">Renunciar a Admin</button>`;
          }
      } else {
          // Acciones sobre TUS COMPAÑEROS
          if (isDueño) {
              // El Dueño puede expulsar a cualquiera
              acciones += `<button class="danger icon-btn" style="margin-right:4px;" onclick="adminExpulsarUsuario('${u.id}', '${u.nombre_mostrar}')">Expulsar</button>`;
              
              if (u.rol === 'delegado') {
                  acciones += `<button class="danger icon-btn" style="margin-right:4px;" onclick="adminCambiarRol('${u.id}', 'residente')">Quitar Delegado</button>`;
              } else if (u.rol !== 'admin') {
                  acciones += `<button class="primary icon-btn" style="margin-right:4px; background:var(--dark);" onclick="adminCambiarRol('${u.id}', 'delegado')">Hacer Delegado</button>`;
              }
              acciones += `<button class="primary icon-btn" style="background:var(--adu);" onclick="adminTraspasarCorona('${u.id}', '${u.nombre_mostrar}')">Coronar Dueño</button>`;
          } else {
              // Delegado: solo puede expulsar residentes, no a admins ni a otros delegados.
              if (u.rol !== 'admin' && u.rol !== 'delegado') {
                  acciones += `<button class="danger icon-btn" style="margin-right:4px;" onclick="adminExpulsarUsuario('${u.id}', '${u.nombre_mostrar}')">Expulsar</button>`;
              }
          }
      }

      let escapedName = u.nombre_mostrar.replace(/'/g, "\\'");
      let ev = state.historialEventos && state.historialEventos[u.nombre_mostrar] ? state.historialEventos[u.nombre_mostrar] : {};
      html += `<div class="account-row" style="border:1px solid #e2e8f0; border-radius:8px; margin-bottom:8px; padding:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
         <div>
            <strong>${u.nombre_mostrar}</strong> <span style="font-size:0.8rem; color:#64748b; margin-left:10px;">${rolBadge}</span>
            <div style="font-size:0.8rem; color:#475569; margin-top:4px;">
               Inicio: <strong>${u.fecha_inicio_residencia || 'No definido'}</strong> | Mes cambio contrato: <strong>${u.fecha_cambio_contrato ? u.fecha_cambio_contrato.substring(0,7) : 'No definido'}</strong>
               <br>${isDueño ? `<button class="secondary" style="font-size:0.7rem; padding:2px 6px; margin-left:8px;" onclick="window.adminEditarFechas('${u.id}', '${escapedName}', '${u.fecha_inicio_residencia || ''}', '${u.fecha_cambio_contrato || ''}')">✏️ Editar</button>` : ''}
            </div>
         </div>
         <div style="display:flex; align-items:center;">${acciones}</div>
      </div>`;
  });
  
  el.innerHTML = html;
}

/** Degrada al admin actual a residente normal, renunciando a todos los privilegios. */
async function adminRenunciarPrivilegios() {
    if (!confirm("¿Seguro que quieres renunciar a tus privilegios de Administrador? Volverás a ser un residente normal y perderás el acceso a esta pestaña.")) return;
    setStatus('Renunciando...');
    await supabaseClient.from('perfiles').update({ rol: null }).eq('id', currentUserProfile.id);
    window.location.reload();
}

/**
 * Cambia el rol de un usuario de la promoción.
 * @param {string} userId
 * @param {'admin'|'delegado'|null} nuevoRol
 */
async function adminCambiarRol(userId, nuevoRol) {
    setStatus('Actualizando rol...');
    const { error } = await supabaseClient.from('perfiles').update({ rol: nuevoRol }).eq('id', userId);
    if(error) alert("Error: " + error.message);
    await renderAccountsList();
    setStatus('Conectado ✅');
}

/**
 * Transfiere la propiedad absoluta de la promoción a otro residente.
 * El que la cede pasa a ser delegado.
 * @param {string} userId
 * @param {string} userName
 */
async function adminTraspasarCorona(userId, userName) {
    if (!confirm(`¿Estás seguro de que quieres ceder la corona a ${userName}? Perderás el control absoluto y pasarás a ser un Delegado normal.`)) return;
    setStatus('Traspasando corona...');
    await supabaseClient.from('promociones').update({ creador_id: userId }).eq('id', currentUserProfile.promocion_id);
    await supabaseClient.from('perfiles').update({ rol: 'admin' }).eq('id', userId);
    await supabaseClient.from('perfiles').update({ rol: 'delegado' }).eq('id', currentUserProfile.id);
    alert(`La corona ha sido cedida a ${userName}. Ahora eres un Delegado.`);
    window.location.reload();
}

/**
 * Abre un modal SweetAlert2 para editar las fechas de residencia de un usuario.
 * Persiste en Supabase y regenera historialEventos para el motor de rotación.
 */
window.adminEditarFechas = async function adminEditarFechas(userId, userName, fInicio, fCambio, fEntrada, fSalida) {
    try {
        // Convertir fecha completa a solo YYYY-MM para el selector de mes
        const fCambioMes = fCambio ? fCambio.substring(0, 7) : '';
        const { value: formValues } = await Swal.fire({
        title: `Editar Fechas de ${userName}`,
        html:
            `<div style="text-align:left; font-size:0.9rem; margin-bottom:5px;">Fecha Inicio Residencia (R1):</div>` +
            `<input id="swal-input1" type="date" class="swal2-input" value="${fInicio}">` +
            `<div style="text-align:left; font-size:0.9rem; margin-bottom:5px; margin-top:10px;">Mes de Cambio de Contrato:</div>` +
            `<input id="swal-input2" type="month" class="swal2-input" value="${fCambioMes}">`,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            return [
                document.getElementById('swal-input1').value,
                document.getElementById('swal-input2').value  // YYYY-MM format
            ]
        }
    });

    if (formValues) {
        setStatus('Actualizando fechas...');
        // Guardamos siempre con día 01 para estandarizar
        const fechaCambioFinal = formValues[1] ? `${formValues[1]}-01` : null;
        const { error } = await supabaseClient.from('perfiles').update({
            fecha_inicio_residencia: formValues[0] || null,
            fecha_cambio_contrato: fechaCambioFinal
        }).eq('id', userId);
        
        if (error) {
            alert("Error: " + error.message);
        } else {
            // Actualizar historialEventos en la rotación (motor matemático)
            if (!state.historialEventos) state.historialEventos = {};
            if (!state.historialEventos[userName]) state.historialEventos[userName] = {};
            
            if (formValues[2]) state.historialEventos[userName].entrada = formValues[2];
            else delete state.historialEventos[userName].entrada;
            
            if (formValues[3]) state.historialEventos[userName].salida = formValues[3];
            else delete state.historialEventos[userName].salida;
            
            await limpiarFuturos(curDate.getFullYear(), curDate.getMonth());
            await saveState();

            // Refrescar perfiles globales y lista
            const { data: profs } = await supabaseClient.from('perfiles').select('*').eq('promocion_id', currentUserProfile.promocion_id).in('estado', ['aprobado', 'historico']);
            globalProfiles = profs || [];
            await renderAccountsList();
        }
        setStatus('Conectado ✅');
    }
    } catch (err) {
        alert("Error crítico en el botón editar: " + err.message);
    }
}

/**
 * Aprueba la solicitud de acceso de un usuario y lo añade al grupo de rotación con menos miembros.
 * Re-empaqueta automáticamente si algún grupo supera 4 miembros.
 * @param {string} userId
 * @param {string} userName
 */
async function adminAprobarUsuario(userId, userName) {
    setStatus('Aprobando...');
    const { error } = await supabaseClient.from('perfiles').update({ estado: 'aprobado' }).eq('id', userId);
    if(error) return alert("Error: " + error.message);
    
    // Añadir al grupo con menor número de miembros (W4)
    const dk = formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1);
    const planName = getCurrentRotPlan(dk);
    if (!state.planRotations) state.planRotations = {};
    if (!state.planRotations[planName]) state.planRotations[planName] = { baseGroups: [], baseYear: curDate.getFullYear(), baseMonth: curDate.getMonth(), customRotations: {}, residentesFijos: [] };
    const pr = state.planRotations[planName];
    const grupos = (pr.baseGroups && pr.baseGroups.length > 0 && pr.baseGroups.some(g => g.length > 0))
        ? pr.baseGroups
        : null;
    if (!grupos) {
        // Primer residente del plan: crear el grupo inicial
        pr.baseGroups = [[userName]];
    } else {
        // Encontrar el grupo con menos miembros (último en caso de empate)
        const minIdx = grupos.reduce((best, g, i) => g.length <= grupos[best].length ? i : best, 0);
        grupos[minIdx].push(userName);
        // Solo reempaquetar si algún grupo supera el máximo de 4
        if (grupos.some(g => g.length > 4)) {
            pr.baseGroups = reempaquetarGruposPlan(grupos.flat(), pr);
        }
    }
    
    invalidateConfigMes();
    await saveState(); 
    await renderAccountsList(); 
    setStatus('Conectado ✅');
}

/**
 * Mueve al usuario al estado 'historico', registrando su fecha de salida en historialEventos.
 * Ya no aparecerá en futuras rotaciones pero sus guardias históricas se conservan.
 * @param {string} userId
 * @param {string} userName
 */
async function adminExpulsarUsuario(userId, userName) {
    if(!confirm(`¿Seguro que quieres dar de baja a ${userName}? Pasará al histórico y ya no estará en futuras listas de rotación.`)) return;
    setStatus('Expulsando...');
    
    await supabaseClient.from('perfiles').update({ estado: 'historico' }).eq('id', userId);
    
    if (!state.historialEventos) state.historialEventos = {};
    if (!state.historialEventos[userName]) state.historialEventos[userName] = {};
    const mStr = String(curDate.getMonth() + 1).padStart(2, '0');
    state.historialEventos[userName].salida = `${curDate.getFullYear()}-${mStr}`;
    
    await saveState(); 
    const { data: profs } = await supabaseClient.from('perfiles').select('*').eq('promocion_id', currentUserProfile.promocion_id).in('estado', ['aprobado', 'historico']);
    globalProfiles = profs || [];
    await renderAccountsList();
    renderRotationView();
    setStatus('Conectado ✅');
}

/** Rechaza la solicitud de acceso de un usuario: lo desvincula de la promoción y lo deja en estado pendiente. */
async function adminRechazarUsuario(userId) {
    if(!confirm("¿Rechazar solicitud?")) return;
    setStatus('Rechazando...');
    await supabaseClient.from('perfiles').update({ promocion_id: null, estado: 'pendiente' }).eq('id', userId);
    await renderAccountsList();
    setStatus('Conectado ✅');
}

/** Renderiza la vista de rotación con el selector de plan (para delegados) y el orden de grupos del mes. */
function renderRotationView() {
    const y = curDate.getFullYear(), m = curDate.getMonth();
    const dk = formatDateKey(y, m, 1);

    // Inject Plan Selector
    const containerTop = document.getElementById('rot-content');
    let planSelectorHtml = '';
    if (isDelegado && promoConfig.planes) {
        planSelectorHtml = `<div style="margin-bottom:15px; padding:10px; background:#f8fafc; border-radius:8px; display:flex; align-items:center; gap:10px;">
            <label style="font-weight:bold; font-size:0.9rem;">Viendo Rotacin de:</label>
            <select id="rot-plan-select" style="padding:5px; border-radius:5px; border:1px solid #cbd5e1;" onchange="selectedRotPlan = this.value; renderRotationView();">
                <option value="AUTO" ${!selectedRotPlan || selectedRotPlan === 'AUTO' ? 'selected' : ''}>Mi Plan Actual (Automtico)</option>
                ${promoConfig.planes.map(p => `<option value="${p.nombre}" ${selectedRotPlan === p.nombre ? 'selected' : ''}>${p.nombre}</option>`).join('')}
            </select>
        </div>`;
    } else {
        const myPlan = getPlanForUserOnDate(currentUserProfile, dk);
        planSelectorHtml = `<div style="margin-bottom:15px; font-size:0.9rem; color:#64748b;">Mostrando Fila India para: <strong>${myPlan ? myPlan.nombre : 'Plan Base'}</strong></div>`;
    }
    
    const groups = getRotation(y, m);
    containerTop.innerHTML = planSelectorHtml;
    
    const listDiv = document.createElement('div');

    const container = document.getElementById('rot-content'); 
    /* container.innerHTML = ''; */ 
    let order = 1; 
    groups.forEach((g, i) => {
        const div = document.createElement('div'); div.className = 'rot-group'; 
        div.innerHTML = `<h4 style="margin-bottom:0.5rem; color:var(--dark);">Grupo ${i+1}</h4>` + g.map(res => `<div style="padding:4px 0; border-bottom:1px dashed #e2e8f0; font-size:0.9rem;"><strong>${order++}.</strong> ${res}</div>`).join(''); 
        listDiv.appendChild(div); 
    }); 
    containerTop.appendChild(listDiv);
    if (isAdmin) { 
        document.getElementById('admin-rot-tools').style.display = 'block'; 
        if (!editingGroups) editingGroups = JSON.parse(JSON.stringify(groups)); 
        renderEditor(); 
    } else document.getElementById('admin-rot-tools').style.display = 'none'; 
}

/**
 * Alterna el estado "fijo" de un residente en el plan activo.
 * Los residentes fijos forman un grupo separado que rota en orden fijo.
 * @param {string} nombre
 */
async function toggleResidenteFijo(nombre) {
    const dk = formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1);
    const planName = getCurrentRotPlan(dk);
    if (!state.planRotations || !state.planRotations[planName]) return;
    const pr = state.planRotations[planName];
    if (!pr.residentesFijos) pr.residentesFijos = [];
    
    let linear = editingGroups.flat();
    let fijos = linear.filter(n => pr.residentesFijos.includes(n));
    let moviles = linear.filter(n => !pr.residentesFijos.includes(n));

    if (pr.residentesFijos.includes(nombre)) {
        pr.residentesFijos = pr.residentesFijos.filter(n => n !== nombre);
        fijos = fijos.filter(n => n !== nombre);
        moviles.unshift(nombre);
    } else {
        pr.residentesFijos.push(nombre);
        moviles = moviles.filter(n => n !== nombre);
        fijos.push(nombre);
    }
    
    let nuevoBlock = [];
    if (fijos.length > 0) nuevoBlock.push(fijos);
    nuevoBlock.push(..._reempaquetarGrupos(moviles));
    
    editingGroups = nuevoBlock;
    pr.baseGroups = JSON.parse(JSON.stringify(editingGroups));
    invalidateConfigMes();
    await saveState();
    renderEditor();
}

/**
 * Alterna la exclusión de un residente del pool de candidatos para subastas forzosas.
 * Sus guardias no se cuentan para calcular el exceso mensual.
 * @param {string} nombre
 */
async function toggleResidenteExcluido(nombre) {
    if (!state.excluidosSubastas) state.excluidosSubastas = [];
    if (state.excluidosSubastas.includes(nombre)) {
        state.excluidosSubastas = state.excluidosSubastas.filter(n => n !== nombre);
    } else {
        if (confirm(`¿Seguro que quieres excluir a ${nombre} de las subastas forzosas? (No se le tendrán en cuenta sus guardias para calcular el exceso)`)) {
            state.excluidosSubastas.push(nombre);
        }
    }
    await saveState();
    renderEditor();
}

	
// ============================================================
// MÓDULO: ROTACION_EDITOR
// Exportar a: src/modules/rotacionEditor.js
// Líneas estimadas: ~370
// Dependencias externas: state.planRotations, editingGroups, curDate, isAdmin, globalProfiles
// Helpers que usa: renderEditor, renderRotationView, saveState, getCurrentRotPlan, formatDateKey, getRotationKey, getRotationForPlan, getAllResidents, reempaquetarGrupos, reempaquetarGruposPlan, invalidateConfigMes, MONTHS
// ============================================================
/** Renderiza el editor de grupos de rotación con controles para mover, fusionar, fijar y excluir residentes. */
function renderEditor() {
    const setupC = document.getElementById('setup-groups');
    setupC.innerHTML = '';
    let flatIdxCounter = 0;
    
    if (!state.excluidosSubastas) state.excluidosSubastas = [];
    const _edDk = formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1);
    const _edPlanName = getCurrentRotPlan(_edDk);
    const _edPr = state.planRotations?.[_edPlanName] || { residentesFijos: [] };
    const _edFijos = _edPr.residentesFijos || [];
    
    // Determinamos si el primer grupo que viene son los fijos
    let tieneGrupoFijos = editingGroups.length > 0 && editingGroups[0].some(n => _edFijos.includes(n));
    let grupoMovilContador = 1;

    editingGroups.forEach((g, i) => {
        const esGrupoDeFijos = (i === 0 && tieneGrupoFijos);
        const tituloGrupo = esGrupoDeFijos 
            ? `👑 Grupo Especial: Rotantes Fijos <span style="color:#a16207; font-size:0.85rem;">(${g.length} personas)</span>` 
            : `Hospital Grupo ${grupoMovilContador++} <span style="color:#64748b; font-size:0.85rem;">(${g.length} personas)</span>`;

        const gdiv = document.createElement('div'); 
        gdiv.className = 'rot-group';
        gdiv.style.border = esGrupoDeFijos ? '2px solid #f59e0b' : '1px solid #e2e8f0';
        gdiv.style.background = esGrupoDeFijos ? '#fffdf5' : 'var(--light)';

        // Cabecera del grupo con acciones de grupo
        let groupHeaderHtml = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:2px solid ${esGrupoDeFijos ? '#f59e0b' : '#cbd5e1'}; padding-bottom:4px;">
            <strong>${tituloGrupo}</strong>
            ${!esGrupoDeFijos ? `
            <div style="display:flex; gap: 4px; flex-wrap:wrap;">
                <button class="icon-btn" style="padding:2px 6px; font-size:0.75rem; height:24px;" onclick="moveGroupEntirely(${i}, 'up')" title="Subir Grupo Entero">⬆️ Grupo</button>
                <button class="icon-btn" style="padding:2px 6px; font-size:0.75rem; height:24px;" onclick="moveGroupEntirely(${i}, 'down')" title="Bajar Grupo Entero">⬇️ Grupo</button>
                <button class="icon-btn" style="padding:2px 6px; font-size:0.75rem; height:24px; background:#e0f2fe;" onclick="mergeGroupWithNext(${i})" title="Fusionar con el siguiente grupo">🔗 Fusionar▼</button>
            </div>` : ''}
        </div>`;
        gdiv.innerHTML = groupHeaderHtml +
        g.map((res, rIdx) => {
            flatIdxCounter++;
            const esFijo = _edFijos.includes(res);
            const esExcluido = state.excluidosSubastas.includes(res);
            const canPrev = !esGrupoDeFijos && i > 0 && !(i === 1 && tieneGrupoFijos);
            const canNext = !esGrupoDeFijos && i < editingGroups.length - 1;
            const canSplit = !esGrupoDeFijos && rIdx > 0;
            
            return `
            <div class="editor-row" style="background:white; padding:5px 6px; border:1px solid ${esFijo ? '#fef08a' : '#e2e8f0'}; border-radius:6px; margin-bottom:3px; ${esExcluido ? 'opacity:0.7;' : ''}">
                <span style="display:inline-block; min-width:120px; font-weight:500; font-size:0.9rem; color:var(--dark);">
                    ${canSplit ? `<button class="icon-btn" style="padding:1px 4px; font-size:0.65rem; height:18px; background:#fef9c3; border-color:#ca8a04; margin-right:3px;" onclick="splitGroupAt(${i},${rIdx})" title="Dividir grupo aquí">✂️</button>` : '<span style="display:inline-block;width:26px"></span>'}
                    ${res} ${esFijo ? '📌' : ''} ${esExcluido ? '👻' : ''}
                </span>
                <div style="display:flex; gap:3px; flex-wrap:wrap;">
                    <button class="icon-btn" style="background:${esExcluido?'#fecaca':'#f1f5f9'}; border-color:${esExcluido?'#ef4444':'#cbd5e1'};" onclick="toggleResidenteExcluido('${res}')" title="Excluir de Subastas">👻</button>
                    <button class="icon-btn" style="background:${esFijo?'#fef08a':'#f1f5f9'}; border-color:${esFijo?'#ca8a04':'#cbd5e1'};" onclick="toggleResidenteFijo('${res}')" title="Fijo/Móvil">📌</button>
                    <button class="icon-btn" style="background:#f1f5f9;" onclick="moveResInGroup(${i},${rIdx},'up')" title="Subir dentro del grupo">↑</button>
                    <button class="icon-btn" style="background:#f1f5f9;" onclick="moveResInGroup(${i},${rIdx},'down')" title="Bajar dentro del grupo">↓</button>
                    ${canPrev ? `<button class="icon-btn" style="background:#dbeafe; font-size:0.75rem;" onclick="moveResToPrevGroup(${i},${rIdx})" title="Mover al grupo anterior">◀ Grp</button>` : ''}
                    ${canNext ? `<button class="icon-btn" style="background:#dcfce7; font-size:0.75rem;" onclick="moveResToNextGroup(${i},${rIdx})" title="Mover al grupo siguiente">Grp ▶</button>` : ''}
                    <button class="danger icon-btn" onclick="editorRemoveMemberLinear(${i},${rIdx})">✕</button>
                </div>
            </div>`;
        }).join('');
        setupC.appendChild(gdiv);
    });

    const btnContainer = document.createElement('div');
    btnContainer.innerHTML = `
    <div style="display:flex; gap:10px; margin-top:10px; margin-bottom:15px; width:100%;">
        <select id="sel-add-res" style="flex:1; padding:8px; border-radius:6px; border:1px solid #cbd5e1;">
            <option value="">-- Añadir Residente a la Rotación --</option>
            <option value="VIRTUAL">+ Nuevo Virtual (Ej: Aura)</option>
            ${globalProfiles.filter(p => !editingGroups.flat().includes(p.nombre_mostrar) && p.promocion_id === currentUserProfile.promocion_id).map(p => `<option value="${p.nombre_mostrar}">${p.nombre_mostrar} (Registrado)</option>`).join('')}
        </select>
        <button class="primary" style="background:var(--dark);" onclick="editorAddSelectedRes()">Añadir</button>
    </div>
    <div style="margin-top:20px; padding-top:15px; border-top:2px dashed #cbd5e1;">
        <span style="font-size:0.75rem; color:#94a3b8; display:block; margin-bottom:6px;">⚠️ ZONA DE CONFIGURACIÓN INICIAL (SOLO AL CREAR EL CONTENEDOR):</span>
        <button id="btn-shuffle" class="danger" style="width:100%; background:#94a3b8; border:none; color:white; font-size:0.8rem; padding:6px;" onclick="adminAutoShuffleGroups()">🎲 Sorteo Inicial: Barajar Fila Completa Respetando Fijos</button>
    </div>`;
    setupC.appendChild(btnContainer);
}
// ============================================================
// MÓDULO: ROTACION_EDITOR_CONTROLES (sub-sección de ROTACION_EDITOR)
// Exportar a: src/modules/rotacionEditor.js  ← mismo archivo
// Líneas estimadas: ~145
// Dependencias externas: editingGroups, state.planRotations, curDate
// Helpers que usa: renderEditor, getCurrentRotPlan, formatDateKey, reempaquetarGrupos, monthString, saveState, renderRotationView
// ============================================================
/**
 * Mueve un residente arriba o abajo dentro de su propio grupo sin reempaquetar.
 * @param {number} gIdx - índice del grupo
 * @param {number} rIdx - índice del residente dentro del grupo
 * @param {'up'|'down'} dir
 */
function moveResInGroup(gIdx, rIdx, dir) {
    const g = editingGroups[gIdx];
    if (!g) return;
    if (dir === 'up' && rIdx > 0) {
        [g[rIdx-1], g[rIdx]] = [g[rIdx], g[rIdx-1]];
    } else if (dir === 'down' && rIdx < g.length - 1) {
        [g[rIdx+1], g[rIdx]] = [g[rIdx], g[rIdx+1]];
    }
    renderEditor();
}

/** Mueve un residente al grupo anterior. No puede saltar por encima del grupo de fijos. */
function moveResToPrevGroup(gIdx, rIdx) {
    if (gIdx <= 0) return;
    const _dk2 = formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1);
    const _pr2 = state.planRotations?.[getCurrentRotPlan(_dk2)] || { residentesFijos: [] };
    const esFijoGroup = gIdx === 0 || (gIdx === 1 && editingGroups[0].some(n => (_pr2.residentesFijos||[]).includes(n)));
    if (esFijoGroup) return; // No mover al grupo de fijos
    const moved = editingGroups[gIdx].splice(rIdx, 1)[0];
    editingGroups[gIdx-1].push(moved);
    renderEditor();
}

/** Mueve un residente al grupo siguiente, colocándolo al inicio de dicho grupo. */
function moveResToNextGroup(gIdx, rIdx) {
    if (gIdx >= editingGroups.length - 1) return;
    const moved = editingGroups[gIdx].splice(rIdx, 1)[0];
    editingGroups[gIdx+1].unshift(moved);
    renderEditor();
}

/**
 * Divide un grupo en dos a partir de la posición rIdx.
 * @param {number} gIdx
 * @param {number} rIdx - índice del primer residente del segundo grupo
 */
function splitGroupAt(gIdx, rIdx) {
    if (rIdx <= 0 || rIdx >= editingGroups[gIdx].length) return;
    const g = editingGroups[gIdx];
    const part1 = g.slice(0, rIdx);
    const part2 = g.slice(rIdx);
    editingGroups.splice(gIdx, 1, part1, part2);
    renderEditor();
}

/** Fusiona el grupo en gIdx con el grupo siguiente. */
function mergeGroupWithNext(gIdx) {
    if (gIdx >= editingGroups.length - 1) return;
    const merged = [...editingGroups[gIdx], ...editingGroups[gIdx+1]];
    editingGroups.splice(gIdx, 2, merged);
    renderEditor();
}

/**
 * Sube o baja el grupo entero una posición. No puede saltar por encima del grupo de fijos.
 * @param {number} gIdx
 * @param {'up'|'down'} dir
 */
function moveGroupEntirely(gIdx, dir) {
    if (dir === 'up' && gIdx > 0) {
        const _mgDk = formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1);
        const _mgPr = state.planRotations?.[getCurrentRotPlan(_mgDk)] || { residentesFijos: [] };
        let tieneGrupoFijos = editingGroups.length > 0 && editingGroups[0].some(n => (_mgPr.residentesFijos||[]).includes(n));
        if (tieneGrupoFijos && gIdx === 1) return; // No puede saltar por encima de los fijos
        
        [editingGroups[gIdx-1], editingGroups[gIdx]] = [editingGroups[gIdx], editingGroups[gIdx-1]];
    } else if (dir === 'down' && gIdx < editingGroups.length - 1) {
        [editingGroups[gIdx+1], editingGroups[gIdx]] = [editingGroups[gIdx], editingGroups[gIdx+1]];
    }
    renderEditor();
}


/** Añade el residente seleccionado (o un nuevo virtual) al final de la fila india y reempaqueta. */
function editorAddSelectedRes() {
    const val = document.getElementById('sel-add-res').value;
    if (!val) return;
    
    let nombre = val;
    if (val === 'VIRTUAL') {
        nombre = prompt("Introduce el nombre del residente virtual (Ej: Aura):");
        if (!nombre || nombre.trim() === "") return;
    }
    
    let filaIndia = editingGroups.flat();
    if (!filaIndia.includes(nombre.trim())) {
        filaIndia.push(nombre.trim());
        
        // Registrar entrada
        if (!state.historialEventos) state.historialEventos = {};
        if (!state.historialEventos[nombre.trim()]) state.historialEventos[nombre.trim()] = {};
        state.historialEventos[nombre.trim()].entrada = monthString(curDate.getFullYear(), curDate.getMonth());
        
        editingGroups = reempaquetarGrupos(filaIndia);
        renderEditor();
    }
}

/** Elimina un residente del grupo directamente (sin reempaquetar) y elimina el grupo si queda vacío. */
function editorRemoveMemberLinear(gIdx, rIdx) {
    // Elimina el residente directamente del grupo (sin reempaquetar)
    if (editingGroups[gIdx]) {
        editingGroups[gIdx].splice(rIdx, 1);
        // Si el grupo queda vacío, lo eliminamos
        if (editingGroups[gIdx].length === 0) {
            editingGroups.splice(gIdx, 1);
        }
    }
    renderEditor();
}

// ============================================================
// MÓDULO: ROTACION_SORTEO (sub-sección de ROTACION_EDITOR)
// Exportar a: src/modules/rotacionEditor.js  ← mismo archivo
// Líneas estimadas: ~35
// Dependencias externas: state.planRotations, curDate, editingGroups
// Helpers que usa: getAllResidents, reempaquetarGruposPlan, formatDateKey, getCurrentRotPlan, saveState, renderRotationView
// ============================================================
/**
 * Baraja aleatoriamente la fila india manteniendo los residentes fijos al inicio.
 * Reinicia customRotations, baseMonth y baseYear al mes actual.
 */
async function adminAutoShuffleGroups() {
    if (!confirm("⚠️ Se va a barajar a los residentes. Los marcados como 'Fijos' se mantendrán al inicio de la rueda. ¿Continuar?")) return;
    
    const dk = formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1);
    const planName = getCurrentRotPlan(dk);
    if (!state.planRotations) state.planRotations = {};
    if (!state.planRotations[planName]) state.planRotations[planName] = { baseGroups: [], baseYear: curDate.getFullYear(), baseMonth: curDate.getMonth(), customRotations: {}, residentesFijos: [] };
    const pr = state.planRotations[planName];
    if (!pr.residentesFijos) pr.residentesFijos = [];
    
    let linear = getAllResidents();
    const fijosPresentes = linear.filter(n => pr.residentesFijos.includes(n));
    let restOfResidents = linear.filter(n => !pr.residentesFijos.includes(n));
    
    for (let i = restOfResidents.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [restOfResidents[i], restOfResidents[j]] = [restOfResidents[j], restOfResidents[i]];
    }
    
    const filaFinal = [...fijosPresentes, ...restOfResidents];
    
    pr.baseGroups = reempaquetarGruposPlan(filaFinal, pr);
    pr.baseMonth = curDate.getMonth();
    pr.baseYear = curDate.getFullYear();
    pr.customRotations = {};
    
    editingGroups = JSON.parse(JSON.stringify(pr.baseGroups));
    await saveState();
    renderRotationView();
}
	
/** Añade un nuevo grupo vacío al final de editingGroups. */
function editorAddGroup() { editingGroups.push([]); renderEditor(); }
/** Elimina el grupo en el índice dado de editingGroups. */
function editorRemoveGroup(gi) { editingGroups.splice(gi, 1); renderEditor(); }

/** Guarda el orden actual de editingGroups como excepción solo para el mes visible (customRotation). */
async function saveCustomMonth() {
    const _dk = formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1);
    const _planName = getCurrentRotPlan(_dk);
    const _pr = state.planRotations?.[_planName];
    if (_pr) _pr.customRotations[getRotationKey(curDate.getFullYear(), curDate.getMonth())] = JSON.parse(JSON.stringify(editingGroups));
    await saveState(); 
    checkAutomaticGraduation();
    renderAll(); 
    alert("Excepción guardada SOLO para este mes. Los meses siguientes seguirán su curso matemático normal ignorando este cambio."); 
}
/**
 * Establece editingGroups como la nueva base matemática del plan desde el mes actual.
 * Borra customRotations futuros y invalida configMes para que se regeneren.
 */
async function saveAsNewBase() {
    const _dk = formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1);
    const _planName = getCurrentRotPlan(_dk);
    if (!state.planRotations) state.planRotations = {};
    if (!state.planRotations[_planName]) state.planRotations[_planName] = { baseGroups: [], baseYear: curDate.getFullYear(), baseMonth: curDate.getMonth(), customRotations: {}, residentesFijos: [] };
    const _pr = state.planRotations[_planName];
    _pr.baseGroups = JSON.parse(JSON.stringify(editingGroups));
    _pr.baseMonth = curDate.getMonth();
    _pr.baseYear = curDate.getFullYear();
    _pr.customRotations = {};

    // Limpiar el caché de ordenSeleccion para todos los meses desde la nueva base en adelante
    // para que se regeneren con el orden rotado correcto
    const baseVal = curDate.getFullYear() * 12 + curDate.getMonth();
    if (state.configMes) {
        let cleared = 0;
        Object.keys(state.configMes).forEach(mk => {
            // mk tiene formato "YYYY_MM" (0-indexed)
            const [mkY, mkM] = mk.split('_').map(Number);
            if (mkY * 12 + mkM >= baseVal) {
                delete state.configMes[mk];
                cleared++;
            }
        });
        if (cleared > 0) console.log(`🔄 configMes: ${cleared} mes(es) desde ${MONTHS[curDate.getMonth()]} ${curDate.getFullYear()} borrados y se regenerarán automáticamente.`);
    }

    await saveState();
    renderRotationView();
    alert(`¡Base Absoluta establecida para el Plan '${_planName}'!\nEl orden de turno de todos los meses desde ${MONTHS[curDate.getMonth()]} ${curDate.getFullYear()} en adelante se ha recalculado automáticamente.`);
}

/** Borra la excepción del mes visible y devuelve el cálculo al orden matemático natural. */
async function clearCustomMonth() {
    const _dk = formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1);
    const _pr = state.planRotations?.[getCurrentRotPlan(_dk)];
    if (_pr) delete _pr.customRotations[getRotationKey(curDate.getFullYear(), curDate.getMonth())];
    await saveState(); 
    editingGroups = null; 
    checkAutomaticGraduation();
    renderAll(); 
    alert("Excepción borrada. El mes vuelve a su cálculo matemático."); 
}

/**
 * Calcula cuántos festivos/fin-de-semana obligatorios existen ese mes y cuántos debe hacer cada residente.
 * @param {number} ano
 * @param {number} mes - 0-indexed
 * @returns {{ huecosFestivosObligatorios: number, cargaMedia: string, minimoExigible: number, necesitaRepartoEquitativo: boolean }}
 */
function calcularViabilidadFestivosMensual(ano, mes) {
    const totalDias = getDaysInMonth(ano, mes);
    let huecosFestivosObligatorios = 0;
    
    // Obtenemos un plan de referencia para saber qué servicios hay
    const miPlan = promoConfig.planes && promoConfig.planes.length > 0 ? promoConfig.planes[0] : null;
    
    if (miPlan) {
        // 1. Contar cuántas plazas de festivo hay que cubrir obligatoriamente este mes
        for (let d = 1; d <= totalDias; d++) {
            const tag = getDayTag(ano, mes, d);
            const dk = formatDateKey(ano, mes, d);
            miPlan.servicios.forEach(svc => {
                if (svc.requiereHabilitacion && !isServiceEnabledOnDate(svc.nombre, dk)) return;
                
                // Si es festivo/fin de semana, O si el servicio exige cobertura total siempre
                if (tag === 'fin_de_semana' || tag === 'festivo_intersemanal' || svc.coberturaObligatoria) {
                    huecosFestivosObligatorios += (svc.plazasPorDia > 0 ? svc.plazasPorDia : 0);
                }
            });
        }
    }
    
    const totalResidentes = getAllResidents().length;
    if (totalResidentes === 0) return { cargaMedia: 0, viable: true };
    

    const cargaMedia = huecosFestivosObligatorios / totalResidentes;    const minimoExigible = Math.floor(cargaMedia); 
    
    let minGlob = (promoConfig.planes && promoConfig.planes[0] && promoConfig.planes[0].minGlobalFestivos !== undefined) ? promoConfig.planes[0].minGlobalFestivos : 1;
    
    return {
        huecosFestivosObligatorios,
        cargaMedia: cargaMedia.toFixed(2),
        minimoExigible: Math.max(minGlob, minimoExigible),
        necesitaRepartoEquitativo: cargaMedia > minGlob
    };
}
	
/**
 * Suma las guardias de cada residente en los meses anteriores al objetivo, filtradas por tipo de día.
 * Sólo cuenta guardias del mismo año de residencia (nivel) que tiene el residente en el mes objetivo.
 * @param {number} targetY
 * @param {number} targetM - 0-indexed
 * @param {string[]} validTags - etiquetas ICS a contar (ej: ['fin_de_semana','festivo_intersemanal'])
 * @param {string|null} targetSvc - si se indica, filtra por nombre de servicio
 * @param {boolean} includeCurrentMonth - si true incluye el mes objetivo en el cómputo
 * @returns {Object} { nombre_mostrar: count }
 */
function getHistoricoFestivosResidentes(targetY, targetM, validTags, targetSvc = null, includeCurrentMonth = false) {
    if (!validTags) validTags = ['fin_de_semana', 'festivo_intersemanal'];

    let historico = {};
    getAllResidents().forEach(r => historico[r] = 0);

    if (!state.shifts) return historico;

    const computed = getComputedShifts();
    Object.keys(computed).forEach(dk => {
        const parts = dk.split('_');
        const y = parseInt(parts[0]), m = parseInt(parts[1]) - 1, d = parseInt(parts[2]);

        // 1. Filtro temporal: histórico puro o incluyendo mes actual según criterio
        if (y > targetY || (y === targetY && (includeCurrentMonth ? m > targetM : m >= targetM))) return;
        
        const tag = getDayTag(y, m, d);
        if (!validTags.includes(tag)) return;
        
        Object.keys(computed[dk] || {}).forEach(user => {
            const uProfile = globalProfiles.find(p => p.nombre_mostrar === user);
            if (!uProfile) return;

            // 2. Calculamos el nivel del residente EN EL MOMENTO DE LA GUARDIA
            const nivelGuardia = getUserLevelOnDate(uProfile, dk);
            
            // 3. Calculamos el nivel del residente EN EL MES OBJETIVO
            const nivelObjetivo = getUserLevelOnDate(uProfile, formatDateKey(targetY, targetM, 1));

            // 4. SOLO contamos si estamos en el mismo año de residencia
            if (nivelGuardia === nivelObjetivo) {
                if (targetSvc && computed[dk][user] !== targetSvc) return;
                if (historico[user] !== undefined) historico[user]++;
            }
        });
    });
    
    return historico;
}

/**
 * Renderiza el banner de alerta de carga mensual bajo el calendario principal.
 * Muestra el estado de la subasta (abierta/cerrada), los nominados y la distribución proyectada.
 */
function renderAlertaCargaMensual() {
    const container = document.getElementById('alerta-carga-mensual');
    if (!container) return;
    container.innerHTML = '';

    const y = curDate.getFullYear();
    const m = curDate.getMonth();
    const mk = getRotationKey(y, m);
    if (!state.configMes || !state.configMes[mk]) return;

    const analisis = getAnalisisFestivos(y, m);
    if (analisis.estado === 'libre') return;

    let criterioTexto = "suerte aleatoria";
    if (analisis.criterio === 'historico_festivos') criterioTexto = "tienen el menor histórico de Festivos";
    else if (analisis.criterio === 'historico_laborables') criterioTexto = "tienen el menor histórico de Laborables";
    else if (analisis.criterio === 'historico_intersemanales') criterioTexto = "tienen el menor histórico de Fest. Intersemanales";
    else if (analisis.criterio === 'historico_total') criterioTexto = "tienen el menor histórico de Guardias en Total";
    else if (analisis.criterio === 'historico_servicio') criterioTexto = `tienen el menor histórico de guardias en ${analisis.svcNombre}`;
    else if (analisis.criterio === 'historico_servicio_dinamico') criterioTexto = `tienen el menor histórico de guardias en ${analisis.servicioCriterio || analisis.svcNombre}`;

    const nombresImplicados = analisis.nominados.map(r => `<b>${r}</b> ${analisis.criterio !== 'aleatorio' ? `(${analisis.historico[r]||0} contados)` : ''}`).join(', ');

    // Contar huecos vacíos reales del calendario (slots, no residentes en exceso).
    // Usar el mismo plan que resolvió getAnalisisFestivos (via planNombre) para garantizar consistencia.
    const planRef = (promoConfig.planes || []).find(p => p.nombre === analisis.planNombre) || promoConfig.planes?.[0];
    const svcRef = planRef?.servicios?.find(s => s.nombre === analisis.svcNombre);
    let huecosCount = Math.ceil(analisis.exceso); // fallback si no se puede calcular
    if (svcRef) {
        huecosCount = 0;
        const totalDiasRef = getDaysInMonth(y, m);
        const planResidentSet = new Set(analisis.planResidentes || []);
        for (let d = 1; d <= totalDiasRef; d++) {
            const tag = getDayTag(y, m, d);
            if ((svcRef.subastaTrigger || []).includes(tag)) {
                const dk = formatDateKey(y, m, d);
                if (svcRef.requiereHabilitacion && !isServiceEnabledOnDate(svcRef.nombre, dk, planRef?.nombre)) continue;
                let assigned = 0;
                if (state.shifts[dk]) {
                    for (const u in state.shifts[dk]) {
                        if (state.shifts[dk][u] === svcRef.nombre && !u.startsWith('VRE')
                            && (!planResidentSet.size || planResidentSet.has(u))) assigned++;
                    }
                }
                const needed = getPlazasForDay(svcRef, dk);
                if (assigned < needed) huecosCount += (needed - assigned);
            }
        }
    }

    const proyeccion = proyectarAsignacionForzosa(y, m, analisis);
    let proyeccionHtml = '';
    if (proyeccion.proyecciones.length > 0) {
        const filas = proyeccion.proyecciones.map(p => {
            const dia = parseInt(p.dk.split('_')[2]);
            if (p.tipo === 'imposible') {
                return `<span style="display:inline-block;background:#fee2e2;border-radius:6px;padding:2px 8px;margin:2px;font-size:0.82rem;">Día ${dia}: <b>Sin candidato legal</b></span>`;
            }
            const badge = p.esNominado
                ? `<span style="background:#fde68a;color:#92400e;border-radius:4px;padding:1px 5px;font-size:0.75rem;margin-left:4px;">nominado</span>`
                : `<span style="background:#dbeafe;color:#1e40af;border-radius:4px;padding:1px 5px;font-size:0.75rem;margin-left:4px;">sustituto</span>`;
            return `<span style="display:inline-block;background:rgba(0,0,0,0.05);border-radius:6px;padding:2px 8px;margin:2px;font-size:0.82rem;">Día ${dia}: <b>${p.residente}</b>${badge}</span>`;
        }).join('');
        const salvadosLine = proyeccion.salvados.length > 0
            ? `<div style="margin-top:5px;font-size:0.8rem;opacity:0.85;">🍀 Salvados por descanso: <b>${proyeccion.salvados.join(', ')}</b></div>`
            : '';
        proyeccionHtml = `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed rgba(0,0,0,0.2);">
            <div style="font-size:0.8rem;font-weight:600;margin-bottom:4px;">📋 Distribución proyectada:</div>
            <div>${filas}</div>${salvadosLine}
        </div>`;
    }

    if (analisis.estado === 'subasta_cerrada') {
        container.innerHTML = `
        <div style="background: #fff7ed; border: 2px dashed #f97316; color: #c2410c; padding: 15px; border-radius: 12px; margin-bottom: 20px; font-size: 0.9rem; line-height: 1.5;">
            <div style="display:flex; align-items:center; gap:8px; font-weight: bold; font-size: 1rem; margin-bottom: 6px;">
                ⚖️ Subasta Cerrada - Justicia Distributiva (${analisis.svcNombre})
            </div>
            Quedan <b>${huecosCount} guardia(s) pendientes</b> en <b>${analisis.svcNombre}</b>.
            El motor exige que ${nombresImplicados} <b>asuman la carga obligatoria</b> ya que ${criterioTexto}.
            ${proyeccionHtml}
            <div style="margin-top:15px;">
                <button onclick="ejecutarAsignacionForzosa(${y}, ${m}, '${analisis.svcNombre}')" class="primary" style="background:var(--fest); width:100%;">⚡ Ejecutar Asignación Forzosa para ${analisis.svcNombre}</button>
            </div>
        </div>`;
    } else if (analisis.estado === 'subasta_abierta') {
        container.innerHTML = `
        <div style="background: #f0fdf4; border: 2px dashed #22c55e; color: #166534; padding: 15px; border-radius: 12px; margin-bottom: 20px; font-size: 0.9rem; line-height: 1.5;">
            <div style="display:flex; align-items:center; gap:8px; font-weight: bold; font-size: 1rem; margin-bottom: 6px;">
                📢 Subasta Voluntaria Abierta - ${analisis.svcNombre} (Quedan ${analisis.horasRestantes} horas)
            </div>
            Quedan <b>${huecosCount} guardia(s) desiertas</b> en <b>${analisis.svcNombre}</b>. Cualquier residente puede adjudicárselas voluntariamente ahora mismo.
            Si siguen desiertas al expirar el tiempo, el motor se las exigirá forzosamente a: ${nombresImplicados}.
            ${proyeccionHtml}
            <div style="margin-top:15px;">
                <button onclick="forzarCierreSubasta(${y}, ${m}, '${analisis.svcNombre}')" class="primary icon-btn" style="background:#dc2626; border-color:#b91c1c;">🚫 Forzar Cierre de Subasta de ${analisis.svcNombre} Ahora</button>
            </div>
        </div>`;
    }
}

/**
 * Cierra la ventana voluntaria de la subasta inmediatamente para un servicio dado.
 * Activa el estado 'subasta_cerrada' marcando la clave en state.subastasCerradasForzosas.
 * @param {number} y
 * @param {number} m
 * @param {string} svcNombre
 */
async function forzarCierreSubasta(y, m, svcNombre) {
    if (!confirm(`¿Seguro que quieres cerrar la subasta de ${svcNombre} inmediatamente? Se requerirá la inyección forzosa para cubrir los huecos restantes.`)) return;
    if (!state.subastasCerradasForzosas) state.subastasCerradasForzosas = {};
    // La clave incluye el plan para no mezclar cierres entre planes distintos
    const analisisCierre = getAnalisisFestivos(y, m);
    const planKey = analisisCierre?.planNombre || '';
    state.subastasCerradasForzosas[`${y}_${m}_${planKey}_${svcNombre}`] = true;
    await saveState();
    renderAll();
}

/**
 * Simula la asignación forzosa sin mutar state: devuelve la distribución proyectada de guardias.
 * Usado para el banner de distribución antes de ejecutar la asignación real.
 * @param {number} y
 * @param {number} m
 * @param {Object} analisis - resultado de getAnalisisFestivos
 * @returns {{ proyecciones: Array, salvados: string[] }}
 */
function proyectarAsignacionForzosa(y, m, analisis) {
    const planRef = (promoConfig.planes || []).find(p => p.nombre === analisis.planNombre) || promoConfig.planes?.[0];
    const svcRef = planRef?.servicios?.find(s => s.nombre === analisis.svcNombre);
    if (!svcRef) return { proyecciones: [], salvados: [] };

    const totalDias = getDaysInMonth(y, m);
    const referenceDk = formatDateKey(y, m, 15);
    let huecosLibres = [];

    for (let d = 1; d <= totalDias; d++) {
        const dk = formatDateKey(y, m, d);
        const tag = getDayTag(y, m, d);
        if (!svcRef.subastaTrigger.includes(tag)) continue;
        if (svcRef.requiereHabilitacion && !isServiceEnabledOnDate(svcRef.nombre, dk, planRef.nombre)) continue;
        let assignedCount = 0;
        if (state.shifts[dk]) {
            for (let u in state.shifts[dk]) {
                if (state.shifts[dk][u] === svcRef.nombre && !u.startsWith('VRE')) {
                    const uProfile = globalProfiles.find(p => p.nombre_mostrar === u);
                    if (!uProfile || getPlanForUserOnDate(uProfile, referenceDk)?.nombre === planRef.nombre) assignedCount++;
                }
            }
        }
        const needed = getPlazasForDay(svcRef, dk);
        if (assignedCount < needed) {
            for (let i = 0; i < (needed - assignedCount); i++) huecosLibres.push({ dk, svc: svcRef.nombre });
        }
    }

    if (huecosLibres.length === 0) return { proyecciones: [], salvados: [] };

    const planResidentes = analisis.planResidentes?.length > 0
        ? analisis.planResidentes
        : (state.configMes?.[getRotationKey(y, m)]?.ordenSeleccion || []);
    const candidatos = [
        ...analisis.nominados,
        ...planResidentes.filter(r => !analisis.nominados.includes(r))
    ];
    const nominadosSet = new Set(analisis.nominados);
    const nominadosBloqueados = new Set();
    const nominadosAsignados = new Set();
    const simulatedShifts = JSON.parse(JSON.stringify(state.shifts || {}));
    const proyecciones = [];

    for (let hIdx = 0; hIdx < huecosLibres.length; hIdx++) {
        const hueco = huecosLibres[hIdx];
        let asignado = false;
        for (let c = 0; c < candidatos.length; c++) {
            const residente = candidatos[c];
            if (simulatedShifts[hueco.dk]?.[residente]) continue;
            const testShifts = JSON.parse(JSON.stringify(simulatedShifts));
            if (!testShifts[hueco.dk]) testShifts[hueco.dk] = {};
            testShifts[hueco.dk][residente] = hueco.svc;
            if (getIllegalShiftsForUser(residente, testShifts).length === 0) {
                if (!simulatedShifts[hueco.dk]) simulatedShifts[hueco.dk] = {};
                simulatedShifts[hueco.dk][residente] = hueco.svc;
                proyecciones.push({ dk: hueco.dk, svc: hueco.svc, residente, esNominado: nominadosSet.has(residente), tipo: 'asignado' });
                if (nominadosSet.has(residente)) nominadosAsignados.add(residente);
                candidatos.push(candidatos.splice(c, 1)[0]);
                asignado = true;
                break;
            } else if (nominadosSet.has(residente)) {
                nominadosBloqueados.add(residente);
            }
        }
        if (!asignado) proyecciones.push({ dk: hueco.dk, svc: hueco.svc, residente: null, esNominado: false, tipo: 'imposible' });
    }

    const salvados = [...nominadosBloqueados].filter(r => !nominadosAsignados.has(r));
    return { proyecciones, salvados };
}

async /**
 * Asigna automáticamente guardias pendientes de un servicio a los nominados por la subasta.
 * Respeta las restricciones de saliente y rota la carga entre los candidatos con fairness.
 * @param {number} y
 * @param {number} m - 0-indexed
 * @param {string} targetSvcNombre - nombre del servicio a cubrir
 */
async function ejecutarAsignacionForzosa(y, m, targetSvcNombre) {
    if (!confirm(`¿Seguro que quieres inyectar automáticamente las guardias pendientes de ${targetSvcNombre} a los nominados?`)) return;
    
    const analisis = getAnalisisFestivos(y, m);
    if (analisis.estado === 'libre' || analisis.svcNombre !== targetSvcNombre) return alert("El estado ha cambiado. Recarga la página.");
    
    const totalDias = getDaysInMonth(y, m);
    let huecosLibres = []; 
    
    const planRef = (promoConfig.planes || []).find(p => p.nombre === analisis.planNombre) || promoConfig.planes?.[0];
    if (!planRef) return;
    const svc = planRef.servicios.find(s => s.nombre === targetSvcNombre);
    if (!svc) return;
    
    for (let d = 1; d <= totalDias; d++) {
        const tag = getDayTag(y, m, d);
        if ((svc.subastaTrigger || []).includes(tag)) {
            const dk = formatDateKey(y, m, d);
            if (svc.requiereHabilitacion && !isServiceEnabledOnDate(svc.nombre, dk, planRef.nombre)) continue;

            let assignedCount = 0;
            if (state.shifts[dk]) {
                for (let u in state.shifts[dk]) {
                    if (state.shifts[dk][u] === svc.nombre && !u.startsWith('VRE')) {
                        // Solo contar shifts del mismo plan (consistente con getAnalisisFestivos)
                        const uProfile = globalProfiles.find(p => p.nombre_mostrar === u);
                        const referenceDkE = formatDateKey(y, m, 15);
                        if (!uProfile || getPlanForUserOnDate(uProfile, referenceDkE)?.nombre === planRef.nombre) {
                            assignedCount++;
                        }
                    }
                }
            }
            const needed = getPlazasForDay(svc, dk);
            if (assignedCount < needed) {
                for (let i = 0; i < (needed - assignedCount); i++) {
                    huecosLibres.push({ dk, svc: svc.nombre });
                }
            }
        }
    }

    if (huecosLibres.length === 0) return alert("No se han detectado huecos libres de este servicio en el calendario.");

    // Nominados primero; fallback limitado a residentes del mismo plan (no pool global)
    const planResidentes = analisis.planResidentes?.length > 0
        ? analisis.planResidentes
        : (state.configMes?.[getRotationKey(y, m)]?.ordenSeleccion || []);
    const candidatos = [
        ...analisis.nominados,
        ...planResidentes.filter(r => !analisis.nominados.includes(r))
    ];
    const nominadosSet = new Set(analisis.nominados);
    const nominadosBloqueados = new Set(); // nominados rechazados por descanso en ≥1 hueco
    const nominadosAsignados = new Set();  // nominados que recibieron ≥1 asignación
    let asignacionesLog = [];
    let huecosImpossibles = [];
    let huecosAsignados = 0;

    for (let hIdx = 0; hIdx < huecosLibres.length; hIdx++) {
        const hueco = huecosLibres[hIdx];
        let asignado = false;

        for (let c = 0; c < candidatos.length; c++) {
            const residente = candidatos[c];
            if (state.shifts[hueco.dk]?.[residente]) continue; // ya cubre este día

            const projected = JSON.parse(JSON.stringify(state.shifts || {}));
            if (!projected[hueco.dk]) projected[hueco.dk] = {};
            projected[hueco.dk][residente] = hueco.svc;

            if (getIllegalShiftsForUser(residente, projected).length === 0) {
                if (!state.shifts[hueco.dk]) state.shifts[hueco.dk] = {};
                state.shifts[hueco.dk][residente] = hueco.svc;
                asignacionesLog.push(`${residente} → ${hueco.svc} (${formatDK(hueco.dk)})`);
                huecosAsignados++;
                if (nominadosSet.has(residente)) nominadosAsignados.add(residente);
                candidatos.push(candidatos.splice(c, 1)[0]); // rotación fairness
                asignado = true;
                break;
            } else if (nominadosSet.has(residente)) {
                // Nominado bloqueado por conflicto de descanso (saliente/entrante)
                nominadosBloqueados.add(residente);
            }
        }

        if (!asignado) {
            huecosImpossibles.push(`${hueco.svc} (${formatDK(hueco.dk)})`);
        }
    }

    await saveState();
    renderAll();

    // Nominados que no recibieron ninguna asignación por restricción de descanso
    const salvados = [...nominadosBloqueados].filter(r => !nominadosAsignados.has(r));

    let mensajeFinal = `Inyección Forzosa procesada.\n\nSe asignaron ${huecosAsignados} guardia(s):\n${asignacionesLog.join('\n')}`;
    if (salvados.length > 0) {
        mensajeFinal += `\n\n🍀 Salvados por restricción de descanso (saliente/entrante):\n${salvados.join(', ')} — estaban nominados pero ningún hueco disponible era legal para ellos.`;
    }
    if (huecosImpossibles.length > 0) {
        mensajeFinal += `\n\n⚠️ ${huecosImpossibles.length} hueco(s) imposibles de cubrir sin violar descansos:\n${huecosImpossibles.join('\n')}`;
    }

    alert(mensajeFinal);
}

/**
 * Actualiza el nombre visible del usuario en Supabase y recarga la página.
 * Impide duplicados comprobando el resto de globalProfiles antes de persistir.
 */
async function guardarNombrePerfil() {
    const nuevoNombre = document.getElementById('perfil-nombre-mostrar').value.trim();
    if (!nuevoNombre) return alert("El nombre no puede estar vacío.");
    if (nuevoNombre === currentUserProfile.nombre_mostrar) return alert("El nombre es el mismo.");
    
    // Check if another user already has this name
    const existe = globalProfiles.find(p => p.nombre_mostrar === nuevoNombre && p.id !== currentUserProfile.id);
    if (existe) return alert("Ese nombre ya está en uso por otra persona.");

    const confirmacion = confirm(`¿Estás seguro de cambiar tu nombre de '${currentUserProfile.nombre_mostrar}' a '${nuevoNombre}'? (Esto requerirá que recargues la app)`);
    if (!confirmacion) return;

    // Actualizar Supabase
    const { error } = await supabaseClient
        .from('perfiles')
        .update({ nombre_mostrar: nuevoNombre })
        .eq('id', currentUserProfile.id);

    if (error) {
        console.error(error);
        return alert("Error al guardar el nombre en la base de datos.");
    }
    
    alert("Nombre actualizado correctamente. Por favor, refresca la página para aplicar los cambios en toda la app.");
    window.location.reload();
}

// ============================================================
// MÓDULO: MOTOR_SUBASTAS
// Exportar a: src/modules/motorSubastas.js
// Líneas estimadas: ~390
// Dependencias externas: state, promoConfig, globalProfiles, curDate
// Helpers que usa: getDaysInMonth, formatDateKey, getDayTag, isServiceEnabledOnDate, getPlazasForDay, getHistoricoFestivosResidentes, getResidentesActivosEnMes, getUserProgress, getPlanForUserOnDate, getComputedShifts, saveState, renderAll, getRotationKey
// ============================================================
/**
 * Punto de entrada del motor de subastas. Calcula el estado del mes (libre / subasta_abierta /
 * subasta_cerrada / critico), los nominados para asignación forzosa y el exceso de huecos.
 * Usa un guard _computingAnalisis para evitar recursión con getUserProgress.
 * @param {number} y
 * @param {number} m - 0-indexed
 * @returns {{ estado: string, exceso: number, nominados: string[], svcNombre: string|null, horasRestantes?: number }}
 */
function getAnalisisFestivos(y, m) {
    if (_computingAnalisis) return { estado: 'libre', exceso: 0, nominados: [], svcNombre: null };
    _computingAnalisis = true;
    try {
    return _getAnalisisFestivosImpl(y, m);
    } finally {
    _computingAnalisis = false;
    }
}
/** Implementación interna del análisis de festivos; no debe llamarse directamente (usa getAnalisisFestivos). */
function _getAnalisisFestivosImpl(y, m) {
    const mk = getRotationKey(y, m);
    // Salvaguarda: solo consideramos la ronda terminada si al menos alguien ha asignado una guardia este mes.
    // Evita que la subasta salte en un mes completamente vacío antes de que nadie haya elegido.
    const monthPrefix = `${y}_${String(m + 1).padStart(2, '0')}_`;
    const monthHasAnyShifts = Object.keys(state.shifts || {}).some(dk => dk.startsWith(monthPrefix));

    const referenceDk = formatDateKey(y, m, 15);
    const miPlan = getPlanForUserOnDate(currentUserProfile, referenceDk) || promoConfig.planes?.[0];
    if (!miPlan) return { estado: 'libre', exceso: 0, nominados: [], svcNombre: null };

    // Ronda terminada solo cuando todos los residentes del plan del usuario han completado el turno.
    // Esto vincula la subasta al plan específico que terminó de elegir, no a la rotación global.
    let rondaTerminada = false;
    if (state.configMes && state.configMes[mk]) {
        const ordenSeleccion = state.configMes[mk].ordenSeleccion || [];
        const activosMes = getResidentesActivosEnMes(y, m);
        const residentsOnMyPlan = ordenSeleccion.filter(r => {
            const rProfile = globalProfiles.find(p => p.nombre_mostrar === r);
            if (!rProfile) return false;
            return getPlanForUserOnDate(rProfile, referenceDk)?.nombre === miPlan.nombre;
        });
        if (residentsOnMyPlan.length > 0) {
            const allDone = residentsOnMyPlan.every(r => {
                if (!activosMes.some(a => a.toLowerCase() === r.toLowerCase())) return true;
                if (state.configMes[mk].pausados?.[r]) return true;
                if ((state.skippedTurns?.[mk] || []).includes(r)) return true;
                return getUserProgress(r, y, m).isFinished;
            });
            const allSkipped = residentsOnMyPlan.every(r =>
                (state.skippedTurns?.[mk] || []).includes(r) || state.configMes[mk].pausados?.[r]
            );
            if (allDone && (monthHasAnyShifts || allSkipped)) rondaTerminada = true;
        }
    }

    if (!rondaTerminada) {
        return { estado: 'libre', exceso: 0, nominados: [], svcNombre: null };
    }

    // keyMes incluye el plan para que cada plan tenga su propia marca de inicio de ventana voluntaria
    const keyMes = `${y}_${m}_${miPlan.nombre}`;
    if (!state.fechaFinRonda) state.fechaFinRonda = {};
    if (!state.fechaFinRonda[keyMes]) {
        state.fechaFinRonda[keyMes] = Date.now();
        saveState(); // Fire and forget
    }

    const totalDias = getDaysInMonth(y, m);

    // Candidatos y nominados son únicamente los residentes del plan del usuario
    const residentes = getAllResidents().filter(residente => {
        if (state.excluidosSubastas && state.excluidosSubastas.includes(residente)) return false;
        const tieneBaja = (state.bajasLargas||[]).some(baja => {
            if (baja.user !== residente || baja.estado !== 'aprobada') return false;
            const bInicio = new Date(baja.fechaInicio);
            const bFin = new Date(baja.fechaFin);
            return (bInicio <= new Date(y, m, totalDias) && bFin >= new Date(y, m, 1));
        });
        if (tieneBaja) return false;
        const rProfile = globalProfiles.find(p => p.nombre_mostrar === residente);
        if (!rProfile) {
            // Residente virtual: incluir si pertenece a este plan por baseGroups
            const vPlan = state.planRotations?.[miPlan.nombre];
            return (vPlan?.baseGroups || []).flat().includes(residente);
        }
        return getPlanForUserOnDate(rProfile, referenceDk)?.nombre === miPlan.nombre;
    });
    
    if (residentes.length === 0) return { estado: 'libre', exceso: 0, nominados: [], svcNombre: null };

    const serviciosOrdenados = [...miPlan.servicios].sort((a, b) => (a.ordenSubasta || 999) - (b.ordenSubasta || 999));
    // FIX: usar getComputedShifts() para que las compras/ventas del mercadillo
    // también cuenten como huecos cubiertos y reduzcan correctamente el exceso.
    const computedShiftsRef = getComputedShifts();
    for (let i = 0; i < serviciosOrdenados.length; i++) {
        const svc = serviciosOrdenados[i];

        if (!svc.subastaTrigger || svc.subastaTrigger.length === 0) continue;

        let huecosObligatoriosSvc = 0;
        let huecosAsignadosSvc = 0;

        for (let d = 1; d <= totalDias; d++) {
            const dk = formatDateKey(y, m, d);
            const tag = getDayTag(y, m, d);

            if (svc.subastaTrigger.includes(tag)) {
                if (svc.requiereHabilitacion && !isServiceEnabledOnDate(svc.nombre, dk, miPlan.nombre)) continue;

                const needed = getPlazasForDay(svc, dk);
                huecosObligatoriosSvc += needed;

                if (computedShiftsRef[dk]) {
                    for (let u in computedShiftsRef[dk]) {
                        if (computedShiftsRef[dk][u] === svc.nombre && !u.startsWith('VRE')) {
                            // Solo contar shifts de residentes del mismo plan
                            const uProfile = globalProfiles.find(p => p.nombre_mostrar === u);
                            if (!uProfile || getPlanForUserOnDate(uProfile, referenceDk)?.nombre === miPlan.nombre) {
                                huecosAsignadosSvc++;
                            }
                        }
                    }
                }
            }
        }

        const excesoSvc = huecosObligatoriosSvc - huecosAsignadosSvc;
        
        if (excesoSvc > 0) {
            const _getHist = (crit, targetSvc) => {
                // includeCurrentMonth=true en todos los criterios: la subasta debe contar
                // el año completo de residencia incluyendo el mes en curso
                if (crit === 'historico_festivos') return getHistoricoFestivosResidentes(y, m, ['fin_de_semana', 'festivo_intersemanal'], null, true);
                if (crit === 'historico_laborables') return getHistoricoFestivosResidentes(y, m, ['laborable'], null, true);
                if (crit === 'historico_intersemanales') return getHistoricoFestivosResidentes(y, m, ['festivo_intersemanal'], null, true);
                if (crit === 'historico_total') return getHistoricoFestivosResidentes(y, m, ['laborable', 'vispera', 'fin_de_semana', 'festivo_intersemanal'], null, true);
                if (crit === 'historico_servicio') return getHistoricoFestivosResidentes(y, m, ['laborable', 'vispera', 'fin_de_semana', 'festivo_intersemanal'], svc.nombre, true);
                if (crit === 'historico_servicio_dinamico') {
                    const exists = miPlan.servicios.some(s => s.nombre === targetSvc);
                    if (!exists) return null; // fallback signal
                    return getHistoricoFestivosResidentes(y, m, ['laborable', 'vispera', 'fin_de_semana', 'festivo_intersemanal'], targetSvc, true);
                }
                return null;
            };

            let historico = _getHist(svc.subastaCriterio, svc.subastaCriterioServicio);
            let fallbackPri = false;
            if (!historico && svc.subastaCriterio !== 'aleatorio') fallbackPri = true;

            let historicoDesempate = null;
            let fallbackDes = false;
            if (svc.subastaDesempate && svc.subastaDesempate !== 'aleatorio') {
                historicoDesempate = _getHist(svc.subastaDesempate, svc.subastaDesempateServicio);
                if (!historicoDesempate) fallbackDes = true;
            }
            
            // Nominados: se calculan una sola vez y se persisten en state para que todos los
            // usuarios vean el mismo resultado (el sorteo aleatorio por empate solo ocurre una vez).
            // La clave incluye criterio+desempate: si el admin los cambia, el cache se invalida automáticamente.
            const criterioSuffix = `${svc.subastaCriterio || 'aleatorio'}_${svc.subastaCriterioServicio || ''}_${svc.subastaDesempate || 'none'}_${svc.subastaDesempateServicio || ''}`;
            // Incluir plan en la clave: R1 y R2 tienen "Urgencias HUAV" separados
            const nominadosKey = `${y}_${m}_${miPlan.nombre}_${svc.nombre}_${criterioSuffix}`;
            let nominados = [];

            const storedNominados = state.subastaNominados?.[nominadosKey];
            const esDeterminista = svc.subastaCriterio !== 'aleatorio' && !fallbackPri;

            if (!esDeterminista && storedNominados && storedNominados.length >= excesoSvc) {
                // Criterio aleatorio: cache válido y suficiente; slice por si alguien tomó slots voluntariamente
                nominados = storedNominados.slice(0, excesoSvc);
            } else if (svc.subastaCriterio === 'aleatorio' || fallbackPri) {
                // Criterio aleatorio sin cache suficiente: sortear y persistir
                nominados = [...residentes].sort(() => Math.random() - 0.5).slice(0, excesoSvc);
                if (!state.subastaNominados) state.subastaNominados = {};
                state.subastaNominados[nominadosKey] = nominados;
                saveState();
            } else {
                // Criterio determinista: siempre recomputar con el histórico actual (nunca usar cache).
                // El resultado es reproducible para todos los usuarios sin necesidad de persistirlo.
                // Desempate dentro de tramos igualados: orden alfabético (estable y consistente).
                const residentesOrdenados = [...residentes].sort((a, b) => {
                    const diff = (historico[a] || 0) - (historico[b] || 0);
                    if (diff !== 0) return diff;
                    if (historicoDesempate && !fallbackDes) {
                        const diffDes = (historicoDesempate[a] || 0) - (historicoDesempate[b] || 0);
                        if (diffDes !== 0) return diffDes;
                    }
                    return 0;
                });
                let _idx = 0;
                while (nominados.length < excesoSvc && _idx < residentesOrdenados.length) {
                    const _r0 = residentesOrdenados[_idx];
                    const _pri0 = (historico[_r0] || 0);
                    const _des0 = (historicoDesempate && !fallbackDes) ? (historicoDesempate[_r0] || 0) : null;
                    const tramo = [];
                    while (_idx < residentesOrdenados.length) {
                        const _r = residentesOrdenados[_idx];
                        if ((historico[_r] || 0) !== _pri0) break;
                        if (_des0 !== null && (historicoDesempate[_r] || 0) !== _des0) break;
                        tramo.push(_r);
                        _idx++;
                    }
                    const _needed = excesoSvc - nominados.length;
                    if (tramo.length <= _needed) {
                        nominados.push(...tramo);
                    } else {
                        // Tramo empatado: desempate alfabético (determinista, mismo resultado para todos)
                        nominados.push(...[...tramo].sort((a, b) => a.localeCompare(b)).slice(0, _needed));
                    }
                }
                // No persistir: el resultado es determinista y siempre se recomputa igual
            }
            
            const inicioRonda = state.fechaFinRonda[keyMes];
            const horasTranscurridas = (Date.now() - inicioRonda) / (1000 * 60 * 60);
            
            let estado = 'subasta_abierta';
            // Clave incluye plan para distinguir cierre forzoso por plan
            const isForzada = state.subastasCerradasForzosas && state.subastasCerradasForzosas[`${y}_${m}_${miPlan.nombre}_${svc.nombre}`];
            
            const ventanaHoras = promoConfig.ventana_voluntaria_horas || 48;
            if (horasTranscurridas >= ventanaHoras || isForzada) {
                estado = 'subasta_cerrada';
            }

            const horasRestantes = Math.max(0, ventanaHoras - horasTranscurridas);
            
            return {
                estado,
                exceso: excesoSvc,
                nominados,
                planResidentes: residentes,
                svcNombre: svc.nombre,
                planNombre: miPlan.nombre,
                servicioCriterio: svc.subastaCriterioServicio || svc.nombre,
                horasRestantes: Math.floor(horasRestantes),
                criterio: svc.subastaCriterio,
                historico
            };
        }
    }
    
    return { estado: 'libre', exceso: 0, nominados: [], svcNombre: null };
}

// ============================================================
// MÓDULO: MOTOR_TURNO
// Exportar a: src/modules/motorTurno.js
// Líneas estimadas: ~210
// Dependencias externas: state.configMes, state.skippedTurns, state.grantedTurn, promoConfig, globalProfiles
// Helpers que usa: getRotationKey, getRotationForPlan, getPlanForUserOnDate, getUserProgress, getResidentesActivosEnMes, formatDateKey, saveState, renderAll
// ============================================================

// Guard para evitar recursión: getCurrentTurn → getUserProgress → getAnalisisFestivos → getCurrentTurn
let _computingTurn = false;
let _computingAnalisis = false;

// 🔧 DEBUG TEMPORAL – ejecutar en consola: debugTurn()
window.debugTurn = function() {
    const y = curDate.getFullYear(), m = curDate.getMonth();
    const mk = getRotationKey(y, m);
    console.group('🔍 debugTurn() – ' + mk + '  (y=' + y + ' m=' + m + ')');
    console.log('promoConfig.planes:', promoConfig.planes?.map(p => p.nombre));
    console.log('state.planRotations keys:', Object.keys(state.planRotations || {}));
    const cm = state.configMes?.[mk];
    console.log('state.configMes[mk].ordenSeleccion:', cm?.ordenSeleccion);
    console.log('state.skippedTurns[mk]:', state.skippedTurns?.[mk]);

    // Mostrar orden de rotación real (el que usa la UI) por cada plan
    for (const plan of (promoConfig.planes || [])) {
        const pr = state.planRotations?.[plan.nombre];
        if (!pr) { console.log(`Plan ${plan.nombre}: sin planRotations`); continue; }
        const targetVal = y * 12 + m;
        const baseVal = (parseInt(pr.baseYear,10)||0) * 12 + (parseInt(pr.baseMonth,10)||0);
        console.log(`📅 ${plan.nombre}: baseYear=${pr.baseYear} baseMonth=${pr.baseMonth} → baseVal=${baseVal}  targetVal=${targetVal}  diff=${targetVal-baseVal}`);
        const rot = getRotationForPlan(plan.nombre, y, m);
        console.log(`   getRotationForPlan result:`, rot?.map(g => g.length + ':' + JSON.stringify(g)));
    }

    const activos = getResidentesActivosEnMes(y, m);
    const saltados = state.skippedTurns?.[mk] || [];
    console.log('activosMes:', activos);

    if (cm?.ordenSeleccion) {
        console.group('📋 Traza del bucle (secuencial):');
        for (let i = 0; i < cm.ordenSeleccion.length; i++) {
            const r = cm.ordenSeleccion[i];
            const enActivos = activos.includes(r);
            const pausado = cm.pausados?.[r] || false;
            const saltado = saltados.includes(r);
            const prog = getUserProgress(r, y, m);
            console.log(`i=${i} "${r}" | enActivos=${enActivos} pausado=${pausado} saltado=${saltado} isFinished=${prog.isFinished}`);
            if (!enActivos || pausado || saltado) continue;
            if (!prog.isFinished) {
                console.log(`  → ¡LE TOCA A ${r}!`);
                break;
            }
        }
        console.groupEnd();
    }

    const turn = getCurrentTurn(y, m);
    console.log('getCurrentTurn() result:', turn);
    console.groupEnd();
};

// 🔧 RESET del ordenSeleccion del mes actual (útil si quedó guardado con orden incorrecto)
// Ejecutar en consola: resetConfigMes()
window.resetConfigMes = async function() {
    const y = curDate.getFullYear(), m = curDate.getMonth();
    const mk = getRotationKey(y, m);
    if (state.configMes && state.configMes[mk]) {
        delete state.configMes[mk];
        await saveState();
        console.log('✅ configMes[' + mk + '] borrado. Regenerando...');
        renderAll();
    } else {
        console.log('ℹ️ No había configMes[' + mk + '] guardado.');
    }
};

// 🔧 Corrección del mes base de un plan. Uso: fixPlanBaseMonth('Plan R2', 5)
// newBaseMonth = 0-indexed (0=enero, 5=junio, 6=julio...)
window.fixPlanBaseMonth = async function(planName, newBaseMonth, newBaseYear) {
    const pr = state.planRotations?.[planName];
    if (!pr) { console.error('❌ Plan no encontrado:', planName); return; }
    const oldM = pr.baseMonth, oldY = pr.baseYear;
    pr.baseMonth = newBaseMonth;
    if (newBaseYear !== undefined) pr.baseYear = newBaseYear;
    await saveState();
    console.log('✅ ' + planName + ': baseMonth ' + oldM + '→' + newBaseMonth + '  baseYear ' + oldY + '→' + pr.baseYear);
    console.log('   Ejecuta resetAllConfigMes() para limpiar el cache de orden del mes.');
};

// 🔧 Borra el configMes de TODOS los meses para que se regeneren con el orden correcto
window.resetAllConfigMes = async function() {
    state.configMes = {};
    await saveState();
    console.log('✅ Todos los configMes borrados. Regenerando...');
    renderAll();
};

// Invalida el cache de ordenSeleccion para que se recalcule en el próximo renderizado
/**
 * Borra el configMes cacheado del mes indicado (o de todos si no se pasa clave)
 * para forzar que getCurrentTurn regenere el orden de selección.
 * @param {string} [mk] - clave "YYYY_MM"; si se omite, limpia todo el cache
 */
function invalidateConfigMes(mk) {
    if (mk) {
        if (state.configMes && state.configMes[mk]) {
            delete state.configMes[mk];
        }
    } else {
        state.configMes = {};
    }
}

/**
 * Devuelve el nombre del residente cuyo turno está activo en el mes dado.
 * Genera/cachea el orden en state.configMes si no existe. Respeta grantedTurn,
 * bajasLargas, skippedTurns y pausados. Usa guard _computingTurn anti-recursión.
 * @param {number} y
 * @param {number} m - 0-indexed
 * @returns {string|null} nombre_mostrar o null si todos han completado
 */
function getCurrentTurn(y, m) {
    if (_computingTurn) return null; // Corta la recursión
    const mk = getRotationKey(y, m);
    
    // Si no hay configMes para este mes, lo generamos automáticamente
    if (!state.configMes || !state.configMes[mk]) {
        const dk = formatDateKey(y, m, 15);
        const targetKey = getRotationKey(y, m);
        let flatOrden = [];
        
        // Recorremos TODOS los planes en orden (R1, R2, R3, R4...)
        // Llamamos a getRotationForPlan para obtener el orden YA ROTADO de cada plan,
        // igual que lo que se muestra en la UI de rotación.
        for (const plan of (promoConfig.planes || [])) {
            if (!state.planRotations?.[plan.nombre]) continue;
            
            // getRotationForPlan devuelve los grupos correctamente rotados para este mes
            const rotGroups = getRotationForPlan(plan.nombre, y, m);
            const planFlat = (rotGroups || []).flat();
            
            // Solo incluir a quienes realmente pertenecen a este plan este mes y están aprobados
            // Solo incluir a quienes realmente pertenecen a este plan este mes y están aprobados (y permitir residentes virtuales que ya forman parte del plan rotado)
            const enEstePlan = planFlat.filter(n => {
                const p = globalProfiles.find(pr2 => pr2.nombre_mostrar === n);
                if (!p) return true; // Si es virtual, se incluye por defecto en su plan asignado
                if (p.estado !== 'aprobado') return false;
                const planActual = getPlanForUserOnDate(p, dk);
                return planActual && planActual.nombre === plan.nombre;
            });
            
            for (const r of enEstePlan) {
                if (!flatOrden.includes(r)) flatOrden.push(r);
            }
        }
        
        // Último recurso: cualquier aprobado con plan válido este mes
        if (flatOrden.length === 0) {
            flatOrden = globalProfiles
                .filter(p => p.estado === 'aprobado' && getPlanForUserOnDate(p, dk) !== null)
                .map(p => p.nombre_mostrar);
        }
        
        if (flatOrden.length === 0) return null;
        if (!state.configMes) state.configMes = {};
        state.configMes[mk] = { ordenSeleccion: flatOrden, pausados: {} };
    }
    
    _computingTurn = true;
    try {
        const orden = state.configMes[mk].ordenSeleccion || [];
        if (orden.length === 0) return null;
        
        // 💡 TURNO OTORGADO: si el admin otorgó el turno a alguien, tiene prioridad absoluta
        if (!state.grantedTurn) state.grantedTurn = {};
        const grantee = state.grantedTurn[mk];
        if (grantee) {
            const activosMesG = getResidentesActivosEnMes(y, m);
            const isActive = activosMesG.some(a => a.toLowerCase() === grantee.toLowerCase());
            if (isActive) {
                const progG = getUserProgress(grantee, y, m);
                if (!progG.isFinished) return grantee; // Sigue siendo su turno
                // Ya terminó → limpiamos el turno otorgado y seguimos con rotación normal
                delete state.grantedTurn[mk];
                saveState(); // guardamos en background, sin await para no bloquear
            } else {
                delete state.grantedTurn[mk];
            }
        }

        // 💡 FILTRO DE BAJAS: Solo consideramos residentes activos para la ronda de turnos de este mes
        const activosMes = getResidentesActivosEnMes(y, m);
        
        // maxGuardias: máximo entre todos los planes (distintos residentes pueden tener planes distintos)
        const maxGuardias = Math.max(
            ...(promoConfig.planes || []).map(p => p.maxGuardiasMes || 5),
            5
        );

        // Recorremos la lista de residentes en orden
        for (let i = 0; i < orden.length; i++) {
            const residente = orden[i];
            
            // 🛑 SI EL RESIDENTE ESTÁ DE BAJA ESTE MES, SE SALTA AUTOMÁTICAMENTE
            // Comparación case-insensitive para evitar problemas de capitalización de nombre
            if (!activosMes.some(a => a.toLowerCase() === residente.toLowerCase())) continue;
            
            // Si el usuario se ha pausado manualmente el mes en la interfaz, lo respetamos
            if (state.configMes[mk].pausados && state.configMes[mk].pausados[residente]) continue;
            
            // Si el usuario ha saltado su turno este mes (o el admin lo saltó), lo ignoramos
            const saltadosMes = state.skippedTurns?.[mk] || [];
            if (saltadosMes.includes(residente)) continue;
            
            // Calculamos qué lleva asignado en este momento
            const prog = getUserProgress(residente, y, m);
            
            // Evaluamos si ya ha completado todas sus guardias de este mes (cupos y festivos)
            if (!prog.isFinished) {
                return residente; // Mantiene el turno hasta que termine TODAS sus guardias
            }
        }
        return null; // Todo el mundo ha completado sus rondas o el mes está cerrado
    } finally {
        _computingTurn = false;
    }
}
// ============================================================
// MÓDULO: BAJAS_ACTIVOS (sub-sección de MOTOR_TURNO)
// Exportar a: src/modules/motorTurno.js  ← mismo archivo
// Líneas estimadas: ~30
// Dependencias externas: state.bajasLargas
// Helpers que usa: getAllResidents
// ============================================================
/**
 * Devuelve todos los residentes que no tienen una baja larga aprobada que solape con el mes dado.
 * @param {number} y
 * @param {number} m - 0-indexed
 * @returns {string[]} array de nombre_mostrar activos en ese mes
 */
function getResidentesActivosEnMes(y, m) {
    const todos = getAllResidents();
    if (!state.bajasLargas) state.bajasLargas = [];

    // Creamos la fecha de inicio y fin del mes que estamos evaluando
    const inicioMes = new Date(y, m, 1);
    const finMes = new Date(y, m + 1, 0);

    return todos.filter(residente => {
        // Buscamos si este residente tiene alguna baja aprobada que solape con este mes
        const tieneBaja = state.bajasLargas.some(baja => {
            if (baja.user !== residente || baja.estado !== 'aprobada') return false;
            
            const bInicio = new Date(baja.fechaInicio);
            const bFin = new Date(baja.fechaFin);
            
            // Si la baja se cruza en cualquier punto con el mes, se solapa
            return (bInicio <= finMes && bFin >= inicioMes);
        });

        return !tieneBaja; // Si tiene baja, queda fuera de los activos del mes
    });
}

/**
 * Calcula las horas de guardia de un residente (mes, año y total histórico),
 * separando guardias completas de partidas en el mes solicitado.
 * @param {string} nombre - nombre_mostrar
 * @param {number} filtroY - año del mes a desglosar
 * @param {number} filtroM - mes (0-indexed) a desglosar
 * @returns {{ horasMes, horasAnio, horasTotal, completasMes, partidasMes }}
 */
function calcHorasResidente(nombre, filtroY, filtroM) {
    const prefMes = `${filtroY}_${String(filtroM + 1).padStart(2, '0')}_`;
    const prefAnio = `${filtroY}_`;
    let horasMes = 0, horasAnio = 0, horasTotal = 0;
    let completasMes = 0, partidasMes = 0;
    for (let dk in state.shifts || {}) {
        if (!state.shifts[dk][nombre]) continue;
        const svcName = state.shifts[dk][nombre];
        const hrs = getShiftHours(dk, svcName, nombre);
        horasTotal += hrs;
        if (dk.startsWith(prefAnio)) {
            horasAnio += hrs;
            if (dk.startsWith(prefMes)) {
                horasMes += hrs;
                const tipo = state.shiftModifiers?.[dk]?.[nombre]?.tipo || 'normal';
                if (tipo === 'partida_primera' || tipo === 'partida_segunda') partidasMes++;
                else completasMes++;
            }
        }
    }
    return { horasMes, horasAnio, horasTotal, completasMes, partidasMes };
}

/**
 * Actualiza los filtros de año/mes del panel de horas del perfil y re-renderiza.
 * @param {number|string} y
 * @param {number|string} m - 0-indexed
 */
function setPerfilHorasFiltro(y, m) {
    perfilHorasFiltroY = +y;
    perfilHorasFiltroM = +m;
    renderPerfilUsuario();
}

// ============================================================
// MÓDULO: PERFIL_USUARIO
// Exportar a: src/modules/perfilUsuario.js
// Líneas estimadas: ~285
// Dependencias externas: currentUserProfile, globalProfiles, state.bajasLargas, supabaseClient
// Helpers que usa: formatDateKey, calcHorasResidente, getPlanForUserOnDate, saveState, renderPerfilUsuario, invalidateConfigMes, formatDK, MONTHS
// ============================================================

/**
 * Renderiza el panel de perfil del usuario: datos personales, contrato, ausencias y auditoría de horas.
 * Calcula el plan activo en la fecha de hoy y muestra la barra de carga laboral histórica.
 */
function renderPerfilUsuario() {
    const uProfile = currentUserProfile;
    if (!uProfile) return;

    // 1. Calcular el plan que le corresponde HOY de forma dinámica
    const hoyDK = formatDateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    const planActivoHoy = getPlanForUserOnDate(uProfile, hoyDK);
    const nombrePlanHoy = planActivoHoy ? planActivoHoy.nombre : 'Sin Plan (Fecha Futura)';

    // 2. Filtrar las ausencias/bajas del propio usuario
    if (!state.bajasLargas) state.bajasLargas = [];
    const misBajas = state.bajasLargas.filter(b => b.user === uProfile.nombre_mostrar);

// 3. 📊 CÓMPUTO DE HORAS POR MES / AÑO / HISTÓRICO
    const { horasMes, horasAnio, horasTotal,
            completasMes, partidasMes } = calcHorasResidente(
                uProfile.nombre_mostrar, perfilHorasFiltroY, perfilHorasFiltroM);

    // ⚖️ PARÁMETROS LEGALES DE HUELGA / FORMACIÓN (referencia all-time)
    const targetHoras = 695;
    const tolerancia = 55;
    const minHoras = targetHoras - tolerancia; // 640h
    const maxHoras = targetHoras + tolerancia; // 750h
    const topeVisual = 850;
    const porcentajeCarga = Math.min(100, (horasTotal / topeVisual) * 100);

    let colorBarra = 'var(--pac)';
    let estadoTexto = 'Déficit Formativo (Revisar)';
    if (horasTotal >= minHoras && horasTotal <= maxHoras) {
        colorBarra = 'var(--ped)';
        estadoTexto = 'Rango Legal y Formativo Óptimo';
    } else if (horasTotal > maxHoras) {
        colorBarra = 'var(--fest)';
        estadoTexto = 'Exceso (Alerta de Descanso)';
    }

    // Opciones para los selectores del recuento de horas
    const _anioActual = new Date().getFullYear();
    const anioOpcionesHoras = [_anioActual - 2, _anioActual - 1, _anioActual].map(y =>
        `<option value="${y}" ${y === perfilHorasFiltroY ? 'selected' : ''}>${y}</option>`).join('');
    const mesOpcionesHoras = MONTHS.map((mn, i) =>
        `<option value="${i}" ${i === perfilHorasFiltroM ? 'selected' : ''}>${mn}</option>`).join('');

    // 4. Preparar las opciones de día y mes para el selector de contrato
    let dMes = '01';
    if (uProfile.fecha_cambio_contrato) {
        const parts = uProfile.fecha_cambio_contrato.split('-');
        if (parts.length >= 2) { dMes = parts[1]; }
    }
    
    const mesOptions = MONTHS.map((m, i) => { 
        let v = String(i+1).padStart(2,'0'); 
        return `<option value="${v}" ${v === dMes ? 'selected' : ''}>${m}</option>`; 
    }).join('');

// 5. Inyección del layout limpio en el contenedor principal
    document.getElementById('contenido-principal').innerHTML = `
        
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; background: white; padding: 15px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); flex-wrap: wrap; gap: 10px;">
            <div>
                <h2 style="margin: 0; color: var(--dark); font-size: 1.5rem;">👤 Mi Perfil</h2>
                <p style="margin: 4px 0 0 0; color: #64748b; font-size: 0.9rem;">Identidad activa: <span style="font-weight: bold; color: var(--dark);">${uProfile.nombre_mostrar}</span></p>
            </div>
            <div style="background: #e0f2fe; color: #0369a1; padding: 6px 12px; border-radius: 20px; font-weight: bold; font-size: 0.85rem;">
                📍 Plan Actual: ${nombrePlanHoy}
            </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px;">
            
            <div style="background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <h3 style="margin-bottom: 12px; font-size: 1.1rem; color: var(--dark); display: flex; align-items: center; gap: 8px;">✏️ Datos Personales</h3>
                    <div style="margin-bottom: 12px;">
                        <label style="font-size: 0.8rem; font-weight: bold; color: #64748b; display: block; margin-bottom: 4px;">Nombre y Apellidos:</label>
                        <p style="margin: 0; padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; color: #475569; font-size: 0.95rem;">${uProfile.nombre_mostrar}</p>
                    </div>
                    <p style="font-size: 0.8rem; color: #94a3b8; line-height: 1.4;">El nombre se sincroniza automáticamente desde tu cuenta de Google. Contacta al administrador si necesitas corregirlo.</p>
                </div>
            </div>

            <div style="background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <h3 style="margin-bottom: 12px; font-size: 1.1rem; color: var(--dark); display: flex; align-items: center; gap: 8px;">🎓 Inicio de Residencia</h3>
                    <div style="margin-bottom: 12px;">
                        <label style="font-size: 0.8rem; font-weight: bold; color: #64748b; display: block; margin-bottom: 4px;">Fecha de Inicio Oficial (R1):</label>
                        <input type="date" id="perfil-fecha-inicio" value="${uProfile.fecha_inicio_residencia || ''}" style="margin:0; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; width: 100%; background: white;">
                    </div>
                    <p style="font-size: 0.8rem; color: #94a3b8; line-height: 1.4;">* Esta es la fecha exacta (con año) en la que empezaste el contrato de R1. Sirve para saber qué plan aplicarte.</p>
                </div>
                <button onclick="guardarFechaInicioPerfil()" style="width:100%; margin-top: 16px; background: var(--merc); color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer;">🔄 Actualizar Inicio</button>
            </div>

            <div style="background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <h3 style="margin-bottom: 12px; font-size: 1.1rem; color: var(--dark); display: flex; align-items: center; gap: 8px;">🪪 Datos de Contrato</h3>
                    <div style="margin-bottom: 12px;">
                        <label style="font-size: 0.8rem; font-weight: bold; color: #64748b; display: block; margin-bottom: 4px;">Mes de Cambio de Contrato:</label>
                        <select id="perfil-mes-contrato" style="margin:0; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; width: 100%; background: white;">
                            ${mesOptions}
                        </select>
                    </div>
                    <p style="font-size: 0.8rem; color: #94a3b8; line-height: 1.4;">* El mes en que se renueva tu contrato y subes de nivel (R1→R2→R3). El día se fija automáticamente al 1 del mes.</p>
                </div>
                <button onclick="guardarFechaContratoPerfil()" style="width:100%; margin-top: 16px; background: var(--adu); color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer;">💾 Actualizar Contrato</button>
            </div>
            <div style="background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <h3 style="margin-bottom: 12px; font-size: 1.1rem; color: var(--dark); display: flex; align-items: center; gap: 8px;">🏥 Ausencias y Suspensiones</h3>
                    <p style="font-size: 0.85rem; color: #64748b; margin-bottom: 15px;">Registra periodos largos de baja médica o rotaciones externas para que el asignador automático te excluya de las ruedas afectadas.</p>
                    
                    <div id="lista-bajas-usuario" style="margin-bottom: 15px; max-height: 150px; overflow-y: auto;">
                        ${misBajas.length === 0 ? '<p style="font-size:0.85rem; color:#94a3b8; font-style: italic;">No tienes ausencias registradas.</p>' : misBajas.map(b => `
                            <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:8px; border-radius:6px; margin-bottom:6px; border:1px solid #e2e8f0;">
                                <div style="font-size:0.8rem; line-height:1.3;">
                                    <b style="color:var(--dark);">${b.motivo}</b><br>
                                    <span style="color:#64748b;">Del ${formatDK(b.fechaInicio.replace(/-/g,'_'))} al ${formatDK(b.fechaFin.replace(/-/g,'_'))}</span>
                                </div>
                                <button class="danger icon-btn" onclick="eliminarBajaPerfil(${b.id})" style="padding:2px 6px; font-size:0.75rem;">X</button>
                            </div>
                        `).join('')}
                    </div>

                    <div style="border-top: 1px dashed #cbd5e1; padding-top: 12px;">
                        <label style="font-size: 0.75rem; font-weight: bold; color: #475569; display: block; margin-bottom: 4px;">Nueva Ausencia:</label>
                        <div style="display: flex; gap: 6px; margin-bottom: 8px;">
                            <div style="flex:1;"><span style="font-size:0.7rem; color:#64748b;">Inicio</span><input type="date" id="baja-fecha-inicio" style="margin:0; padding:6px; font-size:0.8rem; width:100%;"></div>
                            <div style="flex:1;"><span style="font-size:0.7rem; color:#64748b;">Fin</span><input type="date" id="baja-fecha-fin" style="margin:0; padding:6px; font-size:0.8rem; width:100%;"></div>
                        </div>
                        <input type="text" id="baja-motivo" placeholder="Motivo (ej: Rotación Externa, IT...)" style="margin:0; padding:8px; font-size:0.8rem; width:100%; border: 1px solid #cbd5e1; border-radius: 4px;">
                    </div>
                </div>
                <button onclick="solicitarBajaPerfil()" style="width:100%; margin-top: 16px; background: var(--dark); color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer;">➕ Añadir Ausencia</button>
            </div>
            <div style="background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); grid-column: span 2;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
                    <h3 style="margin:0; font-size: 1.1rem; color: var(--dark);">⏱️ Auditoría de Carga Laboral (Horas)</h3>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <select onchange="setPerfilHorasFiltro(this.value, perfilHorasFiltroM)" style="margin:0; padding:5px 8px; font-size:0.85rem; border:1px solid #cbd5e1; border-radius:6px;">${anioOpcionesHoras}</select>
                        <select onchange="setPerfilHorasFiltro(perfilHorasFiltroY, this.value)" style="margin:0; padding:5px 8px; font-size:0.85rem; border:1px solid #cbd5e1; border-radius:6px;">${mesOpcionesHoras}</select>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin-bottom: 14px;">
                    <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                        <span style="font-size: 0.8rem; color: #64748b; font-weight: bold; display: block;">HORAS ${MONTHS[perfilHorasFiltroM].toUpperCase()}</span>
                        <span style="font-size: 1.8rem; font-weight: bold; color: var(--dark);">${horasMes.toFixed(1)} h</span>
                    </div>
                    <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                        <span style="font-size: 0.8rem; color: #64748b; font-weight: bold; display: block;">GUARDIAS COMPLETAS</span>
                        <span style="font-size: 1.8rem; font-weight: bold; color: var(--adu);">${completasMes}</span>
                    </div>
                    <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                        <span style="font-size: 0.8rem; color: #64748b; font-weight: bold; display: block;">MEDIAS GUARDIAS (PARTIDAS)</span>
                        <span style="font-size: 1.8rem; font-weight: bold; color: var(--merc);">${partidasMes}</span>
                    </div>
                </div>
                <div style="display:flex; gap:24px; font-size:0.85rem; color:#64748b; margin-bottom:18px; flex-wrap:wrap;">
                    <span>Total ${perfilHorasFiltroY}: <b style="color:var(--dark);">${horasAnio.toFixed(1)} h</b></span>
                    <span>Total histórico: <b style="color:var(--dark);">${horasTotal.toFixed(1)} h</b></span>
                </div>

                <div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: bold; margin-bottom: 6px; color: #475569;">
                        <span style="color: ${colorBarra};">${estadoTexto}</span>
                        <span>${horasTotal.toFixed(0)} / ${targetHoras} h (±${tolerancia}h)</span>
                    </div>
                    <div style="background: #e2e8f0; width: 100%; height: 12px; border-radius: 6px; position: relative; overflow: hidden;">
                        <div style="position: absolute; left: ${(minHoras/topeVisual)*100}%; width: 2px; height: 100%; background: #94a3b8; z-index: 2;" title="Mínimo Formativo (${minHoras}h)"></div>
                        <div style="position: absolute; left: ${(maxHoras/topeVisual)*100}%; width: 2px; height: 100%; background: #ef4444; z-index: 2;" title="Tope Máximo (${maxHoras}h)"></div>
                        <div style="background: ${colorBarra}; width: ${porcentajeCarga}%; height: 100%; transition: width 0.3s ease;"></div>
                    </div>
                    <p style="font-size: 0.75rem; color: #94a3b8; margin-top: 8px; line-height: 1.4;">
                        * Objetivo: <b>${targetHoras}h</b>. Tolerancia legal: entre <b>${minHoras}h</b> y <b>${maxHoras}h</b>.<br>
                        Por debajo del mínimo el sistema advierte de un posible déficit formativo; por encima del máximo, se incumplen los descansos estipulados.
                    </p>
                </div>
            </div>
            </div> `;
	}
// A) GUARDAR LA FECHA DE CAMBIO DE CONTRATO DESDE EL PERFIL
/** Persiste el mes de cambio de contrato del usuario (día fijo al 1 del mes, año base 2000). */
async function guardarFechaContratoPerfil() {
    const mes = document.getElementById('perfil-mes-contrato').value;
    const nuevaFecha = `2000-${mes}-01`; // Siempre día 1

    const uProfile = currentUserProfile;
    const pIdx = globalProfiles.findIndex(p => p.nombre_mostrar === uProfile.nombre_mostrar);
    if (pIdx !== -1) {
        globalProfiles[pIdx].fecha_cambio_contrato = nuevaFecha;
        try {
            const { error } = await supabaseClient
                .from('perfiles')
                .update({ fecha_cambio_contrato: nuevaFecha })
                .eq('id', uProfile.id);
            if (error) throw error;
            alert("¡Fecha de contrato actualizada con éxito!");
            invalidateConfigMes();
            renderPerfilUsuario();
        } catch (err) { alert("Error al guardar en Supabase."); }
    }
}

// B) GUARDAR LA FECHA DE INICIO DE RESIDENCIA
/** Persiste la fecha de inicio de residencia R1 del usuario e invalida el cache de turnos. */
async function guardarFechaInicioPerfil() {
    const nuevaFecha = document.getElementById('perfil-fecha-inicio').value;
    if (!nuevaFecha) return alert("Selecciona una fecha válida.");

    const uProfile = currentUserProfile;
    const pIdx = globalProfiles.findIndex(p => p.nombre_mostrar === uProfile.nombre_mostrar);
    if (pIdx !== -1) {
        globalProfiles[pIdx].fecha_inicio_residencia = nuevaFecha;
        try {
            const { error } = await supabaseClient
                .from('perfiles')
                .update({ fecha_inicio_residencia: nuevaFecha })
                .eq('id', uProfile.id);
            if (error) throw error;
            alert("¡Fecha de inicio de residencia actualizada con éxito!");
            invalidateConfigMes();
            renderPerfilUsuario();
        } catch (err) { alert("Error al guardar en Supabase."); }
    }
}

// C) SOLICITAR UNA NUEVA BAJA PROLONGADA
/** Registra un nuevo periodo de baja/ausencia para el usuario actual y persiste en state. */
async function solicitarBajaPerfil() {
    const fInicio = document.getElementById('baja-fecha-inicio').value;
    const fFin = document.getElementById('baja-fecha-fin').value;
    const motivo = document.getElementById('baja-motivo').value.trim();

    if (!fInicio || !fFin || !motivo) {
        return alert("Por favor, rellena todos los campos para solicitar la suspensión temporal.");
    }
    if (new Date(fInicio) > new Date(fFin)) {
        return alert("La fecha de inicio no puede ser posterior a la fecha de fin.");
    }

    const nuevaBaja = {
        id: Date.now(),
        user: currentUserProfile.nombre_mostrar,
        fechaInicio: fInicio,
        fechaFin: fFin,
        motivo: motivo,
        estado: 'aprobada' 
    };

    if (!state.bajasLargas) state.bajasLargas = [];
    state.bajasLargas.push(nuevaBaja);

    await saveState(); // CORREGIDO
    alert("Periodo de excepción registrado. El motor te saltará automáticamente en los meses afectados.");
    renderPerfilUsuario();
}

// C) ELIMINAR UNA BAJA REGISTRADA
/**
 * Elimina un periodo de baja por su id y persiste el estado actualizado.
 * @param {number} idBaja - id generado con Date.now() al crear la baja
 */
async function eliminarBajaPerfil(idBaja) {
    if (!confirm("¿Seguro que deseas eliminar este periodo de baja y volver a activarte en la rotación?")) return;

    state.bajasLargas = state.bajasLargas.filter(b => b.id !== idBaja);
    
    await saveState(); // CORREGIDO
    renderPerfilUsuario();
}

// ============================================================
// MÓDULO: MOTOR_BALANCEO
// Exportar a: src/modules/motorRotacion.js  ← mismo archivo que MOTOR_ROTACION
// Líneas estimadas: ~35
// Dependencias externas: state.planRotations, curDate
// Helpers que usa: getCurrentRotPlan, formatDateKey
// ============================================================
/** Wrapper que llama a reempaquetarGruposPlan con el plan activo del mes actual. */
function reempaquetarGrupos(lista) { return reempaquetarGruposPlan(lista, state.planRotations?.[getCurrentRotPlan(formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1))] || {}); }
/**
 * Reagrupa una lista plana en sub-grupos de máximo 4, distribuyendo el resto equitativamente.
 * @param {string[]} lista
 * @returns {string[][]}
 */
function _reempaquetarGrupos(lista) {
    if (!lista || lista.length === 0) return [[]];
    let n = lista.length;
    
    // Calcula cuántos grupos se necesitan para que el máximo sea 4
    let numGroups = Math.max(1, Math.ceil(n / 4)); 

    let result = Array.from({length: numGroups}, () => []);
    let baseSize = Math.floor(n / numGroups);
    let extras = n % numGroups;

    let currentIndex = 0;
    // Empaqueta dejando los grupos más grandes (de 4) al final de la rotación
    for (let i = 0; i < numGroups; i++) {
        let size = baseSize + (i >= (numGroups - extras) ? 1 : 0);
        for (let j = 0; j < size; j++) {
            result[i].push(lista[currentIndex++]);
        }
    }
    return result;
}

/**
 * Activa o desactiva el modificador "guardia diurna" para un usuario en un día.
 * @param {string} dk - dateKey
 * @param {string} user - nombre_mostrar
 * @param {boolean} isDiurna
 */
async function toggleDiurna(dk, user, isDiurna) {
    if (!state.shiftModifiers) state.shiftModifiers = {};
    if (!state.shiftModifiers[dk]) state.shiftModifiers[dk] = {};
    if (!state.shiftModifiers[dk][user]) state.shiftModifiers[dk][user] = {};

    state.shiftModifiers[dk][user].diurna = isDiurna;
    await saveState();
    renderMainCalendar(); // Refresca para eliminar los salientes grises en vivo
}

/**
 * Actualiza el tipo de guardia (normal / partida_primera / partida_segunda) de un usuario en un día.
 * @param {string} dk - dateKey
 * @param {string} user - nombre_mostrar
 * @param {'normal'|'partida_primera'|'partida_segunda'} modo
 */
async function updateShiftMode(dk, user, modo) {
    if (!state.shiftModifiers) state.shiftModifiers = {};
    if (!state.shiftModifiers[dk]) state.shiftModifiers[dk] = {};
    if (!state.shiftModifiers[dk][user]) state.shiftModifiers[dk][user] = {};

    state.shiftModifiers[dk][user].tipo = modo;
    await saveState();
    renderMainCalendar(); // Refresca los salientes en el calendario
    if (document.getElementById('pane-perfil').style.display === 'block') {
        renderPerfilUsuario(); // Refresca el contador del perfil si está abierto
    }
}

/**
 * Marca a un residente como graduado, descarga su historial completo en Excel y lo excluye de futuras rotaciones.
 * @param {string} user - nombre_mostrar
 */
function graduarResidente(user) {
    if (!confirm(`¿Estás seguro de que quieres graduar a ${user}? Se eliminará de las listas activas y se descargará un Excel con su histórico completo de guardias (Mercadillo).`)) return;
    
    // Descargar Excel
    const wb = XLSX.utils.book_new();
    const data = [["Fecha", "Día de la semana", "Servicio"]];
    const computed = getComputedShifts();
    
    // Buscamos todas las guardias del usuario
    const allDks = Object.keys(computed).sort();
    let total = 0;
    allDks.forEach(dk => {
        if (computed[dk][user]) {
            const parts = dk.split('_');
            const dateObj = new Date(parts[0], parseInt(parts[1])-1, parts[2]);
            const dayName = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][dateObj.getDay()];
            data.push([`${parts[2]}/${parts[1]}/${parts[0]}`, dayName, computed[dk][user]]);
            total++;
        }
    });
    data.push(["TOTAL GUARDIAS", "", total]);
    
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Historial");
    XLSX.writeFile(wb, `Historial_${user}_Graduacion.xlsx`);
    
    // Marcar como graduado
    if (!state.graduados) state.graduados = [];
    if (!state.graduados.includes(user)) state.graduados.push(user);
    
    saveState().then(() => {
        alert(`${user} se ha graduado correctamente.`);
        checkAutomaticGraduation();
    renderAll();
    });
}


/**
 * Revisa todos los perfiles y marca como graduados a quienes ya no tienen plan activo
 * pero llevan tiempo en la residencia. Salvaguarda: no actúa si no hay planes configurados.
 */
function checkAutomaticGraduation() {
    if (!state.graduados) state.graduados = [];
    let changed = false;
    const dk = formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1);
    
    // Salvaguarda: solo actuamos si hay al menos un plan de guardias configurado con residentes.
    // Si promoConfig no tiene planes o planRotations está vacío, no graduamos a nadie.
    const hayPlanesConfigurados = promoConfig.planes && promoConfig.planes.length > 0;
    const hayRotacionConfigurada = state.planRotations && Object.values(state.planRotations).some(pr => pr.baseGroups && pr.baseGroups.flat().length > 0);
    if (!hayPlanesConfigurados || !hayRotacionConfigurada) return;
    
    // Iteramos sobre todos los perfiles globales
    globalProfiles.forEach(p => {
        const u = p.nombre_mostrar;
        if (state.graduados.includes(u)) return;
        
        // Comprobamos si tiene plan para el mes actual
        const plan = getPlanForUserOnDate(p, dk);
        if (plan === null && getUserLevelOnDate(p, dk) > 0) {
            // No tiene plan pero ya empezó la residencia -> Automáticamente graduado
            state.graduados.push(u);
            changed = true;
            console.log(`[Auto-Graduación] ${u} ha sido graduado automáticamente por no tener plan de guardias activo.`);
        }
    });
    
    if (changed) {
        saveState();
    }
}

// ============================================================
// MÓDULO: EXPORTACION_MERCADILLO (sub-sección de EXPORTACION)
// Exportar a: src/modules/exportacion.js  ← mismo archivo
// Líneas estimadas: ~50
// Dependencias externas: state.trades, XLSX
// Helpers que usa: formatDK
// ============================================================
/**
 * Genera y descarga un Excel con el log de operaciones aprobadas/deshachas del Mercadillo
 * en el rango de meses seleccionado (máximo 12 meses).
 */
function exportarLogMercadillo() {
    const fromVal = document.getElementById('export-merc-desde').value;
    const toVal = document.getElementById('export-merc-hasta').value;
    
    if (!fromVal || !toVal) return alert("Por favor, selecciona las fechas Desde y Hasta.");
    if (fromVal > toVal) return alert("La fecha Desde no puede ser posterior a Hasta.");
    
    // Validar rango máximo 1 año (12 meses)
    const [fromY, fromM] = fromVal.split('-');
    const [toY, toM] = toVal.split('-');
    const monthsDiff = (parseInt(toY) - parseInt(fromY)) * 12 + (parseInt(toM) - parseInt(fromM));
    if (monthsDiff > 12) return alert("El rango máximo de exportación es de 1 año (12 meses).");
    
    const fromDate = new Date(parseInt(fromY), parseInt(fromM) - 1, 1);
    const toDate = new Date(parseInt(toY), parseInt(toM), 0); // last day of toMonth
    
    const trades = (state.trades || []).filter(t => {
        if (t.status !== 'approved' && t.status !== 'undone') return false;
        if (!t.timestamp) return false;
        const [datePart] = t.timestamp.split(' ');
        const [d, m, y] = datePart.split('/');
        const tradeDate = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
        return tradeDate >= fromDate && tradeDate <= toDate;
    });
    
    if (trades.length === 0) return alert("No se encontraron operaciones completadas en este rango de fechas.");
    
    const wb = XLSX.utils.book_new();
    const data = [["ID", "Fecha Operación", "Tipo", "Estado", "Solicitante", "Destinatario", "Día 1", "Servicio 1", "Día 2", "Servicio 2"]];
    
    trades.slice().reverse().forEach(t => {
        data.push([
            t.id,
            t.timestamp,
            t.type.toUpperCase(),
            t.status.toUpperCase(),
            t.requester,
            t.target,
            t.d1 ? formatDK(t.d1) : "-",
            t.s1 || "-",
            t.d2 ? formatDK(t.d2) : "-",
            t.s2 || "-"
        ]);
    });
    
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Log Mercadillo");
    XLSX.writeFile(wb, `Log_Mercadillo_${fromVal}_a_${toVal}.xlsx`);
}

// ============================================================
// MAPA DE MÓDULOS
// ============================================================
// CONFIG_ESTADO          → src/modules/config.js          (~70 líneas)  | Depende de: ninguno
// HELPERS_UTILS          → src/modules/helpers.js          (~65 líneas)  | Depende de: state.festivos
// PERSISTENCIA           → src/modules/persistencia.js    (~135 líneas) | Depende de: CONFIG_ESTADO, supabaseClient, HELPERS_UTILS
// AUTH_SESION            → src/modules/auth.js            (~120 líneas) | Depende de: PERSISTENCIA, USUARIOS_ACCESOS, NAVEGACION
// USUARIOS_ACCESOS       → src/modules/usuarios.js        (~115 líneas) | Depende de: AUTH_SESION, GRUPOS_HOSPITALARIOS
// MOTOR_TEMPORAL         → src/modules/motorTemporal.js   (~70 líneas)  | Depende de: CONFIG_ESTADO, globalProfiles, promoConfig
// MOTOR_SALIENTES        → src/modules/motorSalientes.js  (~90 líneas)  | Depende de: MOTOR_TEMPORAL, HELPERS_UTILS
// MOTOR_ROTACION         → src/modules/motorRotacion.js   (~215 líneas) | Depende de: MOTOR_TEMPORAL, PERSISTENCIA, MOTOR_BALANCEO
// MOTOR_EVALUACION       → src/modules/motorEvaluacion.js (~185 líneas) | Depende de: MOTOR_ROTACION, MOTOR_SALIENTES, MOTOR_SUBASTAS, HELPERS_SERVICIOS
// MOTOR_MERCADILLO       → src/modules/motorMercadillo.js (~95 líneas)  | Depende de: MOTOR_SALIENTES
// MOTOR_SUBASTAS         → src/modules/motorSubastas.js   (~390 líneas) | Depende de: MOTOR_EVALUACION, MOTOR_TEMPORAL, HELPERS_SERVICIOS
// MOTOR_TURNO            → src/modules/motorTurno.js      (~210 líneas) | Depende de: MOTOR_EVALUACION, MOTOR_ROTACION, MOTOR_SUBASTAS
// MOTOR_BALANCEO         → src/modules/motorRotacion.js   (~35 líneas)  | Depende de: MOTOR_ROTACION  ← mismo archivo
// NAVEGACION             → src/modules/navegacion.js      (~120 líneas) | Depende de: MOTOR_TURNO, todos los render*
// HELPERS_SERVICIOS      → src/modules/helpersServicios.js (~55 líneas) | Depende de: promoConfig, state.habilitaciones
// CALENDARIO             → src/modules/calendario.js      (~225 líneas) | Depende de: MOTOR_TURNO, MOTOR_SUBASTAS, MOTOR_EVALUACION, HELPERS_SERVICIOS
// MODALES_CALENDARIO     → src/modules/modalesCalendario.js (~215 líneas)| Depende de: MOTOR_EVALUACION, MOTOR_TURNO, MOTOR_SUBASTAS
// MERCADILLO_RENDER      → src/modules/mercadillo.js      (~315 líneas) | Depende de: MOTOR_MERCADILLO, MOTOR_TEMPORAL, HELPERS_SERVICIOS
// ADMIN_AJUSTES          → src/modules/adminAjustes.js    (~440 líneas) | Depende de: promoConfig, supabaseClient
// ADMIN_CALENDARIO       → src/modules/adminCalendario.js (~155 líneas) | Depende de: HELPERS_SERVICIOS, state.festivos, state.habilitaciones
// ADMIN_EXCEPCIONES      → src/modules/adminExcepciones.js (~60 líneas) | Depende de: MOTOR_TURNO, state.pendingExceptions
// ADMIN_CUENTAS          → src/modules/adminCuentas.js    (~250 líneas) | Depende de: supabaseClient, MOTOR_ROTACION
// GRUPOS_HOSPITALARIOS   → src/modules/grupos.js          (~230 líneas) | Depende de: supabaseClient, AUTH_SESION
// ROTACION_EDITOR        → src/modules/rotacionEditor.js  (~555 líneas) | Depende de: MOTOR_ROTACION, MOTOR_BALANCEO, state.planRotations
// EXPORTACION            → src/modules/exportacion.js     (~245 líneas) | Depende de: MOTOR_MERCADILLO, state.shifts, XLSX
// PERFIL_USUARIO         → src/modules/perfilUsuario.js   (~285 líneas) | Depende de: MOTOR_TEMPORAL, supabaseClient, state.bajasLargas
// GRADUACION             → (inline, ~95 líneas)           | Depende de: MOTOR_ROTACION, MOTOR_TEMPORAL, XLSX
//
// HELPERS COMPARTIDOS (usados por 3+ módulos):
//   formatDateKey, getDayTag, getDaysInMonth, getRotationKey, getFirstDayOffset,
//   setStatus, saveState, getComputedShifts, getPlanForUserOnDate, getUserLevelOnDate,
//   getAllResidents, renderAll, checkAutomaticGraduation, MONTHS
//
// POSIBLES IMPORTS CIRCULARES:
//   MOTOR_EVALUACION ←→ MOTOR_SUBASTAS  (getUserProgress llama getAnalisisFestivos y viceversa)
//     → resuelto en código con guards _computingTurn / _computingAnalisis
//   MOTOR_TURNO ←→ MOTOR_EVALUACION  (getCurrentTurn → getUserProgress → getAnalisisFestivos → getCurrentTurn)
//     → resuelto con _computingTurn
// ============================================================
