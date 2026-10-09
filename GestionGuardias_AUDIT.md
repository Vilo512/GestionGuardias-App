# GestionGuardias App — Auditoría de Implementación
**Versión PRD auditada:** 1.6  
**Codebase auditado:** `app.js` (~7 250 líneas), vanilla JS sin build step + Supabase  
**Fecha de última revisión:** 8 de octubre de 2026  
**Estado general:** **MVP cerrado** — N5 se entregó el 15-jul (`0fe4110`) y con él caen los cinco ítems N1-N5. Dos divergencias nuevas abiertas (W12, W13), ambas de permisos, detectadas al redactar el PRD v1.6. Tres ítems en ruta futura post-MVP: W4-B, N6 y N7.

> **Nota de vocabulario (oct-2026).** Hasta esta revisión la cabecera describía el codebase como «monolítico». Era una **descripción**, pero acabó leyéndose como norma y durante meses bloqueó incluso mencionar el reparto del archivo. No lo es: repartir `app.js` en varios `<script>` clásicos no contradice el «sin build step», que sí fue decisión consciente. Ver `GestionGuardias_DECISIONES.md` §2.

> **Atención — los R1 de MFyC usan la app desde el 8-oct, sobre `main`.** Producción sigue en el 15 de julio y no tiene nada de lo auditado aquí desde entonces. Ver `GestionGuardias_HANDOVER_2026-10-08.md` §2.

---

## Cómo usar este documento

Este archivo es la **memoria de trabajo persistente** del Engineering Lead entre sesiones.

- Al iniciar cada sesión: leer el ítem a trabajar y su bloque de contexto completo
- Al terminar cada sesión: rellenar el bloque `### Resultado` del ítem trabajado y cambiar su `Estado`
- El estado de cada ítem sigue el ciclo: `pendiente → en progreso → resuelto`
- Los ítems están ordenados por **dependencia lógica**. Respetar el orden.

---

## Índice de ítems activos

| # | Tipo | Sección PRD | Descripción | Estado |
|---|---|---|---|---|
| W1 | ⚠️ Diverge | §3.2 | Roles binarios en vez de ternarios | `resuelto` |
| W2 | ⚠️ Diverge | §3.3 | Toggle modo residente impersona a otro usuario | `resuelto` |
| W3 | ⚠️ Diverge | §8.3 | Duración ventana voluntaria hardcodeada a 48h | `resuelto` |
| W4 | ⚠️ Diverge | §9.2 | Nuevo residente entra al último grupo, no al más pequeño | `resuelto` |
| W4-B | 🔮 Futuro | §9.6 | Identidad de grupo con memoria de slots inter-plan | `pendiente` |
| W5 | ⚠️ Diverge | §14 / §13.1 | Recuento de horas sin selector de mes ni visibilidad admin | `resuelto` |
| W6 | ⚠️ Diverge | §13.1 | Vista de Rotación con navegador de mes propio, desacoplado de `curDate` | `resuelto` |
| W7 | ⚠️ Diverge | §8 | Reset de mes no limpia `subastasCerradasForzosas` — impide re-forzar subasta | `resuelto` |
| W8 | ⚠️ Diverge | §8.3 | Calendario bloqueado durante ventana voluntaria — `isMyTurn` impide auto-asignación libre | `resuelto` |
| W9 | ⚠️ Diverge | §8 | Panel de turno muestra "Turno de Nadie" en meses pasados para admin/delegado | `resuelto` |
| W10 | ⚠️ Diverge | §8 / §9 | Subasta no aislada por plan — mezcla residentes, huecos y caché entre R1/R2/R3 | `resuelto` |
| W11 | ⚠️ Diverge | §8 | `_getAnalisisFestivosImpl` usaba `getComputedShifts` para contar huecos cubiertos — inconsistente con `state.shifts` en `renderAlertaCargaMensual` y `ejecutarAsignacionForzosa`; mes atascado con "0 guardias" | `resuelto` |
| W12 | ⚠️ Diverge | §3.2 / §3.4 | **No existe ámbito por plan.** `perfiles.rol` es global a la especialidad y ninguna de las 88 comprobaciones de rol es consciente del plan. Detalle en PRD §3.5 (a, b, c, e) | `pendiente` |
| W13 | ⚠️ Diverge | §3.3 | **D-06 ampliado:** el panel de Cuentas escribe en modo simulación, y la pestaña de Admin no se oculta al simular. No es solo el mercadillo | `pendiente` |
| N1 | ✅ Hecho | §12 | Sistema de notificaciones in-app completo | `resuelto` |
| N2 | ✅ Hecho | §15 / §8.4 | Registro persistente de huecos sin candidato válido | `resuelto` |
| N3 | ✅ Hecho | §5.1 | Calendario automático de huecos desde patrón configurable | `resuelto` |
| N4 | ✅ Hecho | §4 / D-02 | Importación de festivos desde fuente oficial | `resuelto` |
| N5 | ✅ Hecho | §8.5 / §8.6 | Propuesta de asignación automática (revisión admin antes de ejecutar) + Forzamiento de turno por inactividad | `resuelto` |
| N6 | 🔮 Futuro | §8.5 (ext.) | Asignación automática con vacaciones: modelo de vacaciones día-a-día + informe de viabilidad + optimizador con backtracking | `pendiente` |
| N7 | 🔮 Futuro | §9.5 / §13.3 | Graduación real al agotar los planes: quitar el clamp, graduación con fecha, bloqueos y aceptación | `pendiente` |

---

## Ruta crítica recomendada

> ⚠️ **Histórica — cerrada.** Lo que sigue es el plan del MVP, y todos sus ítems están resueltos. Se conserva porque documenta por qué se atacaron en ese orden, no porque quede nada que hacer en él.
>
> **La hoja de ruta viva está en otro sitio:** la cola ordenada en `GestionGuardias_BACKLOG.md` y el arranque en `GestionGuardias_HANDOVER_2026-10-08.md` §6. Lo pendiente hoy, resumido: W12 y W13 (permisos), el Paso 6 del rediseño (seis vistas), el Paso 7 (PWA), el despliegue a producción, y los tres post-MVP W4-B / N6 / N7.
>
> **Dependencia que conviene recordar:** la sucesión forzosa del Dueño al graduarse (backlog P-04) necesita **N7 — graduación real al agotar los planes**, que sigue pendiente. Hoy no existe el evento de graduación al que engancharse.

```
W1 (roles ternarios)
  └──→ habilita separar permisos admin / delegado en §15
  └──→ W3 depende de W1 (solo admin debería poder configurar la ventana)

N1 (notificaciones in-app)
  └──→ desbloquea §8.1 (aviso de turno activo)
  └──→ desbloquea §8.4 (aviso de guardia forzada)
  └──→ desbloquea §11 (loop completo del mercadillo)

N2 (registro sin candidato)
  └──→ necesita N1 para notificar a admin/delegados cuando ocurre

Independientes (cualquier orden tras los anteriores):
  W2, W4, W5, N3, N4
```

**Orden de ataque sugerido:**
`W1 → W3 → N1 → N2 → W2 → W4 → W5 → N3 → N4`

---

## Ítems ⚠️ — Divergencias activas

> **W12 y W13 no tienen bloque propio aquí, a propósito.** Su detalle —ocho divergencias con `file:line`— vive en **PRD §3.5**, y su posición en la cola en `GestionGuardias_BACKLOG.md` (P-02, P-05). Duplicarlo aquí garantizaría que las dos copias divergieran. Los bloques W1-W11 de abajo son históricos: todos resueltos.

---

### W1 — Roles binarios en vez de ternarios
**Sección PRD:** §3.2 / §15  
**Impacto:** Alto — bloquea permisos diferenciados admin/delegado  
**Archivos:** `app.js` líneas 407, 2806  
**Estado:** `pendiente`

**Diagnóstico:**
El PRD define tres roles acumulativos: Residente / Delegado / Admin. El código es binario: `isAdmin = (currentUserProfile.rol === 'admin')`. "Dueño" y "Delegado" comparten `rol = 'admin'` e `isAdmin = true`. Un delegado accede a todas las acciones exclusivas del Admin (configurar estructura, gestionar roles, redistribuir grupos) sin ninguna restricción en código.

```js
// línea 407
isAdmin = (currentUserProfile.rol === 'admin');
// línea 2806 — solo cosmético, no limita permisos
rolBadge = (promo.creador_id === u.id) ? '👑 Dueño' : '⭐ Delegado';
```

**Acción requerida:**
- Añadir valor `'delegado'` al enum de roles en Supabase
- Crear variable `isDelegado` además de `isAdmin`
- Auditar todas las vistas y funciones de §15 aplicando el guard correcto:
  - **Admin y delegado:** supervisar turnos, gestionar incidencias, registrar bajas, gestionar incorporaciones, consultar histórico
  - **Solo admin:** configurar estructura, gestionar roles, redistribuir grupos, toggle simulación, configurar ventana voluntaria y criterios de forzamiento

**Dependencias previas:** Ninguna  
**Dependencias posteriores:** W3 (la ventana configurable debería ser solo-admin)

### Resultado
**Estado final:** `resuelto`  
**Decisiones tomadas:**
- `rol = 'admin'` → solo el Dueño del contenedor. `isAdmin = true`, `isDelegado = true`.
- `rol = 'delegado'` → Delegados designados por el Dueño. `isAdmin = false`, `isDelegado = true`.
- `rol = 'residente'` → Residentes. Ambas variables `false`.
- Sub-pestañas solo-admin (`calendario`, `ajustes`, `seguridad`) ocultas para delegados en `navAdmin`.
- Botón impersonar visible solo para `isAdmin` (W2 lo refactorizará en profundidad).
- Herramientas de redistribución de grupos en vista de rotación (`admin-rot-tools`) permanecen con guard `isAdmin`.

**Efectos secundarios detectados:**
- `adminTraspasarCorona` ahora escribe `rol = 'delegado'` para el ex-dueño (antes escribía `'admin'`).
- Sucesión automática al salir busca delegados por `rol === 'delegado'` (antes por `rol === 'admin'`).
- `impersonateUser` resetea también `isDelegado = false`.

