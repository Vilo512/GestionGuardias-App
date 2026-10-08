# GestionGuardias App — Product Requirements Document
**Versión:** 1.6  
**Estado:** Funcionalidad core cerrada — rediseño visual en curso (§16.2)  
**Audiencia:** Engineering Lead, desarrolladores, diseñadores  
**Última actualización:** 8 de octubre de 2026

---

## Índice

1. [Visión General](#1-visión-general)
2. [Estructura Jerárquica y Modelo de Datos](#2-estructura-jerárquica-y-modelo-de-datos)
3. [Roles y Autenticación](#3-roles-y-autenticación)
4. [Tipos de Día y Calendario de Festivos](#4-tipos-de-día-y-calendario-de-festivos)
5. [Definición de Huecos (Slots)](#5-definición-de-huecos-slots)
6. [Características de Guardias por Tipo de Día](#6-características-de-guardias-por-tipo-de-día)
7. [Reglas de Asignación Mínima](#7-reglas-de-asignación-mínima)
8. [Motor de Turnos — Flujo de Asignación Mensual](#8-motor-de-turnos--flujo-de-asignación-mensual)
9. [Sistema de Rotación de Turnos](#9-sistema-de-rotación-de-turnos)
10. [Restricciones de Saliente y Entrante](#10-restricciones-de-saliente-y-entrante)
11. [Mercadillo de Guardias](#11-mercadillo-de-guardias)
12. [Notificaciones](#12-notificaciones)
13. [Histórico, Auditoría y Navegación Temporal](#13-histórico-auditoría-y-navegación-temporal)
14. [Recuento de Horas](#14-recuento-de-horas)
15. [Panel de Administración](#15-panel-de-administración)
16. [UI/UX — Notas y Extensiones Pendientes](#16-uiux--notas-y-extensiones-pendientes)
17. [Stack y Modelo de Datos](#17-stack-y-modelo-de-datos)
18. [Decisiones Pendientes y Changelog](#18-decisiones-pendientes-y-changelog)

---

## 1. Visión General

GestionGuardias App es una aplicación web para la gestión automatizada de guardias médicas de residentes hospitalarios.

**Funcionalidades core:**
- Asignación voluntaria de guardias por turnos rotativos mensuales
- Definición de reglas personalizadas por servicio y plan de guardias
- Cálculo automático de horas acumuladas
- Forzamiento controlado de guardias no cubiertas voluntariamente
- Mercadillo de compra, venta e intercambio de guardias
- Histórico público y audit trail de todas las operaciones

**Usuarios objetivo:** Residentes médicos (R1–R4) y sus coordinadores dentro de un Hospital + Especialidad.

**Principio de diseño clave:** El mes siempre es una elección explícita del usuario. No existe ninguna vista con un mes implícito o por defecto.

---

## 2. Estructura Jerárquica y Modelo de Datos

```
Hospital
  └── Especialidad                        ← Contenedor
        └── Plan de Guardias (R1/R2/R3/R4)
              └── Servicio
                    └── Hueco (Slot)
```

### Contenedor
Unidad operativa básica = Hospital + Especialidad. El admin lo crea y mantiene. Cada residente pertenece a **exactamente un contenedor** y transita por distintos Planes de Guardias a lo largo de su residencia.

### Plan de Guardias
Define las reglas aplicables a un año de residencia concreto (R1–R4):
- Servicios habilitados para ese año
- Cupo mensual por tipo de guardia
- Reglas de asignación mínima
- Características horarias de cada tipo de guardia

### Servicio
Unidad donde se realizan las guardias (ej. URG HUAV, Pediatría, PAC Balaguer). Cada servicio tiene:
- Sus propios huecos por día
- Sus características horarias según tipo de día
- Su calendario de huecos habilitados (manual o automático)

---

## 3. Roles y Autenticación

### 3.1 Autenticación
Login mediante **Google OAuth**. No existen cuentas propias de la app.

### 3.2 Roles

| Rol | Descripción |
|---|---|
Tres niveles con privilegios, más el residente. Lo que distingue a Dueño de Admin **no son las funciones, es el alcance**: los dos pueden todo, el Dueño en toda la especialidad y el Admin solo en su plan.

| Rol | Alcance | Puede |
|---|---|---|
| **Residente** | — | Su calendario, asignación mensual, mercadillo, histórico público |
| **Delegado** | Su plan actual | Lo mismo que el Admin de su plan, **salvo destituir o expulsar a un Admin**. Un Admin sí puede destituirlo a él |
| **Admin** | Su plan actual (R1–R5) | Todas las funciones, limitadas a los residentes y la configuración de **su** plan |
| **Dueño** | **Toda la especialidad**, todos los planes | Todas las funciones, sin límite de plan. Uno y solo uno por especialidad, y obligatorio |

Los roles son **acumulativos**: un Dueño, admin o delegado es simultáneamente residente activo y participa en la rotación con normalidad.

#### Vocabulario — dos niveles que la base de datos nombra al revés

| Concepto | Qué es | Dónde vive |
|---|---|---|
| **Especialidad** (contenedor) | Hospital + Especialidad. Un residente pertenece a exactamente una | Tabla `promociones` — **el nombre de la tabla engaña** |
| **Plan de Guardias** | Reglas de un año de residencia: R1, R2, R3, R4, R5 | `promoConfig.planes`, dentro de la especialidad |

Cuando este documento dice «promoción» en el sentido de cohorte de un año, se refiere al **Plan**. La fila de `promociones` es la especialidad.

#### El alcance del Admin y del Delegado es su plan actual

El plan de un residente **no se almacena como cargo**: se deriva de su fecha de inicio de residencia, igual que ya hacen `getSvcConfigForUser` y `getPlazasForDay`. Por tanto, **cuando un residente avanza de R1 a R2, su cargo le acompaña al plan nuevo** y deja de tener poder sobre el plan que abandona.

> Consecuencia a tener presente: un plan puede quedarse temporalmente sin admin ni delegado propios cuando su cohorte avanza en bloque. El Dueño cubre siempre ese hueco, porque su alcance es toda la especialidad.

#### Cada especialidad DEBE tener Dueño, en todo momento

El Dueño es el suelo del sistema: mientras exista, la especialidad nunca se queda sin nadie capaz de administrarla. De ahí que **no se le pueda destituir, solo suceder**:

- Ningún Admin ni Delegado puede expulsar ni destituir al Dueño.
- El Dueño no puede renunciar a sus privilegios, darse de baja **ni graduarse** sin **traspasar antes la corona** a alguien que siga activo en la especialidad.
- El sistema debe rechazar cualquier operación cuyo resultado sea una especialidad con cero Dueños.

Como el Dueño siempre existe y es indestituible, **no hace falta una guarda aparte del «último admin»**: el bloqueo de quedarse sin administración lo da el propio Dueño.

### 3.3 Vista de Simulación (Admin)
El admin puede activar un **modo de simulación** seleccionando cualquier residente del contenedor desde el panel del calendario. Mientras está activo:
- La app renderiza completamente desde la perspectiva del residente seleccionado (turno activo, progreso, vista de huecos)
- Un banner morado permanente en la parte superior indica que la simulación está activa
- Cualquier acción de escritura está bloqueada — el modo es puramente visual
- El admin sale mediante el botón "Salir de simulación" del banner

La sesión real del admin no se ve afectada: `loggedInUser`, `isAdmin` e `isDelegado` permanecen inalterados.

> ⚠️ **Desviación conocida — el mercadillo no aplica el bloqueo de escritura (D-06).**
> El bloqueo se implementa repitiendo `if (simulatedViewUser !== null) { alert(...); return; }` en cada punto de escritura, y **ninguno de los del mercadillo lo tiene**: `openMercadoModal`, `executeBuyRequest`, `executeSellRequest`, `executeSwapRequestDirect`, `processTrade` ni `requestTradeUndo`.
>
> El efecto no es una suplantación de identidad —el trade se graba con el `loggedInUser` real, es decir el admin—, sino una incoherencia entre lo que se ve y lo que se escribe: la rejilla está filtrada por el residente simulado, pero la operación que se cree hacer «en su nombre» acaba siendo del admin. Detectado en la auditoría del Paso 5 (ago-2026); pendiente de decidir si el mercadillo se bloquea en simulación o si se habilita explícitamente la operación en nombre de otro.
>
> **Ampliación (oct-2026): no es solo el mercadillo.** El **panel de Cuentas** tampoco comprueba `simulatedViewUser` en ninguna de sus seis acciones — `adminAprobarUsuario`, `adminExpulsarUsuario`, `adminCambiarRol`, `adminTraspasarCorona`, `adminRenunciarPrivilegios` y `adminEditarFechas`. Y la pestaña de Admin no se oculta al entrar en simulación: su visibilidad se fija una sola vez al iniciar sesión (`app.js:731-732`, `app.js:2110-2124`) según el rol **real**, y `activateSimulationMode` (`app.js:908-916`) no la toca. Un admin en modo simulación puede ir a Admin → Cuentas y pulsar «Expulsar» o «Coronar Dueño» con efecto real. A diferencia del mercadillo, aquí sí hay consecuencias de gobierno, no solo incoherencia de vista. Detectado por el `testing-lead` en la auditoría del Paso 6.

### 3.4 Admins y Delegados

- Puede haber **múltiples admins y múltiples delegados** por especialidad, y cada uno manda en **su** plan.
- Un Admin designa y revoca delegados **de su plan**, y puede expulsarlos.
- Un Delegado puede designar, revocar y expulsar a **otros delegados de su plan**. Lo único que no puede es destituir ni expulsar a un Admin.
- El Dueño puede hacer todo lo anterior en **cualquier** plan, y es el único que puede **nombrar**, destituir o expulsar a un Admin. Un Admin gestiona delegados, no otros admins.
- **Lo que afecta a la especialidad entera es solo del Dueño**, nunca de un Admin. En el panel son las dos pestañas rotuladas **«Planes de guardias»** (servicios, cupos y reglas de *todos* los planes) y **«Ajustes»** (hospital, nombre y borrado de la especialidad) — ids `ajustes` y `seguridad`, que están cambiados respecto a sus etiquetas.
- Un Admin manda hoy sobre **personas**: aprobar, expulsar y gestionar delegados. **No** sobre la configuración de los planes, aunque §3.2 se lo conceda «en su plan»: hasta que exista el ámbito por plan (§3.5 a), `adminSaveConfig` escribe todos los planes de una vez, así que abrirle esa pantalla le daría poder sobre planes ajenos. Se reevalúa al cerrar §3.5 a.
- Quien avanza de plan **se lleva el cargo consigo** (§3.2) y pierde el poder sobre el plan que deja atrás.
- Objetivo: que la supervisión de cada año no dependa de que una persona concreta esté disponible, y que nadie tenga poder sobre una cohorte a la que ya no pertenece.

### 3.5 Punto de cambio — apertura de permisos (oct-2026)

**Pendiente de implementación.** Lo descrito en §3.2 y §3.4 es el objetivo; el código actual no lo cumple. Divergencias medidas el 2026-10-08 sobre `GestionGuardias-BETA`, de mayor a menor alcance:

**a) No existe el ámbito por plan. Es el cambio grande.** `perfiles.rol` es un **único valor global a la especialidad**, y ninguna de las 88 comprobaciones de rol de `app.js` es consciente del plan. Hoy un admin manda sobre los residentes de todos los años. Hay que derivar el plan del actor —igual que `getSvcConfigForUser` y `getPlazasForDay` ya derivan el del residente— y filtrar por él todas las acciones sobre personas y configuración. No requiere tocar el esquema, porque el cargo sigue a la persona (§3.2), pero sí toca muchos puntos.

**b) La gestión de roles está atada al Dueño, no al Admin.** «Quitar Delegado», «Hacer Delegado», «Coronar Dueño» y editar fechas de residencia solo se renderizan bajo `isDueño` (`app.js:5009-5014`, `app.js:5030`). Un Admin no puede nombrar ni revocar delegados de su propio plan. Hay que abrir esos poderes a Admin **dentro de su plan**, dejando «Coronar Dueño» y «destituir un Admin» como exclusivos del Dueño.

**c) Un delegado no puede destituir ni expulsar a otro delegado.** `app.js:5017` oculta «Expulsar» cuando el objetivo es `admin` **o** `delegado`, y «Quitar Delegado» (`app.js:5010`) solo existe para el Dueño. Las dos palancas están cerradas a la vez, así que tampoco sirve el camino de «primero quitar delegado, luego expulsar». Debe permitirse sobre delegados del propio plan, dejando bloqueado solo el objetivo `admin`.

**d) Falta la sucesión forzosa del Dueño.** Las piezas existen —`adminTraspasarCorona`, y `app.js:4998` bloquea la renuncia con «No puedes abdicar sin traspasar la corona primero»— pero **nada detecta la graduación o la salida del Dueño**. Si termina la residencia y deja de entrar, la especialidad queda con un Dueño ausente y sin vía de recuperación desde la app. Hace falta: bloquear su baja sin traspaso previo, y avisarle de que debe traspasar cuando se acerque el fin de su residencia.

**e) Trampa de nombres, a corregir antes de tocar las guardas.** `app.js:730` define `isDelegado = (rol === 'admin' || rol === 'delegado')`, es decir **«delegado o superior»**, no «es delegado». Cualquier guarda nueva escrita leyendo esa variable como «es delegado» será incorrecta. Renombrar, o introducir un `esSoloDelegado` explícito.

**f) `adminExpulsarUsuario` no comprueba el error de Supabase.** `app.js:5202` lanza el `update` sin leer `error`; la UI pasa de «Expulsando…» a «Conectado ✅» aunque la escritura se haya rechazado. Es la explicación más probable de que «el botón no sirva» sin mensaje alguno. Añadir comprobación, como ya hace `app.js:4809`.

**g) Expulsar no limpia el `rol`.** Solo escribe `estado: 'historico'`. Un delegado expulsado conserva `rol: 'delegado'` y, si se le vuelve a aprobar, **regresa con privilegios**. La baja debe degradar el rol a `residente` en la misma operación.

**h) El nivel Dueño no estaba documentado.** Existía solo en el código, como `isDueño = promo.creador_id === currentUserProfile.id` (`app.js:2000`, `app.js:4960`). Queda documentado en §3.2 y se conserva. Ya está protegido contra expulsión por admins y delegados: `app.js:5005` reserva la rama de «expulsar a cualquiera» a `isDueño`, y el resto solo alcanza a residentes.

> **Nota de alcance.** Ninguna de estas guardas vive en el servidor: son comprobaciones de JavaScript en el navegador. Mientras la escritura a Supabase no esté protegida por RLS, un residente con las devtools abiertas puede saltarse cualquiera de ellas. Eso es una cuestión aparte de este punto de cambio y debe tratarse como tal.

---

## 4. Tipos de Día y Calendario de Festivos

El sistema distingue cuatro tipos de día con comportamientos diferenciados:

| Tipo | Definición |
|---|---|
| **Laborable** | Lunes a viernes sin festivo |
| **Víspera de festivo** | Día anterior a un festivo intersemanal o a un fin de semana |
| **Fin de semana** | Sábado y domingo |
| **Festivo intersemanal** | Día entre semana declarado festivo (ej. 6 de enero en miércoles) |

**Comportamiento del festivo intersemanal:**
- Se comporta como domingo a todos los efectos
- El día anterior → comportamiento de víspera
- El día posterior → comportamiento de lunes (a efectos de salientes)

**Definición del calendario de festivos:**
- Importación desde fuente oficial del calendario laboral de la localidad del contenedor (Lleida, Madrid, Valladolid…)
- Alternativamente, entrada manual por el admin
- El admin puede editar la lista resultante en cualquier momento

---

## 5. Definición de Huecos (Slots)

Un **hueco** es un slot en el calendario donde se puede asignar un residente para una guardia.

### Propiedades de un hueco

| Propiedad | Descripción |
|---|---|
| `servicio` | Servicio al que pertenece |
| `fecha` | Fecha en que está disponible |
| `tipo_dia` | Laborable, festivo intersemanal, fin de semana, víspera |
| `capacidad` | Nº máximo de residentes simultáneos (por defecto: 1) |

**Nota — Obligatoriedad:** La obligatoriedad de cobertura no se modela por hueco individual sino a nivel de servicio. Cada servicio define mediante `subastaTrigger` qué tipos de día requieren cobertura obligatoria (y por tanto disparan ventana voluntaria y forzamiento si quedan desiertos). Este modelo cubre el caso de uso habitual: "todos los festivos de este servicio son obligatorios". No está prevista la marcación de días concretos como obligatorios de forma individual.

### 5.1 Modos de generación del calendario de huecos

**Calendario automático**
El sistema genera huecos según un patrón regular configurable por el admin. Ejemplo: L-X-V una semana, M-J la siguiente, rotando mensualmente.

**Habilitación manual**
El admin pinta sobre un calendario en blanco los días habilitados para ese servicio en ese mes, con el color asignado al servicio dentro del Plan de Guardias correspondiente.

---

## 6. Características de Guardias por Tipo de Día

Configurables por el admin para cada combinación de servicio + plan de guardias.

| Tipo de día | Duración típica | Pernocta | Genera saliente |
|---|---|---|---|
| Laborable | 17h | Sí | Día siguiente |
| Festivo / Festivo intersemanal | 24h | Sí | Día siguiente |
| Sábado o domingo | Variable (configurable) | No | Lunes siguiente |

El sistema calcula automáticamente las horas acumuladas de cada residente a partir de estas configuraciones.

---

## 7. Reglas de Asignación Mínima

El admin define para cada Plan de Guardias un conjunto de **reglas de asignación mínima**: combinaciones de servicios, tipos de día y cantidades que el residente debe cumplir en su turno mensual.

- Las reglas se validan **en tiempo real** durante la selección
- El sistema bloquea la confirmación si la selección no satisface las reglas
- Si no hay huecos disponibles para cumplir las reglas, el sistema libera al residente de las mínimas para ese mes (ver §8.2)

> **Nota para desarrollo:** Las reglas deben modelarse como un motor de condiciones flexible, ya que cada especialidad puede tener combinaciones distintas. No hardcodear reglas específicas en el código.

---

## 8. Motor de Turnos — Flujo de Asignación Mensual

**Panel de turno en meses pasados:** El indicador de turno activo (banner "Turno de X") solo debe mostrarse para el mes activo o meses futuros. Para meses ya finalizados, el panel de turno no debe renderizarse — su información carece de significado operativo y genera confusión.

**Invariante de reset:** La función de reset mensual debe dejar el mes en estado completamente limpio, equivalente a un mes sin actividad. Esto incluye borrar cualquier marca de subasta cerrada forzosamente (`subastasCerradasForzosas`), el timestamp de fin de ronda (`fechaFinRonda`) y el snapshot de evaluación (`subastaSnapshot`) para ese mes, de modo que el flujo completo pueda reiniciarse desde cero.

**Evaluación congelada (snapshot):** La primera vez que `rondaTerminada=true` para un mes+plan, `_getAnalisisFestivosImpl` persiste el resultado en `state.subastaSnapshot[y_m_plan]` con los campos `exceso`, `nominados`, `svcNombre`, `planNombre`, `planResidentes`, `servicioCriterio`, `criterio`, `historico`. Las llamadas posteriores leen desde el snapshot sin re-evaluar el bucle de servicios ni el check `rondaTerminada`. El `estado` (`subasta_abierta` / `subasta_cerrada`) se sigue calculando en tiempo real desde `fechaFinRonda` y `subastasCerradasForzosas`. Si durante la ventana voluntaria todos los huecos son cubiertos voluntariamente (verificación ligera sobre `state.shifts`), la función transiciona a `libre` aunque el snapshot indique `exceso > 0`.

### 8.1 Selección activa
1. El residente en turno recibe notificación in-app
2. Accede a la vista de asignación del mes (con selector de mes explícito)
3. Selecciona activamente sus guardias de entre los huecos disponibles
4. El sistema valida en tiempo real: reglas mínimas + restricciones de saliente/entrante
5. Al confirmar una selección válida: huecos reservados → turno pasa al siguiente residente

### 8.2 Liberación del turno
Si el residente no puede completar la asignación mínima por ausencia de huecos compatibles (conflictos de saliente/entrante u ocupación total de huecos), el sistema:
- Le libera de las guardias mínimas para ese mes
- Pasa el turno igualmente al siguiente residente

### 8.3 Ventana voluntaria
Una vez completada la ronda de asignación inicial:
1. Si quedan huecos marcados como obligatorios sin cubrir → el sistema abre una **ventana voluntaria**
2. Duración: configurable por el admin (entre 24 y 48 horas)
3. Cualquier residente del contenedor puede reclamar esos huecos libremente, sin restricción de orden
4. Restricción activa: saliente/entrante
5. La apertura de la ventana se notifica in-app al consultar el mes en cuestión

**Durante la ventana voluntaria el calendario debe permanecer abierto.** Todos los residentes pueden auto-asignarse guardias disponibles simultáneamente — no aplica el sistema de turno rotativo. El check `isMyTurn` no debe bloquear asignaciones en este estado.

### 8.4 Forzamiento
Transcurrida la ventana voluntaria, los huecos obligatorios sin cubrir se asignan forzosamente:

- **Elegibles:** Solo residentes del Plan de Guardias al que pertenece el hueco
- **Criterios de prioridad:** Configurables por el admin (ej. menor nº de festivos realizados, menor nº de guardias totales). El admin ordena los criterios según su preferencia
- **Restricción activa:** Saliente/entrante siempre respetado
- **Notificación:** El residente afectado recibe notificación in-app
- **Sin candidato válido:** Si todos los elegibles tienen conflicto de saliente/entrante → el hueco queda sin cubrir, se notifica al admin y delegados, y queda registrado en el sistema como evidencia de exceso de carga asistencial
- **Soft-lock en asignación manual:** Cuando el admin asigna forzosamente a un residente desde el calendario, el sistema advierte si la asignación viola restricciones de saliente/entrante. El admin puede confirmar de todas formas (aviso sin bloqueo).

### 8.5 Propuesta de asignación automática

Antes de ejecutar cualquier asignación forzosa global, el sistema calcula la propuesta completa de reparto y la presenta al admin para revisión. Solo tras confirmación explícita se materializan cambios en `state.shifts`.

**Comportamiento:**
- El admin **elige sobre qué servicio** lanzar la propuesta (ver "Selección por servicio" abajo)
- Usa los mismos criterios de prioridad que la asignación forzosa (§8.4): histórico de guardias, restricciones de saliente/entrante, criterio configurado por servicio
- Presenta al admin una vista de propuesta: para cada hueco pendiente, el residente propuesto y el criterio aplicado
- El admin puede modificar asignaciones individuales dentro de la propuesta antes de confirmar
- La propuesta es no destructiva — ningún dato de `state.shifts` se modifica hasta que el admin confirma
- Requiere confirmación explícita antes de ejecutar
- Visible y accesible exclusivamente para `isAdmin`, y bloqueada en modo simulación
- Si todos los huecos de un servicio ya están cubiertos, ese servicio no se ofrece

**Selección por servicio** *(añadido jul-2026)*

El botón **📋 Proponer asignación** (banner de turno de la vista calendario) abre primero un **selector de servicio**, no la propuesta directamente:

- Solo se listan los servicios con **huecos obligatorios sin cubrir** en el mes, con su recuento.
- "Hueco obligatorio" = día que dispara subasta (`subastaTrigger` incluye la etiqueta del día) + habilitado si el servicio lo requiere + `plazas > 0`. **`plazasPorDia: 0` significa ilimitado y queda fuera de la subasta por diseño.**
- Se ofrece además "Todos los servicios a la vez", que conserva el comportamiento anterior.
- Si solo queda **un** servicio con huecos, se omite el selector y se abre su propuesta directamente.

**Por qué servicio a servicio.** Al calcular todos los servicios de una vez, las asignaciones *hipotéticas* del primero entran en la simulación del siguiente y descartan candidatos por conflicto de saliente aunque esas guardias todavía no existan. Repartiendo de uno en uno —y aplicando antes de pasar al siguiente— cada cálculo parte de guardias **reales y confirmadas**. La opción "Todos" se mantiene por comodidad, pero arrastra ese efecto.

**Directiva de implementación:**
Reemplaza el concepto anterior de "Activar subasta ya" (ejecución inmediata sin revisión). La UI debe mostrar un modal o panel de propuesta que permita al admin revisar, ajustar y confirmar antes de que ninguna asignación se persista. No implementar `activarSubastaGlobal` como función de ejecución directa.

**Estado:** implementado. `calcularPropuestaMes(y, m, planName, soloSvc)`, `contarHuecosPorServicio()`, `abrirSelectorPropuestaModal()`, `abrirPropuestaMesModal(y, m, soloSvc)` y `confirmarPropuestaMes()` en `app.js`.

### 8.6 Forzamiento de turno por inactividad

Cuando un residente ha mantenido su turno de elección activo durante más tiempo del umbral configurado sin confirmar una guardia, el admin o delegado puede forzar la asignación de las guardias mínimas requeridas para ese residente y pasar el turno al siguiente.

**Comportamiento:**
- Umbral de inactividad configurable por el admin (en horas), almacenado en la configuración de la promoción
- El sistema asigna al residente inactivo el mínimo de guardias requeridas para ese turno, usando los mismos criterios de prioridad histórica que §8.4
- Tras la asignación, el turno avanza automáticamente al siguiente residente en `ordenSeleccion`
- El residente afectado recibe una notificación de asignación forzosa por inactividad (cuando N1 esté implementado)
- Requiere confirmación explícita antes de ejecutar
- Disponible para `isAdmin` y `isDelegado`
- Solo opera sobre el residente cuyo turno está activo en ese momento — no es una operación global

---

## 9. Sistema de Rotación de Turnos

### 9.1 Estructura de grupos

Los residentes se organizan en **grupos de rotación** con un máximo recomendado de 4 miembros. La distribución `[3,3,3,4,4]` para 17 residentes es una sugerencia, no un requisito rígido. El admin puede ajustar manualmente los tamaños de grupo y el sistema respetará ese orden.

| Nº residentes | Distribución sugerida |
|---|---|
| 1–4 | 1 grupo |
| 5–8 | 2 grupos |
| 9–12 | 3 grupos |
| 13–16 | 4 grupos de 4 |
| 17 | 3-3-3-4-4 |
| 18–20 | Rellenar hacia 5 grupos de 4 |

Los integrantes de un grupo **no se mezclan** con los de otro salvo en una redistribución explícita solicitada por el admin.

### 9.2 Incorporación de nuevos residentes
- Entran por la **parte inferior** del grupo con menor número de miembros en el momento de la incorporación
- En caso de empate de tamaño, entra en el último grupo empatado
- Se preserva el orden relativo de los residentes ya presentes — el reempaquetado automático **no se dispara** salvo que algún grupo supere el máximo de 4 miembros
- Cuando el reempaquetado sí es necesario, el sistema muestra un aviso al admin indicando qué grupos se ven afectados y qué residentes cambian de grupo

### 9.3 Redistribución y nueva base
- Ocurre únicamente cuando un grupo supera 4 miembros o cuando el admin la solicita explícitamente
- El sistema genera una **nueva base de rotación** intentando preservar el orden relativo previo
- El estado de rotación (posición de grupos y miembros) persiste mes a mes en la base de datos
- El orden configurado manualmente por el admin se preserva siempre que sea posible

### 9.4 Lógica de rotación mensual

Cada mes se aplica la siguiente transformación:

```
Mes actual:     [ABC] [DEF] [GHI]
                  ↓     ↓     ↓
Mes siguiente:  [IGH] [CAB] [FDE]
```

Reglas:
- Los **grupos** avanzan una posición hacia abajo (el último pasa a ser el primero)
- Dentro de cada grupo, los **miembros** avanzan una posición hacia abajo (el último del grupo pasa a ser el primero)

### 9.5 Gestión de residentes salientes
- Los **graduados** salen del sistema de rotación activa cuando ya no existe ningún Plan de Guardias activo que les aplique. El criterio no es un número fijo de cambios de contrato sino la ausencia de plan siguiente: una especialidad de 4 años tiene 4 planes (R1–R4) y gradúa al superar R4; una de 5 años tiene 5 planes y gradúa al superar R5.
- Su histórico permanece visible en el contenedor de forma permanente
- No participan en ningún cálculo de turnos futuros

### 9.6 Identidad de grupo y memoria de slots *(pendiente de implementación — W4-B)*

Los grupos tienen **identidad persistente**: no son simples listas de nombres sino colecciones de slots con historia. Este sistema garantiza equidad a largo plazo evitando que un residente quede sistemáticamente en posiciones desfavorables por accidentes de reempaquetado.

#### Slots de grupo
Cada posición dentro de un grupo es un **slot** con los siguientes atributos:
- `titular_actual` — residente activo en el slot en este momento
- `titular_original` — primer residente que ocupó el slot (o el de mayor antigüedad acumulada)
- `meses_ocupacion` — meses que el titular actual lleva en el slot
- `estado` — `activo` | `abierto` (vacante temporal, no cuenta para rotación ni turnos)

#### Memoria inter-plan
Cuando un grupo de residentes transita de un Plan de Guardias al siguiente (R1 → R2, R2 → R3…) el grupo mantiene su identidad: Bea, Carlos y Javi siguen juntos en R2 si estaban juntos en R1. El sistema traspasa la estructura de slots al nuevo plan en lugar de reasignar desde cero.

#### Slots abiertos por acabalgo
Un residente con contrato acabalgado (fechas de cambio de contrato distintas a la mayoría) puede ausentarse temporalmente de su plan. Durante su ausencia:
- Su slot queda `abierto`: no visible en el calendario, no cuenta para rotación ni turnos
- Si entra un nuevo residente, puede ocupar ese slot temporalmente

#### Política de prioridad de slot ("first come, longer stay")
Cuando el titular original de un slot regresa tras una ausencia:
- Si el slot está `abierto` → recupera su posición
- Si el slot está ocupado por un sustituto:
  - Si el sustituto lleva **menos meses** que el titular original acumuló en su día → el titular original recupera el slot
  - Si el sustituto lleva **más meses** que el titular original → el slot pertenece al sustituto; el titular original se incorpora como nuevo residente (grupo más pequeño)

#### Residentes fijos (chincheta)
Algunos residentes tienen requisito de RRHH de conciliación que les garantiza siempre la primera posición de elección. Se marcan como `residentesFijos` y se sitúan en un grupo especial al inicio de la rotación, no sujetos al algoritmo de slots. Ya implementado parcialmente en `pr.residentesFijos[]`.

---

## 10. Restricciones de Saliente y Entrante

### Definición
Una guardia genera **saliente**: el día siguiente al fin de la guardia el residente no trabaja y no puede comenzar otra guardia.

### Tipos de conflicto bloqueados por el sistema

| Conflicto | Descripción |
|---|---|
| **Saliente** | Se intenta asignar una guardia en un día en que el residente ya tiene saliente de una guardia previa |
| **Entrante** | Se intenta asignar una guardia cuyo saliente coincide con el día de inicio de otra guardia ya asignada |

### Alcance
- Aplican cruzando **todos los servicios del contenedor**
- Los residentes tienen contratos de exclusividad: no se producen conflictos entre contenedores distintos

### Restricciones en operaciones de mercadillo
En el mercadillo aplican **únicamente dos** tipos de restricción (las demás — tipo de día, huecos habilitados, cupo mensual — no aplican):

1. **Saliente/entrante** — igual que en la asignación ordinaria
2. **Regla de intercambio del servicio (`reglaIntercambio`)** — configurada por el admin por servicio. Permite controlar, por ejemplo, que un R1 no pueda comprar, vender ni cambiar guardias con residentes de mayor seniority. Opciones: `superior` (solo puede operar con el mismo año o superiores), `solo_mismo` (solo dentro del mismo año de residencia), `no_r1` (excluye a R1 de ambos lados), `cualquiera` (sin restricción de año).

---

## 11. Mercadillo de Guardias

Opera exclusivamente sobre **guardias futuras** (que ninguna de las partes haya realizado aún).

**Restricciones aplicables:** saliente/entrante y la `reglaIntercambio` configurada para el servicio (ver §10). No aplican restricciones de tipo de día, huecos habilitados ni cupo.

**Auditoría:** Cada operación genera una entrada en el log público y una notificación in-app a todos los usuarios implicados.

### 11.1 Modelo de propuesta
- Todas las operaciones son **dirigidas**: proponente → objetivo concreto (interno o externo)
- No existen ofertas públicas abiertas en v1.0 (posible extensión futura)
- Un **externo** es un residente de otra especialidad del mismo hospital que no tiene cuenta en la app

### 11.2 Interfaz de selección — Calendario miniatura

El punto de entrada es un calendario miniatura con el siguiente flujo:

```
Usuario selecciona día
    → Sistema muestra guardias asignadas ese día (todos los residentes del contenedor)
    → Usuario selecciona su propia guardia como parte proponente
    → Sistema presenta opciones: Comprar / Vender / Intercambiar
```

### 11.3 Compra

| Objetivo | Comportamiento |
|---|---|
| **Interno** | Transfiere la guardia del cedente al comprador. Requiere aceptación del cedente. |
| **Externo** | Crea ("spawnea") la guardia directamente en el calendario del comprador. Sin confirmación de segunda parte. |

### 11.4 Venta

| Objetivo | Comportamiento |
|---|---|
| **Interno** | Transfiere la guardia al comprador. Requiere aceptación del comprador. |
| **Externo** | Elimina la guardia del calendario del vendedor sin asignarla a nadie. Sin confirmación de segunda parte. |

### 11.5 Intercambio

**Con interno:**
1. Proponente selecciona su guardia (día origen) y la del interno (día destino)
2. El interno recibe la propuesta y acepta o rechaza
3. Si acepta: ambas guardias intercambian titular

**Con externo** (dos rutas equivalentes):

```
Ruta A:
  Clic en día destino
    → Popup "Intercambio → Cambio a externo"
    → Seleccionar cuál de mis guardias mover a esa fecha

Ruta B:
  Clic en mi guardia
    → "Intercambiar → Cambio a externo → Seleccionar fecha"
    → Elegir fecha destino en calendario
```

En ambas rutas: la guardia se mueve al día destino. Solo se verifica saliente/entrante sobre la nueva fecha. Sin confirmación de segunda parte.

---

## 12. Notificaciones

Todas las notificaciones son **in-app** en v1.0.

| Evento | Destinatario |
|---|---|
| Le toca turno de asignación mensual | Residente en turno |
| Se le ha asignado una guardia forzada | Residente afectado |
| Se abre la ventana voluntaria | Todos los residentes del contenedor |
| Propuesta de compra/venta/intercambio recibida | Residente implicado |
| Propuesta de mercadillo aceptada o rechazada | Residente proponente |
| Hueco obligatorio sin candidato válido tras forzamiento | Admin y delegados |

> **Extensión futura posible:** Notificaciones push o email para eventos de alta prioridad (turno de asignación, guardia forzada).

---

## 13. Histórico, Auditoría y Navegación Temporal

### 13.1 Selector de mes — Principio universal
En **cualquier vista** donde se actúe sobre datos de un mes concreto, la interfaz expone un selector de mes explícito. Sin excepción. No existe ninguna vista con mes implícito o "mes actual" como valor por defecto no modificable.

Vistas afectadas: asignación, rotación, mercadillo, recuento de horas, auditoría, panel de admin.

**Fuente única de verdad:** El mes activo está controlado por una única variable global (`curDate`). Ninguna vista mantiene su propio estado de mes independiente. Los controles ◀/▶ del header actualizan `curDate` y todas las vistas reaccionan en consecuencia.

### 13.2 Registro histórico
El sistema conserva un registro **completo** de:

- Asignaciones realizadas en cada ciclo mensual
- Operaciones de mercadillo: fecha, partes implicadas, tipo de operación, resultado
- Guardias forzadas: criterio aplicado, candidatos descartados, residente asignado
- Huecos sin cubrir: causa registrada (sin candidato válido)

**Política de modificación del registro:** El registro no es estrictamente inmutable. Están permitidas las siguientes operaciones de corrección:
- El admin puede eliminar entradas del log de excepciones (por errores de registro)
- Los residentes pueden solicitar deshacer operaciones de mercadillo ya consumadas (compra, venta, cambio), con aceptación de la otra parte cuando aplique
- Cualquier modificación queda implícitamente reflejada en el estado resultante del calendario

### 13.3 Acceso y visibilidad
- **Público dentro del contenedor:** residentes, delegados y admin pueden consultarlo
- Funciona como **audit trail transparente y revisable** de los cambios sobre las asignaciones
- Los graduados y residentes salientes mantienen su histórico visible de forma permanente

---

## 14. Recuento de Horas

- Calcula horas acumuladas por residente en el **mes** y en el **año**
- La suma se calcula a partir de las horas configuradas por tipo de guardia y servicio (§6)
- Visible para el residente, delegados y admin
- Selector de mes presente en la vista

---

## 15. Panel de Administración

### Acciones disponibles para Admin y Delegados

- Supervisar el progreso de los turnos de asignación del mes en curso
- Gestionar incidencias del mercadillo y del forzamiento
- Registrar bajas, prórrogas y fechas de cambio de contrato
- Gestionar incorporaciones y nombres de display de residentes
- Consultar el registro de huecos sin candidato válido
- Consultar el histórico completo del contenedor

### Acciones exclusivas del Admin

- Crear y configurar servicios, tipos de guardia y características horarias
- Definir el calendario de huecos de cada servicio (manual o automático)
- Configurar reglas de asignación mínima por Plan de Guardias
- Definir y editar el calendario de festivos locales
- Configurar la duración de la ventana voluntaria y los criterios de forzamiento
- Gestionar roles (designar y revocar delegados)
- Gestionar redistribuciones de grupos de rotación
- Activar el modo de simulación de vista de residente (seleccionar residente a simular desde el panel del calendario)

---

## 16. UI/UX — Notas y Extensiones Pendientes

> Esta sección es un espacio vivo para recoger decisiones de diseño, patrones de interacción y funcionalidades de interfaz que se definirán durante el desarrollo. Añadir aquí antes de implementar.

### 16.1 Patrones de interacción definidos

- **Calendario miniatura** como punto de entrada al mercadillo (§11.2)
- **Selector de simulación** en el panel del calendario admin para activar vista de residente (§3.3), con banner morado sticky mientras la simulación está activa
- **Selector de mes** universal y explícito en todas las vistas con datos temporales (§13.1)
- **Validación en tiempo real** durante la selección de guardias (§8.1)
- **Popup contextual** para operaciones de intercambio con externo (§11.5)
- **Código de color por servicio** en el calendario de huecos (§5.1)

### 16.2 Rediseño visual — tema oscuro *(en curso, jul-2026)*

Rediseño por capas hacia una interfaz tipo Google Calendar, **oscura por defecto** (los residentes la usan en el móvil de madrugada). Brief completo y plan por pasos en `GestionGuardias_REDISENO.md`.

**Decisiones cerradas:**

| Tema | Decisión |
|---|---|
| Paleta | Google Calendar dark: `--bg #202124`, `--surface #2d2e30`, `--border #3c4043`, `--text #e8eaed`, `--text-2 #9aa0a6` |
| `svc.color` como fondo | Se pinta el hex **exacto** del plan, sin derivar |
| `svc.color` como texto | Prohibido. Se usa chip de fondo con texto calculado, o punto de color + texto neutro |
| Contraste del texto sobre chip | Blanco por defecto; negro solo si el blanco no alcanza 3:1 (`contrastText()`) |
| Iconos | SVG inline temables (`icon()`), migrados solo en la vista calendario |
| Alcance por PR | Una vista por PR; el resto queda en claro hasta que le toque |
| Suelo de `--text-3` | Está calculado **sobre `--surface`**. Sobre `--surface-2` cae a 4.1:1, así que el texto secundario de cualquier elemento elevado debe ser `--text-2` (4.57:1) |
| Rojos de aviso sobre `--surface-2` | `--fest-d` se queda en 4.36:1, y un tinte rojo translúcido lo **empeora** porque aclara el fondo. Se hunden a `--bg` (5.82:1) y el aviso lo aporta el borde, como ya hace `button.danger` |

**Regla dura:** los colores de servicio (`svc.color`) son **dato del plan**, elegidos por el usuario y guardados en Supabase. El rediseño no los tokeniza, no los altera y no los almacena en CSS.

**Implementado:**
- [x] Fundación de tokens en `:root` (neutros, espaciado, radios, elevación, acentos dark-safe)
- [x] Chrome compartido: cabecera, tarjetas, pestañas, botones, formularios, pie, modales, notificaciones
- [x] Vista calendario: rejilla, día actual resaltado, festivos, chips de guardia, contadores de plazas
- [x] Panel de día como **bottom sheet** en móvil (reskin de `openShiftModal`, lógica intacta)
- [x] Primeras `@media` del proyecto (antes no había ninguna)
- [x] Objetivos táctiles ≥44px y contrastes verificados con `design-reviewer`
- [x] Vista mercadillo (`#pane-merc`): rejilla, panel de día como bottom sheet, filtro por clase, buzón y log público

**Pendiente:**
- [ ] Resto de vistas: rotación, grupos, perfil, ayuda, admin
- [ ] Cabecera PWA: `manifest.json`, iconos, `theme-color`, metas apple *(instalable, sin offline)*

### 16.3 Pendiente de diseño

- [ ] Estado visual de los huecos: libre / ocupado / obligatorio / propio / ajeno
- [ ] Flujo de onboarding para nuevos residentes
- [ ] Vista de rotación de grupos (cómo se visualiza la lista y el avance mensual)
- [ ] Vista del histórico y audit trail (filtros, paginación, exportación)
- [ ] Interfaz del motor de reglas de asignación mínima (para el admin)
- [ ] Vista de recuento de horas con comparativa entre residentes
- [ ] Estados vacíos (contenedor recién creado, mes sin huecos, etc.)

### 16.4 Ideas anotadas para versiones futuras

- Ofertas públicas en el mercadillo (guardia en oferta abierta a cualquier residente)
- Notificaciones push / email para eventos de alta prioridad
- Exportación del calendario a iCal / Google Calendar
- Vista comparativa de horas entre residentes del contenedor
- Dashboard de carga asistencial para el admin (huecos sin cubrir históricos, forzamientos)

---

## 17. Stack y Modelo de Datos

> Sección a completar por Engineering Lead. Se incluye el modelo conceptual derivado del PRD.

### 17.1 Autenticación
Google OAuth (definido en §3.1)

### 17.2 Entidades principales del modelo de datos

```
Contenedor
  - id
  - hospital
  - especialidad
  - admin_id (FK → Usuario)
  - festivos_localidad[]
  - ventana_voluntaria_horas

Usuario
  - id
  - google_id
  - nombre_display
  - contenedor_id (FK → Contenedor)
  - fecha_inicio_residencia
  - fecha_cambio_contrato
  - rol (residente | delegado | admin)
  - bajas[]

PlanGuardias
  - id
  - contenedor_id (FK → Contenedor)
  - año_residencia (R1 | R2 | R3 | R4)
  - servicios[] (FK → Servicio)
  - reglas_minimas[]
  - criterios_forzamiento[]

Servicio
  - id
  - plan_id (FK → PlanGuardias)
  - nombre
  - color
  - modo_calendario (automatico | manual)
  - patron_automatico (opcional)
  - caracteristicas_por_tipo_dia[]
  - subastaTrigger[] (tipos de día que disparan ventana voluntaria y forzamiento)
  - reglaIntercambio (superior | solo_mismo | no_r1 | cualquiera)
  - plazasPorDia
  - cupoMensualTotal

Hueco
  - id
  - servicio_id (FK → Servicio)
  - fecha
  - tipo_dia
  - capacidad
  - asignaciones[] (FK → Asignacion)
  ← obligatoriedad modelada en Servicio.subastaTrigger[], no por hueco individual

Asignacion
  - id
  - hueco_id (FK → Hueco)
  - usuario_id (FK → Usuario)
  - tipo (voluntaria | forzada | mercadillo_compra | mercadillo_spawn)
  - timestamp

GrupoRotacion
  - id
  - contenedor_id (FK → Contenedor)
  - miembros[] (FK → Usuario, ordenado)
  - posicion_actual

OperacionMercadillo
  - id
  - tipo (compra | venta | intercambio)
  - proponente_id (FK → Usuario)
  - objetivo_id (FK → Usuario | null si externo)
  - asignacion_origen_id (FK → Asignacion)
  - asignacion_destino_id (FK → Asignacion | null)
  - estado (pendiente | aceptada | rechazada)
  - timestamp

Notificacion
  - id
  - usuario_id (FK → Usuario)
  - tipo
  - payload (JSON)
  - leida (bool)
  - timestamp

EventoAuditoria
  - id
  - contenedor_id (FK → Contenedor)
  - tipo
  - actor_id (FK → Usuario)
  - payload (JSON)
  - timestamp
```

### 17.3 Stack tecnológico
> A definir por Engineering Lead.

---

## 18. Decisiones Pendientes y Changelog

### Decisiones pendientes
> Mover a "resuelto" cuando se tome la decisión.

| # | Decisión | Contexto |
|---|---|---|
| D-01 | Stack tecnológico | Backend, frontend, base de datos, hosting |
| D-02 | Fuente de importación de festivos | API pública del calendario laboral español por localidad |
| D-05 | Umbral de `contrastText()` | Usa 3:1 (texto grande) sobre chips de ~10.5px que pedirían 4.5:1. Subirlo cambiaría a texto negro los servicios azules y rojos |
| D-06 | Guardas de simulación en el mercadillo | §3.3 promete que la simulación es "puramente visual", pero ningún punto de escritura del mercadillo comprueba `simulatedViewUser`. Decidir entre bloquearlo (coherente con el resto de la app) o habilitar de forma explícita la operación en nombre de otro, con su rastro en el log |
| D-07 | Renombrar un servicio deja huérfanas sus guardias | `state.shifts` guarda el **nombre** del servicio como valor, y `state.habilitaciones` lo usa dentro de la clave `svc@@plan`. Cambiar el nombre en Ajustes no arrastra ninguna de las dos cosas: las guardias ya asignadas dejan de casar con ningún servicio y desaparecen del calendario y del mercadillo, y el servicio se queda sin días habilitados. Por eso D-04 **señala** los nombres problemáticos en vez de corregirlos: cualquier reescritura automática dispararía este efecto sin que nadie pidiera un renombrado. Resolverlo pide una migración que recorra `shifts`, `habilitaciones` y los `trades` pendientes, o pasar a identificar el servicio por `id` en lugar de por nombre |
| D-10 | El solicitante de un cambio no recibe notificación de su propia petición | `_notifyNewTrade` avisa **solo al destinatario**. Quien envía la propuesta no ve nada en su panel: para cancelarla tiene que ir al Log Público y encontrarla, y el log filtra por mes, así que una propuesta cuya fecha más tardía cae en otro mes **no aparece en el mes que estás mirando**. Pedido (ago-2026): que el solicitante reciba una autonotificación de «pendiente de aceptar» con acción de cancelar. `cancelPendingTrade` ya borra el trade entero, así que una solicitud cancelada antes de aceptarse **no debe dejar rastro en el log** — eso ya se cumple y hay que conservarlo |
| D-11 | «Editar especialidad» renombra la promoción en sitio, sin aviso | `adminUpdatePromoDetails` hace `UPDATE promociones SET servicio, hospital WHERE id = <la tuya>`. No crea un grupo nuevo: **reescribe el que ya tienes**. Ocurrió de verdad (ago-2026): la promoción quedó renombrada y la original desapareció del listado de Grupos porque ya no existía, mientras guardias y plan seguían intactos —misma fila— lo que hacía el síntoma desconcertante. Nada se pierde y se revierte con el mismo formulario, pero el formulario debería decir qué va a hacer y pedir confirmación |
| D-09 | `subastaCriterioServicio` guarda un nombre que puede dejar de existir | El `<select>` de «a quien haya hecho menos guardias en el servicio X» se rellena en tiempo de render con los nombres del plan. Si se renombra un servicio, el `<select>` conserva la opción vieja y el siguiente `syncConfigFromUI` persiste un nombre inexistente. Ese valor alimenta `_getHistoricoParaCriterio`: el histórico sale 0 para todos, empate general, y la guardia desierta se reparte por el desempate o por sorteo. **Corre limpio y asigna mal.** Familia de D-07; se resuelve igual, identificando el servicio por `id` en vez de por nombre. Detectado en la tercera auditoría (ago-2026) |
| D-08 | Unicidad del nombre de **plan** | Mismo defecto que D-04 un nivel más arriba y aún abierto. `getSvcConfig` y `getPlanVistaContext` resuelven el plan por nombre con `find`, así que dos planes homónimos hacen que los residentes del segundo reciban cupos, horas, pernocta y reglas del primero — corre limpio y asigna mal. `adminAddPlan` ya no genera duplicados por su cuenta (autonumera saltando los ocupados), pero **nada impide teclear el mismo nombre en dos planes**. Falta decidir si se extiende la puerta de `adminSaveConfig` a los nombres de plan, sabiendo que eso bloquearía el guardado a cualquier promoción que ya tenga el duplicado |

**Resueltas**

| # | Decisión | Resolución |
|---|---|---|
| D-03 | Prioridad de diseño mobile | **Mobile-first.** Los residentes usan la app en el móvil de madrugada; la legibilidad y el tamaño táctil priman sobre la densidad. Ver §16.2 |
| D-04 | Unicidad del nombre de servicio dentro de un plan | **Obligatoria dentro de cada plan; libre entre planes.** La clave de comparación normaliza a NFC, colapsa espacios (incluido el espacio duro) y pasa a minúsculas. Las tildes **sí** diferencian: son visibles. La normalización Unicode no es cosmética — `Pediatría` tecleada en Windows (NFC) y pegada desde macOS (NFD) son cadenas distintas e idénticas en pantalla, y sin normalizar pasaban la validación. Un nombre vacío cuenta como inválido. `adminSaveConfig` aborta el guardado y señala el conflicto abriendo el plan afectado; `adminAddService` autonumera para no crearlo. **La app nunca reescribe el nombre por su cuenta** (ver D-07): los espacios sobrantes se señalan, no se recortan en silencio |

### Changelog

| Versión | Cambios principales |
|---|---|
| v0.1 | Texto inicial de requerimientos en lenguaje natural |
| v0.2 | Primera estructuración formal: motor de turnos, rotación, festivos, huecos, forzamiento, multiusuario R1-R4, jerarquía de datos |
| v0.3 | Incorporación de: redistribución de grupos con nueva base, exclusividad de contratos, forzamiento sin candidato como evidencia, notificación in-app de ventana voluntaria, mercadillo con externos, histórico permanente de graduados |
| v0.4 | Mercadillo detallado (spawn/eliminación con externos), notificaciones expandidas, log de auditoría público, selector de mes universal, registro histórico inmutable |
| v0.5 | Intercambio con externo (dos rutas UI), modelo de propuesta dirigida, graduates mantienen histórico, flujo completo del mercadillo con calendario miniatura |
| v0.6 | Roles y autenticación: Google OAuth, roles acumulativos, toggle admin/residente, delegados múltiples. Distribución de permisos admin vs delegado. Sección UI/UX pendiente añadida. |
| v0.7 | Alineación con implementación real: obligatoriedad modelada a nivel de servicio (subastaTrigger), no por hueco individual. Mercadillo aplica dos restricciones: saliente/entrante + reglaIntercambio. Criterio de graduación por ausencia de plan (no por número fijo de cambios). Registro histórico revisable (no inmutable): admin puede corregir logs, residentes pueden deshacer operaciones de mercadillo consumadas. Modelo de datos de Servicio y Hueco actualizados. |
| v0.8 | §3.3 actualizado: modo simulación con selector en calendar banner, write guards, banner sticky y sesión real inalterada. §8.4: nota de soft-lock en asignación manual forzosa. §15: "toggle" → selector de simulación. §16.1: referencia actualizada. Roles: modelo de datos incluye `delegado` en `Usuario.rol`. |
| v0.9 | §9.1: distribución de grupos como sugerencia, no requisito rígido. §9.2: política de inserción en grupo mínimo sin reempaquetado automático salvo necesidad, aviso al admin cuando grupos se ven afectados. §9.3: redistribución solo bajo demanda o desbordamiento. §9.6 nuevo: identidad de grupo y memoria de slots (W4-B, pendiente). |
| v1.0 | §13.1: clarificación de fuente única de verdad (`curDate`); eliminada la excepción implícita de la vista de Rotación que mantenía su propio estado de mes independiente. |
| v1.1 | §8.5 nuevo: override de emergencia "Activar subasta ya" con directiva de implementación (`activarSubastaGlobal`, ruta paralela sin modificar funciones existentes). |
| v1.2 | §8: invariante de reset (limpiar `subastasCerradasForzosas`), panel de turno solo en mes activo/futuro. §8.3: calendario abierto durante ventana voluntaria, `isMyTurn` no bloquea en estado `subasta_abierta`. |
| v1.3 | §8.5 rediseñado: "Propuesta de asignación automática" reemplaza "Activar subasta ya" — propuesta editable con revisión admin antes de ejecutar, no destructiva hasta confirmar. §8.6 nuevo: "Forzamiento de turno por inactividad" — umbral configurable, admin/delegado asigna mínimo al residente inactivo y avanza turno. |
| v1.5 | §3.3: desviación conocida — el mercadillo no aplica el bloqueo de escritura en simulación (D-06 nueva). §16.2: mercadillo migrado al tema oscuro (Paso 5). D-04 resuelta: unicidad de nombre de servicio obligatoria dentro de cada plan, libre entre planes, con el guardado bloqueado cuando hay choque. D-07 nueva: renombrar un servicio deja huérfanas sus guardias y habilitaciones — es la razón de que D-04 señale en vez de corregir. D-08 nueva: el mismo problema de unicidad, sin resolver, en los nombres de plan. |
| v1.4 | §8.5: **selección por servicio** — el admin elige sobre qué servicio lanzar la propuesta; solo se ofrecen los que tienen huecos obligatorios sin cubrir (`plazasPorDia: 0` = ilimitado queda fuera). Se documenta por qué el reparto encadenado falsea los descartes por saliente. §16.2 nueva: rediseño visual a tema oscuro (paleta, reglas de `svc.color`, estado por vista). §16 renumerada. D-03 resuelta (mobile-first); D-04 y D-05 nuevas. |
