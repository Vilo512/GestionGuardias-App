// ============================================================
// MÓDULO: ADMIN_CUENTAS
// Dependencias externas: supabaseClient, currentUserProfile, state, globalProfiles, curDate
// Helpers que usa: setStatus, saveState, renderAccountsList, renderRotationView, reempaquetarGruposPlan, invalidateConfigMes, limpiarFuturos, formatDateKey, getCurrentRotPlan, MONTHS
// ============================================================
/** Descarga y renderiza la lista de usuarios de la promoción con acciones de aprobar, expulsar y cambiar rol. */
async function renderAccountsList() {
  const el = document.getElementById('accounts-list');
  if (!el) return;
  // Sin sesión no hay nada que listar. Sin esta guarda se lanzaba más abajo, en
  // la línea del fetch, DESPUÉS de crear la promesa de timeout y antes del
  // Promise.race: el timeout se quedaba sin nadie escuchando y reventaba sin
  // capturar a los 5 segundos, en cada carga sin sesión.
  if (!currentUserProfile?.promocion_id) { el.innerHTML = ''; return; }
  el.innerHTML = '<span class="accounts-note">Cargando lista de usuarios...</span>';

  // 1. Cargamos usuarios con timeout anti-congelamiento
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout de red")), 5000));
  const fetchUsers = supabaseClient.from('perfiles').select('*').eq('promocion_id', currentUserProfile.promocion_id).order('estado', { ascending: false });
  
  let usuarios;
  try {
      const { data, error } = await Promise.race([fetchUsers, timeout]);
      if (error) throw error;
      usuarios = data;
  } catch (err) {
      return el.innerHTML = `<span class="accounts-error">Error de red: ${escapeHtml(err.message)}</span>`;
  }

  if (!usuarios || usuarios.length === 0) return el.innerHTML = `<span class="accounts-note">No hay NADIE vinculado a esta promoción aún.</span>`;

  // 2. Comprobamos si somos el "Dueño" legítimo del contenedor
  const { data: promo, error: errPromo } = await supabaseClient.from('promociones').select('creador_id').eq('id', currentUserProfile.promocion_id).single();
  const isDueño = promo && promo.creador_id === currentUserProfile.id;
  // Sin `promo` no hay forma de distinguir al Dueño de un Admin, y tanto las
  // etiquetas como los botones se degradan. Antes esto fallaba en silencio:
  // ahora se avisa, en vez de mostrar una lista que parece completa y no lo está.
  const avisoPromo = (errPromo || !promo)
      ? `<p class="accounts-error">⚠️ No se ha podido comprobar quién es el Dueño de la especialidad${errPromo ? `: ${escapeHtml(errPromo.message)}` : ''}. Las etiquetas de rango y las acciones disponibles pueden estar incompletas — recarga antes de actuar.</p>`
      : '';

  // === LA MAGIA DEL DATALIST ===
  const datalist = document.getElementById('lista-usuarios-aprobados');
  if (datalist) datalist.innerHTML = usuarios.filter(u => u.estado === 'aprobado').map(u => `<option value="${escapeHtml(u.nombre_mostrar)}">`).join('');

  // --- RENDER DE SOLICITUDES PENDIENTES ---
  let html = avisoPromo + `<h4 class="accounts-title">🔔 Solicitudes Pendientes</h4>`;
  const pendientes = usuarios.filter(u => u.estado === 'pendiente');

  if(pendientes.length === 0) {
      html += `<p class="accounts-note">No hay nadie en la sala de espera.</p>`;
  } else {
      pendientes.forEach(u => {
         const n = escapeHtml(u.nombre_mostrar);
         html += `<div class="account-row account-row--pending">
            <div><strong>${n}</strong> <span class="account-row__wait">⏳ Esperando acceso</span></div>
            <div class="account-row__actions">
              <button class="primary icon-btn btn-approve" data-acc-act="aprobar" data-acc-id="${u.id}" data-acc-nombre="${n}">✅ Aprobar</button>
              <button class="danger icon-btn" data-acc-act="rechazar" data-acc-id="${u.id}">❌ Rechazar</button>
            </div>
         </div>`;
      });
  }
  
  // --- RENDER DE MIEMBROS APROBADOS (LA ABDICACIÓN Y DELEGADOS) ---
  html += `<h4 class="accounts-title accounts-title--spaced">🏥 Miembros de la Promoción</h4>`;
  const aprobados = usuarios.filter(u => u.estado === 'aprobado');

  aprobados.forEach(u => {
      // Etiquetas de rango. El Dueño NO es un rol: es `creador_id` de la
      // especialidad (PRD §3.2). Antes se etiquetaba `rol==='admin'` como
      // «Dueño», que confundía dos niveles distintos.
      const esDueñoFila = promo && promo.creador_id === u.id;
      let rolBadge = '✅ Residente';
      if (esDueñoFila) rolBadge = '👑 Dueño';
      // El selector de variación (U+FE0F) no es opcional: sin él, 🛡 se
      // dibuja en estilo texto y sale un contorno tipo corazón, no un escudo.
      else if (u.rol === 'admin') rolBadge = '🛡️ Admin';
      else if (u.rol === 'delegado') rolBadge = '⭐ Delegado';

      const n = escapeHtml(u.nombre_mostrar);
      let acciones = '';

      if (u.id === currentUserProfile.id) {
          // Acciones para TI MISMO
          if (isDueño && aprobados.length > 1) {
              acciones = `<span class="account-row__locked">No puedes abdicar sin traspasar la corona primero.</span>`;
          } else {
              acciones = `<button class="danger icon-btn" data-acc-act="renunciar">Renunciar a Admin</button>`;
          }
      } else {
          // Acciones sobre TUS COMPAÑEROS
          // NOTA: el reparto de poderes es el de hoy, sin tocar. Abrirlo al
          // modelo de PRD §3.5 es [P-02] del backlog, no este punto.
          if (isDueño) {
              // El Dueño puede expulsar a cualquiera
              acciones += `<button class="danger icon-btn" data-acc-act="expulsar" data-acc-id="${u.id}" data-acc-nombre="${n}">Expulsar</button>`;

              // Gestión de rol. «Hacer Admin» es exclusivo del Dueño (PRD §3.2)
              // y va siempre con su contrario: sin «Quitar Admin» la promoción
              // sería una puerta de un solo sentido, porque una fila de admin
              // no mostraba ningún botón de rol y solo se podía deshacer
              // expulsando o coronando.
              if (u.rol === 'admin') {
                  acciones += `<button class="danger icon-btn" data-acc-act="rol" data-acc-id="${u.id}" data-acc-rol="residente" data-acc-confirm="¿Quitar el rol de Admin a ${n}? Volverá a ser residente.">Quitar Admin</button>`;
              } else {
                  if (u.rol === 'delegado') {
                      acciones += `<button class="danger icon-btn" data-acc-act="rol" data-acc-id="${u.id}" data-acc-rol="residente">Quitar Delegado</button>`;
                  } else {
                      acciones += `<button class="primary icon-btn" data-acc-act="rol" data-acc-id="${u.id}" data-acc-rol="delegado">Hacer Delegado</button>`;
                  }
                  acciones += `<button class="primary icon-btn" data-acc-act="rol" data-acc-id="${u.id}" data-acc-rol="admin" data-acc-confirm="¿Hacer Admin a ${n}? Podrá aprobar, expulsar y gestionar delegados. NO podrá tocar los planes de guardias ni borrar la especialidad: eso sigue siendo solo tuyo. Solo tú podrás quitarle el rol.">Hacer Admin</button>`;
              }
              acciones += `<button class="primary icon-btn btn-crown" data-acc-act="coronar" data-acc-id="${u.id}" data-acc-nombre="${n}">Coronar Dueño</button>`;
          } else {
              // Delegado: solo puede expulsar residentes, no a admins ni a otros delegados.
              if (u.rol !== 'admin' && u.rol !== 'delegado') {
                  acciones += `<button class="danger icon-btn" data-acc-act="expulsar" data-acc-id="${u.id}" data-acc-nombre="${n}">Expulsar</button>`;
              }
          }
      }

      const fIni = escapeHtml(u.fecha_inicio_residencia || 'No definido');
      const fCam = u.fecha_cambio_contrato ? escapeHtml(u.fecha_cambio_contrato.substring(0,7)) : 'No definido';
      html += `<div class="account-row">
         <div>
            <strong>${n}</strong> <span class="account-row__role">${rolBadge}</span>
            <div class="account-row__meta">
               Inicio: <strong>${fIni}</strong> | Mes cambio contrato: <strong>${fCam}</strong>
               ${isDueño ? `<br><button class="secondary icon-btn" data-acc-act="fechas" data-acc-id="${u.id}" data-acc-nombre="${n}" data-acc-ini="${escapeHtml(u.fecha_inicio_residencia || '')}" data-acc-cam="${escapeHtml(u.fecha_cambio_contrato || '')}">✏️ Editar</button>` : ''}
            </div>
         </div>
         <div class="account-row__actions">${acciones}</div>
      </div>`;
  });

  el.innerHTML = html;
  _bindAccountActions(el);
}