**Archivos modificados:** `app.js` (19 cambios). Supabase: constraint `perfiles_rol_check` ampliado con `'delegado'`.

---

### W2 — Toggle modo residente impersona a otro usuario
**Sección PRD:** §3.3  
**Impacto:** Medio — el admin puede operar accidentalmente como otro residente  
**Archivos:** `app.js` línea 487  
**Estado:** `resuelto`

**Diagnóstico:**
PRD: toggle puramente visual que muestra al admin cómo ve la app un residente sin privilegios, sin modificar permisos ni datos.

Código: `impersonateUser(user)` recibe un nombre de otro residente, cambia `loggedInUser` a esa persona y pone `isAdmin = false`. El admin queda operando como esa persona. Si realiza asignaciones en ese estado, afecta datos reales bajo el nombre del residente impersonado.

```js
// línea 487
function impersonateUser(user) { loggedInUser = user; isAdmin = false; nav('cal'); }
```

**Acción requerida:**
- Separar el concepto de "usuario de sesión real" del "usuario de vista simulada"
- El toggle debe cambiar únicamente el renderizado (ocultar controles admin) sin alterar `loggedInUser`
- Añadir banner visible permanente "MODO SIMULACIÓN ACTIVO" mientras esté activo
- Bloquear cualquier acción de escritura mientras el modo simulación está activo

**Dependencias previas:** W1 (para que el guard de admin esté bien definido antes de tocar `isAdmin`)  
**Dependencias posteriores:** Ninguna

### Resultado
**Estado final:** `resuelto`  
**Decisiones tomadas:**
- Se introduce `simulatedViewUser` (null por defecto). `loggedInUser`, `isAdmin` e `isDelegado` nunca se modifican durante la simulación.
- `impersonateUser` ahora es un wrapper que llama a `activateSimulationMode(nombre)`. No altera estado de sesión.
- `activateSimulationMode(nombre)` establece `simulatedViewUser`, muestra el banner sticky y navega al calendario. `exitSimulationMode()` lo limpia.
- "Otorgar turno" y "Visualizar como" se fusionan en un único widget `.admin-action-toolbar` dentro del banner del calendario admin: selector de acción en cascada + selector de residente + botón confirmar. Reduce el espacio visual en móvil frente a dos filas independientes.
- Banner sticky `#simulation-banner` (fondo morado, z-index 90) permanece visible mientras la simulación está activa. La variable CSS `--header-h` se actualiza con `offsetHeight` del header real para que el banner no tape contenido.
- **Write guards** (`if (simulatedViewUser !== null) { alert(...); return; }`) añadidos en: `toggleShift`, `adminForceAssign`, `adminForceRemove`, `userSkipTurn`, `adminSkipTurn`, `adminGrantTurn`, `onAdminActionConfirm` (rama `grant`).
- `openShiftModal` introduce `viewUser = simulatedViewUser ?? loggedInUser`. Todas las comparaciones de "mine", turno activo, pendencias y progreso usan `viewUser`. La rama admin (`isDelegado`) solo se renderiza cuando `simulatedViewUser === null`; en simulación el admin ve la interfaz del residente. Los botones de escritura tienen `disabled` en modo simulación.
- Los filtros "solo mis guardias" de `renderMainCalendar` (dos instancias) usan `simulatedViewUser ?? loggedInUser`.
- **Soft-lock en `adminForceAssign`**: antes de asignar, clona `state.shifts`, aplica la asignación prospectiva y llama `getIllegalShiftsForUser`. Si hay conflictos de saliente/entrante, muestra `confirm()` con el detalle. El admin puede confirmar de todas formas.

**Efectos secundarios detectados:**
- El Testing Lead detectó que `onAdminActionConfirm` (rama `grant`) y `adminGrantTurn` carecían inicialmente de write guard. Ambos corregidos en la misma sesión.
- `updateShiftMode` permanece sin guard directo (riesgo bajo aceptado): la ruta desde `openShiftModal` está bloqueada por `disabled` en el select del branch residente y por el guard de branch `isDelegado && simulatedViewUser === null`.
- La nota en el Resultado de W1 (`impersonateUser resetea isDelegado = false`) queda obsoleta: `impersonateUser` ya no toca ninguna variable de sesión.

**Archivos modificados:** `app.js` (~20 cambios), `index.html` (banner `#simulation-banner`), `style.css` (`.simulation-banner` + `.admin-action-toolbar` y sub-clases BEM).

---

### W3 — Duración de ventana voluntaria hardcodeada a 48h
**Sección PRD:** §8.3  
**Impacto:** Bajo — comportamiento correcto pero no configurable  
**Archivos:** `app.js` líneas 3760, 3764  
**Estado:** `resuelto`

**Diagnóstico:**
PRD: "Duración configurable por el admin (entre 24 y 48 horas)." Código: siempre 48h. El campo `ventana_voluntaria_horas` del modelo `Contenedor` no existe en la configuración actual.

```js
// línea 3760
if (horasTranscurridas >= 48 || isForzada) { estado = 'subasta_cerrada'; }
// línea 3764
const horasRestantes = Math.max(0, 48 - horasTranscurridas);
```

**Acción requerida:**
- Añadir campo `ventana_voluntaria_horas` (número, entre 24 y 48) al config del contenedor en Supabase
- Añadir control de configuración en el panel admin (exclusivo admin, ver W1)
- Sustituir el literal `48` por lectura del campo en las líneas afectadas
- Valor por defecto: 48h si el campo no está definido (compatibilidad con contenedores existentes)

**Dependencias previas:** W1 (la configuración de la ventana debe ser acción exclusiva de admin)  
**Dependencias posteriores:** Ninguna

### Resultado
**Estado final:** `resuelto`  
**Decisiones tomadas:**
- `ventana_voluntaria_horas` vive dentro del JSON `configuracion` de la tabla `promociones` — no requiere columna nueva en Supabase. Se persiste con el `update({ configuracion: promoConfig })` ya existente en `adminSaveConfig`.
- `normalizeConfig` aplica el valor por defecto 48 si el campo está ausente, fuera de rango o es inválido. Compatible con todos los contenedores existentes.
- Los dos literales `48` hardcodeados reemplazados por `ventanaHoras = promoConfig.ventana_voluntaria_horas || 48` (doble fallback por defensa en profundidad).
- `syncConfigFromUI` lee el input con clamp `Math.min(48, Math.max(24, v))` antes de guardar; NaN se resuelve con `|| 48`.
- UI: tarjeta "⚙️ Configuración General" con input numérico (24–48) añadida al inicio de `renderAdminAjustes`, que ya está gateada por `isAdmin` en `navAdmin()`.

**Efectos secundarios detectados:** Ninguno. Testing Lead validó 7 puntos sin bugs ni riesgos.

**Archivos modificados:** `app.js` (4 cambios: `normalizeConfig`, `syncConfigFromUI`, `getAnalisisFestivos` ×2, `renderAdminAjustes`).

---

### W4 — Nuevo residente entra al último grupo, no al de menor número de miembros
**Sección PRD:** §9.2  
**Impacto:** Medio — afecta la equidad de la rotación al incorporar residentes  
**Archivos:** `app.js` líneas 2951–2953  
**Estado:** `resuelto`

**Diagnóstico:**
PRD: "Entran por la parte inferior del grupo con menor número de miembros." Código: `filaIndia.push(userName)` añade al final del array flat y `reempaquetarGruposPlan` lo sitúa en el último grupo, que tras el empaquetado puede no ser el más pequeño si los grupos tienen tamaños desiguales.

```js
// líneas 2951-2953 (antes)
let filaIndia = (pr.baseGroups || []).flat();
filaIndia.push(userName);  // siempre al final del array flat
pr.baseGroups = reempaquetarGruposPlan(filaIndia, pr);
```

**Dependencias previas:** Ninguna  
**Dependencias posteriores:** W4-B (sistema de slots, construye sobre esta base)

### Resultado
**Estado final:** `resuelto`  
**Decisiones tomadas:**
- Se identifica el grupo con menor número de miembros en `pr.baseGroups` y se añade el nuevo residente directamente al final de ese grupo, sin aplanar ni redistribuir.
- En caso de empate de tamaño, se usa el último grupo empatado (más cercano al comportamiento anterior).
- `reempaquetarGruposPlan` solo se invoca si algún grupo supera 4 miembros tras la inserción. Esto preserva los órdenes manuales del admin.
- Se maneja el caso inicial vacío (`baseGroups: []` o `[[]]`) creando el primer grupo directamente.
- La distribución `[3,3,3,4,4]` pasa a ser sugerencia, no requisito rígido (ver PRD v0.9 §9.1).

**Efectos secundarios detectados:** Ninguno relevante. El reempaquetado al superar máximo sigue comportándose igual que antes.

**Archivos modificados:** `app.js` (~6 líneas en `adminAprobarUsuario`).

---

### W6 — Vista de Rotación con navegador de mes propio
**Sección PRD:** §13.1  
**Impacto:** Bajo — UX inconsistente; el usuario debía navegar con dos selectores independientes  
**Archivos:** `app.js` líneas 91, 3170–3175, 3179–3208  
**Estado:** `resuelto`

**Diagnóstico:**
PRD §13.1: "El mes activo está controlado por una única variable global. Ninguna vista mantiene su propio estado de mes independiente."

Código: la vista de Rotación declaraba `rotDate` (variable propia) y `changeRotMonth` (función de navegación propia). Esto generaba dos navegadores ◀/▶ visibles simultáneamente: uno en el header global y otro embebido dentro de la vista de Rotación. Ambos podían apuntar a meses distintos sin sincronización garantizada.

```js
// línea 91 — estado de mes duplicado
let rotDate = new Date(curDate.getFullYear(), curDate.getMonth(), 1);

// líneas 3170-3175 — navegación paralela
function changeRotMonth(delta) {
    let y = rotDate.getFullYear(), m = rotDate.getMonth() + delta;
    if (m > 11) { m = 0; y++; } else if (m < 0) { m = 11; y--; }
    rotDate = new Date(y, m, 1);
    editingGroups = null;
    renderRotationView();
}
```

