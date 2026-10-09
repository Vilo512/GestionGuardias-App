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
  // 🧭 B5: 'calendario' ya no es solo-admin — el delegado puede pintar los días
  // habilitados de SU plan (renderAdminCalendar restringe pinceles y filtro).
  // Ajustes y Seguridad son de la ESPECIALIDAD entera (borrarla, cambiarle
  // hospital y nombre), así que van con `esDueño`, no con `isAdmin`. Desde que
  // el Dueño puede nombrar admins, isAdmin ya no implica ser el Dueño.
  const adminOnlySubs = ['ajustes', 'seguridad'];
  if (adminOnlySubs.includes(sub) && !esDueño) sub = 'excepciones';
  currentAdminView = sub;
  ['calendario','excepciones','export','cuentas','horas','seguridad','ajustes'].forEach(t => {
    const view = document.getElementById(`aview-${t}`); if (view) view.style.display = t === sub ? 'block' : 'none';
    const tab = document.getElementById(`atab-${t}`);
    if (tab) {
      tab.className = `tab ${t === sub ? 'active' : ''}`;
      if (adminOnlySubs.includes(t)) tab.style.display = esDueño ? '' : 'none';
    }
  });
  document.getElementById('admin-nav-header').style.display = (sub === 'calendario' || sub === 'horas' || sub === 'excepciones') ? 'block' : 'none';
  document.getElementById('admin-cal-views').style.display = (sub === 'calendario') ? 'block' : 'none';
  if (sub === 'cuentas') renderAccountsList();
  if (sub === 'calendario') renderAdminCalendar();
  if (sub === 'excepciones') renderAdminExceptions();
  if (sub === 'ajustes') renderAdminAjustes();
  if (sub === 'seguridad') renderAdminSeguridad();
  if (sub === 'horas') renderAdminHoras();
}

/**
 * 🏥 B6: Rellena el panel de Seguridad: propiedades de la promoción propia (especialidad,
 * hospital con selector anti-duplicados, estado abierta/cerrada) y el listado global de
 * especialidades con borrado de grupos vacíos.
 */
async function renderAdminSeguridad() {
    const { data: todas, error } = await supabaseClient.from('promociones').select('*');
    if (error || !todas) return;
    todasLasPromociones = todas;
    const promo = todas.find(p => p.id === currentUserProfile.promocion_id);
    if (!promo) return;

    document.getElementById('edit-promo-servicio').value = promo.servicio || '';
    document.getElementById('edit-promo-activa').value = promo.activa === false ? 'false' : 'true';

    const hospitales = [...new Set(todas.map(p => p.hospital))].sort();
    const selHosp = document.getElementById('edit-promo-hospital');
    selHosp.innerHTML = hospitales.map(h => `<option value="${h}" ${h === promo.hospital ? 'selected' : ''}>${h}</option>`).join('')
        + '<option value="__NUEVO__">➕ Otro hospital (crear nuevo)...</option>';
    onEditPromoHospitalChange();

    // Listado global de especialidades (grupos vacíos borrables; el servidor verifica)
    const listEl = document.getElementById('admin-promos-list');
    if (listEl) {
        listEl.innerHTML = todas
            .sort((a, b) => (a.hospital + a.servicio).localeCompare(b.hospital + b.servicio))
            .map(p => {
                const esMia = p.id === currentUserProfile.promocion_id;
                const estado = p.activa === false ? '🔒 Cerrada' : '🟢 Abierta';
                return `<div style="background:white; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <span style="font-size:0.88rem;"><b>${p.servicio}</b> <span style="color:#64748b;">— ${p.hospital}</span> <span style="font-size:0.75rem; color:#94a3b8;">· ${estado}${esMia ? ' · (la tuya)' : ''}</span></span>
                    ${!esMia ? `<button class="danger icon-btn" style="padding:3px 8px; font-size:0.78rem;" onclick="adminBorrarPromocionVacia('${p.id}')">🗑️ Borrar si está vacía</button>` : ''}
                </div>`;
            }).join('');
    }
}

/** Muestra el campo de hospital nuevo del panel de Seguridad solo si se eligió "crear nuevo". */
function onEditPromoHospitalChange() {
    const sel = document.getElementById('edit-promo-hospital');
    const inp = document.getElementById('edit-promo-hospital-nuevo');
    if (sel && inp) inp.style.display = sel.value === '__NUEVO__' ? 'block' : 'none';
}

