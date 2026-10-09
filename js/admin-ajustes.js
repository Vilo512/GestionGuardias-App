// ============================================================
// MÓDULO: ADMIN_AJUSTES
// Exportar a: src/modules/adminAjustes.js
// Líneas estimadas: ~440
// Dependencias externas: promoConfig, supabaseClient, currentUserProfile
// Helpers que usa: syncConfigFromUI, saveState, setStatus, renderAll, checkAutomaticGraduation, MONTHS
// ============================================================
/**
 * Normaliza un nombre para compararlo. `Pediatría ` y `pediatría` son el mismo
 * servicio para quien lo escribe y dos distintos para el código, y esa asimetría
 * es justo la que deja guardias sin encontrar su configuración.
 *
 * `normalize('NFC')` no es adorno: `Pediatría` tecleada en Windows y la misma
 * palabra pegada desde un documento de macOS son cadenas DISTINTAS —una lleva la
 * tilde como carácter combinante— y en pantalla son idénticas carácter por
 * carácter. Sin esto, dos servicios visualmente iguales pasaban la validación y
 * el segundo quedaba inalcanzable para siempre. En una app en español, con
 * Pediatría / Cirugía / Urgencias, no es un caso teórico.
 *
 * El colapso de espacios cubre el mismo problema por otra vía: espacio doble
 * interno y espacio duro (` `), que `\s` sí captura.
 *
 * @param {string} nombre
 * @returns {string} clave de comparación
 */