/**
 * Dispatcher de la lista de cuentas: un solo listener delegado en el
 * contenedor, en vez de `onclick` con el nombre interpolado.
 *
 * Los nombres de residente son texto libre del admin, y la regla del Paso 6
 * dice que cualquier `onclick` que los interpole es un bug latente: un
 * `O'Brien` rompía el atributo. Los datos viajan en `data-*` escapado y se
 * leen del dataset, donde las comillas ya no significan nada.
 */
function _bindAccountActions(root) {
    if (!root || root._accBound) return;
    root._accBound = true;
    root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-acc-act]');
        if (!btn || !root.contains(btn)) return;
        const d = btn.dataset;
        // Botones que conceden o retiran poder piden confirmación. Comparten
        // fila con «Coronar Dueño» y en el móvil envuelven a dos líneas, así
        // que un toque desviado es fácil.
        if (d.accConfirm && !confirm(d.accConfirm)) return;
        switch (d.accAct) {
            case 'aprobar':   return adminAprobarUsuario(d.accId, d.accNombre);
            case 'rechazar':  return adminRechazarUsuario(d.accId);
            case 'expulsar':  return adminExpulsarUsuario(d.accId, d.accNombre);
            case 'rol':       return adminCambiarRol(d.accId, d.accRol);
            case 'coronar':   return adminTraspasarCorona(d.accId, d.accNombre);
            case 'renunciar': return adminRenunciarPrivilegios();
            case 'fechas':    return window.adminEditarFechas(d.accId, d.accNombre, d.accIni, d.accCam);
        }
    });
}