/** 🏥 B6: Guarda especialidad, hospital y estado (abierta/cerrada) de la promoción propia. */
async function adminUpdatePromoDetails() {
    // Hospital y nombre son de la especialidad entera, no de un plan.
    if (!esDueño) return alert("⚠️ Solo el Dueño de la especialidad puede cambiar su hospital o su nombre.");
    const newServicio = document.getElementById('edit-promo-servicio').value.trim();
    if (!newServicio) return alert("El campo de la especialidad no puede estar vacío.");

    const selVal = document.getElementById('edit-promo-hospital')?.value || '';
    const nuevoTxt = (document.getElementById('edit-promo-hospital-nuevo')?.value || '').trim();
    let newHospital;
    if (selVal === '__NUEVO__') {
        if (!nuevoTxt) return alert('Escribe el nombre completo del hospital nuevo.');
        const yaExiste = (todasLasPromociones || []).map(p => p.hospital)
            .find(h => h.trim().toLowerCase() === nuevoTxt.toLowerCase());
        if (yaExiste) return alert(`⚠️ Ese hospital ya existe como "${yaExiste}". Selecciónalo del desplegable.`);
        newHospital = nuevoTxt;
    } else {
        newHospital = selVal;
    }
    if (!newHospital) return alert('Selecciona el hospital.');

    const newActiva = document.getElementById('edit-promo-activa')?.value !== 'false';

    setStatus('Guardando...');
    const { error } = await supabaseClient.from('promociones').update({
        servicio: newServicio,
        hospital: newHospital,
        activa: newActiva
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
 * 🏥 B6: Borra una promoción ajena SOLO si está vacía. La política RLS del servidor
 * exige 0 perfiles vinculados: si tiene miembros, el delete no borra ninguna fila y
 * se informa — imposible cargarse un grupo activo por accidente.
 */
async function adminBorrarPromocionVacia(promoId) {
    if (!esDueño) return alert('⚠️ Solo el Dueño de una especialidad puede borrar grupos.');
    if (promoId === currentUserProfile.promocion_id) return alert('Esa es tu propia promoción: usa la Zona de Peligro si de verdad quieres borrarla.');
    const p = (todasLasPromociones || []).find(x => x.id === promoId);
    if (!confirm(`¿Borrar el grupo "${p ? p.servicio + ' — ' + p.hospital : promoId}"?\n\nSolo se borrará si está completamente vacío (sin ningún perfil vinculado).`)) return;

    setStatus('Borrando...');
    const { data, error } = await supabaseClient.from('promociones').delete().eq('id', promoId).select();
    setStatus('Conectado ✅');
    if (error) return alert('Error al borrar: ' + error.message);
    if (!data || data.length === 0) {
        return alert('🛡️ No se borró: el grupo tiene miembros vinculados (o no tienes permiso). Solo los grupos vacíos pueden eliminarse.');
    }
    alert('🗑️ Grupo vacío eliminado correctamente.');
    renderAdminSeguridad();
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
  // 🎨 Rediseño Paso 2 (calendario) y Paso 5 (mercadillo): ambos botones son
  // .cal-filter-btn y alternan con la clase .active. Sin estilos inline: el acento
  // morado del mercadillo lo aporta el modificador .cal-filter-btn--merc.
  const label = showOnlyMine ? '👁️ Viendo SOLO las mías' : '👁️ Ver solo mis guardias';
  ['btn-filter', 'btn-filter-merc'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('active', showOnlyMine);
    btn.setAttribute('aria-pressed', showOnlyMine ? 'true' : 'false');
    btn.innerHTML = label;
  });
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
 * 🎨 Color de texto legible sobre un svc.color cualquiera (rediseño Paso 3).
 * Blanco por defecto — conserva el look blanco-sobre-color de siempre —, y solo
 * cae a casi-negro cuando el blanco no alcanza 3:1 (umbral de texto en negrita).
 * Así cualquier hex que elija el usuario en su plan queda legible.
 * @param {string} hex - color de servicio, formato #rrggbb
 * @returns {string} '#ffffff' o '#202124'
 */
function contrastText(hex) {
    if (typeof hex !== 'string') return '#ffffff';
    const c = hex.replace('#', '');
    if (c.length !== 6) return '#ffffff';
    const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    if ([r, g, b].some(isNaN)) return '#ffffff';
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return (1.05 / (L + 0.05)) >= 3 ? '#ffffff' : '#202124';
}

/**
 * Escapa texto para incrustarlo con seguridad en HTML generado por template string.
 * Los nombres de servicio, plan y residente son texto libre que escribe el admin: sin
 * esto, un `UCI "Peque"` rompe el atributo que lo contiene y un `<b>` inyecta markup.
 * Cuando se pueda, es preferible construir el nodo y usar textContent.
 * @param {*} s
 * @returns {string}
 */
function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 🎨 Iconos SVG inline temables (rediseño Paso 3). Heredan currentColor, así que
 * se adaptan solos al color de texto calculado del chip o al token del tema.
 * De momento solo los usa la vista calendario; el resto migra en el Paso 6.
 * @param {string} name
 * @returns {string} markup SVG
 */
function icon(name) {
    const paths = {
        user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        check: '<path d="M20 6 9 17l-5-5"/>',
        x: '<path d="M18 6 6 18M6 6l12 12"/>',
        calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'
    };
    if (!paths[name]) return '';
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

/**
 * Devuelve true si el servicio está habilitado para ese día (consulta state.habilitaciones y pedWhitelist).
 * Pasar siempre planName para evitar el fallback legacy de búsqueda por nombre.
 * @param {string} svcName
 * @param {string} dk - dateKey
 * @param {string|null} planName
 * @returns {boolean}
 */
/**
 * 🧭 B7 — Migración de una sola vez: state.habilitaciones pasa de indexarse por nombre
 * de servicio ("Urgencias") a indexarse por servicio y plan ("Urgencias@@Plan R1").
 * Antes, dos planes con un servicio del mismo nombre COMPARTÍAN los días pintados: los
 * días habilitados de R1 se veían/bloqueaban en R2 y viceversa. Los valores legacy se
 * copian a TODOS los planes que tienen ese nombre de servicio (conserva exactamente el
 * comportamiento visible previo) y la clave legacy se elimina. Claves de servicios
 * huérfanos (renombrados/borrados) se conservan tal cual.
 * @returns {boolean} true si hubo cambios que persistir
 */
function migrarHabilitacionesPorPlan() {
    if (!promoConfig.planes || promoConfig.planes.length === 0) return false;
    if (!state.habilitaciones || state.habilitacionesPorPlan) return false;
    let changed = false;
    for (const dk of Object.keys(state.habilitaciones)) {
        const dia = state.habilitaciones[dk];
        for (const key of Object.keys(dia)) {
            if (key.includes('@@')) continue;
            const duenos = promoConfig.planes.filter(p => (p.servicios || []).some(s => s.nombre === key));
            if (duenos.length === 0) continue;
            for (const p of duenos) {
                if (dia[`${key}@@${p.nombre}`] === undefined) dia[`${key}@@${p.nombre}`] = dia[key];
            }
            delete dia[key];
            changed = true;
        }
    }
    state.habilitacionesPorPlan = true; // marca: no volver a escanear
    return changed;
}

function isServiceEnabledOnDate(svcName, dk, planName = null) {
    let svc, ownerPlanName = planName;
    if (planName) {
        svc = getSvcConfig(svcName, planName);
    } else {
        // Fallback legacy: encuentra el primer plan que contenga el servicio.
        // Puede devolver el plan equivocado si el nombre es compartido entre planes.
        // Pasar siempre planName en código nuevo.
        const pData = (promoConfig.planes || []).find(p => p.servicios.some(s => s.nombre === svcName));
        svc = pData?.servicios.find(s => s.nombre === svcName);
        ownerPlanName = pData?.nombre || null;
    }
    if (!svc) return false;
    if (!svc.requiereHabilitacion) return true;
    // 🧭 B7: lectura por plan ("svc@@plan") con fallback a la clave legacy pre-migración
    const dia = state.habilitaciones?.[dk] || {};
    const val = (ownerPlanName && dia[`${svcName}@@${ownerPlanName}`] !== undefined)
        ? dia[`${svcName}@@${ownerPlanName}`]
        : dia[svcName];
    if (val !== false && val !== undefined) return true;
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
function getPlazasForDay(svc, dk, planName = null) {
    if (svc.requiereHabilitacion && state.habilitaciones && state.habilitaciones[dk]) {
        // 🧭 B7: resolver el plan dueño del servicio — por parámetro, por identidad del
        // objeto de config, o por nombre (primer plan que lo tenga) como último recurso.
        const ownerPlanName = planName
            || (promoConfig.planes || []).find(p => (p.servicios || []).includes(svc))?.nombre
            || (promoConfig.planes || []).find(p => (p.servicios || []).some(s => s.nombre === svc.nombre))?.nombre
            || null;
        const dia = state.habilitaciones[dk];
        const val = (ownerPlanName && dia[`${svc.nombre}@@${ownerPlanName}`] !== undefined)
            ? dia[`${svc.nombre}@@${ownerPlanName}`]
            : dia[svc.nombre];
        if (val !== undefined && val !== false && typeof val === 'number') return val;
    }
    return svc.plazasPorDia >= 0 ? svc.plazasPorDia : 1;
}


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
        colors.push('rgba(248,113,113,0.16)'); // 🎨 tinte rojo translúcido, legible sobre --surface
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
       // 🧭 Contexto de plan: el banner del delegado/admin muestra el turno/subasta del
       // plan visualizado (selector de rotación o su plan propio). Las acciones de
       // gestión solo se ofrecen si puede gestionar ese plan.
       const planVista = getCurrentRotPlan(formatDateKey(y, m, 1));
       const esGestor = puedeGestionarPlan(planVista, y, m);
       // Turno otorgado del plan visualizado (cada plan tiene el suyo)
       const granted = _getGrantedTurn(y, m, planVista)?.nombre || null;
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
       html += `<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;"><span>📋 <b>${planVista}</b> · ${turnLabel}${!esGestor ? ' <span style="font-size:0.7rem; color:#94a3b8;">(solo lectura: no es tu plan)</span>' : ''}</span><div style="display:flex; gap:8px;">`;
       if (esGestor) {
         if (turnUser) {
           html += `<button class="danger" style="padding:4px 8px; font-size:0.75rem;" onclick="adminSkipTurn('${turnUser}', ${y}, ${m})">Saltar turno ⏭️</button>`;
           if (granted) html += `<button class="primary" style="padding:4px 8px; font-size:0.75rem; background:#7c3aed;" onclick="adminClearGrantedTurn(${y}, ${m})">❌ Cancelar turno otorgado</button>`;
         } else if (af && (af.estado === 'subasta_cerrada' || af.estado === 'critico')) {
             html += `<button class="primary" style="padding:4px 8px; font-size:0.75rem; background:var(--fest); color:white;" onclick="ejecutarAsignacionForzosa(${y}, ${m}, '${af.svcNombre}')">⚡ Forzosa</button>`;
         }
       }
       // 📋 N5 §8.5: propuesta de asignación con revisión previa — exclusiva del admin
       if (isAdmin) html += `<button class="primary" style="padding:4px 8px; font-size:0.75rem; background:var(--dark); color:white;" onclick="abrirPropuestaMesModal(${y}, ${m})">📋 Proponer asignación</button>`;
       // El reset borra el mes de TODOS los planes → exclusivo del admin
       if (isAdmin) html += `<button class="danger" style="padding:4px 8px; font-size:0.75rem; background:var(--fest); color:white;" onclick="adminResetMonth(${y}, ${m})">⚠️ Reset Mes</button>`;
       html += `</div></div>`;
       // Toolbar unificado: Otorgar turno / Visualizar como — solo residentes del plan visualizado
       // Subselector de promoción: por defecto el plan visualizado, pero se puede cambiar
       // para listar los residentes de otro plan (ej. admin R2 visualizando a una R1).
       const activosToolbar = getResidentesActivosEnMes(y, m).filter(r => residentePerteneceAPlan(r, planVista, y, m));
       const optsToolbar = activosToolbar.map(r => `<option value="${r}">${r}</option>`).join('');
       const optsPlanesToolbar = (promoConfig.planes || []).map(p => `<option value="${p.nombre}" ${p.nombre === planVista ? 'selected' : ''}>${p.nombre}</option>`).join('');
       html += `<div class="admin-action-toolbar">
           <div class="admin-action-toolbar__mode-row">
               <span class="admin-action-toolbar__mode-label">Acción:</span>
               <select id="sel-admin-mode" class="admin-action-toolbar__mode-select" onchange="onAdminModeChange()">
                   <option value="">— Seleccionar acción —</option>
                   ${esGestor ? '<option value="grant">🎁 Otorgar turno a...</option>' : ''}
                   <option value="simulate">👁 Visualizar como...</option>
               </select>
           </div>
           <div id="admin-action-resident-row" class="admin-action-toolbar__resident-row">
               <select id="sel-admin-plan" class="admin-action-toolbar__resident-select" style="flex:0 1 auto;" title="Promoción / Plan de guardias" onchange="onAdminPlanChange(${y}, ${m})">
                   ${optsPlanesToolbar}
               </select>
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
  
  // 🧭 B1: todo el calendario se pinta desde el contexto del plan visualizado
  // (simulación > selector de delegado > plan propio). Cada residente ve únicamente
  // los días habilitados, servicios y compañeros de su plan.
  const planVistaCtx = getPlanVistaContext(y, m);
  const userLevelName = planVistaCtx ? planVistaCtx.planName : 'ALL';

  // 🎨 Paso 3: día de hoy, para resaltarlo en la rejilla
  const _hoy = new Date();
  const hoyKey = formatDateKey(_hoy.getFullYear(), _hoy.getMonth(), _hoy.getDate());

  for(let d=1; d<=getDaysInMonth(y,m); d++) {
    const dateKey = formatDateKey(y, m, d);
    const dayShifts = state.shifts[dateKey] || {};
    const isFest = state.festivos[dateKey];

    // Verificación de si el día está habilitado (para la clase CSS)
    // Nota: Aquí usamos una comprobación genérica ya que no estamos en el contexto de un solo servicio
    const cell = document.createElement('div');

    let cClass = 'cal-cell';
    if (isFest) cClass += ' is-festivo';
    if (dateKey === hoyKey) cClass += ' is-today';
    cell.className = cClass;
    const bgStyle = getCellBackgroundStyle(dateKey, y, m, d, userLevelName);
    if (bgStyle) cell.setAttribute('style', bgStyle);
    
    let badgesHtml = '';
    const multihuecoItems = [];

    // 🛡️ AQUÍ ESTABA EL ERROR: Recorremos los servicios definidos arriba
    todosLosServicios.forEach(svc => {
        // 🧭 B1: los servicios que no pertenecen al plan visualizado no se pintan
        if (planVistaCtx && !planVistaCtx.svcNames.includes(svc.nombre)) return;
        let assigned = Object.keys(dayShifts || {}).filter(u =>
            dayShifts[u] === svc.nombre && esTitularVisibleEnPlan(u, svc.nombre, planVistaCtx));
        if (showOnlyMine && (simulatedViewUser || loggedInUser)) assigned = assigned.filter(u => u === (simulatedViewUser ?? loggedInUser));
        assigned.forEach(u => {
            badgesHtml += `<div class="shift-badge" style="background:${svc.color}; color:${contrastText(svc.color)};">${icon('user')}${escapeHtml(getInitials(u))}</div>`;
        });
        // 🧭 B7: plan explícito — los objetos de getAllUniqueServices pertenecen por
        // identidad al primer plan con ese nombre, no necesariamente al visualizado
        const pd = getPlazasForDay(svc, dateKey, planVistaCtx ? planVistaCtx.planName : null);
        if (pd > 1) {
            const filled = Object.keys(dayShifts || {}).filter(u =>
                dayShifts[u] === svc.nombre && esTitularVisibleEnPlan(u, svc.nombre, planVistaCtx)).length;
            multihuecoItems.push({ color: svc.color, filled, pd });
        }
    });

    // 🎨 Los contadores de plazas van junto al número de día ("11 ● 1/2"), sin
    // recuadro: en esquina flotante se solapaban con las etiquetas de nombre.
    // §3.1: el svc.color va en el PUNTO (hex exacto, sin derivar, así coincide
    // siempre con el chip de su servicio) y el número en texto neutro legible.
    // El punto lleva un aro sutil por CSS para que un color oscuro no se pierda
    // sobre el fondo oscuro — el relleno sigue siendo el color tal cual.
    const plazasHtml = multihuecoItems.length > 0
        ? `<span class="cal-plazas">${multihuecoItems.map(item =>
              `<span class="cal-plaza"><i class="cal-plaza__dot" style="background:${item.color};"></i>${item.filled}/${item.pd}</span>`
          ).join('')}</span>`
        : '';

    cell.innerHTML = `<div class="cal-dayrow"><div class="day-number">${d}</div>${plazasHtml}</div>${badgesHtml}`;

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

  // DETERMINACIÓN DIARIA: plan del usuario EFECTIVO en esta fecha. Si hay simulación
  // activa, el del residente simulado (currentUserProfile sigue siendo el admin).
  const viewProfile = (simulatedViewUser !== null
      ? globalProfiles.find(p => p.nombre_mostrar === simulatedViewUser)
      : null) || currentUserProfile;
  // 🧭 B4: para delegado/admin sin simulación, el modal sigue el plan VISUALIZADO
  // (selector de rotación), igual que el calendario que tiene detrás.
  const myPlanOnDate = (isDelegado && simulatedViewUser === null)
      ? ((promoConfig.planes || []).find(p => p.nombre === getCurrentRotPlan(dateKey)) || getPlanForUserOnDate(viewProfile, dateKey))
      : getPlanForUserOnDate(viewProfile, dateKey);
  const serviciosDisponibles = myPlanOnDate ? myPlanOnDate.servicios : [];
  // Contexto de visibilidad del plan (mismo criterio B1 que el calendario) y candidatos
  // asignables: residentes del plan activos este mes (sin graduados/históricos/bajas).
  const planCtxModal = getPlanVistaContext(y, m);
  const esGestorModal = myPlanOnDate ? puedeGestionarPlan(myPlanOnDate.nombre, y, m) : isAdmin;
  const _activosMesModal = getResidentesActivosEnMes(y, m);
  const candidatosForce = (planCtxModal ? planCtxModal.residentes : getAllResidents())
      .filter(r => _activosMesModal.some(a => a.toLowerCase() === r.toLowerCase()));
  const pDataFull = getUserProgress(viewUser, y, m).progress;
  const theTag = getDayTag(y, m, d);

  // 🎨 Paso 3: el modal centrado pasa a ser bottom sheet (sube desde abajo, al
  // alcance del pulgar). Solo cambia cómo se DIBUJA el día: toggleShift y el resto
  // de la lógica de asignación quedan intactos.
  // 🎨 Un doble-toque rápido en la celda llegaba a crear DOS overlays con el mismo
  // id="shift-modal". Como "Cerrar" resuelve por getElementById, borraba siempre el
  // primero del DOM y no el que se veía: hacían falta dos pulsaciones para cerrar.
  const _prevSheet = document.getElementById('shift-modal');
  if (_prevSheet) _prevSheet.remove();

  const modal = document.createElement('div'); modal.className = 'modal-overlay sheet-overlay'; modal.id = 'shift-modal';
  let html = `<div class="modal sheet" role="dialog" aria-modal="true">
    <div class="sheet__grip" aria-hidden="true"></div>
    <h3 class="sheet__title">${d} de ${MONTHS[m]} ${y}</h3>`;
  if (simulatedViewUser !== null) html += `<p class="sheet__mode" style="color:var(--merc-d);">👁 Viendo como: ${simulatedViewUser}</p>`;
  else if (isAdmin) html += `<p class="sheet__mode" style="color:var(--fest-d);">👑 MODO ADMIN (Control Total)</p>`;
  else if (isDelegado) html += `<p class="sheet__mode" style="color:var(--adu-d);">⭐ MODO DELEGADO</p>`;
  else html += `<p class="sheet__mode sheet__mode--plain">Usuario actual: <b>${loggedInUser}</b> (Evaluando: ${myPlanOnDate ? myPlanOnDate.nombre : 'Sin Plan'})</p>`;
  
  // Cambiamos el bucle para que recorra SOLO tus servicios autorizados para esta fecha
serviciosDisponibles.forEach((svc, svcIdx) => {
    // 🧭 B4: los titulares se filtran con el mismo criterio de plan que el calendario
    const holders = Object.keys(dayShifts || {}).filter(u =>
        dayShifts[u] === svc.nombre && esTitularVisibleEnPlan(u, svc.nombre, planCtxModal));

    // 🎨 Contador de plazas en la cabecera del servicio. En móvil la rejilla ya no
    // lo pinta (no cabe sin descuadrar la celda): aquí es donde de verdad hace
    // falta, justo al decidir si te asignas la guardia.
    const pdSvc = getPlazasForDay(svc, dateKey);
    const plazasChip = pdSvc > 1 ? `<span class="svc-plazas">${holders.length}/${pdSvc}</span>` : '';

    // 🎨 Paso 3 (§3.1): el nombre del servicio va como CHIP con texto de contraste.
    // Antes se pintaba con svc.color como color de texto: sobre fondo oscuro, un
    // color de servicio oscuro se volvía ilegible.
    html += `<div class="shift-option" style="flex-direction:column; align-items:stretch;"><div class="shift-option-header"><span class="svc-chip" style="background:${svc.color}; color:${contrastText(svc.color)};">${svc.nombre}</span>${plazasChip}</div>`;

    if (isDelegado && simulatedViewUser === null) {
// A) INTERFAZ PARA ADMIN/DELEGADO (edición solo si gestiona el plan visualizado)
holders.forEach(h => {
    let currentMode = state.shiftModifiers?.[dateKey]?.[h]?.tipo || 'normal';
    const modeLabels = { normal: 'Guardia Normal', partida_primera: 'Partida Diurna (50% H / Sin Saliente)', partida_segunda: 'Partida Nocturna (50% H / Con Saliente)' };
    html += `<div class="sheet__holder">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:8px;">
            <span style="font-size:0.85rem; color:var(--text-2);">Asignado: <b style="color:var(--text);">${h}</b></span>
            ${esGestorModal ? `<button class="danger icon-btn" onclick="adminForceRemove('${dateKey}', '${h}', ${y}, ${m}, ${d})">Quitar</button>` : ''}
        </div>`;
    if (esGestorModal) {
        html += `<label style="font-size:0.75rem; color:var(--text-2); display:block; margin-bottom:2px;">Regimen de Guardia:</label>
        <select class="sheet-select" onchange="updateShiftMode('${dateKey}', '${h}', this.value)" style="margin:0; padding:4px; width:100%;">
            <option value="normal" ${currentMode === 'normal' ? 'selected' : ''}>Guardia Normal</option>
            <option value="partida_primera" ${currentMode === 'partida_primera' ? 'selected' : ''}>Partida Diurna (50% H / Sin Saliente)</option>
            <option value="partida_segunda" ${currentMode === 'partida_segunda' ? 'selected' : ''}>Partida Nocturna (50% H / Con Saliente)</option>
        </select>`;
    } else {
        html += `<span style="font-size:0.75rem; color:var(--text-3);">Régimen: ${modeLabels[currentMode] || currentMode} (solo lectura: no es tu plan)</span>`;
    }
    html += `</div>`;
	}); // ⚠️ ESTE CIERRE ES EL QUE HABÍAS BORRADO
        if (esGestorModal) {
            // Solo residentes del plan visualizado, activos este mes (B4)
            html += `<div style="display:flex; gap:4px; margin-top:12px; border-top:1px solid #e2e8f0; padding-top:8px;"><select id="force-sel-${svcIdx}" class="sheet-select" style="margin:0; padding:4px;"><option value="">Añadir Residente...</option>${candidatosForce.map(r => `<option value="${r}">${r}</option>`).join('')}</select><button class="primary" style="background:var(--dark); color:white;" onclick="adminForceAssign('${dateKey}', '${svc.nombre}', ${y}, ${m}, ${d}, 'force-sel-${svcIdx}')">Poner</button></div>`;
        }
    } else {
        const isMine = dayShifts[viewUser] === svc.nombre;
        let isIllegal = false; let tempShifts = JSON.parse(JSON.stringify(state.shifts || {}));
        if (!tempShifts[dateKey]) tempShifts[dateKey] = {}; tempShifts[dateKey][viewUser] = svc.nombre;
        if (getIllegalShiftsForUser(viewUser, tempShifts).length > 0) isIllegal = true;
        
        let disabled = false; let reason = "";
        let pData = pDataFull[svc.nombre];
        let pd = pdSvc; // mismo valor: ya calculado arriba para la cabecera

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
    html += `<div class="sheet__mine">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <span style="font-size:0.85rem; color:var(--pac-d);"><b>Tu Guardia Seleccionada</b></span>
            <button class="danger" ${simulatedViewUser !== null ? 'disabled style="opacity:0.4"' : ''} onclick="toggleShift('${dateKey}', '${svc.nombre}')">Quitar</button>
        </div>
        <div style="margin-top:4px;">
            <label style="font-size:0.75rem; color:var(--pac-d); display:block; margin-bottom:2px; font-weight:bold;">Ajustar Modalidad:</label>
            <select class="sheet-select" ${simulatedViewUser !== null ? 'disabled' : `onchange="updateShiftMode('${dateKey}', '${viewUser}', this.value)"`} style="margin:0; padding:6px; width:100%;">
                <option value="normal" ${currentMode === 'normal' ? 'selected' : ''}>Guardia Normal</option>
                <option value="partida_primera" ${currentMode === 'partida_primera' ? 'selected' : ''}>Partida Diurna (50% Horas / Sin Saliente)</option>
                <option value="partida_segunda" ${currentMode === 'partida_segunda' ? 'selected' : ''}>Partida Nocturna (50% Horas / Con Saliente)</option>
            </select>
        </div>
    </div>`;
} else {
            html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; gap:8px;"><span style="font-size:0.85rem; color:${isIllegal && !isMine ? 'var(--fest-d)' : 'var(--text-2)'}; font-weight:${isIllegal && !isMine ? 'bold' : 'normal'}">${reason || occStr}</span>`;
            html += `<button class="primary" ${(disabled || simulatedViewUser !== null) ? 'disabled style="opacity:0.4"' : ''} onclick="toggleShift('${dateKey}', '${svc.nombre}')">Elegir</button></div>`;
        }
    }
    html += `</div>`;
  });
  html += `<div class="sheet__footer"><button class="sheet__close" onclick="document.getElementById('shift-modal').remove()">Cerrar</button></div></div>`;
  modal.innerHTML = html; document.body.appendChild(modal);
  // 🎨 Paso 3: tocar fuera del panel lo cierra (patrón bottom sheet)
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
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
  maybeNotifyTurnChange(curDate.getFullYear(), curDate.getMonth());
}
/**
 * Asigna forzosamente una guardia a un residente seleccionado desde el modal de admin.
 * Avisa si hay conflictos de saliente y pide confirmación antes de sobrescribir.
 */
