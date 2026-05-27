# GestionGuardias App — Auditoría de Implementación
**Versión PRD auditada:** 0.7  
**Codebase auditado:** `app.js` (4 447 líneas, monolítico vanilla JS + Supabase)  
**Fecha de última revisión:** Mayo 2026  
**Estado general:** 4 divergencias activas, 4 funciones no implementadas. 10 ítems resueltos o alineados con PRD v0.8.

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
| W3 | ⚠️ Diverge | §8.3 | Duración ventana voluntaria hardcodeada a 48h | `pendiente` |
| W4 | ⚠️ Diverge | §9.2 | Nuevo residente entra al último grupo, no al más pequeño | `pendiente` |
| W5 | ⚠️ Diverge | §14 / §13.1 | Recuento de horas sin selector de mes ni visibilidad admin | `pendiente` |
| N1 | ❌ Falta | §12 | Sistema de notificaciones in-app completo | `pendiente` |
| N2 | ❌ Falta | §15 / §8.4 | Registro persistente de huecos sin candidato válido | `pendiente` |
| N3 | ❌ Falta | §5.1 | Calendario automático de huecos desde patrón configurable | `pendiente` |
| N4 | ❌ Falta | §4 / D-02 | Importación de festivos desde fuente oficial | `pendiente` |

---

## Ruta crítica recomendada

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
**Estado:** `pendiente`

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
**Estado final:** `pendiente`  
**Decisiones tomadas:** —  
**Efectos secundarios detectados:** —  
**Archivos modificados:** —

---

### W4 — Nuevo residente entra al último grupo, no al de menor número de miembros
**Sección PRD:** §9.2  
**Impacto:** Medio — afecta la equidad de la rotación al incorporar residentes  
**Archivos:** `app.js` líneas 2951–2953  
**Estado:** `pendiente`

**Diagnóstico:**
PRD: "Entran por la parte inferior del grupo con menor número de miembros." Código: `filaIndia.push(userName)` añade al final del array flat y `reempaquetarGruposPlan` lo sitúa en el último grupo, que tras el empaquetado puede no ser el más pequeño si los grupos tienen tamaños desiguales.

```js
// líneas 2951-2953
let filaIndia = (pr.baseGroups || []).flat();
filaIndia.push(userName);  // siempre al final del array flat
pr.baseGroups = reempaquetarGruposPlan(filaIndia, pr);
```

**Acción requerida:**
- En `adminAprobarUsuario`, antes de hacer push al flat array, identificar el grupo con menor número de miembros en `pr.baseGroups`
- Insertar el nuevo residente al final de ese grupo específico, no al final del flat array global
- Verificar que `reempaquetarGruposPlan` no redistribuye si no hay cambio de nivel, para no deshacer la inserción correcta

**Dependencias previas:** Ninguna  
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
**Estado final:** `pendiente`  
**Decisiones tomadas:** —  
**Efectos secundarios detectados:** —  
**Archivos modificados:** —

---

## Ítems ❌ — No implementados

---

### N1 — Sistema de notificaciones in-app completo
**Sección PRD:** §12  
**Impacto:** Alto — bloquea el loop de comunicación de §8.1, §8.4 y §11  
**Estado:** `pendiente`

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
**Estado final:** `pendiente`  
**Decisiones tomadas:** —  
**Efectos secundarios detectados:** —  
**Archivos modificados:** —

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
**Estado final:** `pendiente`  
**Decisiones tomadas:** —  
**Efectos secundarios detectados:** —  
**Archivos modificados:** —

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
**Estado final:** `pendiente`  
**Decisiones tomadas:** —  
**Efectos secundarios detectados:** —  
**Archivos modificados:** —

---

### N4 — Importación de festivos desde fuente oficial
**Sección PRD:** §4 / Decisión pendiente D-02  
**Impacto:** Bajo — solo eficiencia del admin; la entrada manual funciona  
**Estado:** `pendiente`

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
**Estado final:** `pendiente`  
**Decisiones tomadas:** —  
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

---

## Changelog del documento

| Versión | Fecha | Cambios |
|---|---|---|
| v1.0 | Mayo 2026 | Auditoría inicial contra PRD v0.6. 8 divergencias, 5 no implementados. |
| v1.1 | Mayo 2026 | Revisión contra PRD v0.7. Resueltos W3/W6/W7/W8-A/N2 por alineación del PRD con el código. 5 divergencias activas, 4 no implementados. |
| v1.2 | Mayo 2026 | W1 resuelto (roles ternarios, Supabase constraint, isDelegado). W2 resuelto (simulatedViewUser, banner sticky, toolbar unificada, write guards en 7 funciones, soft-lock en adminForceAssign). Restricciones de los 5 agentes actualizadas. PRD actualizado a v0.8. |
