// ============================================================
// MÓDULO: GRUPOS_HOSPITALARIOS
// Exportar a: src/modules/grupos.js
// Líneas estimadas: ~230
// Dependencias externas: supabaseClient, currentUserProfile, state
// Helpers que usa: setStatus, evaluarEstadoUsuario, saveState, limpiarFuturos, renderGruposView
// ============================================================
/** Renderiza el panel de grupos: estado actual del usuario y listado de otros grupos por hospital. */
async function renderGruposView() {
    const currentContainer = document.getElementById('grupos-current-info');
    const listContainer = document.getElementById('grupos-list-container');
    // Guarda de sesión: el visibilitychange de initApp puede llamar aquí sin perfil cargado.
    if (!currentContainer || !listContainer || !currentUserProfile) return;
    _bindGruposActions(document.getElementById('pane-grupos'));

    currentContainer.innerHTML = '<p class="grp-muted">Cargando...</p>';
    listContainer.innerHTML = '<p class="grp-muted">Cargando...</p>';

    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout de red")), 5000));
    const fetchPromos = supabaseClient.from('promociones').select('*');

    let promos;
    try {
        const { data, error } = await Promise.race([fetchPromos, timeout]);
        if (error) throw error;
        promos = data || [];
    } catch (err) {
        const msg = `<p class="grp-error">Error de conexión: ${escapeHtml(err.message)}</p>`;
        currentContainer.innerHTML = msg;
        listContainer.innerHTML = '';
        return;
    }

    // 1. DIBUJAR GRUPO ACTUAL
    const myPromo = currentUserProfile.promocion_id
        ? promos.find(p => p.id === currentUserProfile.promocion_id)
        : null;
    if (myPromo) {
        const statusBadge = currentUserProfile.estado === 'aprobado'
            ? `<span class="grp-badge grp-badge--ok">✓ Acceso activo</span>`
            : `<span class="grp-badge grp-badge--wait">⏳ Pendiente de aprobación</span>`;

        currentContainer.innerHTML = `
            <div class="grp-current">
                <div class="grp-current__info">
                    <h4 class="grp-current__hosp">${escapeHtml(myPromo.hospital)}</h4>
                    <div class="grp-current__svc">${escapeHtml(myPromo.servicio)} <span class="grp-current__name">(${escapeHtml(myPromo.nombre)})</span></div>
                    <div class="grp-current__status">${statusBadge}</div>
                </div>
                <button class="danger grp-leave" data-grp-act="salir">🚪 Salir de este grupo</button>
            </div>`;
    } else if (currentUserProfile.promocion_id) {
        // El id apunta a una promoción que ya no existe: antes se quedaba en «Cargando...».
        currentContainer.innerHTML = `
            <div class="grp-current">
                <p class="grp-muted">Tu grupo ya no figura en el sistema.</p>
                <button class="danger grp-leave" data-grp-act="salir">🚪 Salir de este grupo</button>
            </div>`;
    } else {
        currentContainer.innerHTML = `<p class="grp-muted grp-muted--italic">No estás en ningún grupo actualmente.</p>`;
    }

    // 2. DIBUJAR LISTA DE OTROS GRUPOS (las especialidades cerradas no admiten solicitudes)
    const otherPromos = promos.filter(p => p.id !== currentUserProfile.promocion_id && p.activa !== false);
    if (otherPromos.length === 0) {
        listContainer.innerHTML = `<p class="grp-empty">No hay otros grupos registrados en el sistema.</p>`;
        return;
    }

    const byHospital = {};
    otherPromos.forEach(p => {
        if (!byHospital[p.hospital]) byHospital[p.hospital] = [];
        byHospital[p.hospital].push(p);
    });

    let html = '';
    for (const hosp in byHospital) {
        html += `<div class="grp-hosp">
            <h4 class="grp-hosp__title">🏥 ${escapeHtml(hosp)}</h4>
            <div class="grp-hosp__list">`;

        byHospital[hosp].forEach(p => {
            html += `<div class="grp-row">
                <div class="grp-row__info">
                    <strong class="grp-row__svc">${escapeHtml(p.servicio)}</strong>
                    <span class="grp-row__name">Contenedor: ${escapeHtml(p.nombre)}</span>
                </div>
                <button class="grp-request" data-grp-act="solicitar" data-grp-id="${escapeHtml(p.id)}">Solicitar acceso</button>
            </div>`;
        });
        html += `</div></div>`;
    }
    listContainer.innerHTML = html;
}