async function adminForceAssign(dateKey, svc, y, m, d, selectId) {
  if (simulatedViewUser !== null) { alert('⚠️ Estás en modo visualización. Sal de la simulación para realizar cambios.'); return; }
  const _pvFA = getCurrentRotPlan(dateKey);
  if (!puedeGestionarPlan(_pvFA, y, m)) { alert('⚠️ Solo puedes asignar guardias dentro de tu propio plan.'); return; }
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
  const _pvFR = getCurrentRotPlan(dateKey);
  if (!puedeGestionarPlan(_pvFR, y, m)) { alert('⚠️ Solo puedes quitar guardias dentro de tu propio plan.'); return; }
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
    maybeNotifyTurnChange(y, m);
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
   const _planVista = getCurrentRotPlan(formatDateKey(y, m, 1));
   if (!puedeGestionarPlan(_planVista, y, m)) { alert('⚠️ Solo puedes saltar turnos de tu propio plan de guardias.'); return; }
   if(!confirm(`¿Saltar forzosamente el turno de ${turnUser}?`)) return;
   const monthKey = getRotationKey(y, m);
   if (!state.skippedTurns[monthKey]) state.skippedTurns[monthKey] = [];
   if (!state.skippedTurns[monthKey].includes(turnUser)) state.skippedTurns[monthKey].push(turnUser);
   let chosenShifts = []; for(let d=1; d<=getDaysInMonth(y, m); d++) { const dk = formatDateKey(y, m, d); if (state.shifts[dk] && state.shifts[dk][turnUser]) chosenShifts.push(`Día ${d} (${state.shifts[dk][turnUser]})`); }
   if (!state.exceptionLogs) state.exceptionLogs = []; state.exceptionLogs.push({ user: turnUser, monthStr: `${MONTHS[m]} ${y}`, reason: "Admin Override", shiftsSummary: chosenShifts.length > 0 ? chosenShifts.join(', ') : 'Ninguna', timestamp: new Date().toLocaleString('es-ES') });
   await saveState(); checkAutomaticGraduation();
   maybeNotifyTurnChange(y, m);
    renderAll();
}