function claveNombreServicio(nombre) {
    return String(nombre ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * D-04. Detecta nombres de servicio inválidos DENTRO de cada plan.
 *
 * El mismo nombre en planes DISTINTOS es legítimo y está en uso: es como se
 * expresa "R1 y R2 hacen Pediatría con cupos distintos", y getAllUniqueServices()
 * lo deduplica a propósito. Lo que rompe es repetirlo dentro del mismo plan:
 * todo lookup se hace por nombre (getSvcConfig, isServiceEnabledOnDate,
 * getServiceColor, el selector de propuesta) y todos devuelven SIEMPRE el
 * primero, así que el segundo servicio existe en la configuración pero es
 * inalcanzable — sus reglas, su cupo y su color no se aplican nunca.
 *
 * Un nombre vacío es igual de destructivo: state.shifts guarda el nombre como
 * valor, y una cadena vacía no vuelve a resolver a ningún servicio.
 *
 * @returns {Array<{tipo:'duplicado'|'vacio', plan:string, pIdx:number, nombre:string, indices:number[]}>}
 */
function getConflictosNombreServicio() {
    const conflictos = [];
    (promoConfig.planes || []).forEach((plan, pIdx) => {
        const porClave = new Map();
        const vacios = [];
        (plan.servicios || []).forEach((svc, i) => {
            const clave = claveNombreServicio((svc || {}).nombre);
            if (!clave) { vacios.push(i); return; }
            if (!porClave.has(clave)) porClave.set(clave, []);
            porClave.get(clave).push(i);
        });
        if (vacios.length) conflictos.push({ tipo: 'vacio', plan: plan.nombre, pIdx, nombre: '', indices: vacios });
        porClave.forEach(indices => {
            if (indices.length > 1) {
                conflictos.push({ tipo: 'duplicado', plan: plan.nombre, pIdx, nombre: (plan.servicios[indices[0]] || {}).nombre, indices });
            }
        });
    });
    return conflictos;
}

/**
 * D-08 (parcial). Índices de planes cuyo nombre choca con el de otro plan.
 *
 * Dos planes homónimos hacen que `getSvcConfig` y `getPlanVistaContext`, que
 * resuelven el plan por nombre con `find`, devuelvan siempre el primero: los
 * residentes del segundo cobrarían cupos, horas y reglas del otro plan sin que
 * nada falle a la vista. Aquí solo se AVISA — no se bloquea el guardado —
 * porque una promoción que ya arrastre el duplicado se quedaría sin poder
 * guardar nada hasta renombrar, y renombrar un plan tiene el mismo efecto
 * colateral que renombrar un servicio (D-07: la clave `svc@@plan`).
 * El nombre VACÍO es harina de otro costal y sí bloquea: no puede
 * preexistir en ninguna config que funcione —los ~30 `find(p => p.nombre ===
 * planName)` del código devolverían `undefined` para todos los residentes de
 * ese plan, que perderían servicios, cupos y calendario— así que solo puede
 * crearse en la sesión de edición actual y ahí es donde hay que atajarlo.
 *
 * @returns {Array<{tipo:'plan'|'plan-vacio', pIdx:number, nombre:string}>}
 */
function getConflictosNombrePlan() {
    const porClave = new Map();
    const conflictos = [];
    (promoConfig.planes || []).forEach((plan, pIdx) => {
        const nombre = (plan || {}).nombre;
        const clave = claveNombreServicio(nombre);
        if (!clave) { conflictos.push({ tipo: 'plan-vacio', pIdx, nombre: '' }); return; }
        if (!porClave.has(clave)) porClave.set(clave, []);
        porClave.get(clave).push({ pIdx, nombre });
    });
    porClave.forEach(items => {
        if (items.length > 1) items.forEach(it => conflictos.push({ tipo: 'plan', pIdx: it.pIdx, nombre: it.nombre }));
    });
    return conflictos;
}

/**
 * Mensaje que ve el admin en el campo en conflicto.
 * @param {{tipo:string, nombre:string}} c
 * @returns {string}
 */
function mensajeConflictoNombre(c) {
    // Una línea y punto: esto se lee de reojo en un móvil, no se estudia. El
    // porqué y el criterio de comparación ("ignorando mayúsculas y espacios")
    // viven en el alert del guardado bloqueado, que es donde hay sitio.
    // "dentro del mismo plan" sí se queda: sin esa coletilla el aviso
    // contradiría a la app, que permite el mismo servicio en planes distintos.
    if (c.tipo === 'vacio') return '⚠️ El servicio necesita un nombre.';
    if (c.tipo === 'plan-vacio') return '⚠️ El plan necesita un nombre.';
    if (c.tipo === 'plan') return '⚠️ No se permiten planes con nombres duplicados.';
    return '⚠️ No se permiten servicios con nombres duplicados dentro del mismo plan.';
}

/**
 * Valida los nombres SIN repintar el formulario y actualiza el marcado in situ.
 *
 * Se dispara al terminar de escribir un nombre (`change`), que es cuando el
 * admin espera el aviso: enterarse al pulsar Guardar, tres pantallas después,
 * llega tarde. No se puede resolver con `renderAdminAjustes()` porque el
 * repintado cierra los acordeones y roba el foco a media edición.
 *
 * Recorre TODOS los campos, no solo el editado: corregir un nombre resuelve el
 * choque de su pareja, y esa otra caja también tiene que dejar de estar roja.
 *
 * Cubre servicios (D-04, además bloquean el guardado) y planes (D-08, solo
 * avisan). Deliberadamente no repinta: `renderAdminAjustes()` cerraría los
 * acordeones y sacaría el foco del campo que se está escribiendo.
 */
function revalidarNombresConfig() {
    syncConfigFromUI();
    const conflictos = getConflictosNombreServicio();
    const planesMalos = getConflictosNombrePlan();
    const pintar = (inp, aviso, conflicto) => {
        if (!inp || !aviso) return;
        inp.classList.toggle('cfg-nom-dup', !!conflicto);
        aviso.hidden = !conflicto;
        if (conflicto) aviso.textContent = mensajeConflictoNombre(conflicto);
    };
    (promoConfig.planes || []).forEach((plan, pIdx) => {
        pintar(
            document.getElementById(`cfg-plan-nom-${pIdx}`),
            document.getElementById(`cfg-plan-aviso-${pIdx}`),
            planesMalos.find(c => c.pIdx === pIdx) || null
        );
        // El nombre del plan aparece además en la cabecera del acordeón y en el
        // botón de añadir servicio. Como aquí NO se repinta, hay que refrescarlos
        // a mano o se quedan diciendo el nombre viejo hasta el siguiente render.
        const resumen = document.getElementById(`cfg-plan-summary-${pIdx}`);
        if (resumen) resumen.textContent = `👉 Desplegar/Ocultar: ${(plan || {}).nombre || ''}`;
        const btnAdd = document.getElementById(`cfg-plan-addsvc-${pIdx}`);
        if (btnAdd) btnAdd.textContent = `+ Servicio al ${(plan || {}).nombre || ''}`;
        ((plan || {}).servicios || []).forEach((svc, i) => {
            pintar(
                document.getElementById(`cfg-nom-${pIdx}-${i}`),
                document.getElementById(`cfg-nom-aviso-${pIdx}-${i}`),
                conflictos.find(x => x.pIdx === pIdx && x.indices.includes(i)) || null
            );
        });
    });
}

/**
 * Devuelve un nombre libre dentro del plan a partir de una base ("Nuevo
 * Servicio", "Nuevo Servicio 2"...). Evita que el camino más común —pulsar
 * "+ Servicio" dos veces— cree ya un duplicado que luego bloquea el guardado.
 * @param {object} plan
 * @param {string} base
 * @returns {string}
 */
function generarNombreServicioLibre(plan, base) {
    const usados = new Set((plan.servicios || []).map(s => claveNombreServicio(s.nombre)));
    if (!usados.has(claveNombreServicio(base))) return base;
    let n = 2;
    while (usados.has(claveNombreServicio(`${base} ${n}`))) n++;
    return `${base} ${n}`;
}

/** Renderiza el formulario de ajustes de la promoción: planes, servicios, reglas y pernoctas. */
function renderAdminAjustes() {
  const container = document.getElementById('admin-config-container');
  let html = ``;

  if (!promoConfig.planes) promoConfig.planes = [];

  // D-04: se recalcula en cada repintado, así que el aviso siempre refleja el
  // estado real de promoConfig sin necesidad de guardar una bandera aparte.
  const conflictosNombre = getConflictosNombreServicio();
  const conflictoDe = (pIdx, i) => conflictosNombre.find(c => c.pIdx === pIdx && c.indices.includes(i));
  const svcEnConflicto = (pIdx, i) => !!conflictoDe(pIdx, i);
  // D-08: los nombres de plan solo AVISAN, no bloquean el guardado (ver §18 del PRD).
  const planesMalos = getConflictosNombrePlan();

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
    // D-04: un plan con conflicto se pinta ABIERTO. El acordeón no conserva
    // estado entre repintados, así que sin esto el aviso rojo que acabamos de
    // pintar quedaba dentro de un <details> cerrado — justo en el momento en
    // que hace falta verlo, al volver del alert de guardado fallido.
    const cPlan = planesMalos.find(c => c.pIdx === pIdx);
    // Se abre solo por lo que BLOQUEA el guardado. Un nombre de plan duplicado
    // es advertencia y puede convivir indefinidamente: abrir su acordeón en cada
    // repintado dejaría dos planes enteros desplegados para siempre.
    const planEnConflicto = conflictosNombre.some(c => c.pIdx === pIdx) || (cPlan && cPlan.tipo === 'plan-vacio');
    html += `
    <details ${planEnConflicto ? 'open' : ''} style="background:#f1f5f9; border:2px solid #cbd5e1; border-radius:12px; padding:15px; margin-bottom:20px;"><summary id="cfg-plan-summary-${pIdx}" style="font-weight:bold; cursor:pointer; font-size:1.1rem; color:var(--dark);">👉 Desplegar/Ocultar: ${escapeHtml(plan.nombre)}</summary><div style="margin-top: 15px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:2px solid #94a3b8; padding-bottom:10px; flex-wrap:wrap; gap:10px;">
            <input type="text" id="cfg-plan-nom-${pIdx}" value="${escapeHtml(plan.nombre)}" class="cfg-plan-nom-input${cPlan ? ' cfg-nom-dup' : ''}" onchange="revalidarNombresConfig()">
            <div style="display:flex; gap:8px;">
                <button class="primary icon-btn" id="cfg-plan-addsvc-${pIdx}" style="background:var(--adu);" onclick="adminAddService(${pIdx})">+ Servicio al ${escapeHtml(plan.nombre)}</button>
                <button class="danger icon-btn" onclick="adminRemovePlan(${pIdx})">Borrar Plan</button>
            </div>
        </div>
        <p class="cfg-nom-aviso" id="cfg-plan-aviso-${pIdx}" ${cPlan ? '' : 'hidden'}>${escapeHtml(mensajeConflictoNombre(cPlan || { tipo: 'plan' }))}</p>`;
    
    if (plan.servicios.length === 0) {
        html += `<p style="color:#64748b; font-size:0.85rem; font-style:italic; padding-bottom:10px;">No hay servicios en este plan.</p>`;
    }

    plan.servicios.forEach((svc, i) => {
        html += `
        <div class="cfg-card" id="cfg-card-${pIdx}-${i}" style="border-left: 4px solid ${svc.color || 'var(--dark)'};">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid #e2e8f0; padding-bottom:10px;">
             <input type="text" id="cfg-nom-${pIdx}-${i}" value="${escapeHtml(svc.nombre)}" class="cfg-nom-input${svcEnConflicto(pIdx, i) ? ' cfg-nom-dup' : ''}" onchange="revalidarNombresConfig()">
             <button class="danger icon-btn" onclick="adminRemoveService(${pIdx}, ${i})">Borrar Servicio 🗑️</button>
          </div>
          <p class="cfg-nom-aviso" id="cfg-nom-aviso-${pIdx}-${i}" ${svcEnConflicto(pIdx, i) ? '' : 'hidden'}>${escapeHtml(mensajeConflictoNombre(conflictoDe(pIdx, i) || { tipo: 'duplicado' }))}</p>

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
    // `planes.length + 1` repetía nombre en cuanto se borraba un plan: con R1 y
    // R2, borrar R1 y añadir otro volvía a calcular 1+1 y creaba un segundo
    // "Plan R2". Dos planes homónimos hacen que getSvcConfig resuelva por nombre
    // al primero, así que los residentes del segundo cobran cupos y horas del
    // plan equivocado, sin error visible.
    const usados = new Set(promoConfig.planes.map(p => claveNombreServicio(p.nombre)));
    let n = promoConfig.planes.length + 1;
    while (usados.has(claveNombreServicio(`Plan R${n}`))) n++;
    promoConfig.planes.push({ id: 'plan-' + Date.now(), nombre: `Plan R${n}`, servicios: [] });
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
      nombre: generarNombreServicioLibre(promoConfig.planes[pIdx], "Nuevo Servicio"), cupoMensualTotal: 1, plazasPorDia: 1, color: "#94a3b8",
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
      // D-04: aquí NO se recorta. Recortar al leer parecía higiene inofensiva y
      // era una migración silenciosa: una config que ya tuviera `PAC Balaguer `
      // guardado se renombraba sola con solo tocar cualquier campo del panel, y
      // state.shifts y state.habilitaciones —que guardan el nombre como valor y
      // como parte de la clave `svc@@plan`— se quedaban apuntando al nombre
      // viejo. Resultado: las guardias de ese servicio desaparecían del
      // calendario y el servicio perdía todos sus días habilitados.
      // El espacio sobrante se DETECTA en getConflictosNombreServicio (choca con
      // su gemelo sin espacio) y lo corrige el admin a propósito, no la app a su
      // espalda. Renombrar sigue dejando guardias huérfanas: ver D-07 en el PRD.
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

  // D-04: la puerta está aquí y no en cada tecleo. Un duplicado a medio escribir
  // es normal mientras se edita; lo que no puede pasar es que se PERSISTA, porque
  // a partir de ahí el segundo servicio homónimo queda inalcanzable para todos
  // los lookups por nombre y sus guardias no encuentran configuración.
  // Los nombres de plan DUPLICADOS solo avisan (D-08), pero un plan sin nombre sí
  // bloquea: no puede preexistir en ninguna config que funcione, así que solo se
  // crea aquí y aquí hay que pararlo.
  const conflictos = [...getConflictosNombreServicio(), ...getConflictosNombrePlan().filter(c => c.tipo === 'plan-vacio')];
  if (conflictos.length > 0) {
      renderAdminAjustes();
      // El repintado deja abiertos los planes en conflicto; llevamos además la
      // vista al primer campo marcado, que con varios planes queda fuera de
      // pantalla y el admin no sabría dónde mirar tras cerrar el aviso.
      // Se prioriza el campo de SERVICIO: los nombres de plan comparten la clase
      // .cfg-nom-dup y los duplicados NO bloquean, así que con `.cfg-nom-dup` a
      // secas un plan duplicado —que puede quedarse ahí para siempre— secuestraba
      // el scroll y llevaba a un campo rojo que no era el motivo del bloqueo.
      const foco = document.querySelector('.cfg-nom-input.cfg-nom-dup')
                || document.querySelector('.cfg-plan-nom-input.cfg-nom-dup');
      foco?.scrollIntoView({ block: 'center' });
      const detalle = conflictos.map(c => {
          if (c.tipo === 'plan-vacio') return `• El plan en la posición ${c.pIdx + 1} no tiene nombre.`;
          if (c.tipo === 'vacio') return `• Plan "${c.plan}": ${c.indices.length} servicio(s) sin nombre.`;
          return `• Plan "${c.plan}": "${c.nombre}" está repetido ${c.indices.length} veces.`;
      }).join('\n');
      setStatus('Sin guardar ⚠️', true);
      alert(`⚠️ No se ha guardado nada.\n\nCada plan necesita nombre, y dentro de cada plan cada servicio necesita un nombre propio y no vacío:\n\n${detalle}\n\nSe comparan ignorando mayúsculas y espacios sobrantes. El mismo nombre de servicio en planes distintos sí es válido.`);
      return;
  }

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

