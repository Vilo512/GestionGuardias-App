// ============================================================
// MÓDULO: MOTOR_SUBASTAS
// Dependencias externas: state, promoConfig, globalProfiles, curDate
// Helpers que usa: getDaysInMonth, formatDateKey, getDayTag, isServiceEnabledOnDate, getPlazasForDay, getHistoricoFestivosResidentes, getResidentesActivosEnMes, getUserProgress, getPlanForUserOnDate, getComputedShifts, saveState, renderAll, getRotationKey
// ============================================================

/**
 * Genera una semilla entera a partir de un objeto historico {nombre: count}.
 * La semilla cambia si cualquier conteo cambia, y es idéntica para todos los usuarios
 * que compartan el mismo state → el orden aleatorio de desempate es consistente y se
 * actualiza automáticamente cuando se añaden guardias (calendario o mercadillo).
 * @param {Object} hist
 * @returns {number}
 */
function hashHistorico(hist) {
    return Object.keys(hist).sort().reduce((acc, k, i) => {
        const nameHash = k.split('').reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0);
        return (Math.imul(acc ^ nameHash, 1664525) + (hist[k] || 0) * 1013904223) | 0;
    }, 1234567891);
}

/**
 * Devuelve una función PRNG basada en la semilla dada (algoritmo mulberry32).
 * Cada llamada al resultado avanza el estado interno y retorna un float [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
function seededRandom(seed) {
    seed = (seed ^ 0xdeadbeef) >>> 0;
    return function() {
        seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
        return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
    };
}
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

    const referenceDk = formatDateKey(y, m, 1);
    // 🧭 B2: el análisis sigue el plan visualizado (simulación > selector del delegado >
    // plan propio calculado), igual que el resto de vistas.
    const planNombreVista = getCurrentRotPlan(referenceDk);
    const miPlan = (promoConfig.planes || []).find(p => p.nombre === planNombreVista)
        || getPlanForUserOnDate(currentUserProfile, referenceDk)
        || promoConfig.planes?.[0];
    if (!miPlan) return { estado: 'libre', exceso: 0, nominados: [], svcNombre: null };

    // keyMes incluye el plan para que cada plan tenga su propia marca y snapshot de subasta.
    const keyMes = `${y}_${m}_${miPlan.nombre}`;

    // ── SNAPSHOT ──────────────────────────────────────────────────────────────────────────────
    // Si ya existe un snapshot para este mes+plan, devolver desde él sin re-evaluar desde cero.
    // Escrito la primera vez que rondaTerminada=true. Borrado por adminResetMonth y resetSubastaEstado.
    if (!state.subastaSnapshot) state.subastaSnapshot = {};
    const _snap = state.subastaSnapshot[keyMes];
    if (_snap !== undefined) {
        // Snapshot "libre": todos los huecos estaban cubiertos cuando terminó la ronda.
        if (!_snap.svcNombre) return { estado: 'libre', exceso: 0, nominados: [], svcNombre: null };
        // Verificación ligera: si todos los huecos se cubrieron voluntariamente, transicionar a libre.
        const _snapPlanRef = (promoConfig.planes || []).find(p => p.nombre === _snap.planNombre) || miPlan;
        const _snapSvcRef = _snapPlanRef?.servicios?.find(s => s.nombre === _snap.svcNombre);
        if (_snapSvcRef) {
            let _currentExceso = 0;
            const _totalDias = getDaysInMonth(y, m);
            for (let d = 1; d <= _totalDias; d++) {
                const dk = formatDateKey(y, m, d);
                const tag = getDayTag(y, m, d);
                if ((_snapSvcRef.subastaTrigger || []).includes(tag)) {
                    if (_snapSvcRef.requiereHabilitacion && !isServiceEnabledOnDate(_snapSvcRef.nombre, dk, _snapPlanRef.nombre)) continue;
                    const needed = getPlazasForDay(_snapSvcRef, dk);
                    let assigned = 0;
                    if (state.shifts[dk]) {
                        for (const u in state.shifts[dk]) {
                            if (state.shifts[dk][u] === _snapSvcRef.nombre && !u.startsWith('VRE')) {
                                const uProfile = globalProfiles.find(p => p.nombre_mostrar === u);
                                if (!uProfile || getPlanForUserOnDate(uProfile, referenceDk)?.nombre === _snapPlanRef.nombre) assigned++;
                            }
                        }
                    }
                    _currentExceso += Math.max(0, needed - assigned);
                }
            }
            if (_currentExceso === 0) return { estado: 'libre', exceso: 0, nominados: [], svcNombre: null };
        }
        // Estado dinámico: la transición abierta→cerrada sigue dependiendo del tiempo y forzados.
        const _inicioRonda = state.fechaFinRonda?.[keyMes] ?? 0;
        const _horasTrans = (Date.now() - _inicioRonda) / (1000 * 60 * 60);
        const _isForzada = state.subastasCerradasForzosas?.[`${y}_${m}_${miPlan.nombre}_${_snap.svcNombre}`];
        const _ventana = promoConfig.ventana_voluntaria_horas || 48;
        const _estadoSnap = (_horasTrans >= _ventana || _isForzada) ? 'subasta_cerrada' : 'subasta_abierta';
        return {
            estado: _estadoSnap,
            exceso: _snap.exceso,
            nominados: _snap.nominados,
            planResidentes: _snap.planResidentes,
            svcNombre: _snap.svcNombre,
            planNombre: _snap.planNombre,
            servicioCriterio: _snap.servicioCriterio,
            horasRestantes: Math.floor(Math.max(0, _ventana - _horasTrans)),
            criterio: _snap.criterio,
            historico: _snap.historico
        };
    }
    // ── FIN SNAPSHOT ──────────────────────────────────────────────────────────────────────────

    // Ronda terminada solo cuando todos los residentes del plan del usuario han completado el turno.
    // Esto vincula la subasta al plan específico que terminó de elegir, no a la rotación global.
    let rondaTerminada = false;
    if (state.configMes && state.configMes[mk]) {
        const ordenSeleccion = state.configMes[mk].ordenSeleccion || [];
        const activosMes = getResidentesActivosEnMes(y, m);
        const residentsOnMyPlan = ordenSeleccion.filter(r =>
            globalProfiles.some(p => p.nombre_mostrar === r) &&
            residentePerteneceAPlan(r, miPlan.nombre, y, m)
        );
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

    if (!state.fechaFinRonda) state.fechaFinRonda = {};
    if (!state.fechaFinRonda[keyMes]) {
        state.fechaFinRonda[keyMes] = Date.now();
        saveState(); // Fire and forget
    }

    const totalDias = getDaysInMonth(y, m);

    // Candidatos y nominados son únicamente los residentes del plan del usuario
    // (getResidentesActivosEnMes ya descarta graduados y bajas largas aprobadas del mes)
    const residentes = getResidentesActivosEnMes(y, m).filter(residente => {
        if (state.excluidosSubastas && state.excluidosSubastas.includes(residente)) return false;
        return residentePerteneceAPlan(residente, miPlan.nombre, y, m);
    });
    
    if (residentes.length === 0) return { estado: 'libre', exceso: 0, nominados: [], svcNombre: null };

    const serviciosOrdenados = [...miPlan.servicios].sort((a, b) => (a.ordenSubasta || 999) - (b.ordenSubasta || 999));
    // La subasta opera sobre el calendario de asignación original (state.shifts), nunca sobre
    // los trades del mercadillo (getComputedShifts). Usar computedShifts aquí generaba una
    // inconsistencia: ventas a Externo o inter-plan eliminan la entrada del vendedor en
    // computedShifts pero no en state.shifts, haciendo que la subasta detectara "exceso"
    // mientras renderAlertaCargaMensual y ejecutarAsignacionForzosa (que usan state.shifts)
    // mostraban 0 huecos → mes atascado en estado de subasta con 0 guardias a repartir.
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

                if (state.shifts[dk]) {
                    for (let u in state.shifts[dk]) {
                        if (state.shifts[dk][u] === svc.nombre && !u.startsWith('VRE')) {
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
                // Desempate dentro de tramos igualados: aleatorio con semilla derivada del histórico.
                // Todos los usuarios obtienen el mismo orden; cambia automáticamente al añadir guardias.
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
                        // Tramo empatado: shuffle con semilla = hash del histórico actual.
                        // Mismo resultado para todos; se renueva al añadirse cualquier guardia.
                        const _seed = hashHistorico(historico) ^ (historicoDesempate && !fallbackDes ? hashHistorico(historicoDesempate) : 0);
                        const _rng = seededRandom(_seed);
                        nominados.push(...[...tramo].sort(() => _rng() - 0.5).slice(0, _needed));
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

            // Congelar evaluación: exceso/nominados/svcNombre no se recalcularán hasta adminResetMonth.
            state.subastaSnapshot[keyMes] = {
                exceso: excesoSvc,
                nominados,
                svcNombre: svc.nombre,
                planNombre: miPlan.nombre,
                planResidentes: residentes,
                servicioCriterio: svc.subastaCriterioServicio || svc.nombre,
                criterio: svc.subastaCriterio,
                historico: historico || null
            };
            saveState(); // Fire and forget

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
    
    // Todos los servicios cubiertos al terminar la ronda: persistir snapshot "libre" para evitar
    // re-evaluación completa (getUserProgress × todos los residentes) en llamadas futuras.
    state.subastaSnapshot[keyMes] = { svcNombre: null, exceso: 0, nominados: [], planNombre: miPlan.nombre };
    saveState(); // Fire and forget
    return { estado: 'libre', exceso: 0, nominados: [], svcNombre: null };
}

// ============================================================
// MÓDULO: MOTOR_TURNO
// Dependencias externas: state.configMes, state.skippedTurns, state.grantedTurn, promoConfig, globalProfiles
// Helpers que usa: getRotationKey, getRotationForPlan, getPlanForUserOnDate, getUserProgress, getResidentesActivosEnMes, formatDateKey, saveState, renderAll
// ============================================================

// Guard para evitar recursión: getCurrentTurn → getUserProgress → getAnalisisFestivos → getCurrentTurn
// (_computingTurn y _computingAnalisis declarados al inicio del archivo para evitar TDZ)

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

// 🔧 Libera un mes atascado en estado de subasta.
// Uso: resetSubastaEstado(2026, 7)  ← agosto (m=7, 0-indexed)
//      resetSubastaEstado(2026, 7, 'Plan R1')  ← solo ese plan
// Borra subastaSnapshot, fechaFinRonda y subastasCerradasForzosas del mes para que el
// motor re-evalúe desde cero en la próxima llamada a getAnalisisFestivos.
window.resetSubastaEstado = async function(y, m, planNombre) {
    let borrados = 0;
    const _rmByPrefix = (obj, prefix, exact) => {
        if (!obj) return;
        Object.keys(obj).forEach(k => {
            if (exact ? k === prefix : k.startsWith(prefix)) { delete obj[k]; borrados++; }
        });
    };
    const prefExact = planNombre ? `${y}_${m}_${planNombre}` : null;
    const prefStart = planNombre ? `${y}_${m}_${planNombre}` : `${y}_${m}_`;
    _rmByPrefix(state.subastaSnapshot, prefExact || prefStart, !!planNombre);
    _rmByPrefix(state.fechaFinRonda,   prefExact || prefStart, !!planNombre);
    _rmByPrefix(state.subastasCerradasForzosas, planNombre ? `${y}_${m}_${planNombre}_` : `${y}_${m}_`, false);
    if (borrados === 0) {
        console.log(`ℹ️ resetSubastaEstado: no se encontraron entradas para y=${y} m=${m}${planNombre ? ' plan=' + planNombre : ''}.`);
        return;
    }
    await saveState();
    renderAll();
    console.log(`✅ resetSubastaEstado: ${borrados} entrada(s) borradas. El motor re-evalúa desde cero.`);
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
 * Invalida el cache de ordenSeleccion SOLO desde el mes indicado en adelante
 * (por defecto, desde el mes actual real). Los meses pasados conservan su orden
 * histórico: así una nueva alta o un cambio de fechas no reabre meses ya cerrados.
 * @param {number} [fromY] - año desde el que invalidar (incluido)
 * @param {number} [fromM] - mes 0-indexed desde el que invalidar (incluido)
 */
