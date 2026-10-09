// ============================================================
// MÓDULO: PROPUESTA_ASIGNACION (N5 §8.5)
// Dependencias externas: promoConfig, state.shifts, state.excluidosSubastas
// Helpers que usa: getResidentesActivosEnMes, residentePerteneceAPlan, getDayTag,
//                  isServiceEnabledOnDate, getPlazasForDay, getIllegalShiftsForUser,
//                  getHistoricoFestivosResidentes, hashHistorico, seededRandom,
//                  registrarHuecoSinCandidato, insertNotificacion, saveState
//
// 🔮 BASE DE N6: este módulo es el esqueleto del optimizador con vacaciones. El motor es
// GREEDY a propósito (sin vacaciones basta); N6 deberá sustituirlo por backtracking
// "most-constrained-first" y añadir el informe de viabilidad completo. Para que ese salto
// sea barato, TODA restricción sobre si alguien puede cubrir un hueco vive en un único
// sitio: _candidatoElegible(). N6 solo tendrá que añadirle estaDeVacaciones().
// ============================================================
let _propuestaMes = null; // Propuesta en revisión (borrador en memoria; nada se persiste)

/**
 * Devuelve el mapa de históricos para un criterio de subasta (§8.4).
 * Extraído de _getAnalisisFestivosImpl para poder reutilizarlo servicio a servicio.
 * @returns {Object|null} mapa {residente: nº} o null si el criterio no se puede resolver
 */
function _getHistoricoParaCriterio(crit, targetSvc, svcNombre, planRef, y, m) {
    const TODAS = ['laborable', 'vispera', 'fin_de_semana', 'festivo_intersemanal'];
    if (crit === 'historico_festivos') return getHistoricoFestivosResidentes(y, m, ['fin_de_semana', 'festivo_intersemanal'], null, true);
    if (crit === 'historico_laborables') return getHistoricoFestivosResidentes(y, m, ['laborable'], null, true);
    if (crit === 'historico_intersemanales') return getHistoricoFestivosResidentes(y, m, ['festivo_intersemanal'], null, true);
    if (crit === 'historico_total') return getHistoricoFestivosResidentes(y, m, TODAS, null, true);
    if (crit === 'historico_servicio') return getHistoricoFestivosResidentes(y, m, TODAS, svcNombre, true);
    if (crit === 'historico_servicio_dinamico') {
        if (!planRef.servicios.some(s => s.nombre === targetSvc)) return null;
        return getHistoricoFestivosResidentes(y, m, TODAS, targetSvc, true);
    }
    return null;
}

/**
 * Ordena a los candidatos de un servicio según su criterio de subasta (§8.4): primero
 * quien menos carga histórica acumula. Mismo desempate que la subasta real, incluido el
 * shuffle con semilla derivada del histórico para tramos empatados (reproducible).
 * @returns {{orden: string[], historico: Object|null}}
 */
function _ordenarCandidatosPorCriterio(residentes, svc, planRef, y, m) {
    const hist = _getHistoricoParaCriterio(svc.subastaCriterio, svc.subastaCriterioServicio, svc.nombre, planRef, y, m);
    let histDes = null, fallbackDes = false;
    if (svc.subastaDesempate && svc.subastaDesempate !== 'aleatorio') {
        histDes = _getHistoricoParaCriterio(svc.subastaDesempate, svc.subastaDesempateServicio, svc.nombre, planRef, y, m);
        if (!histDes) fallbackDes = true;
    }
    // Sin criterio determinista → orden aleatorio reproducible (semilla del mes)
    if (!hist || svc.subastaCriterio === 'aleatorio') {
        const rng = seededRandom(y * 100 + m);
        return { orden: [...residentes].sort(() => rng() - 0.5), historico: null };
    }
    const ordenados = [...residentes].sort((a, b) => {
        const diff = (hist[a] || 0) - (hist[b] || 0);
        if (diff !== 0) return diff;
        if (histDes && !fallbackDes) {
            const dd = (histDes[a] || 0) - (histDes[b] || 0);
            if (dd !== 0) return dd;
        }
        return 0;
    });
    // Barajar los tramos empatados con semilla del histórico: mismo orden para todos
    const semilla = hashHistorico(hist) ^ (histDes && !fallbackDes ? hashHistorico(histDes) : 0);
    const rng = seededRandom(semilla);
    const salida = [];
    let i = 0;
    while (i < ordenados.length) {
        const pri = hist[ordenados[i]] || 0;
        const des = (histDes && !fallbackDes) ? (histDes[ordenados[i]] || 0) : null;
        const tramo = [];
        while (i < ordenados.length) {
            const r = ordenados[i];
            if ((hist[r] || 0) !== pri) break;
            if (des !== null && (histDes[r] || 0) !== des) break;
            tramo.push(r); i++;
        }
        salida.push(...(tramo.length > 1 ? [...tramo].sort(() => rng() - 0.5) : tramo));
    }
    return { orden: salida, historico: hist };
}

