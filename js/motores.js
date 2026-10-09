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
    
    const targetVal = targetDate.getFullYear() * 12 + targetDate.getMonth();

    // 🗓️ REGLA MENSUAL (entrada): el mes de inicio de residencia cuenta ENTERO como
    // primer mes en el plan — quien empieza el 5 de junio pertenece al plan R1 desde
    // el 1 de junio. Antes se comparaba el día exacto y el residente no existía para
    // las listas mensuales (que muestrean el día 1) hasta su primer mes completo.
    const inicioVal = startDate.getFullYear() * 12 + startDate.getMonth();
    if (targetVal < inicioVal) return 0; // Mes anterior a ser residente

    // EL SALVAVIDAS: Si no ha configurado el cambio de contrato, usamos su fecha de inicio
    let savedDate = userProfile.fecha_cambio_contrato || userProfile.fecha_inicio_residencia;
    const cambioParts = savedDate.split('-');

    // 🗓️ REGLA MENSUAL (cambio): el nivel/plan nunca cambia a mitad de mes. El mes que
    // contiene la fecha de cambio de contrato cuenta ENTERO como el nivel nuevo (el
    // posterior): cambio el 27/05 → todo mayo ya es R2. Se comparan meses, no días.
    const cambioMes = parseInt(cambioParts[1], 10) - 1;
    const efectivoVal = targetDate.getFullYear() * 12 + cambioMes;

    let level = targetDate.getFullYear() - startDate.getFullYear() + 1;
    if (targetVal < efectivoVal) level--; // Aún no ha cruzado su mes de cambio este año

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

        // 1. Calcular quiénes pertenecen matemáticamente a este Plan en este mes
        // (fuente única B3: excluye graduados e históricos ya salidos; incluye virtuales)
        const eligible = getResidentesDePlan(planName, curY, curM);
        
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

/**
 * Indica si un residente (real o virtual) pertenece al plan dado en el mes dado.
 * Fuente única de la compartimentación por plan: los perfiles reales se resuelven
 * por fechas de contrato (getPlanForUserOnDate, día 1 como referencia del mes —
 * el nivel es mensual y solo cambia en frontera de mes, ver getUserLevelOnDate);
 * los virtuales (sin perfil en globalProfiles) pertenecen al plan en cuyos
 * baseGroups figuran. No aplica exclusiones de estado (graduados, históricos,
 * aprobación): eso lo decide cada caller o getResidentesDePlan.
 * @param {string} nombre - nombre_mostrar
 * @param {string} planName
 * @param {number} y
 * @param {number} m - 0-indexed
 * @returns {boolean}
 */
function residentePerteneceAPlan(nombre, planName, y, m) {
    const perfil = globalProfiles.find(p => p.nombre_mostrar === nombre);
    if (perfil) {
        const plan = getPlanForUserOnDate(perfil, formatDateKey(y, m, 1));
        return !!plan && plan.nombre === planName;
    }
    return (state.planRotations?.[planName]?.baseGroups || []).flat().includes(nombre);
}

/**
 * Devuelve los residentes de un plan de guardias en un mes concreto, aplicando la
 * regla de producto: cada residente solo ve/opera con los compañeros de su plan.
 * Excluye graduados (state.graduados) e históricos cuya salida (state.historialEventos)
 * sea anterior al mes consultado. Incluye a los virtuales del plan (baseGroups sin
 * perfil real), que siguen rotando indefinidamente en su plan original.
 * @param {string} planName
 * @param {number} y
 * @param {number} m - 0-indexed
 * @param {Object} [opts]
 * @param {boolean} [opts.soloAprobados=false] - exige estado 'aprobado' en perfiles reales
 * @returns {string[]} array de nombre_mostrar
 */