/** Degrada al admin actual a residente normal, renunciando a todos los privilegios. */
async function adminRenunciarPrivilegios() {
    if (!confirm("¿Seguro que quieres renunciar a tus privilegios de Administrador? Volverás a ser un residente normal y perderás el acceso a esta pestaña.")) return;
    setStatus('Renunciando...');
    const { error } = await supabaseClient.from('perfiles').update({ rol: null }).eq('id', currentUserProfile.id);
    if (error) {
        setStatus('Conectado ✅');
        return alert(`⚠️ No se ha podido renunciar a los privilegios.\n\n${error.message}\n\nSigues siendo administrador.`);
    }
    window.location.reload();
}

/**
 * Cambia el rol de un usuario de la promoción.
 * @param {string} userId
 * @param {'admin'|'delegado'|null} nuevoRol
 */
async function adminCambiarRol(userId, nuevoRol) {
    setStatus('Actualizando rol...');
    const { error } = await supabaseClient.from('perfiles').update({ rol: nuevoRol }).eq('id', userId);
    if(error) alert("Error: " + error.message);
    await renderAccountsList();
    setStatus('Conectado ✅');
}

/**
 * Transfiere la propiedad absoluta de la promoción a otro residente.
 * El que la cede pasa a ser delegado.
 * @param {string} userId
 * @param {string} userName
 */
