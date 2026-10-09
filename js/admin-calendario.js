// ============================================================
// MÓDULO: ADMIN_CALENDARIO
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
    
    // Filtro por Nivel/Año — 🧭 B5: el admin ve todos los planes; el delegado queda
    // fijado a SU plan calculado del mes visible (puede cambiar con los años R1→R2).
    const planPropioNombre = isAdmin ? null : (getPlanForUserOnDate(currentUserProfile, formatDateKey(y, m, 1))?.nombre || null);
    if (!document.getElementById('admin-level-filter')) {
        selectTool.insertAdjacentHTML('beforebegin', `<select id="admin-level-filter" style="margin-right:10px; padding:6px; border-radius:6px; border:1px solid #cbd5e1;" onchange="renderAdminCalendar()"></select>`);
    }
    const levelSel = document.getElementById('admin-level-filter');
    const prevLevel = levelSel.value;
    if (isAdmin) {
        levelSel.innerHTML = `<option value="ALL">Todos los Niveles</option>` +
            (promoConfig.planes || []).map(p => `<option value="${p.nombre}">${p.nombre}</option>`).join('');
    } else {
        levelSel.innerHTML = planPropioNombre
            ? `<option value="${planPropioNombre}">${planPropioNombre}</option>`
            : `<option value="ALL">Sin plan asignado</option>`;
    }
    if (prevLevel && levelSel.querySelector(`option[value="${prevLevel}"]`)) levelSel.value = prevLevel;
    const levelFilter = levelSel.value;

    // 1. Construcción dinámica del desplegable de pinceles.
    // Festivos oficiales: solo admin (state.festivos es global, afecta a TODOS los planes).
    let optionsHtml = isAdmin ? `<option value="festivos">🔴 Pintar Festivos Oficiales</option>` : '';

    if (promoConfig.planes) {
        promoConfig.planes.forEach(plan => {
            if (levelFilter !== 'ALL' && plan.nombre !== levelFilter) return;
            // El delegado solo recibe pinceles de su propio plan
            if (!isAdmin && plan.nombre !== planPropioNombre) return;
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
        currentVal = selectTool.options.length > 0 ? selectTool.options[0].value : '';
        selectTool.value = currentVal;
    }
    selectTool.onchange = renderAdminCalendar; // Hacer reactivo al cambiar de pincel

    // 🧨 Borrado total del mes (todas las habilitaciones + festivos): exclusivo del admin
    // ⚠️ FIX: antes el año/mes quedaban fijados en el onclick solo al insertar el botón la
    // primera vez, y no se actualizaban al cambiar de mes (el botón seguía apuntando al mes
    // viejo). Ahora el handler se reasigna en cada render con el y/m ACTUALES.
    if (isAdmin) {
        let nukeBtn = document.getElementById('admin-nuke-btn');
        if (!nukeBtn) {
            selectTool.insertAdjacentHTML('afterend', `<button id="admin-nuke-btn" class="danger" style="padding:6px 10px; font-size:0.8rem; margin-left:6px;">🧨 Borrar mes entero</button>`);
            nukeBtn = document.getElementById('admin-nuke-btn');
        }
        nukeBtn.onclick = () => adminBorrarMesCompleto(y, m);
    }


    // 🧭 N3: panel de patrón automático del pincel de habilitación activo
    let patronPanel = document.getElementById('patron-panel');
    if (!patronPanel) {
        patronPanel = document.createElement('div');
        patronPanel.id = 'patron-panel';
        patronPanel.style.cssText = 'flex-basis:100%; margin-top:8px;';
        document.getElementById('aview-calendario').appendChild(patronPanel);
    }
    patronPanel.style.display = 'none';
    if (currentVal.startsWith('svc_')) {
        const _pp = currentVal.replace('svc_', '').split('_');
        const _svcNP = _pp[0], _planNP = _pp[1];
        if (puedeGestionarPlan(_planNP, y, m)) {
            const _svcCfgP = getSvcConfig(_svcNP, _planNP);
            patronPanel.innerHTML = `
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:8px; background:white; border:1px dashed #cbd5e1; border-radius:6px;">
                    <label style="font-size:0.8rem; font-weight:bold; color:#475569;">⚙️ Patrón automático:</label>
                    <input type="text" id="patron-input" placeholder="Ej: L,X,V | M,J" value="${patronToText(_svcCfgP?.patron_automatico)}" style="margin:0; padding:5px; font-size:0.85rem; flex:1; min-width:160px; border:1px solid #cbd5e1; border-radius:5px;">
                    <button class="primary" style="padding:5px 10px; font-size:0.8rem;" onclick="guardarPatronServicio('${_svcNP}', '${_planNP}')">💾 Guardar patrón</button>
                    <button class="primary" style="padding:5px 10px; font-size:0.8rem; background:var(--dark); color:white;" onclick="ejecutarGeneracionPatron('${_svcNP}', '${_planNP}', ${y}, ${m})">✨ Generar huecos del mes</button>
                    <button class="danger" style="padding:5px 10px; font-size:0.8rem;" onclick="limpiarHabilitacionesMes('${_svcNP}', '${_planNP}', ${y}, ${m})">🧹 Limpiar mes (este pincel)</button>
                    <span style="flex-basis:100%; font-size:0.72rem; color:#94a3b8;">Semanas separadas por "|" (alternan cíclicamente desde la semana del día 1); días por comas: L,M,X,J,V,S,D. La generación usa las plazas por defecto del servicio y NO pisa los días ya pintados a mano — el resultado se edita con el pincel como siempre. "Limpiar mes" borra lo pintado de este pincel; los días establecidos por un admin quedan protegidos (solo un admin puede borrarlos).</span>
                </div>`;
            patronPanel.style.display = 'block';
        }
    }

    // 🎌 N4: panel de festivos oficiales (CCAA + año + importar), visible con el pincel
    // de festivos activo — así toda la gestión de festivos vive donde se pintan.
    let festPanel = document.getElementById('festivos-panel');
    if (!festPanel) {
        festPanel = document.createElement('div');
        festPanel.id = 'festivos-panel';
        festPanel.style.cssText = 'flex-basis:100%; margin-top:8px;';
        document.getElementById('aview-calendario').appendChild(festPanel);
    }
    festPanel.style.display = 'none';
    if (currentVal === 'festivos' && isAdmin) {
        const _fr = promoConfig.festivosRegion || null;
        const _years = [y - 1, y, y + 1, y + 2];
        festPanel.innerHTML = `
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:8px; background:white; border:1px dashed #cbd5e1; border-radius:6px;">
                <label style="font-size:0.8rem; font-weight:bold; color:#475569;">🎌 Festivos oficiales:</label>
                <select id="cfg-festivo-region" style="margin:0; padding:5px; font-size:0.85rem; min-width:190px;">
                    <option value="">-- Comunidad Autónoma --</option>
                    ${FESTIVOS_CCAA_ES.map(c => `<option value="${c.codigo}" ${_fr?.codigo === c.codigo ? 'selected' : ''}>${c.nombre}</option>`).join('')}
                </select>
                <button class="primary" style="padding:5px 10px; font-size:0.8rem;" onclick="guardarRegionFestivos()">💾 Guardar</button>
                <span style="width:1px; height:22px; background:#e2e8f0;"></span>
                <label style="font-size:0.8rem; color:#475569;">Año:</label>
                <select id="import-festivos-year" onchange="irAAnioFestivos(this.value)" style="margin:0; padding:5px; font-size:0.85rem;">
                    ${_years.map(yy => `<option value="${yy}" ${yy === y ? 'selected' : ''}>${yy}</option>`).join('')}
                </select>
                <button class="primary" style="background:#0891b2; padding:5px 10px; font-size:0.8rem;" onclick="abrirImportarFestivosModal(${y})">✨ Importar festivos</button>
                <span style="flex-basis:100%; font-size:0.72rem; color:#94a3b8;">${_fr ? `📍 Configurado: <b>${_fr.nombre}</b>. ` : '⚠️ Elige tu Comunidad Autónoma y pulsa Guardar antes de importar. '}Importa festivos nacionales + autonómicos del año elegido (fuente: Nager.Date, agregador público sin garantía oficial — revísalos antes de confirmar). Los festivos <b>LOCALES</b> de tu municipio (fiesta mayor, patrón...) no están cubiertos: píntalos a mano con este mismo pincel.</span>
            </div>`;
        festPanel.style.display = 'block';
    }

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
            // 🧭 B5: solo se puede pintar el plan que se gestiona (admin: todos)
            const puedePintar = puedeGestionarPlan(planName, y, m);

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
                if (e.button !== 0 || !puedePintar) return;

                longPressTimer = setTimeout(() => {
                    // LONG PRESS: Custom value
                    if (!state.habilitaciones) state.habilitaciones = {};
                    if (!state.habilitaciones[dateKey]) state.habilitaciones[dateKey] = {};

                    // 🧭 B7: las escrituras van SIEMPRE a la clave por plan
                    const habKey = `${svcName}@@${planName}`;
                    const current = state.habilitaciones[dateKey][habKey] !== undefined
                        ? state.habilitaciones[dateKey][habKey]
                        : state.habilitaciones[dateKey][svcName];
                    let num = prompt("Introduce el número de plazas PERSONALIZADO para este día (o 0 para ilimitado, o deja vacío para cancelar):", typeof current === 'number' ? current : (targetSvc ? targetSvc.plazasPorDia : 1));
                    if (num === null || num.trim() === '') return;

                    let parsed = parseInt(num, 10);
                    if (!isNaN(parsed) && parsed >= 0) {
                        state.habilitaciones[dateKey][habKey] = parsed;
                        _marcarOrigenHabilitacion(dateKey, habKey);
                    }

                    if (svcName === 'Pediatría') state.pedWhitelist[dateKey] = state.habilitaciones[dateKey][habKey] !== false;
                    
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
                if (e.detail === 0 || !puedePintar) return; // sometimes triggered by long press cancel

                if (!state.habilitaciones) state.habilitaciones = {};
                if (!state.habilitaciones[dateKey]) state.habilitaciones[dateKey] = {};

                // 🧭 B7: las escrituras van SIEMPRE a la clave por plan (lectura con fallback legacy)
                const habKey = `${svcName}@@${planName}`;
                const actual = state.habilitaciones[dateKey][habKey] !== undefined
                    ? state.habilitaciones[dateKey][habKey]
                    : state.habilitaciones[dateKey][svcName];
                const currentlyEnabled = actual !== undefined && actual !== false;

                state.habilitaciones[dateKey][habKey] = currentlyEnabled ? false : (targetSvc ? targetSvc.plazasPorDia : 1);
                _marcarOrigenHabilitacion(dateKey, habKey);

                if (svcName === 'Pediatría') state.pedWhitelist[dateKey] = !!state.habilitaciones[dateKey][habKey];
                
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
// MÓDULO: FESTIVOS_IMPORTACION (N4 — sub-sección de ADMIN_CALENDARIO)
// Fuente externa: date.nager.at (agregador público, sin garantía oficial; CORS abierto
// verificado). Cubre festivos NACIONALES y AUTONÓMICOS de España. NO cubre festivos
// LOCALES de municipio (fiesta mayor, patrón) — esos se añaden a mano con el pincel.
// Dependencias externas: promoConfig.festivosRegion, state.festivos, supabaseClient
// Helpers que usa: saveState, renderAdminAjustes, renderAll, setStatus
// ============================================================
/** Comunidades autónomas de España con su código ISO 3166-2 usado por Nager.Date (campo `counties`). */
const FESTIVOS_CCAA_ES = [
    { codigo: 'ES-AN', nombre: 'Andalucía' },
    { codigo: 'ES-AR', nombre: 'Aragón' },
    { codigo: 'ES-AS', nombre: 'Asturias' },
    { codigo: 'ES-CN', nombre: 'Canarias' },
    { codigo: 'ES-CB', nombre: 'Cantabria' },
    { codigo: 'ES-CL', nombre: 'Castilla y León' },
    { codigo: 'ES-CM', nombre: 'Castilla-La Mancha' },
    { codigo: 'ES-CT', nombre: 'Cataluña' },
    { codigo: 'ES-MD', nombre: 'Comunidad de Madrid' },
    { codigo: 'ES-NC', nombre: 'Comunidad Foral de Navarra' },
    { codigo: 'ES-VC', nombre: 'Comunitat Valenciana' },
    { codigo: 'ES-EX', nombre: 'Extremadura' },
    { codigo: 'ES-GA', nombre: 'Galicia' },
    { codigo: 'ES-IB', nombre: 'Illes Balears' },
    { codigo: 'ES-RI', nombre: 'La Rioja' },
    { codigo: 'ES-PV', nombre: 'País Vasco' },
    { codigo: 'ES-MC', nombre: 'Región de Murcia' },
];

/**
 * Salta a enero del año elegido en el selector de festivos. El selector NAVEGA (no es un
 * campo suelto): así el mes visible y el año a importar nunca se contradicen — antes,
 * elegir 2027 mirando enero de 2026 se revertía solo en el siguiente re-render.
 * @param {string|number} anio
 */
function irAAnioFestivos(anio) {
    const yy = parseInt(anio, 10);
    if (isNaN(yy)) return;
    curDate = new Date(yy, 0, 1);
    editingGroups = null;
    checkAutomaticGraduation();
    renderAll();
}

/** Persiste la Comunidad Autónoma elegida en la config de la promoción (jsonb, sin migración). */
async function guardarRegionFestivos() {
    const sel = document.getElementById('cfg-festivo-region');
    const codigo = sel?.value;
    if (!codigo) return alert('Selecciona una Comunidad Autónoma.');
    const nombre = FESTIVOS_CCAA_ES.find(c => c.codigo === codigo)?.nombre || codigo;
    promoConfig.festivosRegion = { codigo, nombre };

    setStatus('Guardando...');
    const { error } = await supabaseClient.from('promociones').update({ configuracion: promoConfig }).eq('id', currentUserProfile.promocion_id);
    if (error) { setStatus('Error ❌', true); return alert('Error al guardar: ' + error.message); }
    setStatus('Conectado ✅');
    alert(`✅ Comunidad Autónoma guardada: ${nombre}. Ya puedes importar los festivos del año que elijas.`);
    renderAdminCalendar();
}

/**
 * Abre el modal de importación: descarga los festivos NACIONALES + los AUTONÓMICOS de la
 * región configurada (Nager.Date) para el año dado y los presenta en una lista editable
 * con checkboxes. Nada se escribe en state.festivos hasta que el admin confirma.
 */
async function abrirImportarFestivosModal(y) {
    const fr = promoConfig.festivosRegion;
    if (!fr) return alert('⚠️ Antes configura tu Comunidad Autónoma en Admin → Ajustes → "🎌 Comunidad Autónoma para importar festivos".');

    document.getElementById('import-festivos-modal')?.remove();
    setStatus('Consultando festivos oficiales...');
    let holidays;
    try {
        const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/ES`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const all = await res.json();
        // Nacionales (global=true) + autonómicos de la región configurada
        holidays = all.filter(h => h.global || (h.counties || []).includes(fr.codigo));
    } catch (e) {
        setStatus('Error ❌', true);
        return alert(`⚠️ No se pudo contactar la fuente externa de festivos (${e.message}).\n\nPuedes seguir pintando festivos manualmente con el pincel "🔴 Pintar Festivos Oficiales" mientras tanto.`);
    }
    setStatus('Conectado ✅');
    if (holidays.length === 0) return alert('La fuente no devolvió festivos para ese año.');

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'import-festivos-modal';
    modal.innerHTML = `
        <div class="modal" style="max-width:520px; text-align:left;">
            <h3 style="margin-bottom:0.3rem;">🎌 Importar festivos ${y}</h3>
            <p style="font-size:0.82rem; color:#64748b; margin-bottom:0.8rem;">Nacionales + ${fr.nombre} — fuente no oficial, revisa antes de confirmar. Solo se marcarán los días que dejes marcados; el resto del calendario no se toca. <b>No incluye festivos locales de tu municipio</b> (fiesta mayor, patrón...): añádelos a mano con el pincel tras importar.</p>
            <div style="max-height:340px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px; padding:8px;">
                ${holidays.map((h, i) => `
                    <label style="display:flex; align-items:center; gap:8px; padding:5px 4px; border-bottom:1px solid #f1f5f9; font-size:0.85rem;">
                        <input type="checkbox" id="imp-fest-${i}" checked style="margin:0;">
                        <span style="min-width:78px; color:#64748b;">${h.date}</span>
                        <span style="flex:1;">${h.localName}</span>
                        <span style="font-size:0.72rem; color:#94a3b8;">${h.global ? '🇪🇸 Nacional' : '🏛️ Autonómico'}</span>
                    </label>`).join('')}
            </div>
            <div style="display:flex; gap:8px; margin-top:12px;">
                <button class="primary" style="flex:1; background:#0891b2;" onclick="confirmarImportarFestivos(${y})">✅ Importar seleccionados</button>
                <button onclick="document.getElementById('import-festivos-modal').remove()">Cancelar</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.dataset.holidays = JSON.stringify(holidays);
}

/** Escribe en state.festivos los días marcados del modal de importación y persiste. */
async function confirmarImportarFestivos(y) {
    const modal = document.getElementById('import-festivos-modal');
    if (!modal) return;
    const holidays = JSON.parse(modal.dataset.holidays || '[]');
    if (!state.festivos) state.festivos = {};
    let count = 0;
    holidays.forEach((h, i) => {
        const chk = document.getElementById(`imp-fest-${i}`);
        if (!chk || !chk.checked) return;
        const dk = h.date.replace(/-/g, '_'); // "2026-05-11" → "2026_05_11" (formato dateKey)
        state.festivos[dk] = true;
        count++;
    });
    modal.remove();
    if (count === 0) return alert('No se ha seleccionado ningún festivo.');
    await saveState();
    renderAll();
    alert(`✅ ${count} festivo(s) de ${y} importados y marcados en el calendario. Ajusta lo que necesites con el pincel de festivos.`);
}

// ============================================================
// MÓDULO: PATRON_HUECOS (N3 — sub-sección de ADMIN_CALENDARIO)
// Dependencias externas: promoConfig, state.habilitaciones, supabaseClient
// Helpers que usa: getSvcConfig, puedeGestionarPlan, getFirstDayOffset, getDaysInMonth,
//                  formatDateKey, saveState, renderAdminCalendar
// ============================================================
/**
 * Registra la procedencia de una habilitación recién escrita: si la escribe un admin,
 * el día queda marcado como "de admin" (prioritario: el borrado masivo de un delegado
 * no lo toca); si la escribe un delegado, se retira la marca (el último escritor manda).
 * Nota: los días pintados ANTES de existir este registro no tienen marca.
 */
function _marcarOrigenHabilitacion(dk, habKey) {
    if (!state.habilitacionesAdmin) state.habilitacionesAdmin = {};
    if (isAdmin) {
        if (!state.habilitacionesAdmin[dk]) state.habilitacionesAdmin[dk] = {};
        state.habilitacionesAdmin[dk][habKey] = true;
    } else if (state.habilitacionesAdmin[dk]?.[habKey]) {
        delete state.habilitacionesAdmin[dk][habKey];
    }
}

/**
 * 🧹 Borra de golpe todo lo pintado del pincel activo (svc@@plan) en el mes visible.
 * Los días marcados como "de admin" solo los borra un admin; para el delegado quedan
 * protegidos y se informa de cuántos se han respetado.
 */
async function limpiarHabilitacionesMes(svcName, planName, y, m) {
    if (!puedeGestionarPlan(planName, y, m)) return alert('⚠️ Solo puedes limpiar habilitaciones de tu propio plan.');
    const habKey = `${svcName}@@${planName}`;
    if (!confirm(`🧹 ¿Borrar TODO lo pintado de ${svcName} (${planName}) en ${MONTHS[m]} ${y}?\n\n${isAdmin ? 'Como admin, se borran también los días marcados por admin.' : 'Los días establecidos por un admin quedarán protegidos y no se borrarán.'}`)) return;
    let borrados = 0, protegidos = 0;
    for (let d = 1; d <= getDaysInMonth(y, m); d++) {
        const dk = formatDateKey(y, m, d);
        const dia = state.habilitaciones?.[dk];
        if (!dia || dia[habKey] === undefined) continue;
        if (!isAdmin && state.habilitacionesAdmin?.[dk]?.[habKey]) { protegidos++; continue; }
        delete dia[habKey];
        if (state.habilitacionesAdmin?.[dk]?.[habKey]) delete state.habilitacionesAdmin[dk][habKey];
        if (svcName === 'Pediatría' && state.pedWhitelist) delete state.pedWhitelist[dk];
        if (Object.keys(dia).length === 0) delete state.habilitaciones[dk];
        borrados++;
    }
    if (borrados === 0 && protegidos === 0) return alert('No había nada pintado de este pincel en el mes.');
    await saveState();
    renderAdminCalendar();
    alert(`🧹 ${borrados} día(s) borrados de ${svcName} (${planName}).${protegidos > 0 ? `\n🛡️ ${protegidos} día(s) establecidos por admin quedaron protegidos.` : ''}`);
}

/**
 * 🧨 Borrado total del mes visible (SOLO ADMIN): todas las habilitaciones de todos los
 * planes, sus marcas de procedencia, la pedWhitelist legacy y los festivos del mes.
 */
async function adminBorrarMesCompleto(y, m) {
    if (!isAdmin) return alert('⚠️ El borrado total del mes es exclusivo del admin (afecta a todos los planes y a los festivos).');
    if (!confirm(`🧨 ¿Borrar TODAS las habilitaciones (todos los planes) y los FESTIVOS de ${MONTHS[m]} ${y}?`)) return;
    if (prompt('Escribe BORRAR en mayúsculas para confirmar:') !== 'BORRAR') return;
    let dias = 0;
    for (let d = 1; d <= getDaysInMonth(y, m); d++) {
        const dk = formatDateKey(y, m, d);
        let tocado = false;
        if (state.habilitaciones?.[dk]) { delete state.habilitaciones[dk]; tocado = true; }
        if (state.habilitacionesAdmin?.[dk]) delete state.habilitacionesAdmin[dk];
        if (state.pedWhitelist?.[dk] !== undefined) { delete state.pedWhitelist[dk]; tocado = true; }
        if (state.festivos?.[dk]) { delete state.festivos[dk]; tocado = true; }
        if (tocado) dias++;
    }
    if (dias === 0) return alert('El mes ya estaba limpio.');
    await saveState();
    renderAll();
    alert(`🧨 Mes ${MONTHS[m]} ${y} limpiado: ${dias} día(s) con datos borrados (habilitaciones de todos los planes + festivos).`);
}

/** Serializa patron_automatico a texto editable: [['L','X','V'],['M','J']] → "L,X,V | M,J". */
function patronToText(patron) {
    return (patron || []).map(sem => sem.join(',')).join(' | ');
}

/**
 * Parsea el texto del patrón ("L,X,V | M,J") a array de semanas [['L','X','V'],['M','J']].
 * @returns {string[][]|null} null si contiene días inválidos; [] si está vacío
 */
function parsePatronText(txt) {
    if (!txt || !txt.trim()) return [];
    const validas = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    const semanas = txt.split('|').map(s => s.split(',').map(x => x.trim().toUpperCase()).filter(Boolean));
    for (const sem of semanas) {
        for (const l of sem) if (!validas.includes(l)) return null;
    }
    return semanas.filter(s => s.length > 0);
}

/** Guarda el patrón del panel en la config del servicio (promociones.configuracion). */
async function guardarPatronServicio(svcName, planName) {
    const _y = curDate.getFullYear(), _m = curDate.getMonth();
    if (!puedeGestionarPlan(planName, _y, _m)) return alert('⚠️ Solo puedes configurar patrones de tu propio plan.');
    const input = document.getElementById('patron-input');
    if (!input) return;
    const patron = parsePatronText(input.value);
    if (patron === null) return alert('⚠️ Patrón inválido. Usa días L,M,X,J,V,S,D separados por comas y semanas separadas por "|". Ej: L,X,V | M,J');
    const svc = getSvcConfig(svcName, planName);
    if (!svc) return alert('No se encontró el servicio en la configuración.');
    svc.patron_automatico = patron;
    svc.modo_calendario = patron.length > 0 ? 'patron' : 'manual';
    setStatus('Guardando patrón...');
    const { error } = await supabaseClient.from('promociones').update({ configuracion: promoConfig }).eq('id', currentUserProfile.promocion_id);
    if (error) { setStatus('Error ❌', true); return alert('Error al guardar el patrón: ' + error.message); }
    setStatus('Conectado ✅');
    alert(patron.length > 0 ? '✅ Patrón guardado para ' + svcName + ' (' + planName + ').' : 'Patrón vaciado: el servicio vuelve a modo manual.');
    renderAdminCalendar();
}

/**
 * Genera habilitaciones del mes desde el patrón del servicio (claves svc@@plan, B7).
 * Las semanas del patrón alternan cíclicamente empezando por la semana que contiene
 * el día 1. Solo rellena días SIN valor previo: lo pintado/despintado a mano se respeta.
 * @returns {number} número de días generados
 */
function generarHuecosDesdePatron(svcName, planName, y, m) {
    const svc = getSvcConfig(svcName, planName);
    if (!svc || !svc.patron_automatico || svc.patron_automatico.length === 0) return -1;
    const habKey = `${svcName}@@${planName}`;
    const off = getFirstDayOffset(y, m); // 0 = el mes empieza en lunes
    const LETRAS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    let count = 0;
    if (!state.habilitaciones) state.habilitaciones = {};
    for (let d = 1; d <= getDaysInMonth(y, m); d++) {
        const semanaIdx = Math.floor((d - 1 + off) / 7);
        const semana = svc.patron_automatico[semanaIdx % svc.patron_automatico.length] || [];
        if (!semana.includes(LETRAS[new Date(y, m, d).getDay()])) continue;
        const dk = formatDateKey(y, m, d);
        if (!state.habilitaciones[dk]) state.habilitaciones[dk] = {};
        if (state.habilitaciones[dk][habKey] === undefined) {
            state.habilitaciones[dk][habKey] = svc.plazasPorDia >= 0 ? svc.plazasPorDia : 1;
            _marcarOrigenHabilitacion(dk, habKey);
            count++;
        }
    }
    return count;
}

/** Handler del botón "Generar huecos del mes": valida, confirma, genera y persiste. */
async function ejecutarGeneracionPatron(svcName, planName, y, m) {
    if (!puedeGestionarPlan(planName, y, m)) return alert('⚠️ Solo puedes generar huecos de tu propio plan.');
    const svc = getSvcConfig(svcName, planName);
    if (!svc || !svc.patron_automatico || svc.patron_automatico.length === 0) {
        return alert('Este servicio no tiene patrón guardado. Escríbelo en el campo y pulsa "Guardar patrón" primero.');
    }
    if (!confirm(`¿Generar los huecos de ${svcName} (${planName}) para ${MONTHS[m]} ${y} según el patrón "${patronToText(svc.patron_automatico)}"?\n\nSolo se rellenarán días sin valor previo.`)) return;
    const count = generarHuecosDesdePatron(svcName, planName, y, m);
    if (count <= 0) return alert('No se generó ningún día nuevo (los días del patrón ya estaban definidos a mano).');
    await saveState();
    renderAdminCalendar();
    alert(`✅ ${count} día(s) habilitados para ${svcName} (${planName}) en ${MONTHS[m]} ${y}. Ajusta lo que necesites con el pincel.`);
}

// ============================================================
// MÓDULO: ADMIN_EXCEPCIONES
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

  // 🕳️ N2: Huecos sin candidato válido del mes visible (evidencia de sobrecarga)
  let hscPanel = document.getElementById('huecos-sin-candidato-panel');
  if (!hscPanel) {
      hscPanel = document.createElement('div');
      hscPanel.id = 'huecos-sin-candidato-panel';
      hscPanel.className = 'rot-group';
      document.getElementById('aview-excepciones')?.appendChild(hscPanel);
  }
  const registrosHSC = (state.huecosSinCandidato || []).filter(r => r.mk === monthKey);
  let hscHtml = `<h4 style="margin:0; margin-bottom:1rem;">🕳️ Huecos sin candidato válido — ${MONTHS[m]} ${y}</h4>`;
  if (registrosHSC.length === 0) {
      hscHtml += `<p style="font-size:0.85rem; color:#64748b;">Sin registros este mes. Cuando una asignación forzosa no encuentre candidato legal para un hueco, la evidencia (fecha, servicio y por qué se descartó cada residente) quedará guardada aquí.</p>`;
  } else {
      registrosHSC.forEach(r => {
          const idxGlobal = state.huecosSinCandidato.indexOf(r);
          const cands = (r.candidatos || []).map(c => `<li style="font-size:0.78rem; color:#64748b;"><b>${c.n}</b>: ${c.motivo}</li>`).join('');
          hscHtml += `<div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:10px; margin-bottom:8px;">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                  <span style="font-size:0.9rem;">🔴 <b>${formatDK(r.dk)}</b> — ${r.svc}${r.plan ? ` <span style="font-size:0.75rem; color:#94a3b8;">(${r.plan})</span>` : ''} <span style="font-size:0.72rem; color:#94a3b8;">· ${r.origen} · ${r.ts}</span></span>
                  ${isAdmin ? `<button class="danger icon-btn" style="padding:2px 6px; font-size:0.8rem;" onclick="adminBorrarHuecoSinCandidato(${idxGlobal})">🗑️</button>` : ''}
              </div>
              ${cands ? `<details style="margin-top:6px;"><summary style="font-size:0.78rem; cursor:pointer; color:#991b1b;">Candidatos evaluados (${(r.candidatos || []).length})</summary><ul style="margin:6px 0 0 16px;">${cands}</ul></details>` : ''}
          </div>`;
      });
  }
  hscPanel.innerHTML = hscHtml;
  const lList = document.getElementById('admin-logs-list'); if (!state.exceptionLogs || state.exceptionLogs.length === 0) { lList.innerHTML = "<p style='font-size:0.85rem; color:#64748b;'>Sin registros.</p>"; } else { lList.innerHTML = state.exceptionLogs.slice().reverse().map((l, revIdx) => { const origIdx = state.exceptionLogs.length - 1 - revIdx; return `<div style="background:#f1f5f9; padding:10px; border-radius:8px; margin-bottom:8px; font-size:0.85rem; border:1px solid #e2e8f0;"><div style="display:flex; justify-content:space-between; margin-bottom:4px;"><strong>👤 ${l.user}</strong><div><span style="color:#94a3b8; font-size:0.75rem; margin-right:8px;">🗓️ ${l.timestamp}</span><button class="danger icon-btn" style="padding:2px 6px; font-size:0.7rem;" onclick="adminDeleteLog(${origIdx})">Borrar</button></div></div><div>Mes: <b>${l.monthStr}</b></div><div style="color:var(--fest);">Motivo: <b>${l.reason}</b></div><div style="color:#475569; font-style:italic;">Retenidas: ${l.shiftsSummary}</div></div>`}).join(''); }
}
/** Elimina una entrada del log de excepciones por su índice. */
async function adminDeleteLog(idx) { if (!confirm("¿Borrar?")) return; state.exceptionLogs.splice(idx, 1); await saveState(); renderAdminExceptions(); }
/** 🕳️ N2: elimina un registro de hueco sin candidato (solo admin, por errores de registro — PRD §13.2). */
async function adminBorrarHuecoSinCandidato(idx) {
    if (!isAdmin) return alert('⚠️ Solo el admin puede borrar registros del histórico.');
    if (!confirm('¿Borrar este registro de hueco sin candidato?')) return;
    if (!state.huecosSinCandidato || !state.huecosSinCandidato[idx]) return;
    state.huecosSinCandidato.splice(idx, 1);
    await saveState();
    renderAdminExceptions();
}
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

    // data-label: en móvil cada fila se apila como tarjeta y la cabecera se oculta.
    const cols = ['Horas mes', 'Completas / Partidas', `Total ${y}`, 'Histórico'];
    let tablaHtml = '';
    if (residentes.length > 0) {
        const filas = residentes.map(r =>
            `<tr>
                <th scope="row" class="hrs-name">${escapeHtml(r.nombre)}</th>
                <td class="hrs-num hrs-num--main" data-label="${cols[0]}">${r.horasMes.toFixed(1)} h</td>
                <td class="hrs-num" data-label="${cols[1]}">${r.completasMes} / ${r.partidasMes}</td>
                <td class="hrs-num" data-label="${cols[2]}">${r.horasAnio.toFixed(1)} h</td>
                <td class="hrs-num hrs-num--muted" data-label="${cols[3]}">${r.horasTotal.toFixed(1)} h</td>
            </tr>`).join('');
        tablaHtml = `<div class="hrs-wrap">
            <table class="hrs-table">
                <thead><tr><th scope="col">Residente</th>${cols.map(c => `<th scope="col" class="hrs-num">${c}</th>`).join('')}</tr></thead>
                <tbody>${filas}</tbody>
            </table>
        </div>`;
    } else {
        tablaHtml = '<p class="hrs-empty">No hay residentes aprobados.</p>';
    }
    const _elHoras = document.getElementById('aview-horas');
    if (!_elHoras) return;
    _elHoras.innerHTML =
        `<h3 class="hrs-title">⏱️ Horas por Residente — ${MONTHS[m]} ${y}</h3>${tablaHtml}`;
}

/** Restaura todos los turnos saltados del mes, devolviendo al grupo su turno natural. */
async function adminResetSkips(y, m) { const monthKey = getRotationKey(y, m); if (state.skippedTurns[monthKey]) { delete state.skippedTurns[monthKey]; await saveState(); checkAutomaticGraduation();
    renderAll(); } }
/** Borra todas las guardias, skips, subastas y excepciones del mes. Acción destructiva con confirmación. */
async function adminResetMonth(y, m) { if (!isAdmin) return alert('⚠️ El reset del mes borra las guardias de TODOS los planes; solo el admin puede ejecutarlo.'); if (!confirm(`¡PELIGRO! ¿Borrar todas las guardias de este mes?`)) return; const days = getDaysInMonth(y, m); for(let d = 1; d <= days; d++) { const dk = formatDateKey(y, m, d); delete state.shifts[dk]; } const monthKey = getRotationKey(y, m); delete state.skippedTurns[monthKey]; if (state.pendingExceptions && state.pendingExceptions[monthKey]) delete state.pendingExceptions[monthKey]; if (state.configMes && state.configMes[monthKey]) delete state.configMes[monthKey]; if (state.subastasCerradasForzosas) { Object.keys(state.subastasCerradasForzosas).forEach(k => { if (k.startsWith(`${y}_${m}_`)) delete state.subastasCerradasForzosas[k]; }); } if (state.subastaNominados) { Object.keys(state.subastaNominados).forEach(k => { if (k.startsWith(`${y}_${m}_`)) delete state.subastaNominados[k]; }); } if (state.subastaSnapshot) { Object.keys(state.subastaSnapshot).forEach(k => { if (k.startsWith(`${y}_${m}_`)) delete state.subastaSnapshot[k]; }); } if (state.fechaFinRonda) { Object.keys(state.fechaFinRonda).forEach(k => { if (k.startsWith(`${y}_${m}_`)) delete state.fechaFinRonda[k]; }); } await saveState(); checkAutomaticGraduation();
    renderAll(); }
/**
 * Expulsa a todos los residentes no-admin de la promoción y limpia el estado del calendario completo.
 * Mantiene las reglas de promoConfig. Requiere confirmación doble con texto "VACIAR".
 */
async function adminVaciarGeneracion() {
    // Sin guarda de rol y sin ningún llamador: no hay botón que la invoque,
    // solo la consola. Se cierra igualmente porque expulsa a toda la
    // promoción, y desde que existen admins nombrados esa es la familia de
    // operaciones que acabamos de cerrar. Ver [P-10] del backlog: decidir si
    // se borra o se conecta.
    if (!esDueño) return alert('⚠️ Solo el Dueño de la especialidad puede vaciar la generación.');
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
    state.subastaSnapshot = {};
    state.fechaFinRonda = {};

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
async function adminDeletePromotion() {
    // Única operación que destruye los datos de todos. Se revalida contra el
    // servidor, no contra `esDueño`: esa variable se fija al iniciar sesión y
    // quedaría obsoleta si la corona cambia de manos a mitad de sesión.
    const { data: promo, error: errP } = await supabaseClient.from('promociones').select('creador_id').eq('id', currentUserProfile.promocion_id).single();
    if (errP || !promo) return alert("No se ha podido comprobar quién es el Dueño de la especialidad. No se ha borrado nada.");
    if (promo.creador_id !== currentUserProfile.id) return alert("⚠️ Solo el Dueño de la especialidad puede borrarla.");

    if (!confirm("⚠️ ¡ALERTA ROJA! ⚠️\nEstás a punto de borrar TODA la promoción y sus calendarios.\nNO se puede deshacer.")) return;
    if (prompt("Escribe BORRAR en mayúsculas para confirmar:") !== "BORRAR") return;
    setStatus('Destruyendo grupo...');
    const { error } = await supabaseClient.from('promociones').delete().eq('id', currentUserProfile.promocion_id);
    if (error) { setStatus('Conectado ✅'); alert("Error: " + error.message); }
    else window.location.reload();
}

/** Actualiza el buzón de solicitudes entrantes y el historial de operaciones del Mercadillo. */
function renderMercadoInboxAndLog() {
  if (!loggedInUser) return; const inb = document.getElementById('merc-inbox'); const log = document.getElementById('merc-log'); let myInbox = (state.trades || []).filter(t => (t.status === 'pending' && t.target === loggedInUser) || (t.status === 'undo_pending' && t.undoRequester !== loggedInUser && (t.requester === loggedInUser || t.target === loggedInUser))); if (myInbox.length === 0) inb.innerHTML = `<span class="merc-note">No tienes solicitudes pendientes.</span>`; else { inb.innerHTML = myInbox.map(t => { let desc = ""; const _r = escapeHtml(t.requester), _u = escapeHtml(t.undoRequester), _s1 = escapeHtml(t.s1), _s2 = escapeHtml(t.s2), _ts = escapeHtml(t.timestamp); if (t.status === 'undo_pending') desc = `⚠️ <b>${_u}</b> quiere DESHACER la operación del ${_ts}.`; else if (t.type === 'venta') desc = `💵 <b>${_r}</b> te quiere VENDER su guardia de ${_s1} (${formatDK(t.d1)}).`; else if (t.type === 'compra') desc = `🛒 <b>${_r}</b> te quiere COMPRAR tu guardia de ${_s1} (${formatDK(t.d1)}).`; else if (t.type === 'cambio') desc = `🔄 <b>${_r}</b> quiere CAMBIAR su ${_s1} (${formatDK(t.d1)}) por tu ${_s2} (${formatDK(t.d2)}).`; return `<div class="trade-row trade-row--inbox"><div>${desc}</div><div class="trade-row__actions"><button class="primary trade-btn-ok" onclick="processTrade(${t.id}, true)">✅ Aceptar</button><button class="danger" onclick="processTrade(${t.id}, false)">❌ Rechazar</button></div></div>`; }).join(''); } let allLogs = (state.trades || []).filter(t => {
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
}); if (allLogs.length === 0) log.innerHTML = `<span class="merc-note">El historial de mercado está vacío.</span>`; else { log.innerHTML = allLogs.slice().reverse().map(t => { let desc = ""; let isPending = t.status === 'pending'; const _r = escapeHtml(t.requester), _t = escapeHtml(t.target), _s1 = escapeHtml(t.s1), _s2 = escapeHtml(t.s2); if (t.type === 'venta') desc = isPending ? `⏳ <b>${_r}</b> quiere VENDER su ${_s1} (${formatDK(t.d1)}) a <b>${_t}</b>.` : `💵 <b>${_r}</b> vendió su ${_s1} (${formatDK(t.d1)}) a <b>${_t}</b>.`; else if (t.type === 'compra') desc = isPending ? `⏳ <b>${_r}</b> quiere COMPRAR ${_s1} (${formatDK(t.d1)}) a <b>${_t}</b>.` : `🛒 <b>${_r}</b> compró ${_s1} (${formatDK(t.d1)}) de <b>${_t}</b>.`; else if (t.type === 'cambio') desc = isPending ? `⏳ <b>${_r}</b> quiere CAMBIAR su ${_s1} (${formatDK(t.d1)}) por la de <b>${_t}</b> (${formatDK(t.d2)}).` : `🔄 <b>${_r}</b> cambió su ${_s1} (${formatDK(t.d1)}) por la de <b>${_t}</b> (${formatDK(t.d2)}).`; let actionBtn = ""; if (t.status === 'approved' && (t.requester === loggedInUser || t.target === loggedInUser)) actionBtn = `<button class="danger" onclick="requestTradeUndo(${t.id})">Deshacer</button>`; else if (isPending && t.requester === loggedInUser) actionBtn = `<button class="danger" onclick="cancelPendingTrade(${t.id})">Cancelar Solicitud</button>`; if (isAdmin || isDelegado) actionBtn += `<button class="danger" onclick="adminForceBorrarTrade(${t.id})" title="Eliminar entrada y guardia del calendario">🗑 Borrar</button>`; let statusClass = ""; let statusLabel = ""; if (t.status === 'undone') { statusClass = " is-undone"; statusLabel = '<b class="trade-tag trade-tag--undone">(DESHECHO)</b>'; } else if (t.status === 'undo_pending') { statusClass = " is-undo-pending"; statusLabel = '<b class="trade-tag trade-tag--undo">(DESHACER PENDIENTE)</b>'; } else if (t.status === 'pending') { statusClass = " is-pending"; statusLabel = '<b class="trade-tag trade-tag--pending">(PENDIENTE)</b>'; } return `<div class="trade-row${statusClass}"><div class="trade-row__head"><span>${desc} ${statusLabel}</span><span class="trade-row__actions">${actionBtn}</span></div><span class="trade-row__ts">${escapeHtml(t.timestamp)}</span></div>`; }).join(''); }
}
/** Cancela una solicitud de trade pendiente enviada por el usuario. */
async function cancelPendingTrade(id) { if (!confirm("¿Cancelar solicitud?")) return; state.trades = state.trades.filter(t => t.id !== id); await saveState(); checkAutomaticGraduation();
    renderAll(); }

/**
 * Elimina forzosamente una entrada del mercadillo (solo admin o delegado).
 * Borra el trade de state.trades y, si existe, la guardia subyacente en state.shifts
 * para los usuarios implicados en la operación.
 * Útil para limpiar entradas de usuarios que han cambiado de nombre o han sido expulsados.
 */
async function adminForceBorrarTrade(id) {
    if (!isAdmin && !isDelegado) return;
    const t = state.trades.find(x => x.id === id);
    if (!t) return;
    if (!confirm(`¿Eliminar esta entrada del mercadillo y sus guardias asociadas en el calendario (si existieran)?`)) return;

    const removeShift = (dk, user) => {
        if (!dk || !user || user === 'Externo' || String(user).startsWith('VRE_')) return;
        if (state.shifts[dk]?.[user]) {
            delete state.shifts[dk][user];
            if (Object.keys(state.shifts[dk]).length === 0) delete state.shifts[dk];
        }
    };

    if (t.type === 'venta') {
        removeShift(t.d1, t.requester);
    } else if (t.type === 'compra') {
        removeShift(t.d1, t.target);
    } else if (t.type === 'cambio') {
        removeShift(t.d1, t.requester);
        removeShift(t.d2, t.target);
    }

    state.trades = state.trades.filter(x => x.id !== id);
    await saveState();
    renderAll();
}
/**
 * Aprueba o rechaza una solicitud de trade (o un undo_pending).
 * Verifica que las guardias involucradas aún existen antes de aprobar.
 */
async function processTrade(id, isApprove) { let t = state.trades.find(x => x.id === id); if (!t) return; if (t.status === 'pending') { if(isApprove) { const computed = getComputedShifts(); if (t.type === 'cambio' && (!computed[t.d1]?.[t.requester] || !computed[t.d2]?.[t.target])) { alert("Error: Las guardias ya no existen."); t.status = 'rejected'; } else if (t.type === 'venta' && !computed[t.d1]?.[t.requester]) { alert("Error: La guardia ya no existe."); t.status = 'rejected'; } else if (t.type === 'compra' && t.target !== 'Externo' && !computed[t.d1]?.[t.target]) { alert("Error: La guardia ya no existe."); t.status = 'rejected'; } else { let conflicts = checkTradeConflicts(t); if (conflicts.length > 0) { if (!confirm("Generará conflictos:\n" + conflicts.join("\n") + "\n¿Continuar?")) return; } t.status = 'approved'; } } else t.status = 'rejected'; } else if (t.status === 'undo_pending') t.status = isApprove ? 'undone' : 'approved'; await saveState(); _notifyTradeResolved(id); checkAutomaticGraduation();
    renderAll(); }
/** Solicita deshacer un trade aprobado. Si es con Externo, se deshace directamente; si no, queda pendiente de confirmación. */
async function requestTradeUndo(id) { let t = state.trades.find(x => x.id === id); if (!t) return; if (t.target === 'Externo') { if(!confirm("¿Deshacer operación con externo?")) return; t.status = 'undone'; } else { if(!confirm(`¿Enviar solicitud de deshacer?`)) return; t.status = 'undo_pending'; t.undoRequester = loggedInUser; } await saveState(); checkAutomaticGraduation();
    renderAll(); }

/** Muestra el formulario de cambio propio: elige la fecha destino para intercambiar la guardia del usuario. */
function renderMercadoCambiar(dk, svc) { const container = document.getElementById('mercado-dynamic'); container.innerHTML = `<h4 class="merc-form__title">Cambiar guardia de ${escapeHtml(svc)}</h4><label class="merc-form__label">1. Elige la fecha objetivo:</label><input type="date" id="cambio-date" data-act="load-cambio-targets" data-dk="${escapeHtml(dk)}" data-svc="${escapeHtml(svc)}"><div id="cambio-targets-area" class="merc-form__area"></div>`; _bindMercadoActions(container); }
/** Carga el selector de contrapartes disponibles para la fecha destino elegida en el cambio propio. */
function loadCambioTargets(myDk, mySvc) { const dateVal = document.getElementById('cambio-date').value; if (!dateVal) return; const [y, mStr, dStr] = dateVal.split('-'); const targetDk = `${y}_${mStr}_${dStr}`; const area = document.getElementById('cambio-targets-area'); if (isPastDate(targetDk)) { area.innerHTML = `<p class="merc-error">No puedes seleccionar una fecha del pasado para hacer un cambio.</p>`; return; } const computed = getComputedShifts(); const dayShifts = computed[targetDk] || {}; let html = `<label class="merc-form__label">2. ¿Con quién la cambias?</label><select id="cambio-to-user"><option value="">-- Selecciona opción --</option>`; html += `<option value="Externo|">👽 Mover a este día (Otro Residente Externo)</option>`; for (let u in dayShifts) { if (u !== loggedInUser && !u.startsWith('VRE')) { if (canUserTakeShift(u, loggedInUser, myDk, mySvc) && canUserTakeShift(loggedInUser, u, targetDk, dayShifts[u])) { html += `<option value="${escapeHtml(u + '|' + dayShifts[u])}">🔄 ${escapeHtml(u)} (Su ${escapeHtml(dayShifts[u])})</option>`; } } } html += `</select><button class="merc merc-btn-block" data-act="solicitar-cambio" data-dk="${escapeHtml(myDk)}" data-svc="${escapeHtml(mySvc)}" data-target="${escapeHtml(targetDk)}">Solicitar Cambio</button>`; area.innerHTML = html; _bindMercadoActions(area); }
/** Lee el select de contrapartes y delega en executeSwapRequestDirect con los parámetros correctos. */
function proxySwapRequest(myDk, mySvc, targetDk) { const val = document.getElementById('cambio-to-user').value; if (!val) return alert("Selecciona una opción de cambio."); const [targetUser, targetSvc] = val.split('|'); executeSwapRequestDirect(myDk, mySvc, targetDk, targetSvc, targetUser); }
/** Muestra el formulario para proponer un cambio sobre la guardia de otro residente: elige tu guardia a ofrecer. */
function renderMercadoCambiarAjena(targetDk, targetSvc, targetUser) { const container = document.getElementById('mercado-dynamic'); if (!canUserTakeShift(loggedInUser, targetUser, targetDk, targetSvc)) { container.innerHTML = `<p class="merc-error merc-error--block">⚠️ Tu nivel actual no te permite asumir esta guardia de ${escapeHtml(targetSvc)}.</p>`; return; } const computed = getComputedShifts(); let myFutureShifts = []; for (let dk in computed) { if (!isPastDate(dk) && computed[dk][loggedInUser]) { if (canUserTakeShift(targetUser, loggedInUser, dk, computed[dk][loggedInUser])) { myFutureShifts.push({dk: dk, svc: computed[dk][loggedInUser]}); } } } let html = `<h4 class="merc-form__title merc-form__title--adu">Ofrecer cambio a ${escapeHtml(targetUser)}</h4><div class="merc-recap">Te quedarías su: <b>${escapeHtml(targetSvc)} (${formatDK(targetDk)})</b></div>`; if (myFutureShifts.length === 0) { html += `<p class="merc-error">No tienes guardias futuras programadas para ofrecerle a cambio.</p>`; } else { html += `<label class="merc-form__label">¿Qué guardia tuya le ofreces a cambio?</label><select id="cambio-ajena-sel"><option value="">-- Selecciona una de tus guardias --</option>${myFutureShifts.map(s => `<option value="${escapeHtml(s.dk + '|' + s.svc)}">${formatDK(s.dk)} - ${escapeHtml(s.svc)}</option>`).join('')}</select><button class="primary merc-btn-block" style="background:var(--adu-d); color:var(--bg);" data-act="enviar-cambio-ajena" data-dk="${escapeHtml(targetDk)}" data-svc="${escapeHtml(targetSvc)}" data-user="${escapeHtml(targetUser)}">Enviar Propuesta de Cambio</button>`; } container.innerHTML = html; _bindMercadoActions(container); }
/** Lee el select de "mi guardia a ofrecer" y ejecuta el cambio con la guardia ajena. */
function executeSwapRequestAjena(targetDk, targetSvc, targetUser) { const val = document.getElementById('cambio-ajena-sel').value; if(!val) return alert("Selecciona una guardia tuya para ofrecer."); const [myDk, mySvc] = val.split('|'); executeSwapRequestDirect(myDk, mySvc, targetDk, targetSvc, targetUser); }