**Acción requerida:**
- Eliminar `rotDate` y `changeRotMonth`
- Sustituir todos los usos de `rotDate` por `curDate`
- Eliminar el bloque `monthNavHtml` de `renderRotationView`
- Verificar que `editingGroups = null` sigue ejecutándose al navegar (ya ocurre en `changeMonth`)

**Dependencias previas:** Ninguna  
**Dependencias posteriores:** Ninguna

### Resultado
**Estado final:** `resuelto`  
**Decisiones tomadas:**
- `rotDate` y `changeRotMonth` eliminados completamente (-35 líneas).
- Todos los usos de `rotDate` sustituidos por `curDate` mediante replace global (12 ocurrencias en `renderRotationView`, `toggleResidenteFijo`, `moveResToPrevGroup`, `saveCustomMonth`, `saveAsNewBase`, `clearCustomMonth`).
- El bloque `monthNavHtml` con los botones ← → eliminado de `renderRotationView`.
- `editingGroups = null` ya se ejecuta en `changeMonth` (línea 1429) al navegar con los botones principales.
- PRD actualizado a v1.0 con la aclaración de fuente única de verdad en §13.1.

**Efectos secundarios detectados:** Ninguno.

**Archivos modificados:** `app.js` (15 inserciones, 35 eliminaciones).

---

### W4-B — Identidad de grupo con memoria de slots inter-plan
**Sección PRD:** §9.6  
**Impacto:** Alto — equidad a largo plazo en la rotación, especialmente con acabalgos y cambios de plan  
**Archivos:** `app.js` — requiere cambios en modelo de datos de `state.planRotations`  
**Estado:** `pendiente`

**Diagnóstico:**
El modelo actual de grupos (`baseGroups: string[][]`) es una lista plana sin memoria. No distingue entre un slot vacante temporal y uno permanente, no preserva la identidad de grupo al cambiar de plan, y no tiene política para residentes con contratos acabalgados.

**Acción requerida:**
- Rediseñar `baseGroups` como array de slots: `{ titular_actual, titular_original, meses_ocupacion, estado }`
- Al transitar de plan (R1→R2), traspasar la estructura de grupos del plan anterior al nuevo en lugar de crear desde cero
- Implementar slots `abierto` para acabalgos: no cuentan en rotación pero mantienen posición reservada
- Política de prioridad: si el titular original regresa y su slot está ocupado, comparar meses de ocupación para decidir quién se queda
- Migración de datos: convertir `baseGroups: string[][]` existentes al nuevo formato de slots
- Aviso al admin cuando el reempaquetado afecte grupos, mostrando quién cambia de grupo

**Dependencias previas:** W4 (base correcta de inserción en grupo mínimo)  
**Dependencias posteriores:** Ninguna

### Resultado
**Estado final:** `pendiente`  
**Decisiones tomadas:** —  
**Efectos secundarios detectados:** —  
**Archivos modificados:** —

---

### W5 — Recuento de horas sin selector de mes ni visibilidad desde admin
**Sección PRD:** §14 / §13.1  
**Impacto:** Medio — §14 incompleto funcionalmente  
**Archivos:** `app.js` líneas 4026–4043 (`renderPerfilUsuario`)  
**Estado:** `pendiente`

**Diagnóstico:**
PRD §14: horas acumuladas por mes y por año, selector de mes presente, visible para residente, delegados y admin.

Código: las horas se muestran solo en el perfil del propio usuario como total histórico acumulado sin desglose mensual/anual. No hay selector de mes. El admin/delegado no puede consultar las horas de otro residente.

```js
// líneas 4026-4043 — suma ALL-TIME sin filtro de mes
for (let dk in state.shifts || {}) {
    if (state.shifts[dk][uProfile.nombre_mostrar]) {
        totalHorasAcumuladas += getShiftHours(...);
    }
}
```

**Acción requerida:**
- Añadir selector de mes a la vista de recuento de horas
- Añadir desglose: horas del mes seleccionado + acumulado anual
- Añadir vista en el panel admin/delegado con la tabla de horas de todos los residentes del contenedor, filtrable por mes

**Dependencias previas:** Ninguna  
**Dependencias posteriores:** Ninguna

### Resultado
**Estado final:** `resuelto`  
**Decisiones tomadas:**
- `calcHorasResidente(nombre, filtroY, filtroM)` centraliza el cálculo: horas del mes, del año y el histórico total, más conteo de guardias completas y medias guardias del mes.
- Dos vars de módulo (`perfilHorasFiltroY`, `perfilHorasFiltroM`) persisten el filtro seleccionado entre re-renders del perfil.
- `renderPerfilUsuario` sustituye el bloque all-time por los resultados de `calcHorasResidente`; las tarjetas HORAS / GUARDIAS COMPLETAS / MEDIAS GUARDIAS reflejan el mes filtrado; el total anual y el histórico se muestran como estadísticas secundarias.
- Nueva función `renderAdminHoras()`: tabla ordenada por horas del mes de todos los residentes aprobados, con columnas: horas del mes, guardias del mes (completas/medias), horas del año, total histórico.
- Nueva pestaña "Horas ⏱️" (`atab-horas` / `aview-horas`) visible para admin y delegado, reutiliza los botones ◀/▶ del calendario mediante el div `admin-nav-header` extraído del bloque `admin-cal-views`.
- `navAdmin` controla visibilidad de `admin-nav-header` (visible en `calendario` y `horas`).
- `renderAll` añade rama `horas` en el bloque `isDelegado`.
- **Feature adicional (multihueco chivato):** En `renderMainCalendar`, los días con servicios de `pd > 1` muestran un badge `filled/pd` por servicio, posicionado `position:absolute; bottom:2px; right:2px` con `background:rgba(255,255,255,0.7)` y texto en el color del servicio — idéntico al patrón del calendario de admin. Múltiples servicios se apilan en `flex-column`. El pintado de fondo completo de celda sigue delegado a `getCellBackgroundStyle` (sin cambios).

**Efectos secundarios detectados:** Ninguno. Testing Lead validó sin bugs; falsos positivos documentados (Bug 5 sobre `isDelegado`, Bug 9 sobre `totalHorasAcumuladas`).

**Archivos modificados:** `app.js` (~80 líneas nuevas/modificadas: `calcHorasResidente`, `setPerfilHorasFiltro`, `renderAdminHoras`, `navAdmin`, `renderAll`, `renderMainCalendar`). `index.html` (`atab-horas`, `aview-horas`, `admin-nav-header` extraído).

---

### W7 — Reset de mes no limpia el estado de subasta forzada
**Sección PRD:** §8 (invariante de reset)  
**Impacto:** Medio — impide re-ejecutar el flujo completo de subasta tras un reset, bloqueando el uso de debug y emergencias  
**Archivos:** `app.js` línea 2832 (`adminResetMonth`), línea 3670 (`subastasCerradasForzosas`)  
**Estado:** `pendiente`

**Diagnóstico:**
`adminResetMonth` limpia `state.shifts[dk]`, `state.skippedTurns[monthKey]`, `state.pendingExceptions[monthKey]` y `state.configMes[monthKey]`, pero no toca `state.subastasCerradasForzosas`. Tras el reset, `getAnalisisFestivos` sigue encontrando la clave `${y}_${m}_${svcNombre}` como `true` y devuelve `estado: 'subasta_cerrada'` — el botón de forzar subasta no reaparece.

```js
// línea 2832 — falta borrar subastasCerradasForzosas
async function adminResetMonth(y, m) {
    // ...borra shifts, skippedTurns, pendingExceptions, configMes...
    // ❌ NO borra subastasCerradasForzosas[y_m_*]
    await saveState(); renderAll();
}
// línea 3920 — la marca persiste y bloquea el reintento
const isForzada = state.subastasCerradasForzosas?.[`${y}_${m}_${svc.nombre}`];
```

**Acción requerida:**
- En `adminResetMonth`, añadir limpieza de todas las claves de `state.subastasCerradasForzosas` que comiencen por `${y}_${m}_`
- Una línea quirúrgica: `if (state.subastasCerradasForzosas) { Object.keys(state.subastasCerradasForzosas).forEach(k => { if (k.startsWith(\`${y}_${m}_\`)) delete state.subastasCerradasForzosas[k]; }); }`

**Dependencias previas:** Ninguna  
**Dependencias posteriores:** N5 (el override "Activar subasta ya" también necesita este fix para poder re-ejecutarse tras un reset)

### Resultado
**Estado final:** `resuelto` — PR #6 mergeado  
**Decisiones tomadas:**
- `adminResetMonth` limpia `subastasCerradasForzosas` y `subastaNominados` del mes
- `adminVaciarGeneracion` limpia ambas colecciones al vaciar generación
- Subasta aparece correctamente cuando todos saltan sin asignar (`allSkipped`)
- Banner no persiste tras reset (`container.innerHTML = ''` siempre al inicio)
- `ejecutarAsignacionForzosa` cubre todos los huecos en una pasada; pool expandido al resto de residentes para días multihueco; rastrea nominados salvados por restricción de descanso
- `subastaNominados` cacheado en Supabase con clave `y_m_svc_criterio_desempate`; sorteo aleatorio ocurre una sola vez para todos los usuarios; selección por tramos garantiza que nunca se mezcla residentes de distinto nivel histórico
- `getHistoricoFestivosResidentes` añade flag `includeCurrentMonth=true` para criterios `historico_servicio` e `historico_servicio_dinamico`
- `huecosCount` y `excesoSvc` usan `getPlazasForDay` respetando habilitaciones en multihueco

**Efectos secundarios detectados:** Usuarios deben hacer Ctrl+Shift+R + Reset Mes si el cache de nominados fue computado con JS antiguo  
**Archivos modificados:** `app.js`

---

### W8 — Calendario bloqueado durante la ventana voluntaria
**Sección PRD:** §8.3  
**Impacto:** Alto — durante la ventana voluntaria ningún residente puede auto-asignarse, anulando el propósito de la fase  
**Archivos:** `app.js` — `openShiftModal` / `toggleShift` (guard de `isMyTurn`), `renderAlertaCargaMensual` (estado `subasta_abierta`)  
**Estado:** `pendiente`