async function adminTraspasarCorona(userId, userName) {
    if (!confirm(`¿Estás seguro de que quieres ceder la corona a ${userName}? Perderás el control absoluto y pasarás a ser un Delegado normal.`)) return;
    setStatus('Traspasando corona...');

    // Son tres escrituras sin transacción: Supabase no las agrupa desde el
    // cliente. El orden está elegido para que CUALQUIER fallo parcial deje un
    // estado recuperable, en vez del que había antes (creador_id primero), que
    // podía mover la corona a alguien sin rol de admin y dejar la promoción
    // sin nadie capaz de administrarla.
    //   1. Promover al nuevo  → peor caso: dos admins. Inofensivo.
    //   2. Mover la corona    → peor caso: sigues siendo Dueño. Reintentable.
    //   3. Degradarte tú      → peor caso: eres un admin de más. Lo arregla él.
    // Repinta al abortar: tras un fallo parcial la lista muestra los badges de
    // ANTES de la escritura que sí entró, y el usuario podría reintentar
    // creyendo que no cambió nada.
    const abortar = async (msg) => { setStatus('Conectado ✅'); alert(msg); await renderAccountsList(); };

    const r1 = await supabaseClient.from('perfiles').update({ rol: 'admin' }).eq('id', userId);
    if (r1.error) return abortar(`⚠️ No se ha podido dar rol de admin a ${userName}.\n\n${r1.error.message}\n\nNo se ha cambiado nada: sigues siendo el Dueño.`);

    const r2 = await supabaseClient.from('promociones').update({ creador_id: userId }).eq('id', currentUserProfile.promocion_id);
    if (r2.error) return abortar(`⚠️ No se ha podido traspasar la corona.\n\n${r2.error.message}\n\nSigues siendo el Dueño, pero ${userName} se ha quedado como admin. Quítaselo o reintenta el traspaso.`);

    const r3 = await supabaseClient.from('perfiles').update({ rol: 'delegado' }).eq('id', currentUserProfile.id);
    if (r3.error) return abortar(`⚠️ La corona YA es de ${userName}, pero no has podido degradarte a Delegado.\n\n${r3.error.message}\n\nSigues como admin. Pídele que te cambie el rol.`);

    alert(`La corona ha sido cedida a ${userName}. Ahora eres un Delegado.`);
    window.location.reload();
}

/**
 * Abre un modal SweetAlert2 para editar las fechas de residencia de un usuario.
 * Persiste en Supabase y regenera historialEventos para el motor de rotación.
 */
window.adminEditarFechas = async function adminEditarFechas(userId, userName, fInicio, fCambio, fEntrada, fSalida) {
    try {
        // Convertir fecha completa a solo YYYY-MM para el selector de mes
        const fCambioMes = fCambio ? fCambio.substring(0, 7) : '';
        const { value: formValues } = await Swal.fire({
        title: `Editar Fechas de ${userName}`,
        html:
            `<div style="text-align:left; font-size:0.9rem; margin-bottom:5px;">Fecha Inicio Residencia (R1):</div>` +
            `<input id="swal-input1" type="date" class="swal2-input" value="${fInicio}">` +
            `<div style="text-align:left; font-size:0.9rem; margin-bottom:5px; margin-top:10px;">Mes de Cambio de Contrato:</div>` +
            `<input id="swal-input2" type="month" class="swal2-input" value="${fCambioMes}">`,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            return [
                document.getElementById('swal-input1').value,
                document.getElementById('swal-input2').value  // YYYY-MM format
            ]
        }
    });

    if (formValues) {
        setStatus('Actualizando fechas...');
        // Guardamos siempre con día 01 para estandarizar
        const fechaCambioFinal = formValues[1] ? `${formValues[1]}-01` : null;
        const { error } = await supabaseClient.from('perfiles').update({
            fecha_inicio_residencia: formValues[0] || null,
            fecha_cambio_contrato: fechaCambioFinal
        }).eq('id', userId);
        
        if (error) {
            alert("Error: " + error.message);
        } else {
            // Actualizar historialEventos en la rotación (motor matemático)
            if (!state.historialEventos) state.historialEventos = {};
            if (!state.historialEventos[userName]) state.historialEventos[userName] = {};
            
            if (formValues[2]) state.historialEventos[userName].entrada = formValues[2];
            else delete state.historialEventos[userName].entrada;
            
            if (formValues[3]) state.historialEventos[userName].salida = formValues[3];
            else delete state.historialEventos[userName].salida;
            
            await limpiarFuturos(curDate.getFullYear(), curDate.getMonth());
            await saveState();

            // Refrescar perfiles globales y lista
            const { data: profs } = await supabaseClient.from('perfiles').select('*').eq('promocion_id', currentUserProfile.promocion_id).in('estado', ['aprobado', 'historico']);
            globalProfiles = profs || [];
            await renderAccountsList();
        }
        setStatus('Conectado ✅');
    }
    } catch (err) {
        alert("Error crítico en el botón editar: " + err.message);
    }
}