/** Delegado de clics de la pestaña Grupos: los botones llevan data-grp-act, sin onclick interpolado. */
function _bindGruposActions(root) {
    if (!root || root._grpBound) return;
    root._grpBound = true;
    root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-grp-act]');
        if (!btn || !root.contains(btn)) return;
        switch (btn.dataset.grpAct) {
            case 'salir':     return abandonarGrupo();
            case 'solicitar': return solicitarCambioGrupo(btn.dataset.grpId);
        }
    });
}

/**
 * Persiste el día y mes de cambio de contrato del usuario usando el año 2000 como base inerte
 * (garantiza soporte de 29-Feb sin depender del año actual).
 */
async function guardarFechaGraduacion() {
    const dia = document.getElementById('input-dia-cambio').value;
    const mes = document.getElementById('input-mes-cambio').value;
    
    // Usamos el año 2000 (bisiesto) como base para soportar 29 de Febrero y cumplir el formato DATE de Supabase
    const dummyDate = `2000-${mes}-${dia}`;

    setStatus('Guardando fecha...');
    const { error } = await supabaseClient
        .from('perfiles')
        .update({ fecha_cambio_contrato: dummyDate })
        .eq('id', currentUserProfile.id);

    if (error) {
        alert("Error al guardar en la base de datos: " + error.message);
    } else {
        currentUserProfile.fecha_cambio_contrato = dummyDate;
        alert("Día y mes de cambio actualizados correctamente.");
        setStatus('Sincronizado ✅');

		// Cirugía técnica: Refresca el chivato visual inmediatamente sin F5
        renderGruposView();
    }
}
	
// ==========================================
// FASE 1: PROTECCIÓN DE GRUPOS Y SUCESIÓN
// ==========================================

/** Inicia el flujo de salida del grupo actual (sin destino alternativo). */
async function abandonarGrupo() {
    if(!confirm("¿Seguro que quieres salir? Perderás el acceso al calendario actual.")) return;
    iniciarProcesoSalida(null); // null significa que solo sale, no cambia a otro
}

/**
 * Solicita el cambio a otra promoción: inicia el proceso de salida con destinoId para que
 * se evalúe si hay sucesión pendiente antes de ejecutar el movimiento.
 * @param {string} destinoId - id de la promoción destino
 */
async function solicitarCambioGrupo(destinoId) {
  if (!confirm("¿Seguro que deseas solicitar el cambio a este grupo? Tu estado volverá a estar pendiente o se evaluará si está vacío.")) return;
  await iniciarProcesoSalida(destinoId);
}

/**
 * Punto de control de salida: determina si el usuario es el dueño del grupo y gestiona
 * tres caminos — salida libre, hibernación (último miembro) o sucesión automática.
 * @param {string|null} destinoId - id de la promoción destino, o null para salida simple
 */
async function iniciarProcesoSalida(destinoId) {
    if (!currentUserProfile.promocion_id) return ejecutarSalidaFinal(destinoId);

    setStatus('Comprobando estado del grupo...');
    
    // 1. Descargamos a todos los aprobados del grupo
    const { data: poblacion, error } = await supabaseClient
        .from('perfiles')
        .select('id, nombre_mostrar, rol')
        .eq('promocion_id', currentUserProfile.promocion_id)
        .in('estado', ['aprobado', 'historico']);

    if (error) return alert("Error al leer el grupo: " + error.message);

    // 2. Averiguamos quiénes somos nosotros en el organigrama
    const { data: promo } = await supabaseClient.from('promociones').select('creador_id').eq('id', currentUserProfile.promocion_id).single();
    const isDueño = promo && promo.creador_id === currentUserProfile.id;
    
    const otrosUsuarios = poblacion.filter(u => u.id !== currentUserProfile.id);

    // CAMINO A: Salida Libre (Si eres residente normal o delegado)
    if (!isDueño) {
        return ejecutarSalidaFinal(destinoId);
    }

    // CAMINO B: Hibernación (Eres el Dueño, pero estás solo)
    if (otrosUsuarios.length === 0) {
        alert("ℹ️ Eres el último miembro. El grupo quedará en 'Modo Hibernación' conservando sus reglas hasta que una nueva generación lo reclame.");
        return ejecutarSalidaFinal(destinoId);
    }

    // CAMINO C: Sucesión Obligatoria Automática (Eres el Dueño y hay gente dentro)
    const delegados = otrosUsuarios.filter(u => u.rol === 'delegado');
    const residentes = otrosUsuarios.filter(u => u.rol !== 'admin' && u.rol !== 'delegado');
    const sucesor = delegados.length > 0 ? delegados[0] : residentes[0];
    
    alert(`👑 Traspaso Automático: Como eras el administrador principal, al abandonar el grupo la corona ha sido transferida automáticamente a ${sucesor.nombre_mostrar}.`);
    
    setStatus('Transfiriendo poderes...');
    
    // Coronar al sucesor como Dueño en la tabla de promociones
    const { error: errPromo } = await supabaseClient.from('promociones').update({ creador_id: sucesor.id }).eq('id', promo.id);
    if (errPromo) return alert("Error al transferir la propiedad: " + errPromo.message);
    
    // Asegurarnos de que el sucesor tiene rol 'admin'
    await supabaseClient.from('perfiles').update({ rol: 'admin' }).eq('id', sucesor.id);

    return ejecutarSalidaFinal(destinoId);
}

