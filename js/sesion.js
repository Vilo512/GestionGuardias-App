// ============================================================
// MÓDULO: AUTH_SESION
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


// ============================================================
// MÓDULO: USUARIOS_ACCESOS
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
  // 🏥 B6: las especialidades CERRADAS (activa=false) no son seleccionables para unirse
  const disponibles = data.filter(p => p.activa !== false);
  const hospitalesUnicos = [...new Set(disponibles.map(p => p.hospital))].sort();
  selHosp.innerHTML = '<option value="">-- Selecciona Hospital --</option>' + hospitalesUnicos.map(h => `<option value="${h}">${h}</option>`).join('');
}

/** Filtra las especialidades disponibles al cambiar el hospital seleccionado en el onboarding. */
function onHospitalChange() {
  const hospElegido = document.getElementById('sel-hospital').value;
  const selServ = document.getElementById('sel-servicio');
  if (!hospElegido) { selServ.disabled = true; selServ.innerHTML = '<option value="">Primero elige un hospital</option>'; return; }
  const serviciosFiltrados = todasLasPromociones.filter(p => p.hospital === hospElegido && p.activa !== false);
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

/**
 * 🏥 B6: Panel de alta de nueva especialidad (sustituye a los prompt() de texto libre,
 * que generaban hospitales duplicados). Dos rutas: elegir un hospital EXISTENTE de la
 * lista y crear la especialidad dentro de él, o crear hospital + especialidad de cero.
 */
async function abrirCrearPromocion() {
  document.getElementById('crear-promo-modal')?.remove();

  // Lista fresca de promociones para poblar hospitales y detectar duplicados
  try {
      const { data } = await supabaseClient.from('promociones').select('*');
      if (data) todasLasPromociones = data;
  } catch (e) { /* si falla la red, usamos la lista ya cargada */ }

  const hospitales = [...new Set((todasLasPromociones || []).map(p => p.hospital))].sort();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'crear-promo-modal';
  modal.innerHTML = `
    <div class="modal" style="max-width:540px; text-align:left;">
        <h3 style="margin-bottom:0.5rem;">🏥 Dar de alta nueva especialidad</h3>
        <p style="font-size:0.85rem; color:#64748b; margin-bottom:1rem;">Para evitar hospitales duplicados, elige el tuyo de la lista si ya existe. Crea uno nuevo <b>solo</b> si de verdad no está.</p>

        <label style="font-size:0.8rem; font-weight:bold;">1. Hospital</label>
        <select id="cp-hospital" onchange="onCrearPromoHospitalChange()" style="width:100%; margin-bottom:8px;">
            <option value="">-- Selecciona tu hospital --</option>
            ${hospitales.map(h => `<option value="${h}">${h}</option>`).join('')}
            <option value="__NUEVO__">➕ Mi hospital no está en la lista (crear nuevo)...</option>
        </select>
        <input type="text" id="cp-hospital-nuevo" placeholder="Nombre COMPLETO y oficial (ej: Hospital Universitari Arnau de Vilanova)" style="width:100%; display:none; margin-bottom:8px;">

        <label style="font-size:0.8rem; font-weight:bold;">2. Especialidad</label>
        <input type="text" id="cp-servicio" placeholder="Nombre completo según el BOE (ej: Medicina Familiar y Comunitaria)" style="width:100%; margin-bottom:12px;">

        <div style="display:flex; gap:8px; margin-top:6px;">
            <button class="primary" style="flex:1;" onclick="confirmarCrearPromocion()">Crear especialidad</button>
            <button onclick="document.getElementById('crear-promo-modal').remove()">Cancelar</button>
        </div>
    </div>`;
  document.body.appendChild(modal);
}

/** Muestra el campo de texto de hospital nuevo solo si se eligió "crear nuevo". */
function onCrearPromoHospitalChange() {
    const sel = document.getElementById('cp-hospital');
    const inp = document.getElementById('cp-hospital-nuevo');
    if (sel && inp) inp.style.display = sel.value === '__NUEVO__' ? 'block' : 'none';
}

/** Valida el panel de alta (anti-duplicados) y delega en crearNuevaPromocionMaster. */
function confirmarCrearPromocion() {
    const selVal = document.getElementById('cp-hospital')?.value || '';
    const nuevoTxt = (document.getElementById('cp-hospital-nuevo')?.value || '').trim();
    const servicio = (document.getElementById('cp-servicio')?.value || '').trim();

    if (!selVal) return alert('Selecciona tu hospital de la lista (o la opción de crear uno nuevo).');
    if (!servicio) return alert('Escribe el nombre de la especialidad.');

    let hospital;
    if (selVal === '__NUEVO__') {
        if (!nuevoTxt) return alert('Escribe el nombre completo del hospital nuevo.');
        // Anti-duplicado: si ya existe uno con ese nombre (ignorando mayúsculas), obligamos a elegirlo
        const yaExiste = (todasLasPromociones || []).map(p => p.hospital)
            .find(h => h.trim().toLowerCase() === nuevoTxt.toLowerCase());
        if (yaExiste) return alert(`⚠️ Ese hospital ya existe en la lista como "${yaExiste}". Selecciónalo del desplegable en vez de crearlo de nuevo.`);
        hospital = nuevoTxt;
    } else {
        hospital = selVal; // string EXACTO del hospital existente → imposible duplicar
    }

    // Anti-duplicado de especialidad dentro del hospital
    const svcExiste = (todasLasPromociones || []).find(p =>
        p.hospital === hospital && (p.servicio || '').trim().toLowerCase() === servicio.toLowerCase());
    if (svcExiste) return alert(`⚠️ La especialidad "${svcExiste.servicio}" ya existe en ${hospital}. Solicita acceso a ese grupo desde el selector en vez de crear otro.`);

    document.getElementById('crear-promo-modal')?.remove();
    crearNuevaPromocionMaster(hospital, servicio, "Especialidad Completa");
}
/**
 * Inserta la nueva promoción en Supabase y asigna al usuario actual como admin con la fecha de inicio indicada.
 * @param {string} h - hospital
 * @param {string} s - especialidad (servicio)
 * @param {string} n - nombre del contenedor
 */
async function crearNuevaPromocionMaster(h, s, n) {
  // Desde el onboarding la fecha viene del formulario; desde la pestaña Grupos (usuario
  // ya registrado) usamos la de su perfil.
  const fechaInicio = document.getElementById('onb-fecha-inicio')?.value || currentUserProfile?.fecha_inicio_residencia;
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

/** Repuebla el selector de residentes del toolbar admin con los del plan elegido. */
function onAdminPlanChange(y, m) {
    const planSel = document.getElementById('sel-admin-plan')?.value;
    const selRes = document.getElementById('sel-admin-resident');
    if (!planSel || !selRes) return;
    const opts = getResidentesActivosEnMes(y, m)
        .filter(r => residentePerteneceAPlan(r, planSel, y, m))
        .map(r => `<option value="${r}">${r}</option>`).join('');
    selRes.innerHTML = '<option value="">— Residente —</option>' + opts;
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
        // El plan de referencia es el del subselector del toolbar (por defecto, el visualizado)
        const planSel = document.getElementById('sel-admin-plan')?.value || getCurrentRotPlan(formatDateKey(y, m, 1));
        if (!puedeGestionarPlan(planSel, y, m)) { alert('⚠️ Solo puedes otorgar turnos dentro de tu propio plan de guardias.'); return; }
        if (!residentePerteneceAPlan(res, planSel, y, m)) { alert('⚠️ Ese residente no pertenece al plan seleccionado este mes.'); return; }
        if (!state.grantedTurn) state.grantedTurn = {};
        // La clave incluye el plan: cada plan tiene su propio turno otorgado y no se pisan
        state.grantedTurn[_grantedTurnKey(y, m, planSel)] = res;
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
  // Show bell only when fully logged-in and approved
  const notifWrapper = document.getElementById('notif-wrapper');
  if (notifWrapper) notifWrapper.style.display = (authSession && currentUserProfile?.estado === 'aprobado') ? 'block' : 'none';
}