/**
 * Aprueba la solicitud de acceso de un usuario y lo añade al grupo de rotación con menos miembros.
 * Re-empaqueta automáticamente si algún grupo supera 4 miembros.
 * @param {string} userId
 * @param {string} userName
 */
async function adminAprobarUsuario(userId, userName) {
    setStatus('Aprobando...');
    const { error } = await supabaseClient.from('perfiles').update({ estado: 'aprobado' }).eq('id', userId);
    if(error) { setStatus('Conectado ✅'); return alert(`⚠️ No se ha podido aprobar a ${userName}.\n\n${error.message}\n\nSigue en la sala de espera.`); }

    // 🧭 B2: el plan de destino es el del USUARIO APROBADO (calculado por sus fechas de
    // contrato), NUNCA el del aprobador: un delegado R2 aprobando a una R1 la metía en
    // los baseGroups del plan R2 y aparecía "al final de la lista de R2".
    const dk = formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1);
    const { data: perfilNuevo } = await supabaseClient.from('perfiles').select('*').eq('id', userId).single();
    if (perfilNuevo && !globalProfiles.some(p => p.id === perfilNuevo.id)) globalProfiles.push(perfilNuevo);
    let planAprobado = perfilNuevo ? getPlanForUserOnDate(perfilNuevo, dk) : null;
    if (!planAprobado && perfilNuevo?.fecha_inicio_residencia) {
        // Aún no ha empezado en el mes visible: usamos el plan de su mes de inicio
        const [iy, im] = perfilNuevo.fecha_inicio_residencia.split('-').map(Number);
        planAprobado = getPlanForUserOnDate(perfilNuevo, formatDateKey(iy, im - 1, 1));
    }
    const planName = planAprobado ? planAprobado.nombre : getCurrentRotPlan(dk);

    // Añadir al grupo con menor número de miembros (W4)
    if (!state.planRotations) state.planRotations = {};
    if (!state.planRotations[planName]) state.planRotations[planName] = { baseGroups: [], baseYear: curDate.getFullYear(), baseMonth: curDate.getMonth(), customRotations: {}, residentesFijos: [] };
    const pr = state.planRotations[planName];
    const grupos = (pr.baseGroups && pr.baseGroups.length > 0 && pr.baseGroups.some(g => g.length > 0))
        ? pr.baseGroups
        : null;
    if (!grupos) {
        // Primer residente del plan: crear el grupo inicial
        pr.baseGroups = [[userName]];
    } else {
        // Encontrar el grupo con menos miembros (último en caso de empate)
        const minIdx = grupos.reduce((best, g, i) => g.length <= grupos[best].length ? i : best, 0);
        grupos[minIdx].push(userName);
        // Solo reempaquetar si algún grupo supera el máximo de 4
        if (grupos.some(g => g.length > 4)) {
            pr.baseGroups = reempaquetarGruposPlan(grupos.flat(), pr);
        }
    }
    
    invalidateConfigMesDesde(); // Solo desde el mes actual: los meses cerrados no se reabren
    await saveState();
    await renderAccountsList();
    setStatus('Conectado ✅');
}