function getResidentesDePlan(planName, y, m, opts = {}) {
    const mesVal = y * 12 + m;
    const out = [];

    for (const p of (globalProfiles || [])) {
        const n = p.nombre_mostrar;
        if (state.graduados && state.graduados.includes(n)) continue;
        if (opts.soloAprobados && p.estado !== 'aprobado') continue;
        if (p.estado === 'historico') {
            const ev = state.historialEventos?.[n];
            if (ev && ev.salida) {
                const parts = ev.salida.split('-');
                const salVal = parseInt(parts[0], 10) * 12 + parseInt(parts[1], 10) - 1;
                if (mesVal > salVal) continue;
            }
        }
        if (residentePerteneceAPlan(n, planName, y, m)) out.push(n);
    }

    const flatBase = (state.planRotations?.[planName]?.baseGroups || []).flat();
    for (const n of flatBase) {
        if (globalProfiles.some(p => p.nombre_mostrar === n)) continue;
        if (state.graduados && state.graduados.includes(n)) continue;
        if (!out.includes(n)) out.push(n);
    }
    return out;
}

/**
 * Indica si el usuario logueado puede GESTIONAR (editar rotación, otorgar/saltar turno,
 * forzar subasta) el plan dado en el mes dado. El admin gestiona todos los planes;
 * el delegado solo el plan que le corresponde por contrato en ese mes (puede VER otros
 * planes con el selector, pero en solo-lectura).
 * @param {string} planName
 * @param {number} y
 * @param {number} m - 0-indexed
 * @returns {boolean}
 */
function puedeGestionarPlan(planName, y, m) {
    if (isAdmin) return true;
    if (!isDelegado) return false;
    const propio = getPlanForUserOnDate(currentUserProfile, formatDateKey(y, m, 1));
    return !!propio && propio.nombre === planName;
}

/**
 * Construye el contexto de visibilidad del plan visualizado para un mes (B1):
 * nombre del plan (simulación > selector de delegado > plan propio), sus residentes
 * (sin graduados ni históricos salidos) y los nombres de sus servicios.
 * @param {number} y
 * @param {number} m - 0-indexed
 * @returns {{planName: string, residentes: string[], svcNames: string[], y: number, m: number}|null}
 *          null si no hay sesión (vista pública: se muestra todo)
 */
function getPlanVistaContext(y, m) {
    if (!currentUserProfile) return null;
    const planName = getCurrentRotPlan(formatDateKey(y, m, 1));
    const plan = (promoConfig.planes || []).find(p => p.nombre === planName);
    return {
        planName, y, m,
        residentes: getResidentesDePlan(planName, y, m),
        svcNames: plan ? plan.servicios.map(s => s.nombre) : (promoConfig.servicios || []).map(s => s.nombre)
    };
}

/**
 * Indica si el titular de una guardia debe mostrarse en el calendario del plan del
 * contexto: miembros del plan siempre; Externo/VRE solo en servicios del plan; foráneos
 * (residentes de otro plan cubriendo una guardia de este) solo si su propio plan no
 * reclama ese servicio — misma regla anti-colisión de nombres que el exportador.
 * @param {string} u - nombre_mostrar del titular
 * @param {string} svcNombre
 * @param {Object|null} ctx - resultado de getPlanVistaContext (null = sin filtro)
 * @returns {boolean}
 */
function esTitularVisibleEnPlan(u, svcNombre, ctx) {
    if (!ctx) return true;
    if (ctx.residentes.includes(u)) return true;
    if (!ctx.svcNames.includes(svcNombre)) return false;
    if (u === 'Externo' || u.startsWith('VRE')) return true;
    const propioPlan = (promoConfig.planes || []).find(p =>
        p.nombre !== ctx.planName && residentePerteneceAPlan(u, p.nombre, ctx.y, ctx.m));
    return !(propioPlan && propioPlan.servicios.some(s => s.nombre === svcNombre));
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
        const referenceDk = formatDateKey(y, m, 1);
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
            const referenceDk = formatDateKey(y, m, 1);
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
    // Cambiar el régimen es gestión: solo admin o delegado del plan del residente afectado
    if (isDelegado && !isAdmin) {
        const parts = dk.split('_');
        const _yMode = parseInt(parts[0], 10), _mMode = parseInt(parts[1], 10) - 1;
        const perfilAfectado = globalProfiles.find(p => p.nombre_mostrar === user);
        const planAfectado = perfilAfectado ? getPlanForUserOnDate(perfilAfectado, dk)?.nombre : getCurrentRotPlan(dk);
        if (!puedeGestionarPlan(planAfectado, _yMode, _mMode)) { alert('⚠️ Solo puedes cambiar el régimen de guardias de tu propio plan.'); return; }
    }
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

