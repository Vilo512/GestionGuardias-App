// ============================================================
// MÓDULO: PERFIL_USUARIO
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

    let estadoCarga = 'deficit';
    let estadoTexto = 'Déficit Formativo (Revisar)';
    if (horasTotal >= minHoras && horasTotal <= maxHoras) {
        estadoCarga = 'ok';
        estadoTexto = 'Rango Legal y Formativo Óptimo';
    } else if (horasTotal > maxHoras) {
        estadoCarga = 'exceso';
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

// 5. Inyección del layout en el contenedor principal
    const root = document.getElementById('contenido-principal');
    _bindPerfilActions(root);
    // left/width de la barra son dato calculado: se pasan como custom properties, no como style= de presentación.
    const pct = v => `${((v / topeVisual) * 100).toFixed(2)}%`;
    root.innerHTML = `
        <div class="prf-head">
            <div class="prf-head__info">
                <h2 class="prf-head__title">👤 Mi Perfil</h2>
                <p class="prf-head__who">Identidad activa: <strong>${escapeHtml(uProfile.nombre_mostrar)}</strong></p>
            </div>
            <span class="prf-plan">📍 Plan actual: ${escapeHtml(nombrePlanHoy)}</span>
        </div>
        <div class="prf-grid">
            <section class="prf-card">
                <div>
                    <h3 class="prf-card__title">✏️ Datos Personales</h3>
                    <span class="prf-label">Nombre y apellidos</span>
                    <p class="prf-readonly">${escapeHtml(uProfile.nombre_mostrar)}</p>
                    <p class="prf-note">El nombre se sincroniza automáticamente desde tu cuenta de Google. Contacta al administrador si necesitas corregirlo.</p>
                </div>
            </section>

            <section class="prf-card">
                <div>
                    <h3 class="prf-card__title">🎓 Inicio de Residencia</h3>
                    <label class="prf-label" for="perfil-fecha-inicio">Fecha de inicio oficial (R1)</label>
                    <input type="date" id="perfil-fecha-inicio" class="prf-input" value="${escapeHtml(uProfile.fecha_inicio_residencia || '')}">
                    <p class="prf-note">Es la fecha exacta (con año) en la que empezaste el contrato de R1. Sirve para saber qué plan aplicarte.</p>
                </div>
                <button class="primary prf-action" data-prf-act="guardar-inicio">🔄 Actualizar inicio</button>
            </section>

            <section class="prf-card">
                <div>
                    <h3 class="prf-card__title">🪪 Datos de Contrato</h3>
                    <label class="prf-label" for="perfil-mes-contrato">Mes de cambio de contrato</label>
                    <select id="perfil-mes-contrato" class="prf-input">${mesOptions}</select>
                    <p class="prf-note">El mes en que se renueva tu contrato y subes de nivel (R1→R2→R3). El día se fija automáticamente al 1 del mes.</p>
                </div>
                <button class="primary prf-action" data-prf-act="guardar-contrato">💾 Actualizar contrato</button>
            </section>

            <section class="prf-card">
                <div>
                    <h3 class="prf-card__title">🏥 Ausencias y Suspensiones</h3>
                    <p class="prf-intro">Registra periodos largos de baja médica o rotaciones externas para que el asignador automático te excluya de las ruedas afectadas.</p>
                    <div id="lista-bajas-usuario" class="prf-bajas">
                        ${misBajas.length === 0 ? '<p class="prf-empty">No tienes ausencias registradas.</p>' : misBajas.map(b => `
                            <div class="prf-baja">
                                <div class="prf-baja__info">
                                    <strong class="prf-baja__motivo">${escapeHtml(b.motivo)}</strong>
                                    <span class="prf-baja__fechas">Del ${formatDK(b.fechaInicio.replace(/-/g,'_'))} al ${formatDK(b.fechaFin.replace(/-/g,'_'))}</span>
                                </div>
                                <button class="danger prf-baja__del" data-prf-act="borrar-baja" data-prf-id="${escapeHtml(String(b.id))}" aria-label="Eliminar ausencia: ${escapeHtml(b.motivo)}">✕</button>
                            </div>
                        `).join('')}
                    </div>
                    <div class="prf-new">
                        <span class="prf-label">Nueva ausencia</span>
                        <div class="prf-new__dates">
                            <div class="prf-new__field"><label class="prf-sublabel" for="baja-fecha-inicio">Inicio</label><input type="date" id="baja-fecha-inicio" class="prf-input"></div>
                            <div class="prf-new__field"><label class="prf-sublabel" for="baja-fecha-fin">Fin</label><input type="date" id="baja-fecha-fin" class="prf-input"></div>
                        </div>
                        <label class="prf-sublabel" for="baja-motivo">Motivo</label>
                        <input type="text" id="baja-motivo" class="prf-input" placeholder="Ej: Rotación externa, IT…">
                    </div>
                </div>
                <button class="primary prf-action" data-prf-act="nueva-baja">➕ Añadir ausencia</button>
            </section>

            <section class="prf-card prf-card--wide">
                <div class="prf-hours-head">
                    <h3 class="prf-card__title prf-card__title--flush">⏱️ Auditoría de Carga Laboral (Horas)</h3>
                    <div class="prf-filters">
                        <select class="prf-input" data-prf-filtro="y" aria-label="Año">${anioOpcionesHoras}</select>
                        <select class="prf-input" data-prf-filtro="m" aria-label="Mes">${mesOpcionesHoras}</select>
                    </div>
                </div>

                <div class="prf-stats">
                    <div class="prf-stat">
                        <span class="prf-stat__label">Horas ${MONTHS[perfilHorasFiltroM]}</span>
                        <span class="prf-stat__value">${horasMes.toFixed(1)} h</span>
                    </div>
                    <div class="prf-stat">
                        <span class="prf-stat__label">Guardias completas</span>
                        <span class="prf-stat__value prf-stat__value--adu">${completasMes}</span>
                    </div>
                    <div class="prf-stat">
                        <span class="prf-stat__label">Medias guardias (partidas)</span>
                        <span class="prf-stat__value prf-stat__value--merc">${partidasMes}</span>
                    </div>
                </div>
                <div class="prf-totals">
                    <span>Total ${perfilHorasFiltroY}: <strong>${horasAnio.toFixed(1)} h</strong></span>
                    <span>Total histórico: <strong>${horasTotal.toFixed(1)} h</strong></span>
                </div>

                <div class="prf-load prf-load--${estadoCarga}">
                    <div class="prf-load__head">
                        <span class="prf-load__state">${estadoTexto}</span>
                        <span class="prf-load__count">${horasTotal.toFixed(0)} / ${targetHoras} h (±${tolerancia} h)</span>
                    </div>
                    <div class="prf-load__track" role="img" aria-label="${horasTotal.toFixed(0)} horas acumuladas; rango legal entre ${minHoras} y ${maxHoras}">
                        <div class="prf-load__mark prf-load__mark--min" style="--x:${pct(minHoras)}" title="Mínimo formativo (${minHoras} h)"></div>
                        <div class="prf-load__mark prf-load__mark--max" style="--x:${pct(maxHoras)}" title="Tope máximo (${maxHoras} h)"></div>
                        <div class="prf-load__fill" style="--w:${porcentajeCarga.toFixed(2)}%"></div>
                    </div>
                    <p class="prf-note">
                        Objetivo: <strong>${targetHoras} h</strong>. Tolerancia legal: entre <strong>${minHoras} h</strong> y <strong>${maxHoras} h</strong>.<br>
                        Por debajo del mínimo el sistema advierte de un posible déficit formativo; por encima del máximo, se incumplen los descansos estipulados.
                    </p>
                </div>
            </section>
        </div>`;
}