/**
 * Puerta única de entrada/salida de grupo: gestiona el protocolo "primer colono" si el destino
 * está vacío, o envía la solicitud de acceso si está ocupado. destinoId=null produce salida simple.
 * @param {string|null} destinoId
 */
async function ejecutarSalidaFinal(destinoId) {
    setStatus(destinoId ? 'Procesando entrada...' : 'Saliendo del grupo...');

    // 1. ESCÁNER DE HIBERNACIÓN (Solo si entramos a un nuevo grupo)
    if (destinoId) {
        const { data: poblacion } = await supabaseClient.from('perfiles')
            .select('id').eq('promocion_id', destinoId).in('estado', ['aprobado', 'historico']);

        if (!poblacion || poblacion.length === 0) {
            if (!confirm("ℹ️ El contenedor está vacío (hibernando). Al entrar, serás coronado automáticamente como Dueño/Administrador. ¿Aceptas el cargo?")) {
                setStatus('Conectado ✅');
                return; // Aborta la operación si le da miedo el poder
            }

            // A. PROTOCOLO PRIMER COLONO: Le damos la medalla y guardamos fechas
            await supabaseClient.from('promociones').update({ creador_id: currentUserProfile.id }).eq('id', destinoId);

            const { error } = await supabaseClient.from('perfiles').update({
                promocion_id: destinoId,
                estado: 'aprobado',
                rol: 'admin',
                fecha_inicio_residencia: currentUserProfile.fecha_inicio_residencia, 
                fecha_cambio_contrato: currentUserProfile.fecha_cambio_contrato || null 
            }).eq('id', currentUserProfile.id);

            if (error) return alert("Error: " + error.message);

            // Actualizamos la memoria local
            currentUserProfile.promocion_id = destinoId;
            currentUserProfile.estado = 'aprobado';
            currentUserProfile.rol = 'admin';
            isAdmin = true;
            isDelegado = true;

            alert("¡Has despertado el contenedor! Ahora eres el Administrador principal.");
            return evaluarEstadoUsuario();
        }
    }

    // 2. EJECUCIÓN DE SALIDA O SOLICITUD NORMAL
    // Esta parte cubre tanto la salida simple (destinoId = null) como la solicitud a un grupo ocupado
    const { error } = await supabaseClient.from('perfiles').update({ 
        promocion_id: destinoId || null, 
        estado: 'pendiente',
        fecha_inicio_residencia: currentUserProfile.fecha_inicio_residencia, 
        fecha_cambio_contrato: currentUserProfile.fecha_cambio_contrato || null 
    }).eq('id', currentUserProfile.id);
    
    if (error) return alert("Error al actualizar perfil: " + error.message);
    
    // Actualizamos la memoria local
    currentUserProfile.promocion_id = destinoId || null;
    currentUserProfile.estado = 'pendiente';
    isAdmin = false;
    isDelegado = false;
    esDueño = false; // al salir del grupo dejas de ser su Dueño, aunque la corona tarde en pasar

    alert(destinoId ? "Solicitud enviada al nuevo grupo." : "Has salido del grupo correctamente.");
    evaluarEstadoUsuario(); 
}

