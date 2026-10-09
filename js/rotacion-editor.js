// ============================================================
// MÓDULO: ROTACION_EDITOR
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
            ? `👑 Grupo Especial: Rotantes Fijos <span class="rot-card__count rot-card__count--fijos">(${g.length} personas)</span>`
            : `Hospital Grupo ${grupoMovilContador++} <span class="rot-card__count">(${g.length} personas)</span>`;

        const gdiv = document.createElement('div');
        gdiv.className = esGrupoDeFijos ? 'rot-card rot-card--fijos' : 'rot-card';

        // Cabecera del grupo con acciones de grupo
        let groupHeaderHtml = `<div class="rot-card__head">
            <strong>${tituloGrupo}</strong>
            ${!esGrupoDeFijos ? `
            <div class="rot-card__actions">
                <button class="rot-btn" onclick="moveGroupEntirely(${i}, 'up')" title="Subir Grupo Entero">⬆️ Grupo</button>
                <button class="rot-btn" onclick="moveGroupEntirely(${i}, 'down')" title="Bajar Grupo Entero">⬇️ Grupo</button>
                <button class="rot-btn rot-btn--adu" onclick="mergeGroupWithNext(${i})" title="Fusionar con el siguiente grupo">🔗 Fusionar▼</button>
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
            
            // Los toggles van por data-* y delegación (_bindRotEditorActions): un
            // nombre con apóstrofo rompía el onclick interpolado.
            const resAttr = escapeHtml(res);
            return `
            <div class="rot-row${esFijo ? ' rot-row--fijo' : ''}${esExcluido ? ' rot-row--excluido' : ''}">
                <div class="rot-row__name">
                    ${canSplit ? `<button class="rot-btn" onclick="splitGroupAt(${i},${rIdx})" title="Dividir grupo aquí" aria-label="Dividir grupo aquí">✂️</button>` : '<span class="rot-row__spacer"></span>'}
                    <span>${resAttr} ${esFijo ? '📌' : ''} ${esExcluido ? '👻' : ''}</span>
                </div>
                <div class="rot-row__actions">
                    <button class="rot-btn rot-btn--toggle-fest${esExcluido ? ' is-on' : ''}" data-rot-act="excluir" data-rot-res="${resAttr}" aria-pressed="${esExcluido}" title="Excluir de Subastas" aria-label="Excluir de Subastas">👻</button>
                    <button class="rot-btn rot-btn--toggle-pac${esFijo ? ' is-on' : ''}" data-rot-act="fijo" data-rot-res="${resAttr}" aria-pressed="${esFijo}" title="Fijo/Móvil" aria-label="Fijo/Móvil">📌</button>
                    <button class="rot-btn" onclick="moveResInGroup(${i},${rIdx},'up')" title="Subir dentro del grupo" aria-label="Subir dentro del grupo">↑</button>
                    <button class="rot-btn" onclick="moveResInGroup(${i},${rIdx},'down')" title="Bajar dentro del grupo" aria-label="Bajar dentro del grupo">↓</button>
                    ${canPrev ? `<button class="rot-btn rot-btn--adu" onclick="moveResToPrevGroup(${i},${rIdx})" title="Mover al grupo anterior">◀ Grp</button>` : ''}
                    ${canNext ? `<button class="rot-btn rot-btn--ped" onclick="moveResToNextGroup(${i},${rIdx})" title="Mover al grupo siguiente">Grp ▶</button>` : ''}
                    <button class="rot-btn danger" onclick="editorRemoveMemberLinear(${i},${rIdx})" title="Quitar de la rotación" aria-label="Quitar de la rotación">✕</button>
                </div>
            </div>`;
        }).join('');
        setupC.appendChild(gdiv);
    });

    const btnContainer = document.createElement('div');
    btnContainer.innerHTML = `
    <div class="rot-add">
        <select id="sel-add-res" aria-label="Añadir residente a la rotación">
            <option value="">-- Añadir Residente a la Rotación --</option>
            <option value="VIRTUAL">+ Nuevo Virtual (Ej: Aura)</option>
            ${globalProfiles.filter(p => !editingGroups.flat().includes(p.nombre_mostrar) && p.promocion_id === currentUserProfile.promocion_id && residentePerteneceAPlan(p.nombre_mostrar, _edPlanName, curDate.getFullYear(), curDate.getMonth())).map(p => `<option value="${escapeHtml(p.nombre_mostrar)}">${escapeHtml(p.nombre_mostrar)} (Registrado)</option>`).join('')}
        </select>
        <button class="primary" onclick="editorAddSelectedRes()">Añadir</button>
    </div>
    <div class="rot-danger-zone">
        <span class="rot-danger-zone__label">⚠️ ZONA DE CONFIGURACIÓN INICIAL (SOLO AL CREAR EL CONTENEDOR):</span>
        <button id="btn-shuffle" class="danger" onclick="adminAutoShuffleGroups()">🎲 Sorteo Inicial: Barajar Fila Completa Respetando Fijos</button>
    </div>`;
    setupC.appendChild(btnContainer);
    _bindRotEditorActions(setupC);
}