**Diagnóstico:**
PRD §8.3: "Cualquier residente puede reclamar esos huecos libremente, sin restricción de orden."

Cuando `getAnalisisFestivos` devuelve `estado: 'subasta_abierta'`, `getCurrentTurn` ya devolvió `null` (todos terminaron su ronda). El modal de asignación evalúa `isMyTurn = (turnUser === viewUser)`, que es `false` para todos los residentes porque `turnUser === null`. El calendario queda efectivamente bloqueado para auto-asignación aunque la ventana esté abierta.

**Acción requerida:**
- En `openShiftModal` (y en `toggleShift` si tiene guard propio), introducir una condición que exima el check de `isMyTurn` cuando `getAnalisisFestivos(y, m).estado === 'subasta_abierta'`
- Durante `subasta_abierta`, cualquier residente puede asignarse en los huecos del servicio en subasta, respetando únicamente la restricción de saliente/entrante
- Los huecos de servicios que NO están en subasta no deben verse afectados por este cambio

**Dependencias previas:** Ninguna  
**Dependencias posteriores:** N5 (el override de emergencia sería menos necesario si W8 permite la auto-asignación libre)

### Resultado
**Estado final:** `resuelto`  
**Decisiones tomadas:**
- `getAnalisisFestivos(y, m)` se calcula una vez al inicio de `openShiftModal` (`_analisisModal`).
- La guarda `!isMyTurn && !isMine` añade una tercera condición: se salta cuando `isSubastaAbierta && svc.nombre === _analisisModal.svcNombre`.
- Solo el servicio en subasta queda desbloqueado; el resto de servicios sigue requiriendo turno.
- `toggleShift` no necesita cambios: no tiene guard de turno propio; el botón ya estaba deshabilitado en `openShiftModal`.
- Restricciones que siguen activas durante subasta: saliente/entrante (`isIllegal`), día ocupado (`isUserBusyOnDay`), habilitación manual (`requiereHabilitacion`) y capacidad del slot (`pd`).

**Efectos secundarios detectados:** Ninguno.  
**Archivos modificados:** `app.js` (3 líneas en `openShiftModal`).

---

### W9 — Panel de turno muestra "Turno de Nadie" en meses pasados
**Sección PRD:** §8  
**Impacto:** Bajo — ruido visual y confusión para admin/delegado al revisar meses anteriores  
**Archivos:** `app.js` líneas 1548–1584 (`renderAlertaCargaMensual`, branch `isDelegado`)  
**Estado:** `resuelto`

**Diagnóstico:**
PRD §8: "El indicador de turno activo solo debe mostrarse para el mes activo o meses futuros."

En el branch `isDelegado && simulatedViewUser === null` (línea 1559), el banner se renderiza siempre independientemente del mes. Cuando `getCurrentTurn(y, m)` devuelve `null` en un mes ya finalizado, la plantilla interpolada produce `Turno de: <b>Nadie</b>`, lo que no tiene significado operativo en un mes pasado.

Además, los banners de estado de subasta con contexto de plan (`subasta_abierta`, `subasta_cerrada`, completado) que existían en el bloque `else { // turnUser === null }` (líneas 1630/1645/1662) eran **código muerto** para el admin directo: el bloque `if (isDelegado && simulatedViewUser === null)` en línea 1559 siempre se ejecuta primero, impidiendo que el flujo llegue al `else`.

**Acción requerida:**
- Dentro del branch admin, cuando `turnUser === null`, calcular `getAnalisisFestivos(y, m)` y mostrar el estado real: subasta_abierta / subasta_cerrada / completado
- Recuperar el botón "⚡ Forzosa" (antes en código muerto) y mostrarlo en el panel admin cuando `af.estado === 'subasta_cerrada'`

**Dependencias previas:** Ninguna  
**Dependencias posteriores:** Ninguna

### Resultado
**Estado final:** `resuelto`  
**Decisiones tomadas:** En lugar de comprobar si el mes es pasado (acción descartada — innecesaria: el estado real ya comunica lo correcto), se reemplazó la interpolación `turnUser || 'Nadie'` con un bloque condicional que computa `getAnalisisFestivos` cuando `turnUser === null` y muestra el label apropiado según el estado de la subasta. El botón "Asignación Forzosa" (antes en código muerto) se rescató e integrado en el panel admin.  
**Efectos secundarios detectados:** Ninguno.  
**Archivos modificados:** `app.js` (~15 líneas en `renderMainCalendar`, branch `isDelegado && simulatedViewUser === null`, líneas 1563–1583).

---

### W10 — Subasta no aislada por plan
**Sección PRD:** §8 / §9  
**Impacto:** Alto — la subasta mostraba huecos incorrectos, nominados del plan equivocado e historial contaminado entre planes  
**Archivos:** `app.js` — `getAnalisisFestivos` / `_getAnalisisFestivosImpl`, `renderAlertaCargaMensual`, `ejecutarAsignacionForzosa`, `forzarCierreSubasta`  
**Estado:** `resuelto`

**Diagnóstico:**
Después de C22 (lookup canónico de config de servicio por plan), `getAnalisisFestivos` seguía usando el plan personal del usuario visualizando la app para cuatro decisiones clave:

1. **`rondaTerminada`** — si el admin era R1 leía la rotación R1 aunque la ronda que terminó fuera R2; cada plan disparaba (o no) la subasta en función del plan del admin en sesión
2. **Candidatos** (`residentes`) — se mezclaban residentes de todos los planes en la lista de nominados
3. **Huecos sin cubrir** (`huecosAsignadosSvc`) — contabilizaba guardias de R1 cuando la subasta correspondía a R2, produciendo un recuento incorrecto (p. ej. 19 huecos en lugar de 13)
4. **Claves de caché** (`nominadosKey`, `fechaFinRonda`, `subastasCerradasForzosas`) — sin `planNombre` en la clave, un cierre forzado de la subasta R1 bloqueaba también la subasta R2

Síntomas adicionales detectados:
- `criterioTexto` mostraba "undefined": se usaba `analisis.servicio` (campo inexistente) en lugar de `analisis.svcNombre`
- El criterio `historico_servicio_dinamico` no tenía case en el bloque de texto del criterio
- Stack overflow (`Maximum call stack size exceeded`): `getAnalisisFestivos` llamaba `getUserProgress` que internamente llama `getAnalisisFestivos` — recursión infinita sin guard
- El histórico de guardias solo contaba el mes activo en lugar de acumular desde el inicio del año de residencia

**Dependencias previas:** C22 (lookup canónico de servicio por plan)  
**Dependencias posteriores:** W8 (la auto-asignación libre durante la ventana voluntaria se beneficia del aislamiento correcto por plan)

### Resultado
**Estado final:** `resuelto` — PR #8 mergeado a main  
**Decisiones tomadas:**
- `getAnalisisFestivos` envuelto con guard `_computingAnalisis` para prevenir recursión infinita; la lógica real se extrae a `_getAnalisisFestivosImpl`.
- `rondaTerminada` filtra `ordenSeleccion` únicamente a los residentes del plan propio del usuario (`miPlan = getPlanForUserOnDate(currentUserProfile, referenceDk)`). Cada plan dispara su subasta de forma independiente.
- `residentes` (candidatos) filtrado al plan: solo residentes cuyo `getPlanForUserOnDate` coincide con `miPlan.nombre`.
- `huecosAsignadosSvc` y `huecosCount` en `renderAlertaCargaMensual` solo contabilizan guardias de residentes del mismo plan.
- Claves de caché ampliadas con `planNombre`: `nominadosKey = y_m_plan_svc_criterio`, `subastasCerradasForzosas[y_m_plan_svc]`.
- Nuevos campos en el retorno de `getAnalisisFestivos`: `planNombre`, `servicioCriterio`, `planResidentes`.
- `_getHist` pasa `includeCurrentMonth=true` en todos los criterios: el histórico acumula desde el inicio del año de residencia hasta el mes de la subasta inclusive, no solo el mes activo.
- `criterioTexto` corregido: `analisis.servicio` → `analisis.svcNombre`; añadido case `historico_servicio_dinamico` usando `analisis.servicioCriterio`.
- `ejecutarAsignacionForzosa` usa `analisis.planNombre` para resolver el plan y construye la lista de candidatos exclusivamente con residentes del plan correcto.
- `forzarCierreSubasta` usa clave `y_m_planKey_svc` para no bloquear subastas de otros planes al cerrar la del propio.

**Efectos secundarios detectados:** Los contenedores con un único plan (mayoría de despliegues) no se ven afectados: el filtro por plan devuelve la lista completa de residentes activos, comportamiento idéntico al anterior.

**Archivos modificados:** `app.js` (~80 líneas modificadas/añadidas en `getAnalisisFestivos`, `_getAnalisisFestivosImpl`, `renderAlertaCargaMensual`, `ejecutarAsignacionForzosa`, `forzarCierreSubasta`).

---

### W11 — Subasta atascada: inconsistencia `getComputedShifts` vs `state.shifts` + falta de snapshot
**Sección PRD:** §8  
**Impacto:** Alto — mes bloqueado permanentemente en estado de subasta mostrando "0 guardias a repartir" y "No se han detectado huecos libres" al intentar forzar la asignación  
**Archivos:** `app.js` — `_getAnalisisFestivosImpl`, `adminResetMonth`, `adminVaciarGeneracion`, `resetSubastaEstado`  
**Estado:** `resuelto`

**Diagnóstico:**  
`_getAnalisisFestivosImpl` usaba `getComputedShifts()` (que aplica trades de mercadillo) para contar huecos cubiertos (`huecosAsignadosSvc`), mientras `renderAlertaCargaMensual` y `ejecutarAsignacionForzosa` usaban `state.shifts` directamente. La inconsistencia surgía ante trades de tipo `venta a Externo` o venta cross-plan: `computedShifts` elimina la entrada del vendedor (reemplazándola por VRE o por el comprador de otro plan), haciendo que `_getAnalisisFestivosImpl` detectara `excesoSvc > 0` y disparara la subasta; mientras las funciones de UI y forzado veían `state.shifts` con el slot cubierto → "0 guardias pendientes" y "0 huecos libres".