/**
 * Recorta shifts a una ventana alrededor del mes (±5 días). Las reglas de saliente solo
 * alcanzan al día siguiente (y al lunes si la guardia es en sábado), así que ±5 días basta
 * para detectar cualquier conflicto real.
 *
 * ⚡ Por qué existe: getIllegalShiftsForUser recorre el objeto ENTERO de shifts en cada
 * llamada, y el motor la invoca (candidatos × huecos) veces — cientos. Sin recortar,
 * escanearía años de histórico en cada comprobación y el modal tardaría segundos en abrir,
 * empeorando cada año que pasa.
 * @returns {Object} copia recortada (segura de mutar)
 */
function _recortarShiftsAlMes(shifts, y, m) {
    const desde = new Date(y, m, 1); desde.setDate(desde.getDate() - 5);
    const hasta = new Date(y, m + 1, 0); hasta.setDate(hasta.getDate() + 5);
    const out = {};
    for (const dk in (shifts || {})) {
        const [yy, mm, dd] = dk.split('_').map(Number);
        if (isNaN(yy) || isNaN(mm) || isNaN(dd)) continue;
        const f = new Date(yy, mm - 1, dd);
        if (f >= desde && f <= hasta) out[dk] = { ...shifts[dk] };
    }
    return out;
}

/**
 * 🚦 ÚNICO punto de verdad sobre si un residente puede cubrir un hueco concreto.
 * Mismas reglas que ejecutarAsignacionForzosa: no doblar guardia el mismo día y no violar
 * descansos de saliente/entrante.
 *
 * 🔮 N6: aquí —y SOLO aquí— se añadirá `if (estaDeVacaciones(residente, dk)) return {ok:false, motivo:'Vacaciones'}`.
 * Todo lo demás (motor, modal, confirmación) queda intacto.
 *
 * Nota: prueba mutando `shifts` y revirtiendo (no deep-copy) porque se llama cientos de
 * veces; `shifts` siempre es la copia recortada que posee calcularPropuestaMes.
 * @returns {{ok: boolean, motivo: string}}
 */
function _candidatoElegible(residente, dk, svc, shifts) {
    if (shifts[dk]?.[residente]) return { ok: false, motivo: 'Ya tiene guardia ese día' };
    const existiaDia = shifts[dk] !== undefined;
    if (!existiaDia) shifts[dk] = {};
    shifts[dk][residente] = svc.nombre;
    let conflictos;
    try {
        conflictos = getIllegalShiftsForUser(residente, shifts);
    } finally {
        delete shifts[dk][residente];
        if (!existiaDia) delete shifts[dk];
    }
    if (conflictos.length > 0) return { ok: false, motivo: `Descanso: ${conflictos[0]}` };
    return { ok: true, motivo: '' };
}

/**
 * 📋 Cuenta, por servicio, los huecos OBLIGATORIOS que quedan sin cubrir en el mes.
 * "Obligatorio" = día que dispara subasta, habilitado si el servicio lo requiere, y con
 * plazas > 0 (plazasPorDia 0 significa ilimitado y queda fuera de la subasta por diseño).
 * Es un recuento estructural: no evalúa candidatos, así que es barato y sirve para
 * poblar el selector de servicios sin simular nada.
 * @returns {{nombre: string, huecos: number}[]} solo servicios con al menos un hueco
 */