/**
 * Mueve al usuario al estado 'historico', registrando su fecha de salida en historialEventos.
 * Ya no aparecerá en futuras rotaciones pero sus guardias históricas se conservan.
 * @param {string} userId
 * @param {string} userName
 */
async function adminExpulsarUsuario(userId, userName) {
    if(!confirm(`¿Seguro que quieres dar de baja a ${userName}? Pasará al histórico y ya no estará en futuras listas de rotación.`)) return;
    setStatus('Expulsando...');

    // Se degrada el rol en la MISMA escritura. Antes solo se ponía
    // `estado: 'historico'`, así que un delegado dado de baja conservaba
    // `rol: 'delegado'` y volvía con privilegios si se le readmitía.
    const { error } = await supabaseClient.from('perfiles')
        .update({ estado: 'historico', rol: null }).eq('id', userId);

    // El return va ANTES de tocar historialEventos a propósito: si la escritura
    // falla y seguimos, el estado local registra una salida que en la base no
    // ha ocurrido, y la app cree que esa persona se fue cuando sigue activa.
    if (error) {
        setStatus('Conectado ✅');
        return alert(`⚠️ No se ha podido dar de baja a ${userName}.\n\n${error.message}\n\nNo se ha cambiado nada: sigue activa en la promoción.`);
    }

    if (!state.historialEventos) state.historialEventos = {};
    if (!state.historialEventos[userName]) state.historialEventos[userName] = {};
    const mStr = String(curDate.getMonth() + 1).padStart(2, '0');
    state.historialEventos[userName].salida = `${curDate.getFullYear()}-${mStr}`;
    
    await saveState(); 
    const { data: profs } = await supabaseClient.from('perfiles').select('*').eq('promocion_id', currentUserProfile.promocion_id).in('estado', ['aprobado', 'historico']);
    globalProfiles = profs || [];
    await renderAccountsList();
    renderRotationView();
    setStatus('Conectado ✅');
}

/** Rechaza la solicitud de acceso de un usuario: lo desvincula de la promoción y lo deja en estado pendiente. */
async function adminRechazarUsuario(userId) {
    if(!confirm("¿Rechazar solicitud?")) return;
    setStatus('Rechazando...');
    const { error } = await supabaseClient.from('perfiles').update({ promocion_id: null, estado: 'pendiente' }).eq('id', userId);
    setStatus('Conectado ✅');
    if (error) return alert(`⚠️ No se ha podido rechazar la solicitud.\n\n${error.message}\n\nSigue pendiente.`);
    await renderAccountsList();
}

/** Renderiza la vista de rotación con el selector de plan (para delegados) y el orden de grupos del mes. */
function renderRotationView() {
    const y = curDate.getFullYear(), m = curDate.getMonth();
    const dk = formatDateKey(y, m, 1);

    // Inject Plan Selector
    const containerTop = document.getElementById('rot-content');
    let planSelectorHtml = '';
    if (isDelegado && promoConfig.planes) {
        planSelectorHtml = `<div class="rot-plan-bar">
            <label for="rot-plan-select">Viendo Rotación de:</label>
            <select id="rot-plan-select" onchange="selectedRotPlan = this.value; editingGroups = null; renderAll();">
                <option value="AUTO" ${!selectedRotPlan || selectedRotPlan === 'AUTO' ? 'selected' : ''}>Mi Plan Actual (Automático)</option>
                ${promoConfig.planes.map(p => `<option value="${escapeHtml(p.nombre)}" ${selectedRotPlan === p.nombre ? 'selected' : ''}>${escapeHtml(p.nombre)}</option>`).join('')}
            </select>
        </div>`;
    } else {
        const myPlan = getPlanForUserOnDate(currentUserProfile, dk);
        planSelectorHtml = `<div class="rot-plan-note">Mostrando Fila India para: <strong>${escapeHtml(myPlan ? myPlan.nombre : 'Plan Base')}</strong></div>`;
    }
    
    const groups = getRotation(y, m);
    containerTop.innerHTML = planSelectorHtml;
    
    const listDiv = document.createElement('div');

    const container = document.getElementById('rot-content'); 
    /* container.innerHTML = ''; */ 
    let order = 1; 
    groups.forEach((g, i) => {
        const div = document.createElement('div'); div.className = 'rot-card';
        div.innerHTML = `<h4 class="rot-card__title">Grupo ${i+1}</h4>` + g.map(res => `<div class="rot-line"><strong>${order++}.</strong> ${escapeHtml(res)}</div>`).join('');
        listDiv.appendChild(div); 
    }); 
    containerTop.appendChild(listDiv);
    // 🧭 B2: el editor se habilita para el admin (todos los planes) y para el delegado
    // SOLO cuando el plan visualizado es el suyo propio. En otros planes: solo lectura.
    const _planVista = getCurrentRotPlan(dk);
    if (puedeGestionarPlan(_planVista, y, m)) {
        document.getElementById('admin-rot-tools').style.display = 'block';
        if (!editingGroups) editingGroups = JSON.parse(JSON.stringify(groups));
        renderEditor();
    } else document.getElementById('admin-rot-tools').style.display = 'none';
}

