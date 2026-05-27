# GestionGuardias App — Product Requirements Document
**Versión:** 0.8  
**Estado:** Funcionalidad core cerrada — abierto a extensiones UI/UX  
**Audiencia:** Engineering Lead, desarrolladores, diseñadores  
**Última actualización:** Mayo 2026

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
| **Residente** | Accede a su calendario, realiza asignación mensual, opera en el mercadillo, consulta histórico público |
| **Delegado** | Todo lo de Residente + funciones administrativas operativas (sin configuración estructural ni gestión de roles) |
| **Admin** | Acceso completo: configuración estructural, gestión de roles, todos los registros |

Los roles son **acumulativos**: un admin o delegado es simultáneamente residente activo y participa en la rotación con normalidad.

### 3.3 Vista de Simulación (Admin)
El admin puede activar un **modo de simulación** seleccionando cualquier residente del contenedor desde el panel del calendario. Mientras está activo:
- La app renderiza completamente desde la perspectiva del residente seleccionado (turno activo, progreso, vista de huecos)
- Un banner morado permanente en la parte superior indica que la simulación está activa
- Cualquier acción de escritura está bloqueada — el modo es puramente visual
- El admin sale mediante el botón "Salir de simulación" del banner

La sesión real del admin no se ve afectada: `loggedInUser`, `isAdmin` e `isDelegado` permanecen inalterados.

### 3.4 Delegados
- Puede haber **múltiples delegados** por contenedor
- El admin los designa y puede revocar su rol en cualquier momento
- Objetivo: distribuir carga operativa de supervisión sin otorgar acceso estructural completo

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

### 8.4 Forzamiento
Transcurrida la ventana voluntaria, los huecos obligatorios sin cubrir se asignan forzosamente:

- **Elegibles:** Solo residentes del Plan de Guardias al que pertenece el hueco
- **Criterios de prioridad:** Configurables por el admin (ej. menor nº de festivos realizados, menor nº de guardias totales). El admin ordena los criterios según su preferencia
- **Restricción activa:** Saliente/entrante siempre respetado
- **Notificación:** El residente afectado recibe notificación in-app
- **Sin candidato válido:** Si todos los elegibles tienen conflicto de saliente/entrante → el hueco queda sin cubrir, se notifica al admin y delegados, y queda registrado en el sistema como evidencia de exceso de carga asistencial
- **Soft-lock en asignación manual:** Cuando el admin asigna forzosamente a un residente desde el calendario, el sistema advierte si la asignación viola restricciones de saliente/entrante. El admin puede confirmar de todas formas (aviso sin bloqueo).

---

## 9. Sistema de Rotación de Turnos

### 9.1 Estructura de grupos

Los residentes se organizan en **grupos de rotación** con un máximo de 4 miembros.

| Nº residentes | Distribución de grupos |
|---|---|
| 1–4 | 1 grupo |
| 5–8 | 2 grupos |
| 9–12 | 3 grupos |
| 13–16 | 4 grupos de 4 |
| 17 | 3-3-3-4-4 (redistribución) |
| 18–20 | Rellenar hacia 5 grupos de 4 |

Los integrantes de un grupo **no se mezclan** con los de otro salvo en una redistribución explícita.

### 9.2 Incorporación de nuevos residentes
- Entran por la **parte inferior** del grupo con menor número de miembros en el momento de la incorporación
- Se preserva el orden relativo de los residentes ya presentes
- Los residentes que "acabalgan" su residencia (fecha de cambio de contrato distinta a la mayoría) entran en el grupo correspondiente al nuevo plan manteniendo esta lógica

### 9.3 Redistribución y nueva base
- Ocurre al superar el límite de grupos completos o cuando el número de residentes activos lo requiere
- El sistema genera una **nueva base de rotación** intentando preservar el orden relativo previo
- El estado de rotación (posición de grupos y miembros) persiste mes a mes en la base de datos

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

### 16.2 Pendiente de diseño

- [ ] Diseño de la vista principal del calendario mensual
- [ ] Estado visual de los huecos: libre / ocupado / obligatorio / propio / ajeno
- [ ] Flujo de onboarding para nuevos residentes
- [ ] Vista de rotación de grupos (cómo se visualiza la lista y el avance mensual)
- [ ] Diseño del panel de notificaciones in-app
- [ ] Vista del histórico y audit trail (filtros, paginación, exportación)
- [ ] Interfaz del motor de reglas de asignación mínima (para el admin)
- [ ] Vista de recuento de horas con comparativa entre residentes
- [ ] Diseño responsivo / mobile (¿es prioritario en v1.0?)
- [ ] Estados vacíos (contenedor recién creado, mes sin huecos, etc.)

### 16.3 Ideas anotadas para versiones futuras

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
| D-03 | Prioridad de diseño mobile en v1.0 | ¿Responsivo completo o desktop-first? |

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