function contarHuecosPorServicio(y, m, planName) {
    const planRef = (promoConfig.planes || []).find(p => p.nombre === planName);
    if (!planRef || !planRef.servicios) return [];
    const totalDias = getDaysInMonth(y, m);
    const salida = [];

    [...planRef.servicios]
        .filter(s => (s.subastaTrigger || []).length > 0)
        .sort((a, b) => (a.ordenSubasta || 999) - (b.ordenSubasta || 999))
        .forEach(svc => {
            let huecos = 0;
            for (let d = 1; d <= totalDias; d++) {
                const dk = formatDateKey(y, m, d);
                if (!svc.subastaTrigger.includes(getDayTag(y, m, d))) continue;
                if (svc.requiereHabilitacion && !isServiceEnabledOnDate(svc.nombre, dk, planName)) continue;
                // Mismo criterio de ocupación que calcularPropuestaMes: los VRE y los
                // residentes de otros planes no cuentan como plaza cubierta de este plan.
                let ocupados = 0;
                for (const u in (state.shifts[dk] || {})) {
                    if (state.shifts[dk][u] === svc.nombre && !u.startsWith('VRE')
                        && residentePerteneceAPlan(u, planName, y, m)) ocupados++;
                }
                huecos += Math.max(0, getPlazasForDay(svc, dk, planName) - ocupados);
            }
            if (huecos > 0) salida.push({ nombre: svc.nombre, huecos });
        });
    return salida;
}

/**
 * Calcula la propuesta de reparto del mes para los servicios con subastaTrigger del plan
 * (§8.5), rellenando solo los huecos vacíos. No toca state.shifts: trabaja sobre una
 * copia simulada. Para cada hueco guarda además la lista de candidatos elegibles y los
 * motivos de descarte — semilla del informe de viabilidad de N6.
 * @param {string|null} [soloSvc] - nombre de un servicio para limitar la propuesta a él;
 *                                  null/omitido = todos los servicios con subasta.
 * @returns {{filas: Object[], residentes: string[], planNombre: string}|null}
 */
function calcularPropuestaMes(y, m, planName, soloSvc = null) {
    const planRef = (promoConfig.planes || []).find(p => p.nombre === planName);
    if (!planRef || !planRef.servicios) return null;

    const residentes = getResidentesActivosEnMes(y, m).filter(r =>
        residentePerteneceAPlan(r, planName, y, m) &&
        !(state.excluidosSubastas || []).includes(r));

    const totalDias = getDaysInMonth(y, m);
    // Copia recortada al mes ±5 días: rápida de escanear y segura de mutar (ver _recortarShiftsAlMes)
    const simulated = _recortarShiftsAlMes(state.shifts, y, m);
    const filas = [];

    // 📋 soloSvc: limita la propuesta a un único servicio. Así el admin revisa y aplica
    // servicio a servicio, y cada cálculo parte de asignaciones REALES en vez de las
    // hipotéticas del servicio anterior (que falseaban los descartes por saliente).
    const serviciosOrdenados = [...planRef.servicios]
        .filter(s => (s.subastaTrigger || []).length > 0)
        .filter(s => soloSvc == null || s.nombre === soloSvc)
        .sort((a, b) => (a.ordenSubasta || 999) - (b.ordenSubasta || 999));

    for (const svc of serviciosOrdenados) {
        const { orden } = _ordenarCandidatosPorCriterio(residentes, svc, planRef, y, m);
        const candidatos = [...orden];

        for (let d = 1; d <= totalDias; d++) {
            const dk = formatDateKey(y, m, d);
            if (!svc.subastaTrigger.includes(getDayTag(y, m, d))) continue;
            if (svc.requiereHabilitacion && !isServiceEnabledOnDate(svc.nombre, dk, planName)) continue;

            // Ocupación actual del plan en ese día/servicio (los de otros planes no cuentan)
            let ocupados = 0;
            for (const u in (simulated[dk] || {})) {
                if (simulated[dk][u] === svc.nombre && !u.startsWith('VRE')
                    && residentePerteneceAPlan(u, planName, y, m)) ocupados++;
            }
            const needed = getPlazasForDay(svc, dk, planName);

            for (let hueco = ocupados; hueco < needed; hueco++) {
                const evaluados = candidatos.map(r => ({ n: r, ..._candidatoElegible(r, dk, svc, simulated) }));
                const elegibles = evaluados.filter(e => e.ok).map(e => e.n);

                if (elegibles.length === 0) {
                    filas.push({
                        dk, svc: svc.nombre, residente: null, elegibles: [],
                        descartes: evaluados.map(e => ({ n: e.n, motivo: e.motivo })), tipo: 'imposible'
                    });
                    continue;
                }
                const elegido = elegibles[0]; // greedy: el primero del orden §8.4
                if (!simulated[dk]) simulated[dk] = {};
                simulated[dk][elegido] = svc.nombre;
                filas.push({ dk, svc: svc.nombre, residente: elegido, elegibles, tipo: 'asignado' });
                // Fairness: quien recibe pasa al final de la cola
                candidatos.push(candidatos.splice(candidatos.indexOf(elegido), 1)[0]);
            }
        }
    }
    return { filas, residentes, planNombre: planName };
}