Problema secundario: `fechaFinRonda[keyMes]` se persistía la primera vez que `rondaTerminada=true`, pero nunca se borraba salvo en `adminResetMonth`. Un mes que entró en subasta por la inconsistencia anterior quedaba atascado permanentemente aunque la causa se corrigiera, porque `_getAnalisisFestivosImpl` seguía re-evaluando y encontrando el `fechaFinRonda` persistido.

**Solución aplicada (dos partes):**

**Parte A — Fuente de datos unificada:** Revertir `_getAnalisisFestivosImpl` a usar `state.shifts` en lugar de `getComputedShifts()`. La subasta opera sobre el calendario de asignación original; el mercadillo actúa a posteriori y no debe afectar la detección de huecos obligatorios. `renderAlertaCargaMensual` y `ejecutarAsignacionForzosa` ya usaban `state.shifts` → ahora las tres funciones son consistentes.

**Parte B — Mecanismo de snapshot (`state.subastaSnapshot[y_m_plan]`):**  
Una vez `rondaTerminada=true`, el resultado de la evaluación completa se persiste en `state.subastaSnapshot[keyMes]` con campos:
- `exceso`, `nominados`, `svcNombre`, `planNombre`, `planResidentes`, `servicioCriterio`, `criterio`, `historico`
- Si ningún servicio tiene huecos → snapshot con `svcNombre: null` (sentinel "libre")

Llamadas posteriores para el mismo mes+plan leen desde el snapshot (sin re-evaluar `rondaTerminada` ni el bucle de servicios). El `estado` (`subasta_abierta` / `subasta_cerrada`) se sigue calculando dinámicamente desde `fechaFinRonda` y `subastasCerradasForzosas`. Una verificación ligera (slot count del servicio snapshoteado) detecta si todos los huecos se cubrieron voluntariamente durante la ventana → transición a `libre` aunque el snapshot diga `exceso > 0`.

**Limpieza del snapshot:** `adminResetMonth` y `adminVaciarGeneracion` borran `subastaSnapshot` y `fechaFinRonda` para el mes reset. La utilidad de consola `resetSubastaEstado(y, m, planNombre?)` también los borra (desatasca meses ya bloqueados sin reset completo).

**Efectos secundarios detectados:** Meses con snapshot ya guardado (anteriores a este fix) pueden tener snapshot nulo/ausente — se evalúan normalmente en la primera llamada y escriben el snapshot en ese momento. Comportamiento transparente para el usuario.

**Archivos modificados:** `app.js` — ~75 líneas añadidas/modificadas en `_getAnalisisFestivosImpl` (snapshot check + write), `adminResetMonth` (2 limpiezas añadidas), `adminVaciarGeneracion` (2 resets añadidos), `resetSubastaEstado` (limpieza de subastaSnapshot + refactor helper interno).

---

## Ítems ❌ — No implementados

---

### N1 — Sistema de notificaciones in-app completo
**Sección PRD:** §12  
**Impacto:** Alto — bloquea el loop de comunicación de §8.1, §8.4 y §11  
**Estado:** `resuelto`

**Diagnóstico:**
Existe un inbox básico de mercadillo en la pestaña "Merc". No existe tabla `Notificaciones` en Supabase, no hay badge de no-leídas, no hay panel propio. Eventos sin cobertura:

| Evento PRD | Estado actual |
|---|---|
| Le toca turno de asignación | Ningún aviso; el residente debe abrir la app y ver el banner |
| Guardia forzada asignada | `alert()` al admin en el momento; el residente afectado no recibe nada |
| Ventana voluntaria abierta | Banner en pestaña cal sin badge persistente |
| Propuesta mercadillo aceptada/rechazada | Solo visible consultando activamente la pestaña merc |
| Hueco obligatorio sin candidato | `alert()` momentáneo al admin; no persiste |

**Acción requerida:**
- Crear tabla `notificaciones` en Supabase: `id`, `usuario_id`, `tipo`, `payload` (JSON), `leida` (bool), `timestamp`
- Crear función `crearNotificacion(usuarioId, tipo, payload)` llamada desde los puntos de disparo
- Añadir badge contador de no-leídas en el header/nav
- Crear panel de notificaciones con lista y acción de marcar como leída
- Suscribir el cliente mediante Supabase Realtime para notificaciones en tiempo real

**Tipos a implementar:**

| Tipo | Disparado desde | Destinatario |
|---|---|---|
| `turno_asignacion` | `getCurrentTurn` al cambiar de turno | Residente en turno |
| `guardia_forzada` | `ejecutarAsignacionForzosa` | Residente afectado |
| `ventana_voluntaria` | `forzarCierreSubasta` al abrir ventana | Todos los residentes del contenedor |
| `mercado_propuesta` | `processTrade` al crear trade pendiente | Residente implicado |
| `mercado_resultado` | `processTrade` al aceptar/rechazar | Residente proponente |
| `hueco_sin_candidato` | `ejecutarAsignacionForzosa` sin candidato | Admin y delegados |

**Dependencias previas:** Ninguna (W1 debe estar resuelto para que `hueco_sin_candidato` llegue a delegados)  
**Dependencias posteriores:** N2

### Resultado
**Estado final:** `resuelto`

**Decisiones tomadas:**
- Tabla `notificaciones` en Supabase: `id uuid PK`, `usuario_id uuid FK→auth.users`, `tipo text CHECK(enum)`, `payload jsonb`, `leida bool DEFAULT false`, `timestamp timestamptz DEFAULT now()`. RLS: SELECT solo propio, INSERT cualquier autenticado (necesario para que un usuario notifique a otro), UPDATE solo propio.
- Índice UNIQUE en `(usuario_id, payload->>'year', payload->>'month') WHERE tipo='turno_asignacion'` para evitar duplicados de turno al recargar.
- **`insertNotificacion(usuarioId, tipo, payload)`** — fire-and-forget; ignora errores de red silenciosamente para no romper el flujo principal. Si el destinatario es el usuario actual, recarga el panel inmediatamente.
- **`loadNotificaciones()`** — cargada al arrancar sesión (en `loadState`); trae las últimas 60 más recientes ordenadas desc.
- **Bell icon** con Tabler Icons (CDN), badge rojo con contador en el header. Solo visible cuando `estado === 'aprobado'`. Controlado en `renderUserHeader()`.
- **Panel flotante** `position:fixed` anclado a `top: var(--header-h)`, cierre al click fuera. Inline "Aceptar/Rechazar" buttons en notificaciones de tipo `propuesta_mercadillo` que llaman a `processTrade` directamente.
- **Click en notificación**: marca leída, cierra panel, navega a la vista correcta cambiando `curDate` si el payload tiene `year/month`.
- **`maybeNotifyTurnChange(y, m)`** — dedup de sesión con `_lastNotifTurnKey`; llamada después de `toggleShift`, `userSkipTurn`, `adminSkipTurn`, `adminGrantTurn`.
- **`_notifyNewTrade(trade)`** — llamada en los tres creadores de trade; solo para trades `pending` a no-Externo.
- **`_notifyTradeResolved(id)`** — llamada en `processTrade` después de `saveState()`; solo notifica al requester si es distinto del usuario actual.
- **`forzarCierreSubasta`** — notifica `ventana_voluntaria` a todos los `planResidentes` del análisis al cerrar la subasta forzosamente.
- **`ejecutarAsignacionForzosa`** — notifica `guardia_forzada` al residente por cada guardia asignada; notifica `hueco_sin_candidato` a todos los admin/delegado cuando `huecosImpossibles.length > 0`.

**Tipos de notificación — colores implementados:**
| Tipo | Icono | Fondo círculo | Color icono |
|---|---|---|---|
| `turno_asignacion` | 🕐 | #B5D4F4 | #0C447C |
| `guardia_forzada` | ⚠️ | #F5C4B3 | #993C1D |
| `ventana_voluntaria` | 📅 | #B5D4F4 | #0C447C |
| `propuesta_mercadillo` | 🔄 | #C0DD97 | #3B6D11 |
| `propuesta_resuelta` | ✅ | #C0DD97 | #3B6D11 |
| `hueco_sin_candidato` | 🚨 | #F7C1C1 | #A32D2D |

**SQL a ejecutar en el dashboard de Supabase (proyecto elmpelhplacgkgfuiwno):**
```sql
CREATE TABLE public.notificaciones (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('turno_asignacion','guardia_forzada','ventana_voluntaria','propuesta_mercadillo','propuesta_resuelta','hueco_sin_candidato')),
    payload JSONB NOT NULL DEFAULT '{}',
    leida BOOLEAN NOT NULL DEFAULT false,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notificaciones_usuario_ts_idx ON public.notificaciones(usuario_id, timestamp DESC);
CREATE UNIQUE INDEX notificaciones_turno_unique ON public.notificaciones(usuario_id, (payload->>'year'), (payload->>'month')) WHERE tipo = 'turno_asignacion';
ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_own" ON public.notificaciones FOR SELECT USING (auth.uid() = usuario_id);
CREATE POLICY "insert_authenticated" ON public.notificaciones FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "update_own" ON public.notificaciones FOR UPDATE USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);
```

**Efectos secundarios detectados:**
- `_notifyNewTrade` es fire-and-forget; si la tabla aún no existe, el error queda silenciado en consola y la operación de trade continúa sin problema.
- `maybeNotifyTurnChange` usa dedup de sesión (`_lastNotifTurnKey`); en la primera carga del mes, dispara siempre para el titular actual — notificaciones de turno duplicadas por sesión son posibles si el mismo usuario recarga con el mismo turno activo, pero el índice UNIQUE de Supabase lo previene a nivel de BD.
- No implementa Supabase Realtime (suscripción push) — recarga manual al navegar/actuar. Extensión futura.