/**
 * Alterna el estado "fijo" de un residente en el plan activo.
 * Los residentes fijos forman un grupo separado que rota en orden fijo.
 * @param {string} nombre
 */
async function toggleResidenteFijo(nombre) {
    const dk = formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1);
    const planName = getCurrentRotPlan(dk);
    if (!puedeGestionarPlan(planName, curDate.getFullYear(), curDate.getMonth())) return alert('⚠️ Solo puedes editar la rotación de tu propio plan de guardias.');
    if (!state.planRotations || !state.planRotations[planName]) return;
    const pr = state.planRotations[planName];
    if (!pr.residentesFijos) pr.residentesFijos = [];
    
    let linear = editingGroups.flat();
    let fijos = linear.filter(n => pr.residentesFijos.includes(n));
    let moviles = linear.filter(n => !pr.residentesFijos.includes(n));

    if (pr.residentesFijos.includes(nombre)) {
        pr.residentesFijos = pr.residentesFijos.filter(n => n !== nombre);
        fijos = fijos.filter(n => n !== nombre);
        moviles.unshift(nombre);
    } else {
        pr.residentesFijos.push(nombre);
        moviles = moviles.filter(n => n !== nombre);
        fijos.push(nombre);
    }
    
    let nuevoBlock = [];
    if (fijos.length > 0) nuevoBlock.push(fijos);
    nuevoBlock.push(..._reempaquetarGrupos(moviles));
    
    editingGroups = nuevoBlock;
    pr.baseGroups = JSON.parse(JSON.stringify(editingGroups));
    invalidateConfigMesDesde(); // Solo desde el mes actual: los meses cerrados no se reabren
    await saveState();
    renderEditor();
}

/**
 * Alterna la exclusión de un residente del pool de candidatos para subastas forzosas.
 * Sus guardias no se cuentan para calcular el exceso mensual.
 * @param {string} nombre
 */
async function toggleResidenteExcluido(nombre) {
    const _dkTE = formatDateKey(curDate.getFullYear(), curDate.getMonth(), 1);
    if (!puedeGestionarPlan(getCurrentRotPlan(_dkTE), curDate.getFullYear(), curDate.getMonth())) return alert('⚠️ Solo puedes editar la rotación de tu propio plan de guardias.');
    if (!state.excluidosSubastas) state.excluidosSubastas = [];
    if (state.excluidosSubastas.includes(nombre)) {
        state.excluidosSubastas = state.excluidosSubastas.filter(n => n !== nombre);
    } else {
        if (confirm(`¿Seguro que quieres excluir a ${nombre} de las subastas forzosas? (No se le tendrán en cuenta sus guardias para calcular el exceso)`)) {
            state.excluidosSubastas.push(nombre);
        }
    }
    await saveState();
    renderEditor();
}

	
