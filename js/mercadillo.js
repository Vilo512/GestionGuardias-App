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
  const _hoy = new Date();
  const hoyKey = formatDateKey(_hoy.getFullYear(), _hoy.getMonth(), _hoy.getDate());
  if (loggedInUser) { document.getElementById('merc-logged-zone').style.display = 'block'; document.getElementById('merc-unlogged-zone').style.display = 'none'; } 
  else { document.getElementById('merc-logged-zone').style.display = 'none'; document.getElementById('merc-unlogged-zone').style.display = 'block'; }
  for(let i=0; i<getFirstDayOffset(y,m); i++) grid.innerHTML += `<div class="cal-cell empty"></div>`;
  
  // 🧭 B1: mismo contexto de plan visualizado que el calendario principal
  const planVistaCtxMerc = getPlanVistaContext(y, m);
  const userLevelName = planVistaCtxMerc ? planVistaCtxMerc.planName : 'ALL';
  // 🧭 Misma fuente de servicios que el calendario principal, y izada fuera del
  // bucle igual que allí. Con promoConfig.servicios la rejilla se quedaba SIN
  // badges en promociones de varios planes: adminSaveConfig lo machaca con los
  // servicios del primer plan, así que al mirar otro plan la intersección con
  // svcNames era vacía hasta recargar (normalizeConfig sí reconstruye la unión).
  const todosLosServiciosMerc = getAllUniqueServices();
  for(let d=1; d<=getDaysInMonth(y,m); d++) {
    const dk = formatDateKey(y, m, d);
    const dayShifts = computed[dk] || {};
    const cell = document.createElement('div');
    cell.className = `cal-cell ${state.festivos[dk]?'is-festivo':''} ${dk === hoyKey ? 'is-today' : ''}`.trim();
    const bgStyle = getCellBackgroundStyle(dk, y, m, d, userLevelName);
    if (bgStyle) cell.setAttribute('style', bgStyle);
    let html = `<div class="day-number">${d}</div>`;

    todosLosServiciosMerc.forEach(svc => {
        if (planVistaCtxMerc && !planVistaCtxMerc.svcNames.includes(svc.nombre)) return;
        let assigned = Object.keys(dayShifts || {}).filter(u =>
            dayShifts[u] === svc.nombre && esTitularVisibleEnPlan(u, svc.nombre, planVistaCtxMerc));
        if (showOnlyMine && (simulatedViewUser || loggedInUser)) assigned = assigned.filter(u => u === (simulatedViewUser ?? loggedInUser));
        assigned.forEach(u => {
            let isVre = u.startsWith('VRE');
            // 🎨 Paso 5 (§3.1): mismo badge que el calendario. El texto lo calcula
            // contrastText() sobre el color REAL del fondo — para el VRE ese fondo es
            // el #94a3b8 que impone .bg-vre con !important, no svc.color.
            const bg = isVre ? '#94a3b8' : svc.color;
            html += `<div class="shift-badge ${isVre ? 'bg-vre' : ''}" style="background:${bg}; color:${contrastText(bg)};">${icon('user')}${isVre ? 'VRE' : escapeHtml(getInitials(u))}</div>`;
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

  // 🎨 Paso 5: mismo blindaje que el panel de día (Paso 3). Un doble-toque rápido en
  // la celda creaba DOS overlays con id="mercado-modal"; como "Cancelar" resuelve por
  // getElementById, borraba el primero del DOM y no el que se veía.
  const _prevSheet = document.getElementById('mercado-modal');
  if (_prevSheet) _prevSheet.remove();

  const modal = document.createElement('div'); modal.className = 'modal-overlay sheet-overlay'; modal.id = 'mercado-modal';
  let html = `<div class="modal sheet" role="dialog" aria-modal="true">
    <div class="sheet__grip" aria-hidden="true"></div>
    <h3 class="sheet__title sheet__title--merc">🛒 Mercadillo: ${d}/${m+1}/${y}</h3>
    <div id="mercado-dynamic">`;

  if (myShift) {
    const sColor = getServiceColor(myShift);
    html += `<div class="merc-mine"><strong>Tienes guardia de:</strong> <span class="svc-chip" style="background:${sColor}; color:${contrastText(sColor)};">${escapeHtml(myShift)}</span></div>`;

    if (past) html += `<p class="merc-note merc-note--center">Esta guardia ya se ha realizado en el mundo real.</p>`;
    else html += `<button class="primary merc-btn-block" data-act="vender" data-dk="${escapeHtml(dk)}" data-svc="${escapeHtml(myShift)}">💵 Vender guardia</button><button class="merc merc-btn-block" data-act="cambiar" data-dk="${escapeHtml(dk)}" data-svc="${escapeHtml(myShift)}">🔄 Cambiar por otra fecha / residente</button>`;
  } else {
    // Contador real de filas pintadas: antes había un `canBuy` que nunca se ponía a
    // true, así que el aviso de "no hay guardias" salía incluso listando compañeros.
    let companeros = 0;

    // Bucle restaurado: Evaluamos a cada compañero que tiene guardia este día
    for (let u in dayShifts) {
			if (u !== loggedInUser && !u.startsWith('VRE')) {
            companeros++;
            const cColor = getServiceColor(dayShifts[u]);
            html += `<div class="merc-row">`;
            html += `<div class="merc-row__who"><span class="merc-row__name">${escapeHtml(u)}</span> <span class="svc-chip" style="background:${cColor}; color:${contrastText(cColor)};">${escapeHtml(dayShifts[u])}</span></div>`;

            if (past) {
                html += `<span class="merc-tag">Pasada</span>`;
            } else {
                // Inyección de la regla de intercambio temporal
                let iCanTake = canUserTakeShift(loggedInUser, u, dk, dayShifts[u]);
                if (iCanTake) {
                    const attrs = `data-dk="${escapeHtml(dk)}" data-svc="${escapeHtml(dayShifts[u])}" data-user="${escapeHtml(u)}"`;
                    html += `<div class="merc-actions"><button class="merc" data-act="comprar" ${attrs}>Comprar</button><button class="primary" style="background:var(--adu-d); color:var(--bg);" data-act="cambiar-ajena" ${attrs}>Cambiar</button></div>`;
                } else {
                    html += `<span class="merc-warn">Incompatible por R</span>`;
                }
            }
            html += `</div>`;
        }
    }

    if(!companeros) html += `<p class="merc-note">No hay guardias de compañeros disponibles en este día.</p>`;

    if (!past) {
        html += `<div class="merc-ext"><h4 class="merc-ext__title">Comprar a Externo (Añadir guardia)</h4><div class="merc-ext__grid">`;
        getAllUniqueServices().forEach(svc => {
            const eColor = getServiceColor(svc.nombre);
            html += `<button class="primary" style="background:${eColor}; color:${contrastText(eColor)};" data-act="comprar-externo" data-dk="${escapeHtml(dk)}" data-svc="${escapeHtml(svc.nombre)}">+ ${escapeHtml(svc.nombre)}</button>`;
        });
        html += `</div></div>`;
    }
  }
  html += `</div><div class="sheet__footer"><button class="sheet__close" data-act="close">Cancelar</button></div></div>`;
  modal.innerHTML = html;
  _bindMercadoActions(modal);
  document.body.appendChild(modal);
}

/**
 * Enlaza por DOM los controles `[data-act]` del modal del Mercadillo.
 * Los nombres de servicio y de residente son texto libre del admin: interpolarlos
 * dentro de un `onclick` rompe el atributo (un `UCI "Peque"` lo parte por la mitad),
 * el mismo fallo que ya se corrigió en el selector de propuesta. Aquí el valor viaja
 * por `data-*` escapado y se lee ya decodificado desde `dataset`.
 * Se llama tras cada repintado de #mercado-dynamic.
 * @param {HTMLElement} root - contenedor recién pintado
 */
function _bindMercadoActions(root) {
  if (!root) return;
  root.querySelectorAll('[data-act]').forEach(el => {
    const act = el.dataset.act;
    const dk = el.dataset.dk || '', svc = el.dataset.svc || '', user = el.dataset.user || '';
    const evt = (act === 'load-cambio-targets') ? 'change' : 'click';
    el.addEventListener(evt, () => {
      switch (act) {
        // closest() y no getElementById: inmune por construcción a que llegue a
        // haber dos overlays con el mismo id, que es lo que hacía falta pulsar
        // "Cerrar" dos veces en el panel de día antes del Paso 3.
        case 'close': el.closest('.modal-overlay')?.remove(); break;
        case 'vender': renderMercadoVender(dk, svc); break;
        case 'cambiar': renderMercadoCambiar(dk, svc); break;
        case 'comprar': executeBuyRequest(dk, svc, user); break;
        case 'cambiar-ajena': renderMercadoCambiarAjena(dk, svc, user); break;
        case 'comprar-externo': executeBuyRequest(dk, svc, 'Externo'); break;
        case 'confirmar-venta': executeSellRequest(dk, svc); break;
        case 'load-cambio-targets': loadCambioTargets(dk, svc); break;
        case 'solicitar-cambio': proxySwapRequest(dk, svc, el.dataset.target || ''); break;
        case 'enviar-cambio-ajena': executeSwapRequestAjena(dk, svc, user); break;
      }
    });
  });
}

/** Reemplaza la zona dinámica del modal con el formulario de venta de guardia. */
function renderMercadoVender(dk, svc) {
    const res = getAllResidents().filter(r => r !== loggedInUser && canUserTakeShift(r, loggedInUser, dk, svc));
    const cont = document.getElementById('mercado-dynamic');
    cont.innerHTML = `<h4 class="merc-form__title">Vender guardia de ${escapeHtml(svc)}</h4><label class="merc-form__label">¿A quién se la vendes?</label><select id="vender-to-user"><option value="">-- Selecciona --</option><option value="Externo">👽 Otro Residente (Externo)</option>${res.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select><button class="primary merc-btn-block" data-act="confirmar-venta" data-dk="${escapeHtml(dk)}" data-svc="${escapeHtml(svc)}">Confirmar Venta</button>`;
    _bindMercadoActions(cont);
}
/** Crea y procesa un trade de tipo 'venta'; si es a Externo, se aprueba directamente. */
function executeSellRequest(dk, svc) { const target = document.getElementById('vender-to-user').value; if (!target) return alert("Selecciona a quién vender."); const trade = { id: Date.now(), type: 'venta', requester: loggedInUser, target: target, d1: dk, s1: svc, timestamp: new Date().toLocaleString('es-ES') }; let conflicts = checkTradeConflicts(trade); if (conflicts.length > 0) { if (!confirm("⚠️ ATENCIÓN: Conflictos:\n\n" + conflicts.join("\n") + "\n\n¿Proponer de todos modos?")) return; } if (target === 'Externo') { trade.status = 'approved'; alert("Venta a externo realizada."); } else { trade.status = 'pending'; alert(`Solicitud enviada a ${target}.`); } if(!state.trades) state.trades = []; state.trades.push(trade); _notifyNewTrade(trade); saveState(); document.getElementById('mercado-modal').remove(); checkAutomaticGraduation();
    renderAll(); }



/** Crea y procesa un trade de tipo 'cambio' directo entre dos días/residentes. */
function executeSwapRequestDirect(myDk, mySvc, targetDk, targetSvc, targetUser) { const trade = { id: Date.now(), type: 'cambio', requester: loggedInUser, target: targetUser, d1: myDk, s1: mySvc, d2: targetDk, s2: targetSvc, timestamp: new Date().toLocaleString('es-ES') }; let conflicts = checkTradeConflicts(trade); if (conflicts.length > 0) { if (!confirm("⚠️ Conflictos:\n" + conflicts.join("\n") + "\n¿Proponer de todos modos?")) return; } if (targetUser === 'Externo') { trade.status = 'approved'; alert("Cambio con externo realizado."); } else { trade.status = 'pending'; alert(`Solicitud enviada a ${targetUser}.`); } if(!state.trades) state.trades = []; state.trades.push(trade); _notifyNewTrade(trade); saveState(); document.getElementById('mercado-modal').remove(); checkAutomaticGraduation();
    renderAll(); }
/** Crea y procesa un trade de tipo 'compra'; si es de Externo, se aprueba directamente. */
function executeBuyRequest(dk, svc, targetUser) { if (targetUser !== 'Externo' && !confirm(`¿Comprar ${svc} a ${targetUser}?`)) return; if (targetUser === 'Externo' && !confirm(`¿Añadir guardia de ${svc} desde Externo?`)) return; const trade = { id: Date.now(), type: 'compra', requester: loggedInUser, target: targetUser, d1: dk, s1: svc, timestamp: new Date().toLocaleString('es-ES') }; let conflicts = checkTradeConflicts(trade); if (conflicts.length > 0) { if (!confirm("⚠️ Conflictos:\n" + conflicts.join("\n") + "\n¿Solicitar de todos modos?")) return; } if (targetUser === 'Externo') { trade.status = 'approved'; alert("Comprada a externo."); } else { trade.status = 'pending'; alert(`Solicitud enviada a ${targetUser}.`); } if(!state.trades) state.trades = []; state.trades.push(trade); _notifyNewTrade(trade); saveState(); document.getElementById('mercado-modal').remove(); checkAutomaticGraduation();
    renderAll(); }