**Archivos modificados:** `app.js` (módulo NOTIFICACIONES ~170 líneas + hooks en 11 funciones existentes), `index.html` (Tabler Icons CDN, bell button, panel div, cache-buster v=1.4), `style.css` (bloque NOTIFICACIONES ~130 líneas).

---

### N2 — Registro persistente de huecos sin candidato válido
**Sección PRD:** §15 / §8.4  
**Impacto:** Medio — la evidencia de exceso de carga asistencial se pierde actualmente  
**Archivos:** `app.js` línea 3601  
**Estado:** `pendiente`

**Diagnóstico:**
Cuando `ejecutarAsignacionForzosa` no encuentra candidato válido, muestra un `alert()` y para. Nada se persiste. La evidencia de exceso de carga asistencial desaparece al cerrar el diálogo.

```js
// línea 3601 — solo alert, nada se guarda
mensajeFinal += `\n\n⚠️ Los nominados no podían cubrir por incompatibilidad con salientes.`;
alert(mensajeFinal);
```

**Acción requerida:**
- Al detectar hueco sin candidato: persistir en `state.exceptionLogs` (o tabla Supabase equivalente) con: hueco afectado, lista de candidatos evaluados y motivo de descarte de cada uno
- Crear vista "Huecos sin candidato" en el panel admin/delegado con selector de mes, mostrando fecha, servicio, motivo y candidatos descartados
- Sustituir el `alert()` por la notificación in-app de tipo `hueco_sin_candidato` (ver N1)

**Dependencias previas:** N1 (para la notificación al admin/delegados)  
**Dependencias posteriores:** Ninguna

### Resultado
**Estado final:** `resuelto` (Julio 2026)  
**Decisiones tomadas:** Persistencia en `state.huecosSinCandidato` (array propio, no exceptionLogs) con: dk, servicio, plan, mes (mk), candidatos evaluados con motivo de descarte ("Ya tiene guardia ese día" / "Descanso: <primer conflicto>"), origen ('forzosa'; N5 podrá registrar como 'propuesta') y timestamp. Cap de 300 entradas. La captura de motivos se hace en el bucle de `ejecutarAsignacionForzosa` vía `registrarHuecoSinCandidato()`. Vista integrada en Admin → Excepciones (panel "🕳️ Huecos sin candidato válido" filtrado por el mes visible, con detalle plegable de candidatos); el navegador de mes se muestra ahora también en la subpestaña Excepciones (§13.1). Borrado de entradas solo admin (`adminBorrarHuecoSinCandidato`, PRD §13.2). La notificación in-app `hueco_sin_candidato` a admin/delegados ya existía desde N1 y se mantiene; el alert() se conserva como feedback inmediato a quien ejecuta, pero la evidencia ya no se pierde.  
**Efectos secundarios detectados:** Ninguno.  
**Archivos modificados:** `app.js` (registrarHuecoSinCandidato, captura de motivos en ejecutarAsignacionForzosa, panel en renderAdminExceptions, adminBorrarHuecoSinCandidato, navAdmin), `index.html` (cache-buster v=2.6)

---

### N3 — Calendario automático de huecos desde patrón configurable
**Sección PRD:** §5.1  
**Impacto:** Bajo — solo eficiencia del admin; la habilitación manual funciona  
**Archivos:** `app.js` función `normalizeConfig` línea ~211  
**Estado:** `pendiente`

**Diagnóstico:**
Los campos `modo_calendario` y `patron_automatico` existen en el modelo de servicio pero ninguna función los procesa ni genera entradas en `state.habilitaciones`. Todo es manual actualmente.

**Acción requerida:**
- Definir el esquema de `patron_automatico`: array de días de la semana por semana del mes, con soporte para rotación entre semanas (ej. `[['L','X','V'], ['M','J']]` alternando semana A/B)
- Crear función `generarHuecosDesdePatron(servicio, mes, año)` que lea el patrón y genere entradas en `state.habilitaciones` con la capacidad por defecto del servicio
- Añadir UI en el panel admin para definir el patrón y botón "Generar huecos del mes"
- Los huecos generados deben ser editables manualmente a posteriori (la generación es un punto de partida, no un lock)

**Dependencias previas:** Ninguna  
**Dependencias posteriores:** Ninguna

### Resultado
**Estado final:** `resuelto` (Julio 2026)  
**Decisiones tomadas:** Esquema de patrón: array de semanas con días L,M,X,J,V,S,D (ej. `[['L','X','V'],['M','J']]`); las semanas alternan cíclicamente empezando por la semana que contiene el día 1 del mes. UI integrada en Admin Calendario como panel bajo el pincel activo (input "L,X,V | M,J" + botones "Guardar patrón" y "Generar huecos del mes"), disponible para admin y para el delegado en su propio plan (`puedeGestionarPlan`). La generación escribe claves por plan `svc@@plan` (esquema B7), usa `plazasPorDia` del servicio y NO pisa días ya definidos a mano (solo rellena `undefined`). `modo_calendario` se marca 'patron'/'manual' al guardar el patrón.  
**Efectos secundarios detectados:** Los festivos no alteran el patrón (es puramente por día de semana); si un festivo intersemanal requiere tratamiento distinto, se ajusta a mano con el pincel.  
**Archivos modificados:** `app.js` (patronToText, parsePatronText, guardarPatronServicio, generarHuecosDesdePatron, ejecutarGeneracionPatron y panel en renderAdminCalendar), `index.html` (cache-buster v=2.4)

---

### N4 — Importación de festivos desde fuente oficial
**Sección PRD:** §4 / Decisión pendiente D-02  
**Impacto:** Bajo — solo eficiencia del admin; la entrada manual funciona  
**Estado:** `resuelto`

**Diagnóstico:**
No existe campo de localidad en el contenedor, no hay API conectada, solo entrada manual por pincel en `renderAdminCalendar`.

**API candidata:** `https://date.nager.at/api/v3/PublicHolidays/{año}/ES` (pública, sin autenticación, festivos nacionales y regionales por código de país/región).

**Acción requerida:**
- Añadir campo `codigo_region` al config del contenedor en Supabase
- Añadir selector de localidad/región en el onboarding del contenedor
- Crear función `importarFestivosOficiales(año, codigoRegion)` que llame a la API y pueble `state.festivos`
- Añadir botón "Importar festivos {año}" en el panel admin con posibilidad de editar el resultado antes de guardar
- Los festivos importados deben ser editables manualmente a posteriori

**Dependencias previas:** Ninguna  
**Dependencias posteriores:** Ninguna

### Resultado
**Estado final:** `resuelto` (Julio 2026)  
**Decisiones tomadas:** Se evaluaron dos fuentes: `date.nager.at` (solo nacional+comunidad autónoma) y `calendariosnacionales.com` (baja a nivel municipal, incluye festivos locales — verificado con Lleida: 11 mayo y 29 sept, coincide con la Fiesta Mayor real vía Ajuntament). Se descartó la segunda tras verificación EN NAVEGADOR REAL: no soporta CORS (fetch cruzado falla con "Failed to fetch"; confirmado con control experimental usando date.nager.at, que sí responde 200 desde el mismo origen externo). Implementarla habría requerido una Supabase Edge Function como proxy — se decidió NO añadir esa infraestructura y optar por un **enfoque híbrido**: import automático de nacional+autonómico vía Nager.Date (`promoConfig.festivosRegion = {codigo, nombre}`, sin migración de esquema, jsonb existente) + festivos LOCALES de municipio añadidos a mano con el pincel de festivos ya existente (aviso explícito en el modal de importación). Toda la gestión de festivos vive en **Admin→Calendario**, en un panel que aparece al activar el pincel "🔴 Pintar Festivos Oficiales" (mismo patrón que el panel de patrones de N3): selector de Comunidad Autónoma (lista estática de 17 CCAA con código ISO 3166-2 verificado contra los `counties` reales devueltos por la API para España 2026) + selector de AÑO (año visible ±) + botón "Importar festivos", con modal de checkboxes editables (todo pre-marcado, nada se escribe hasta confirmar); solo escribe los días marcados, no toca el resto del calendario. Decisión de UX (Vincenzo, jul 2026): el selector de CCAA se movió de Admin→Ajustes a Admin→Calendario por coherencia — se configura donde se pinta; el selector de año evita tener que navegar meses con ◀▶ para importar otro año.  
**Efectos secundarios detectados:** Ninguno. Nota de calidad de datos observada en la fuente (no en el código): el `localName` de "Sant Esteve" (26 dic, Cataluña) viene en inglés ("Feast of Saint Stephen") en Nager para 2026 — cosmético, sin impacto porque `state.festivos` solo persiste un booleano por día, no el nombre.  
**Archivos modificados:** `app.js` (FESTIVOS_CCAA_ES, guardarRegionFestivos, abrirImportarFestivosModal, confirmarImportarFestivos, card en renderAdminAjustes, botón en renderAdminCalendar — también fix del bug pre-existente de "🧨 Borrar mes entero" que no seguía el mes navegado), `index.html` (cache-buster v=2.8)

---

### N5 — Propuesta de asignación automática + Forzamiento de turno por inactividad
**Sección PRD:** §8.5 / §8.6  
**Impacto:** Medio — herramienta de emergencia con supervisión humana para cubrir huecos globalmente; mecanismo para desbloquear turnos inactivos  
**Estado:** `pendiente`

**Diagnóstico:**
La asignación forzosa (`ejecutarAsignacionForzosa`) y el cierre de ventana voluntaria (`forzarCierreSubasta`) solo son accesibles cuando `getAnalisisFestivos` detecta activamente un servicio con huecos pendientes y lo expone en el banner de `renderAlertaCargaMensual`. No existe ningún punto de entrada que permita al admin iniciar el proceso completo de forma inmediata e incondicional.

Ambas funciones operan sobre **un único servicio** a la vez y requieren que el análisis previo devuelva ese servicio como activo. Si hay múltiples servicios con cobertura incompleta, el admin debe ejecutar el proceso servicio a servicio. Adicionalmente, no hay mecanismo para desbloquear automáticamente a un residente que no confirma su turno dentro de un umbral de tiempo configurable.