/**
 * Delegación de los toggles del editor de rotación. Se engancha una sola vez
 * al contenedor (que sobrevive a los re-render por innerHTML). Mismo patrón
 * que _bindAccountActions: el nombre viaja en data-*, no interpolado en JS.
 * @param {HTMLElement} root
 */
function _bindRotEditorActions(root) {
    if (!root || root._rotBound) return;
    root._rotBound = true;
    root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-rot-act]');
        if (!btn || !root.contains(btn)) return;
        const res = btn.dataset.rotRes;
        switch (btn.dataset.rotAct) {
            case 'excluir': return toggleResidenteExcluido(res);
            case 'fijo':    return toggleResidenteFijo(res);
        }
    });
}
// ============================================================
// MÓDULO: ROTACION_EDITOR_CONTROLES (sub-sección de ROTACION_EDITOR)
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
// Dependencias externas: state.planRotations, curDate, editingGroups
// Helpers que usa: getAllResidents, reempaquetarGruposPlan, formatDateKey, getCurrentRotPlan, saveState, renderRotationView
// ============================================================
/**
 * Baraja aleatoriamente la fila india manteniendo los residentes fijos al inicio.
 * Reinicia customRotations, baseMonth y baseYear al mes actual.
 */
async function adminAutoShuffleGroups() {
    const dk = formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1);
    const planName = getCurrentRotPlan(dk);
    if (!puedeGestionarPlan(planName, curDate.getFullYear(), curDate.getMonth())) return alert('⚠️ Solo puedes editar la rotación de tu propio plan de guardias.');
    if (!confirm("⚠️ Se va a barajar a los residentes. Los marcados como 'Fijos' se mantendrán al inicio de la rueda. ¿Continuar?")) return;
    if (!state.planRotations) state.planRotations = {};
    if (!state.planRotations[planName]) state.planRotations[planName] = { baseGroups: [], baseYear: curDate.getFullYear(), baseMonth: curDate.getMonth(), customRotations: {}, residentesFijos: [] };
    const pr = state.planRotations[planName];
    if (!pr.residentesFijos) pr.residentesFijos = [];
    
    // Solo se baraja a los residentes del plan visualizado (antes: todos los de la especialidad)
    let linear = getResidentesDePlan(planName, curDate.getFullYear(), curDate.getMonth());
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
    if (!puedeGestionarPlan(_planName, curDate.getFullYear(), curDate.getMonth())) return alert('⚠️ Solo puedes editar la rotación de tu propio plan de guardias.');
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
    if (!puedeGestionarPlan(_planName, curDate.getFullYear(), curDate.getMonth())) return alert('⚠️ Solo puedes editar la rotación de tu propio plan de guardias.');
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
    const _pvCierre = getCurrentRotPlan(formatDateKey(y, m, 1));
    if (!puedeGestionarPlan(_pvCierre, y, m)) return alert('⚠️ Solo puedes cerrar subastas de tu propio plan de guardias.');
    if (!confirm(`¿Seguro que quieres cerrar la subasta de ${svcNombre} inmediatamente? Se requerirá la inyección forzosa para cubrir los huecos restantes.`)) return;
    if (!state.subastasCerradasForzosas) state.subastasCerradasForzosas = {};
    // La clave incluye el plan para no mezclar cierres entre planes distintos
    const analisisCierre = getAnalisisFestivos(y, m);
    const planKey = analisisCierre?.planNombre || '';
    state.subastasCerradasForzosas[`${y}_${m}_${planKey}_${svcNombre}`] = true;
    // Notify all plan residents that the voluntary window is now open
    const _mesLabelVC = MONTHS[m] + ' ' + y;
    (analisisCierre?.planResidentes || []).forEach(nombre => {
        const _prof = globalProfiles.find(p => p.nombre_mostrar === nombre);
        if (_prof) insertNotificacion(_prof.id, 'ventana_voluntaria', { year: y, month: m, mes: _mesLabelVC, servicio: svcNombre });
    });
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
    const referenceDk = formatDateKey(y, m, 1);
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
        : (state.configMes?.[getRotationKey(y, m)]?.ordenSeleccion || [])
            .filter(r => !analisis.planNombre || residentePerteneceAPlan(r, analisis.planNombre, y, m));
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