/**
 * Abre el modal de revisión de la propuesta (§8.5). Exclusivo del admin. Nada se escribe
 * en state.shifts hasta pulsar Confirmar; cada fila es editable.
 */
function abrirPropuestaMesModal(y, m, soloSvc) {
    if (!isAdmin) return alert('⚠️ La propuesta de asignación es exclusiva del administrador.');
    if (simulatedViewUser !== null) return alert('⚠️ Estás en modo visualización. Sal de la simulación para usar la propuesta.');
    const planName = getCurrentRotPlan(formatDateKey(y, m, 1));

    // 📋 Paso 1 — elección de servicio. `undefined` = aún no se ha elegido; `null` = todos.
    // Solo se ofrecen servicios con huecos obligatorios pendientes; si queda uno solo,
    // se salta el selector para no pedir un clic sin alternativa real.
    if (soloSvc === undefined) {
        const conHuecos = contarHuecosPorServicio(y, m, planName);
        if (conHuecos.length === 0) return alert(`✅ No hay huecos vacíos en ${planName} para ${MONTHS[m]} ${y}. No hay nada que proponer.`);
        if (conHuecos.length === 1) return abrirPropuestaMesModal(y, m, conHuecos[0].nombre);
        return abrirSelectorPropuestaModal(y, m, planName, conHuecos);
    }

    const propuesta = calcularPropuestaMes(y, m, planName, soloSvc);
    if (!propuesta) return alert('No se ha podido resolver el plan visualizado.');
    if (propuesta.filas.length === 0) return alert(`✅ No hay huecos vacíos en ${soloSvc == null ? planName : soloSvc} para ${MONTHS[m]} ${y}. No hay nada que proponer.`);
    _propuestaMes = { ...propuesta, y, m, soloSvc };

    document.getElementById('propuesta-modal')?.remove();
    const nAsignados = propuesta.filas.filter(f => f.tipo === 'asignado').length;
    const nImposibles = propuesta.filas.filter(f => f.tipo === 'imposible').length;

    const filasHtml = propuesta.filas.map((f, i) => {
        const dia = parseInt(f.dk.split('_')[2], 10);
        if (f.tipo === 'imposible') {
            return `<div style="display:flex; align-items:center; gap:8px; padding:6px 4px; border-bottom:1px solid #f1f5f9; font-size:0.84rem; background:#fef2f2;">
                <span style="min-width:34px; color:#64748b;">${dia}</span>
                <span style="flex:1;"><b>${f.svc}</b></span>
                <span style="color:#b91c1c; font-size:0.8rem;">🔴 Sin candidato legal (${f.descartes.length} descartados)</span>
            </div>`;
        }
        return `<div style="display:flex; align-items:center; gap:8px; padding:6px 4px; border-bottom:1px solid #f1f5f9; font-size:0.84rem;">
            <span style="min-width:34px; color:#64748b;">${dia}</span>
            <span style="flex:1;"><b>${f.svc}</b></span>
            <select id="prop-fila-${i}" style="margin:0; padding:3px; font-size:0.8rem; max-width:190px;">
                ${f.elegibles.map(r => `<option value="${r}" ${r === f.residente ? 'selected' : ''}>${r}</option>`).join('')}
                <option value="">— dejar sin asignar —</option>
            </select>
        </div>`;
    }).join('');

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'propuesta-modal';
    modal.innerHTML = `
        <div class="modal" style="max-width:600px; text-align:left;">
            <h3 style="margin-bottom:0.3rem;">📋 ${soloSvc == null ? 'Todos los servicios' : escapeHtml(soloSvc)} — ${MONTHS[m]} ${y}</h3>
            <p style="font-size:0.82rem; color:#64748b; margin-bottom:0.8rem;">
                Plan <b>${escapeHtml(planName)}</b> · Rellena solo los <b>huecos vacíos</b> ${soloSvc == null ? 'de los servicios con subasta' : 'de este servicio'}, repartiendo por los criterios de justicia ya configurados (menor histórico primero) y respetando los descansos de saliente.
                <b>Nada se guarda hasta que confirmes</b>, y puedes cambiar cualquier fila.
            </p>
            <div style="display:flex; gap:8px; margin-bottom:8px; font-size:0.8rem;">
                <span style="background:#dcfce7; color:#166534; padding:3px 8px; border-radius:6px;">✅ ${nAsignados} asignables</span>
                ${nImposibles > 0 ? `<span style="background:#fee2e2; color:#b91c1c; padding:3px 8px; border-radius:6px;">🔴 ${nImposibles} sin candidato</span>` : ''}
            </div>
            <div style="max-height:330px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px; padding:6px;">${filasHtml}</div>
            <div style="display:flex; gap:8px; margin-top:12px;">
                <button class="primary" style="flex:1; background:var(--dark); color:white;" onclick="confirmarPropuestaMes()">✅ Aplicar propuesta</button>
                <button onclick="document.getElementById('propuesta-modal').remove(); _propuestaMes = null; abrirPropuestaMesModal(${y}, ${m});">↩ Otro servicio</button>
                <button onclick="document.getElementById('propuesta-modal').remove(); _propuestaMes = null;">Cancelar</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

/**
 * 📋 Selector previo de la propuesta (§8.5): deja al admin elegir SOBRE QUÉ SERVICIO
 * lanzarla, listando solo los que tienen huecos obligatorios pendientes este mes.
 * Repartir servicio a servicio evita que las asignaciones hipotéticas de uno falseen
 * los descartes por saliente del siguiente.
 * @param {{nombre: string, huecos: number}[]} conHuecos
 */
function abrirSelectorPropuestaModal(y, m, planName, conHuecos) {
    document.getElementById('propuesta-modal')?.remove();
    const total = conHuecos.reduce((a, s) => a + s.huecos, 0);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'propuesta-modal';
    modal.innerHTML = `
        <div class="modal" style="max-width:480px; text-align:left;">
            <h3 style="margin-bottom:0.3rem;">📋 Proponer asignación — ${MONTHS[m]} ${y}</h3>
            <p style="font-size:0.82rem; color:#64748b; margin-bottom:0.8rem;">
                Plan <b>${escapeHtml(planName)}</b> · Elige el servicio sobre el que lanzar la propuesta.
                Solo aparecen los que tienen <b>huecos obligatorios sin cubrir</b>.
                Repartir <b>de uno en uno</b> es más fiable: cada cálculo parte de las guardias ya confirmadas.
            </p>
            <div id="propuesta-opciones"></div>
            <div style="display:flex; justify-content:flex-end; margin-top:12px;">
                <button onclick="document.getElementById('propuesta-modal').remove();">Cancelar</button>
            </div>
        </div>`;

    // Los botones se construyen por DOM, no por template: el nombre del servicio es
    // texto libre del admin y no debe interpolarse ni en HTML ni en un atributo onclick
    // (un `UCI "Peque"` rompería el atributo; un `<b>` inyectaría markup).
    const cont = modal.querySelector('#propuesta-opciones');
    const mkBtn = (etiqueta, huecos, onClick, dashed) => {
        const b = document.createElement('button');
        b.setAttribute('style', `display:flex; justify-content:space-between; align-items:center; gap:10px;`
            + ` width:100%; text-align:left; padding:10px 12px; min-height:44px; font-size:0.86rem;`
            + (dashed ? ' margin-top:10px; border-style:dashed;' : ' margin-bottom:6px;'));
        const izq = document.createElement('span');
        if (dashed) izq.textContent = etiqueta;
        else { const bo = document.createElement('b'); bo.textContent = etiqueta; izq.appendChild(bo); }
        const der = document.createElement('span');
        der.setAttribute('style', 'color:#64748b; font-size:0.8rem; white-space:nowrap;');
        der.textContent = `${huecos} hueco${huecos === 1 ? '' : 's'}`;
        b.append(izq, der);
        b.addEventListener('click', onClick);
        return b;
    };

    conHuecos.forEach(s => cont.appendChild(
        mkBtn(s.nombre, s.huecos, () => abrirPropuestaMesModal(y, m, s.nombre), false)));
    cont.appendChild(
        mkBtn('Todos los servicios a la vez', total, () => abrirPropuestaMesModal(y, m, null), true));

    document.body.appendChild(modal);
}

/** Aplica la propuesta revisada: escribe en state.shifts, notifica y registra los imposibles (N2). */
async function confirmarPropuestaMes() {
    if (!_propuestaMes) return;
    if (!isAdmin) return alert('⚠️ Solo el administrador puede aplicar la propuesta.');
    const { filas, y, m, planNombre, soloSvc } = _propuestaMes;

    // Recogemos lo que el admin haya dejado en cada desplegable
    const aplicar = [];
    filas.forEach((f, i) => {
        if (f.tipo !== 'asignado') return;
        const val = document.getElementById(`prop-fila-${i}`)?.value;
        if (val) aplicar.push({ dk: f.dk, svc: f.svc, residente: val });
    });
    if (aplicar.length === 0) return alert('No hay ninguna asignación seleccionada.');
    if (!confirm(`¿Aplicar ${aplicar.length} guardia(s) de ${soloSvc == null ? 'todos los servicios' : soloSvc} al calendario de ${planNombre} en ${MONTHS[m]} ${y}?`)) return;

    for (const a of aplicar) {
        if (!state.shifts[a.dk]) state.shifts[a.dk] = {};
        state.shifts[a.dk][a.residente] = a.svc;
        const p = globalProfiles.find(gp => gp.nombre_mostrar === a.residente);
        if (p) insertNotificacion(p.id, 'guardia_forzada', { year: y, month: m, fecha: formatDK(a.dk), servicio: a.svc });
    }
    // 🕳️ N2: los huecos que nadie podía cubrir quedan registrados como evidencia
    filas.filter(f => f.tipo === 'imposible').forEach(f => {
        registrarHuecoSinCandidato(f.dk, f.svc, planNombre, y, m, f.descartes, 'propuesta');
    });

    document.getElementById('propuesta-modal')?.remove();
    _propuestaMes = null;
    await saveState();
    renderAll();
    alert(`✅ Propuesta aplicada: ${aplicar.length} guardia(s) asignadas en ${MONTHS[m]} ${y}.`);
}

/**
 * 🕳️ N2 — Registra de forma persistente un hueco que la asignación forzosa no pudo
 * cubrir: fecha, servicio, plan, candidatos evaluados con su motivo de descarte y
 * origen del evento. Es la evidencia de exceso de carga asistencial (PRD §15/§8.4).
 * Visible en Admin → Excepciones. Cap de 300 entradas (se conservan las más recientes).
 * @param {string} dk
 * @param {string} svcNombre
 * @param {string} planNombre
 * @param {number} y
 * @param {number} m - 0-indexed
 * @param {{n: string, motivo: string}[]} candidatosEvaluados
 * @param {string} origen - 'forzosa' | 'propuesta' (N5) | ...
 */
function registrarHuecoSinCandidato(dk, svcNombre, planNombre, y, m, candidatosEvaluados, origen) {
    if (!state.huecosSinCandidato) state.huecosSinCandidato = [];
    state.huecosSinCandidato.push({
        dk, svc: svcNombre, plan: planNombre, mk: getRotationKey(y, m),
        candidatos: candidatosEvaluados || [], origen,
        ts: new Date().toLocaleString('es-ES')
    });
    if (state.huecosSinCandidato.length > 300) {
        state.huecosSinCandidato = state.huecosSinCandidato.slice(-300);
    }
}

/**
 * Asigna automáticamente guardias pendientes de un servicio a los nominados por la subasta.
 * Respeta las restricciones de saliente y rota la carga entre los candidatos con fairness.
 * @param {number} y
 * @param {number} m - 0-indexed
 * @param {string} targetSvcNombre - nombre del servicio a cubrir
 */
async function ejecutarAsignacionForzosa(y, m, targetSvcNombre) {
    const _pvForz = getCurrentRotPlan(formatDateKey(y, m, 1));
    if (!puedeGestionarPlan(_pvForz, y, m)) return alert('⚠️ Solo puedes forzar asignaciones de tu propio plan de guardias.');
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
                        const referenceDkE = formatDateKey(y, m, 1);
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
        : (state.configMes?.[getRotationKey(y, m)]?.ordenSeleccion || [])
            .filter(r => !analisis.planNombre || residentePerteneceAPlan(r, analisis.planNombre, y, m));
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
        const motivosHueco = []; // 🕳️ N2: por qué se descartó cada candidato de este hueco

        for (let c = 0; c < candidatos.length; c++) {
            const residente = candidatos[c];
            if (state.shifts[hueco.dk]?.[residente]) {
                motivosHueco.push({ n: residente, motivo: 'Ya tiene guardia ese día' });
                continue;
            }

            const projected = JSON.parse(JSON.stringify(state.shifts || {}));
            if (!projected[hueco.dk]) projected[hueco.dk] = {};
            projected[hueco.dk][residente] = hueco.svc;

            const conflictos = getIllegalShiftsForUser(residente, projected);
            if (conflictos.length === 0) {
                if (!state.shifts[hueco.dk]) state.shifts[hueco.dk] = {};
                state.shifts[hueco.dk][residente] = hueco.svc;
                asignacionesLog.push(`${residente} → ${hueco.svc} (${formatDK(hueco.dk)})`);
                huecosAsignados++;
                // Notify the assigned resident
                { const _fp = globalProfiles.find(p => p.nombre_mostrar === residente); if (_fp) insertNotificacion(_fp.id, 'guardia_forzada', { year: y, month: m, fecha: formatDK(hueco.dk), servicio: hueco.svc }); }
                if (nominadosSet.has(residente)) nominadosAsignados.add(residente);
                candidatos.push(candidatos.splice(c, 1)[0]); // rotación fairness
                asignado = true;
                break;
            } else {
                motivosHueco.push({ n: residente, motivo: `Descanso: ${conflictos[0] || 'conflicto saliente/entrante'}` });
                if (nominadosSet.has(residente)) {
                    // Nominado bloqueado por conflicto de descanso (saliente/entrante)
                    nominadosBloqueados.add(residente);
                }
            }
        }

        if (!asignado) {
            huecosImpossibles.push(`${hueco.svc} (${formatDK(hueco.dk)})`);
            // 🕳️ N2: la evidencia de sobrecarga se persiste (antes moría en el alert)
            registrarHuecoSinCandidato(hueco.dk, hueco.svc, analisis.planNombre || '', y, m, motivosHueco, 'forzosa');
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
        // Notify admins and delegados about uncoverable slots
        globalProfiles.filter(p => p.estado === 'aprobado' && (p.rol === 'admin' || p.rol === 'delegado')).forEach(ap => {
            insertNotificacion(ap.id, 'hueco_sin_candidato', { year: y, month: m, servicio: targetSvcNombre, count: huecosImpossibles.length });
        });
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