// ============================================================
// MÓDULO: ADMIN_TURNO (sub-sección de MODALES_CALENDARIO)
// Exportar a: src/modules/modalesCalendario.js  ← mismo archivo
// Líneas estimadas: ~30
// Dependencias externas: state.grantedTurn, simulatedViewUser
// Helpers que usa: getRotationKey, residentePerteneceAPlan, getCurrentRotPlan,
//                  puedeGestionarPlan, saveState, renderAll
// ============================================================
/**
 * Clave de turno otorgado: mes + plan. Antes era solo el mes, así que en un contenedor
 * con varios planes solo cabía UN turno otorgado al mes: si la delegada de R1 otorgaba
 * uno y luego alguien otorgaba otro en R2, el segundo pisaba al primero en silencio.
 * Mismo esquema que keyMes de la subasta (subastaSnapshot / fechaFinRonda).
 * @param {number} y
 * @param {number} m - 0-indexed
 * @param {string} planName
 * @returns {string} "YYYY_MM_Plan"
 */
function _grantedTurnKey(y, m, planName) { return `${getRotationKey(y, m)}_${planName}`; }

/**
 * Devuelve el turno otorgado vigente para ese mes y plan, o null. Acepta las claves del
 * esquema antiguo (solo mes) validando que el agraciado pertenezca al plan consultado,
 * para no perder turnos otorgados que estuvieran vivos al desplegar este cambio.
 * @param {number} y
 * @param {number} m - 0-indexed
 * @param {string} planName
 * @returns {{nombre: string, clave: string}|null} clave = dónde está guardado (para borrarlo)
 */
function _getGrantedTurn(y, m, planName) {
    if (!state.grantedTurn || !planName) return null;
    const k = _grantedTurnKey(y, m, planName);
    if (state.grantedTurn[k]) return { nombre: state.grantedTurn[k], clave: k };
    const mkLegacy = getRotationKey(y, m);
    const legacy = state.grantedTurn[mkLegacy];
    if (legacy && residentePerteneceAPlan(legacy, planName, y, m)) return { nombre: legacy, clave: mkLegacy };
    return null;
}

/** Cancela el turno especial otorgado para este mes EN EL PLAN VISUALIZADO, volviendo al turno natural. */
async function adminClearGrantedTurn(y, m) {
    const planVista = getCurrentRotPlan(formatDateKey(y, m, 1));
    if (!puedeGestionarPlan(planVista, y, m)) return alert('⚠️ Solo puedes cancelar turnos otorgados de tu propio plan de guardias.');
    const g = _getGrantedTurn(y, m, planVista);
    if (g && state.grantedTurn) delete state.grantedTurn[g.clave];
    await saveState();
    renderAll();
}

