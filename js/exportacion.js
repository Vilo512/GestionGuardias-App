// ============================================================
// MÓDULO: EXPORTACION
// Dependencias externas: state.shifts, state.trades, state.planRotations, promoConfig, XLSX
// Helpers que usa: getComputedShifts, getAllResidents, getDaysInMonth, formatDateKey, MONTHS, getRotationKey
// ============================================================
/** Abre el modal de exportación y rellena los selectores de plan, servicio y período disponibles. */
function openExportModal() {
    if (!promoConfig || !promoConfig.planes || promoConfig.planes.length === 0) {
        alert("No hay ningún Plan de Guardias configurado.");
        return;
    }
    
    // 1. Llenar Planes
    const planSel = document.getElementById('exp-plan');
    planSel.innerHTML = '';
    promoConfig.planes.forEach(p => {
        planSel.innerHTML += `<option value="${p.nombre}">${p.nombre}</option>`;
    });
    
    // 2. Llenar Servicios
    updateExportServices();
    
    // 3. Llenar Meses (buscando en el historial de shifts guardado o en los 12 meses)
    const periodSel = document.getElementById('exp-period');
    periodSel.innerHTML = '<option value="ALL">Todo el Histórico Disponible</option>';
    
    // Recopilar meses únicos del state.shifts
    let uniqueMonths = new Set();
    if (state.shifts) {
        for (let dk in state.shifts) {
            uniqueMonths.add(dk.substring(0, 7)); // "2024_01"
        }
    }
    let sortedMonths = Array.from(uniqueMonths).sort().reverse(); // Más recientes primero
    sortedMonths.forEach(mStr => {
        const [y, m] = mStr.split('_');
        periodSel.innerHTML += `<option value="${mStr}">${MONTHS[parseInt(m) - 1]} ${y}</option>`;
    });

    document.getElementById('export-modal').style.display = 'flex';
}

/** Actualiza el selector de servicios del modal de exportación al cambiar el plan seleccionado. */
function updateExportServices() {
    const planName = document.getElementById('exp-plan').value;
    const plan = promoConfig.planes.find(p => p.nombre === planName);
    const svcSel = document.getElementById('exp-svc');
    
    svcSel.innerHTML = '<option value="ALL">Todos los servicios del Plan</option>';
    if (plan && plan.servicios) {
        plan.servicios.forEach(s => {
            svcSel.innerHTML += `<option value="${s.nombre}">${s.nombre}</option>`;
        });
    }
}

/**
 * Genera y descarga un archivo Excel (.xlsx) con las guardias del plan/servicio/período seleccionados.
 * Soporta exportación de turnos originales o con trades del mercadillo aplicados.
 */