**Nota de rediseño (Junio 2026):** El concepto original de "Activar subasta ya" (botón de ejecución inmediata vía `activarSubastaGlobal`) fue reemplazado por una **propuesta de asignación con revisión previa** (§8.5) para mantener supervisión humana. Se añade además el **forzamiento de turno por inactividad** (§8.6) como mecanismo complementario. No implementar `activarSubastaGlobal` como función de ejecución directa.

**Acción requerida (§8.5 — Propuesta de asignación automática):**
- Calcular propuesta completa de reparto para todos los servicios con `subastaTrigger` en el mes activo, usando los mismos criterios de prioridad que `ejecutarAsignacionForzosa`
- Presentar la propuesta en un modal/panel editable antes de persistir cualquier cambio
- El admin puede modificar asignaciones individuales dentro de la propuesta
- Solo al confirmar se ejecutan cambios en `state.shifts`
- Exclusivo para `isAdmin`

**Acción requerida (§8.6 — Forzamiento de turno por inactividad):**
- Umbral de inactividad de turno configurable (en horas) en la configuración de la promoción
- Botón disponible para `isAdmin` y `isDelegado` cuando el residente en turno supera el umbral
- Asigna el mínimo requerido al residente inactivo usando criterios históricos de §8.4
- Avanza el turno al siguiente residente en `ordenSeleccion` tras la asignación
- Requiere confirmación explícita

**Dependencias previas:** Ninguna — funciona de forma autónoma  
**Dependencias posteriores:**
- Cuando **N1** esté implementado: los residentes afectados recibirán la notificación `guardia_forzada` automáticamente (N5 es productor de ese evento)
- Cuando **N2** esté implementado: los huecos sin candidato válido quedarán registrados persistentemente (N5 es productor de esos eventos)

### Resultado
**Estado final:** `pendiente`  
**Decisiones tomadas:** Concepto "Activar subasta ya" rediseñado — propuesta con revisión reemplaza ejecución inmediata (Junio 2026)  
**Efectos secundarios detectados:** —  
**Archivos modificados:** —

---

## Ítems 🔮 — Ruta futura (post-MVP)

---

### N6 — Asignación automática con vacaciones
**Sección PRD:** §8.5 (extensión) — pendiente de redactar en el PRD  
**Impacto:** Alto — es el "ultimate automation tool" para meses conflictivos (diciembre, agosto)  
**Estado:** `pendiente` (roadmap, NO para el MVP — decisión de Vincenzo, jul 2026)

**Concepto:**
El admin abre una ventana ("poned vuestras vacaciones para diciembre"), los residentes marcan sus días, y el sistema produce una **propuesta de guardias completa** que respeta vacaciones, festivos, cupos, reglas obligatorias y salientes. La propuesta se publica al grupo en una pantalla aparte; si no hay conformidad, se descarta y se vuelve a la elección por rotación.

**Regla de vacaciones (definida con Vincenzo):**
- **Ningún turno en un día de vacaciones.** Punto.
- El **saliente SÍ** puede caer en vacaciones ("como mucho, vacaciones en saliente"): guardia el día 9 + vacaciones desde el 10 es válido. No requiere lógica especial — el saliente no es un turno.
- Después de las vacaciones se puede hacer guardia con normalidad.

**⚠️ LA TRAMPA (verificado en código, jul 2026):**
`state.bajasLargas` **NO sirve** para vacaciones. `getResidentesActivosEnMes()` excluye del **mes entero** a quien tenga una baja que solape *un solo día* (el propio formulario lo dice: *"el motor te saltará automáticamente en los meses afectados"*). Unas vacaciones del 1 al 15 de diciembre borrarían al residente de todo diciembre, incluidos los días 16-31 en los que debería hacer guardias. **Vacaciones necesita ser un concepto NUEVO a nivel de día** que bloquee días sin sacar a nadie de la rotación del mes. Las bajas largas (maternidad, IT) se quedan como están.

**Reencuadre clave (Vincenzo + análisis, jul 2026): el valor está en DIAGNOSTICAR, no en asignar.**
El cuello de botella de diciembre no es la capacidad agregada (con cupos de 4-5/mes sobran días físicos aunque alguien libre 15 días), sino la **concentración en días concretos**: el 24, el 25, el 31. Si los 5 residentes de un plan marcan el 25, ese día es **matemáticamente incubrible** — no es un problema de optimización, es un conflicto social. Lo valioso es que el sistema diga *"25/12 — Urgencias: 0 candidatos, todos de vacaciones; alguien tiene que ceder"* y *"31/12: 1 candidato (Marta), forzada, sin reparto justo posible"*. Eso convierte la discusión de WhatsApp en aritmética. Para los días contestados pero cubribles, los criterios de §8.4 (`historico_festivos`) ya resuelven el reparto justo.

**Lo que YA existe y se reutiliza:**
- `proyectarAsignacionForzosa(y, m, analisis)` — **es el germen del motor**: simula sin tocar `state.shifts`, valida salientes con `getIllegalShiftsForUser` y marca los huecos imposibles. Pero es **monoservicio** (solo el de la subasta activa) y **greedy** (primer candidato que encaja).
- `getIllegalShiftsForUser`, `isUserBusyOnDay`, `getPlazasForDay`, `isServiceEnabledOnDate`, `getDayTag`, `getUserProgress` (cupos + reglas + válvula de escape `hasAvailableLegalSlots`), `getResidentesDePlan` (B3), `getHistoricoFestivosResidentes` (criterios §8.4).
- `state.huecosSinCandidato` (N2) — **el hook ya está puesto**: `registrarHuecoSinCandidato(..., origen)` acepta `'propuesta'`.
- Notificaciones N1 para publicar la propuesta.

**Acción requerida (por fases, ~4-5 sesiones):**
1. **Modelo de vacaciones día-a-día** (media-baja): concepto nuevo + `estaDeVacaciones(user, dk)`; integrar en `openShiftModal` (bloquear día), `hasAvailableLegalSlots` (saltar), `proyectarAsignacionForzosa` (excluir), `getUserProgress` (la válvula de escape existente perdonaría reglas imposibles sola). **Ya aporta valor aunque la asignación siga siendo por rotación.**
2. **Ventana de vacaciones** (baja): el admin abre/cierra el marcado por mes.
3. **👑 Informe de viabilidad por día** (media): candidatos disponibles por hueco; días con 0 → bandera roja; días con 1 → forzado sin alternativa. **La joya de la corona.**
4. **Motor multiservicio con backtracking** (ALTA): el greedy actual se atasca en diciembre. Hace falta "most-constrained-first" + backtracking con límite de nodos. Con ~5-15 residentes × 31 días es tratable en ms; el riesgo no es rendimiento, es corrección y saber explicar por qué falla.
5. **Pantalla de propuesta pública + estados** (media): `borrador → publicada → aceptada/rechazada`, sin tocar `state.shifts` hasta aceptar. Por plan (B2).

**Decisiones de producto pendientes:**
- ¿Las vacaciones se aprueban o son libres? ¿Tope de días?
- ¿Quemar el primer día de vacaciones con un saliente es aceptable o solo tolerable? (si es "tolerable" → penalización blanda, no restricción dura)
- ¿Quién acepta la propuesta? ¿Ventana de objeciones del grupo?
- ¿El mes tendría un "modo" (rotación / propuesta)? Hoy no existe tal concepto.

**Orden recomendado:** fases 1-3 primero (valor inmediato, y los datos de vacaciones reales quedan en el sistema); el optimizador después, cuando se pueda probar contra un diciembre de verdad.

**Dependencias previas:** Ninguna técnica (B2 y N2 ya están)  
**Dependencias posteriores:** Ninguna

### Resultado
**Estado final:** `pendiente`  
**Decisiones tomadas:** Aplazado a post-MVP (Vincenzo, jul 2026): "lo veo tremendamente complejo como para retrasar el MVP".  
**Efectos secundarios detectados:** —  
**Archivos modificados:** —

---

### N7 — Graduación real al agotar los planes
**Sección PRD:** §9.5 (gestión de salientes) / §13.3 (histórico permanente)  
**Impacto:** Medio — sin urgencia inmediata, pero rompe la compartimentación cuando llegue  
**Estado:** `pendiente` (roadmap)

**Diagnóstico (verificado en código, jul 2026):**
La duración de la especialidad **ya es configurable**: el número de planes ES la duración (4 planes = 4 años). Lo que falla es que **nadie se queda nunca sin plan**, por el clamp de `getPlanForUserOnDate`:

```js
const planIndex = Math.min(level - 1, promoConfig.planes.length - 1);   // ← clampa al último plan
```

Un R5 en una especialidad de 4 años **no** devuelve `null`: devuelve "Plan R4". Consecuencia: **se mezclaría con los R4 nuevos** en su rotación, cola de turnos, calendario y subasta — justo lo que no se quiere ("cuando empiecen los siguientes R4 no quiero que se mezclen con los salientes").

Corolario: **`checkAutomaticGraduation` es código muerto**. Su condición `plan === null && getUserLevelOnDate(p, dk) > 0` es insatisfacible, porque `plan === null` ⟺ `level === 0`, que contradice `level > 0`. La graduación real hoy es **manual** (`graduarResidente`, la que exporta el Excel de despedida).

**Comportamiento deseado (Vincenzo, jul 2026):**
Al pasar el cambio de contrato de R4 sin que exista un plan R5: graduar al residente (o notificarle para que **acepte** su graduación) y mientras tanto bloquearle para coger guardias y usar el mercadillo (solo lectura), y sacarlo de la Rotación.

**Lo que se arregla SOLO al quitar el clamp** (`if (level > planes.length) return null`), porque toda la Fase 1 cuelga del plan:
- Fuera de la Rotación → `residentePerteneceAPlan` = false en todos los planes
- No puede coger guardias → `openShiftModal` → `serviciosDisponibles = []`
- Fuera de la cola de turnos → `getUserProgress` sin servicios → nunca tiene turno
- **Revive `checkAutomaticGraduation`**: la condición imposible pasa a cumplirse