function invalidateConfigMesDesde(fromY, fromM) {
    if (!state.configMes) return;
    const hoy = new Date();
    const fy = (fromY ?? hoy.getFullYear());
    const fm = (fromM ?? hoy.getMonth());
    const fromVal = fy * 12 + fm;
    for (const k of Object.keys(state.configMes)) {
        // Las claves tienen formato "YYYY_MM" con MM 0-indexed (getRotationKey)
        const [ky, km] = k.split('_').map(n => parseInt(n, 10));
        if (isNaN(ky) || isNaN(km)) continue;
        if (ky * 12 + km >= fromVal) delete state.configMes[k];
    }
}

/**
 * Devuelve el nombre del residente cuyo turno está activo en el mes dado, DENTRO del
 * plan consultado (compartimentación B2): el orden cacheado sigue siendo la lista plana
 * de todos los planes, pero la evaluación de turno se restringe a los miembros del plan.
 * Genera/cachea el orden en state.configMes si no existe. Respeta grantedTurn,
 * bajasLargas, skippedTurns y pausados. Usa guard _computingTurn anti-recursión.
 * @param {number} y
 * @param {number} m - 0-indexed
 * @param {string} [forcedPlanName] - si se omite, usa getCurrentRotPlan (plan del
 *   espectador: simulado > selector de delegado > plan propio calculado)
 * @returns {string|null} nombre_mostrar o null si todos los del plan han completado
 */