/** Delegado de Mi Perfil: botones con data-prf-act y selectores con data-prf-filtro, sin onclick inline. */
function _bindPerfilActions(root) {
    if (!root || root._prfBound) return;
    root._prfBound = true;
    root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-prf-act]');
        if (!btn || !root.contains(btn)) return;
        switch (btn.dataset.prfAct) {
            case 'guardar-inicio':   return guardarFechaInicioPerfil();
            case 'guardar-contrato': return guardarFechaContratoPerfil();
            case 'nueva-baja':       return solicitarBajaPerfil();
            case 'borrar-baja': {
                // Se busca el id original en vez de convertir el atributo: una baja sin id numérico daría NaN y no se borraría.
                const baja = (state.bajasLargas || []).find(b => String(b.id) === btn.dataset.prfId);
                return eliminarBajaPerfil(baja ? baja.id : undefined);
            }
        }
    });
    root.addEventListener('change', (e) => {
        const sel = e.target.closest('[data-prf-filtro]');
        if (!sel || !root.contains(sel)) return;
        if (sel.dataset.prfFiltro === 'y') setPerfilHorasFiltro(sel.value, perfilHorasFiltroM);
        else setPerfilHorasFiltro(perfilHorasFiltroY, sel.value);
    });
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
            invalidateConfigMesDesde(); // Solo desde el mes actual: los meses cerrados no se reabren
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
            invalidateConfigMesDesde(); // Solo desde el mes actual: los meses cerrados no se reabren
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