function executeExport() {
    const planName = document.getElementById('exp-plan').value;
    const svcName = document.getElementById('exp-svc').value;
    const period = document.getElementById('exp-period').value;
    const isMercado = document.getElementById('exp-type').value === 'merc';
    
    const plan = promoConfig.planes.find(p => p.nombre === planName);
    if (!plan) return;

    const shiftsToUse = isMercado ? getComputedShifts() : state.shifts;
    const suffix = isMercado ? "Mercadillo" : "Original";
    
    // Los residentes del plan se calculan mes a mes (getResidentesDePlan): si alguien
    // cambia de plan a mitad del período exportado, cada hoja refleja su plan real.
    const wb = XLSX.utils.book_new();
    const STYLE_FESTIVO = { fill: { fgColor: { rgb: "FEE2E2" } }, font: { color: { rgb: "EF4444" }, bold: true } };

    // Determinar qué meses exportar
    let monthsToExport = [];
    if (period === 'ALL') {
        let uniqueMonths = new Set();
        if (shiftsToUse) {
            for (let dk in shiftsToUse) uniqueMonths.add(dk.substring(0, 7));
        }
        monthsToExport = Array.from(uniqueMonths).sort();
    } else {
        monthsToExport = [period];
    }

    if (monthsToExport.length === 0) {
        alert("No hay datos de guardias para exportar.");
        return;
    }

    monthsToExport.forEach(mStr => {
        const [yStr, mStrIdx] = mStr.split('_');
        const y = parseInt(yStr, 10), m = parseInt(mStrIdx, 10) - 1;
        const days = getDaysInMonth(y, m);
        const sheetName = `${MONTHS[m].substring(0,3)} ${y}`;

        const residents = getResidentesDePlan(planName, y, m);

        // Determinar qué servicios mostrar
        let targetServices = svcName === 'ALL' ? plan.servicios.map(s => s.nombre) : [svcName];

        // Foráneos: residentes de otros planes que aparecen en el calendario de este plan
        // (mercadillo inter-plan, forzosas). Su guardia se atribuye a este plan solo si su
        // propio plan NO tiene un servicio con ese nombre; si lo tiene, la guardia pertenece
        // al calendario de su propio plan y no se exporta aquí.
        const foraneos = [];
        const monthPrefix = `${y}_${String(m + 1).padStart(2, '0')}_`;
        for (const dk in (shiftsToUse || {})) {
            if (!dk.startsWith(monthPrefix)) continue;
            for (const u in shiftsToUse[dk]) {
                if (u === 'Externo' || u.startsWith('VRE')) continue;
                if (residents.includes(u) || foraneos.includes(u)) continue;
                const svcNombre = shiftsToUse[dk][u];
                if (!targetServices.includes(svcNombre)) continue;
                const propioPlan = (promoConfig.planes || []).find(p =>
                    p.nombre !== planName && residentePerteneceAPlan(u, p.nombre, y, m));
                const loReclamaSuPlan = propioPlan && propioPlan.servicios.some(s => s.nombre === svcNombre);
                if (!loReclamaSuPlan) foraneos.push(u);
            }
        }

        const rowUsers = [...residents, ...foraneos];

        // Construir la tabla de este mes
        const dataGlobal = [];
        const hGlobal = ["Residente"];

        // Cabecera de días
        for (let d = 1; d <= days; d++) hGlobal.push(`${d}`);
        hGlobal.push("Total");
        dataGlobal.push(hGlobal);

        rowUsers.forEach(user => {
            const row = [user]; let total = 0; 
            for(let d=1; d<=days; d++) { 
                const ds = shiftsToUse[formatDateKey(y, m, d)] || {}; 
                let mySvc = ds[user];
                if (!mySvc && isMercado) { 
                    const vre = Object.keys(ds).find(k => k.startsWith('VRE_') && ds[k]); 
                    if(vre && targetServices.includes(ds[vre])) mySvc = ds[vre]; 
                }
                
                if (mySvc && targetServices.includes(mySvc)) {
                    total++; 
                    row.push(mySvc.substring(0,3).toUpperCase()); 
                } else {
                    row.push(""); 
                }
            } 
            // Solo exportamos a quien tuvo guardias del plan este mes (sin filas a cero)
            if (total > 0) { row.push(total); dataGlobal.push(row); }
        });

        if (dataGlobal.length <= 1) return; // Nadie tuvo guardias de este plan este mes → sin hoja

        const ws = XLSX.utils.aoa_to_sheet(dataGlobal);
        for(let d=1; d<=days; d++) {
            if (state.festivos && state.festivos[formatDateKey(y, m, d)]) {
                for (let r = 0; r < dataGlobal.length; r++) {
                    const cell = ws[XLSX.utils.encode_cell({r: r, c: d})]; 
                    if (cell) cell.s = STYLE_FESTIVO; 
                } 
            } 
        }
        
        // Solo añadimos la hoja si hay residentes (ya filtrados arriba)
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    if (wb.SheetNames.length === 0) {
        alert("No se han encontrado residentes asignados a este Plan de Guardias en el período seleccionado.");
        return;
    }

    let filename = `Guardias_${planName}_${svcName === 'ALL' ? 'Todos' : svcName}_${suffix}.xlsx`;
    XLSX.writeFile(wb, filename);
    document.getElementById('export-modal').style.display = 'none';
}

// ============================================================
// MÓDULO: EXPORTACION_MERCADILLO (sub-sección de EXPORTACION)
// Dependencias externas: state.trades, XLSX
// Helpers que usa: formatDK
// ============================================================
/**
 * Genera y descarga un Excel con el log de operaciones aprobadas/deshachas del Mercadillo
 * en el rango de meses seleccionado (máximo 12 meses).
 */
function exportarLogMercadillo() {
    const fromVal = document.getElementById('export-merc-desde').value;
    const toVal = document.getElementById('export-merc-hasta').value;
    
    if (!fromVal || !toVal) return alert("Por favor, selecciona las fechas Desde y Hasta.");
    if (fromVal > toVal) return alert("La fecha Desde no puede ser posterior a Hasta.");
    
    // Validar rango máximo 1 año (12 meses)
    const [fromY, fromM] = fromVal.split('-');
    const [toY, toM] = toVal.split('-');
    const monthsDiff = (parseInt(toY) - parseInt(fromY)) * 12 + (parseInt(toM) - parseInt(fromM));
    if (monthsDiff > 12) return alert("El rango máximo de exportación es de 1 año (12 meses).");
    
    const fromDate = new Date(parseInt(fromY), parseInt(fromM) - 1, 1);
    const toDate = new Date(parseInt(toY), parseInt(toM), 0); // last day of toMonth
    
    const trades = (state.trades || []).filter(t => {
        if (t.status !== 'approved' && t.status !== 'undone') return false;
        if (!t.timestamp) return false;
        const [datePart] = t.timestamp.split(' ');
        const [d, m, y] = datePart.split('/');
        const tradeDate = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
        return tradeDate >= fromDate && tradeDate <= toDate;
    });
    
    if (trades.length === 0) return alert("No se encontraron operaciones completadas en este rango de fechas.");
    
    const wb = XLSX.utils.book_new();
    const data = [["ID", "Fecha Operación", "Tipo", "Estado", "Solicitante", "Destinatario", "Día 1", "Servicio 1", "Día 2", "Servicio 2"]];
    
    trades.slice().reverse().forEach(t => {
        data.push([
            t.id,
            t.timestamp,
            t.type.toUpperCase(),
            t.status.toUpperCase(),
            t.requester,
            t.target,
            t.d1 ? formatDK(t.d1) : "-",
            t.s1 || "-",
            t.d2 ? formatDK(t.d2) : "-",
            t.s2 || "-"
        ]);
    });
    
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Log Mercadillo");
    XLSX.writeFile(wb, `Log_Mercadillo_${fromVal}_a_${toVal}.xlsx`);
}