function getCurrentTurn(y, m, forcedPlanName) {
    if (_computingTurn) return null; // Corta la recursión
    const mk = getRotationKey(y, m);
    const planName = forcedPlanName || getCurrentRotPlan(formatDateKey(y, m, 1));
    
    // Si no hay configMes para este mes, lo generamos automáticamente
    if (!state.configMes || !state.configMes[mk]) {
        const dk = formatDateKey(y, m, 1);
        const targetKey = getRotationKey(y, m);
        let flatOrden = [];
        
        // Recorremos TODOS los planes en orden (R1, R2, R3, R4...)
        // Llamamos a getRotationForPlan para obtener el orden YA ROTADO de cada plan,
        // igual que lo que se muestra en la UI de rotación. No saltamos planes sin
        // planRotations: un plan recién estrenado (ej. nuevos R1) se puebla solo desde
        // sus miembros elegibles y debe entrar en la cola desde el primer mes.
        for (const plan of (promoConfig.planes || [])) {
            // getRotationForPlan devuelve los grupos correctamente rotados para este mes
            const rotGroups = getRotationForPlan(plan.nombre, y, m);
            const planFlat = (rotGroups || []).flat();
            
            // Solo incluir a quienes realmente pertenecen a este plan este mes y están aprobados
            // (los virtuales pertenecen al plan de sus baseGroups y se incluyen siempre)
            const enEstePlan = planFlat.filter(n => {
                const p = globalProfiles.find(pr2 => pr2.nombre_mostrar === n);
                if (p && p.estado !== 'aprobado') return false;
                return residentePerteneceAPlan(n, plan.nombre, y, m);
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
        // 🧭 COMPARTIMENTACIÓN B2: el turno se evalúa solo entre los miembros del plan
        // consultado. El cache sigue siendo la lista plana global (compatibilidad), pero
        // cada plan tiene su propia cola y su propio "residente en turno".
        const orden = (state.configMes[mk].ordenSeleccion || [])
            .filter(r => residentePerteneceAPlan(r, planName, y, m));
        if (orden.length === 0) return null;

        // 💡 TURNO OTORGADO: cada plan tiene el suyo (clave mes+plan), así que el de otro
        // plan ni se ve desde aquí. Tiene prioridad absoluta sobre la rotación natural.
        if (!state.grantedTurn) state.grantedTurn = {};
        const _granted = _getGrantedTurn(y, m, planName);
        if (_granted) {
            const grantee = _granted.nombre;
            const activosMesG = getResidentesActivosEnMes(y, m);
            const isActive = activosMesG.some(a => a.toLowerCase() === grantee.toLowerCase());
            if (isActive) {
                const progG = getUserProgress(grantee, y, m);
                if (!progG.isFinished) return grantee; // Sigue siendo su turno
                // Ya terminó → limpiamos el turno otorgado y seguimos con rotación normal
                delete state.grantedTurn[_granted.clave];
                saveState(); // guardamos en background, sin await para no bloquear
            } else {
                delete state.grantedTurn[_granted.clave];
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