**Lo que NO sale gratis:**
1. **Mercadillo en solo lectura** — hay que gatearlo a mano (`canUserTakeShift`, modal de mercadillo); hoy no depende del plan.
2. **Notificación + aceptación** — infraestructura N1 lista, pero falta un estado `pendiente_graduacion` y su flujo.
3. **⚠️ La graduación no tiene fecha.** `state.graduados` es una **lista plana de nombres**: "graduado para siempre, en todos los meses". Graduar en junio 2029 y mirar marzo 2029 (cuando era R4 activo) le borraría de la lista de miembros de aquel mes — y el PRD §13.3 exige histórico permanente. **Ya existe el mecanismo correcto** y lo usa `getResidentesDePlan`: `estado: 'historico'` + `state.historialEventos[nombre].salida = 'YYYY-MM'`, que sí compara contra el mes consultado. La graduación debería apoyarse en eso en vez de en la lista plana.

**Urgencia (jul 2026):** ninguna. MFyC tiene los 4 planes configurados (R3 y R4 como placeholders), así que Aura — que pasa a R3 en noviembre de 2026 por su cambio de contrato en noviembre — cae en un plan que existe y no se mezcla. El primer R5 real no llega hasta ~2029. **Aviso menor:** si el Plan R3 sigue sin servicios en noviembre, Aura simplemente no tendrá turnos (`getUserProgress` la da por terminada) hasta que se configure; no rompe nada.

**Dependencias previas:** Ninguna  
**Dependencias posteriores:** Ninguna

### Resultado
**Estado final:** `pendiente`  
**Decisiones tomadas:** Aplazado (Vincenzo, jul 2026): "Tenemos tiempo".  
**Efectos secundarios detectados:** —  
**Archivos modificados:** —

---

## Inventario de lo implementado correctamente

Para referencia del agente: estas secciones son conformes al PRD v0.7. No requieren intervención salvo que un ítem activo las afecte como efecto secundario.

| # | Sección PRD | Función/es | Líneas |
|---|---|---|---|
| C1 | §3.1 Google OAuth | `initApp`, `handleSession`, `syncUserProfile`, `loginWithGoogle` | 312, 349, 362, 485 |
| C2 | §4 Clasificador de tipos de día | `getDayTag` | 151 |
| C3 | §5 Habilitación manual de huecos | `renderAdminCalendar`, `getPlazasForDay`, `isServiceEnabledOnDate` | 1439, 1461, 2504 |
| C4 | §5 Obligatoriedad por tipo de día | `svc.subastaTrigger[]` — obligatoriedad a nivel de servicio por tipo de día | — |
| C5 | §6 Características por tipo de día | `getShiftHours`, `getSalienteDaysForShift` | 593, 559 |
| C6 | §6 Saliente de sábado desplazado al lunes | `getSalienteDaysForShift` línea 584 | 584 |
| C7 | §7 Motor de reglas mínimas | `getUserProgress`, `hasAvailableLegalSlots` | 873, 810 |
| C8 | §8.2 Liberación automática del turno | `getUserProgress` → `totalForgiven` | 873 |
| C9 | §8 Motor de turno | `getCurrentTurn`, `userSkipTurn`, `adminSkipTurn`, `adminGrantTurn` | 3880, 1767, 1784, 1798 |
| C10 | §8.3 Ventana voluntaria | `getAnalisisFestivos`, `renderAlertaCargaMensual`, `forzarCierreSubasta` | 3637, 3450, 3505 |
| C11 | §8.4 Forzamiento con criterios históricos | `ejecutarAsignacionForzosa`, `getHistoricoFestivosResidentes` | 3513, 3410 |
| C12 | §9 Algoritmo de rotación mensual | `getRotation` | 650 |
| C13 | §9.1 Distribución de grupos | `_reempaquetarGrupos` (17 res. → `[3,3,3,4,4]`) | 4282 |
| C14 | §9.3 Nueva base de rotación | `saveAsNewBase`, `adminAutoShuffleGroups` | 3328, 3284 |
| C15 | §9.5 Graduación automática | `graduarResidente`, `checkAutomaticGraduation` | 4327, 4365 |
| C16 | §10 / §11 Restricciones en mercadillo | `checkTradeConflicts`, `canUserTakeShift` (saliente + reglaIntercambio) | 1026, 550 |
| C17 | §11 Mercadillo completo con internos | `processTrade`, `getComputedShifts`, `renderMercadoInboxAndLog` | 998, 2714 |
| C18 | §11.3 Compra con externo (spawn) | `getComputedShifts` línea 1009 | 1009 |
| C19 | §11.5 Intercambio con externo (dos rutas) | `renderMercadoCambiar`, `renderMercadoCambiarAjena` | 2745, 2748 |
| C20 | §13.2 / §13.3 Histórico y visibilidad | `state.trades[]`, `state.exceptionLogs[]`, `renderMercadoInboxAndLog`, `renderAdminExceptions` | 2714, 2647 |
| C21 | §15 Panel admin funcional | `renderAdminAjustes`, `renderAccountsList`, `adminAprobarUsuario` | 1932, 2753, 2940 |
| C22 | §8 / §9 Lookup canónico de servicio por plan | `getSvcConfig`, `getSvcConfigForUser` — reemplaza first-plan-wins en toda la app | 581, 587 |

---

## Changelog del documento

| Versión | Fecha | Cambios |
|---|---|---|
| v1.0 | Mayo 2026 | Auditoría inicial contra PRD v0.6. 8 divergencias, 5 no implementados. |
| v1.1 | Mayo 2026 | Revisión contra PRD v0.7. Resueltos W3/W6/W7/W8-A/N2 por alineación del PRD con el código. 5 divergencias activas, 4 no implementados. |
| v1.2 | Mayo 2026 | W1 resuelto (roles ternarios, Supabase constraint, isDelegado). W2 resuelto (simulatedViewUser, banner sticky, toolbar unificada, write guards en 7 funciones, soft-lock en adminForceAssign). Restricciones de los 5 agentes actualizadas. PRD actualizado a v0.8. |
| v1.3 | Mayo 2026 | W3 resuelto (ventana_voluntaria_horas en JSON configuracion, normalizeConfig con fallback 48, UI en panel Ajustes, clamp 24-48). |
| v1.4 | Mayo 2026 | W4 resuelto (inserción en grupo mínimo sin reempaquetado salvo desbordamiento). W4-B nuevo ítem pendiente (identidad de grupo con slots y memoria inter-plan). PRD actualizado a v0.9. |
| v1.5 | Mayo 2026 | W5 resuelto (selector mes en perfil, pestaña Horas admin/delegado, chivato multihueco en calendario principal). |
| v1.6 | Mayo 2026 | W6 nuevo y resuelto (navegador de mes duplicado en vista Rotación eliminado; `rotDate`/`changeRotMonth` reemplazados por `curDate`). PRD actualizado a v1.0. |
| v1.7 | Mayo 2026 | N5 nuevo (botón admin "Activar subasta ya" — asignación forzosa global inmediata, independiente de N1-N4). |
| v1.8 | Mayo 2026 | W7/W8/W9 nuevos (reset no limpia subastasCerradasForzosas; calendario bloqueado en ventana voluntaria; "Turno de Nadie" en meses pasados). PRD actualizado a v1.2. |
| v1.9 | Mayo 2026 | W7 resuelto (PR #6): reset limpia subasta, nominados deterministas por tramos, asignación forzosa multihueco completa, criterios de servicio cuentan mes actual. |
| v2.0 | Mayo 2026 | C22 nuevo y resuelto: bug sistémico de lookup de servicio por nombre sin contexto de plan. Introducidos `getSvcConfig`/`getSvcConfigForUser`; `isServiceEnabledOnDate` refactorizado; sort por `ordenSubasta` en `getAnalisisFestivos`; `getSalienteDaysForShift`/`getShiftHours` usan plan real del residente en lugar de Plan R1 fijo. |
| v2.1 | Mayo 2026 | W10 nuevo y resuelto (PR #8): subasta completamente aislada por plan. Guard `_computingAnalisis` + extracción a `_getAnalisisFestivosImpl` (previene stack overflow). `rondaTerminada`, candidatos, conteo de huecos y claves de caché filtrados al plan propio. `includeCurrentMonth=true` para todos los criterios históricos (acumula desde inicio del año de residencia). `criterioTexto` corregido; case `historico_servicio_dinamico` añadido. |
| v2.2 | Mayo 2026 | W8 resuelto: ventana voluntaria exenta del guard de turno solo para el servicio en subasta. W9 resuelto: banner admin muestra estado real (subasta/completado) cuando `turnUser === null`; botón "Forzosa" recuperado del código muerto e integrado en el panel admin. |
| v2.3 | Junio 2026 | W11 nuevo y resuelto: inconsistencia `getComputedShifts`/`state.shifts` en `_getAnalisisFestivosImpl` causaba mes atascado con "0 guardias". Fix en dos partes: (A) revertir a `state.shifts` para contar huecos cubiertos; (B) introducir `state.subastaSnapshot[y_m_plan]` que congela exceso/nominados/svcNombre la primera vez que `rondaTerminada=true`, evitando re-evaluación completa y el bug de `fechaFinRonda` persistido. `adminResetMonth` y `adminVaciarGeneracion` borran el snapshot; `resetSubastaEstado` también. |
| v2.4 | Junio 2026 | N5 rediseñado: concepto "Activar subasta ya" (ejecución inmediata) reemplazado por "Propuesta de asignación automática" (§8.5, revisión admin antes de ejecutar, no destructiva hasta confirmar) + "Forzamiento de turno por inactividad" (§8.6, umbral configurable, disponible para admin y delegado). PRD actualizado a v1.3. |
| v2.5 | Junio 2026 | N1 resuelto: sistema de notificaciones in-app completo. Tabla `notificaciones` en Supabase (6 tipos con RLS). Módulo JS (insertNotificacion, loadNotificaciones, markNotifRead, markAllNotifsRead, renderNotifPanel, toggleNotifPanel, maybeNotifyTurnChange, _notifyNewTrade, _notifyTradeResolved). Bell icon con badge en header. Panel flotante con acciones inline para mercadillo. Hooks en 11 funciones existentes. |
