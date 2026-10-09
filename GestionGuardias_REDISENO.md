# Rediseño GestionGuardias — Brief de arranque

> **Para qué es este documento.** Es el punto de partida de una conversación nueva dedicada al rediseño visual y a la conversión a PWA. Reúne las decisiones ya tomadas, las restricciones que no se negocian, los hallazgos del inventario del código actual y el plan por capas. La conversación nueva debe **leer este archivo primero** y arrancar por el Paso 1. No re-explorar lo que aquí ya está resuelto.

---

## 1. Contexto

App de asignación de guardias médicas. Vanilla JS **sin build step**: `index.html` (393 líneas) + `style.css` (355 líneas) + `app.js` (~7.267 líneas), backend en Supabase. Los residentes la usan en el **móvil, a las 3 de la mañana** — legibilidad y tamaño táctil pesan más que densidad de información.

Aplican todas las reglas de `CLAUDE.md`: no Python para editar archivos del proyecto, rama temporal por feature, confirmar rama antes de push/merge, aviso previo en cualquier operación de Supabase, trabajo por sección (nunca todo `app.js` a la vez), sin funciones muertas ni inconsistencias de mayúsculas/minúsculas.

## 2. Objetivo (decisiones cerradas)

1. **Patrón de interacción tipo Google Calendar.** Tocar un día → se despliegan las acciones de ese día. En el calendario: asignar guardias. En el mercadillo: comprar / vender / cambiar.
2. **PWA instalable.** Que el residente la instale en el móvil: icono, pantalla completa, arranque rápido. Aditivo (`manifest.json`, iconos, `theme-color`, metas `apple-mobile-web-app-*`). **Sin modo offline.**
3. **Rediseño responsive**, **modo oscuro por defecto** (menos fatiga visual en guardia nocturna).

### Fuera de alcance (no reabrir)
- **Nada de framework** (React/Vue/…). **Nada de partir `app.js` en módulos ES.** Son decisiones ya tomadas.
- No se toca la lógica de negocio: motores de asignación, `toggleShift`, `executeBuyRequest`, intercambios. Solo se reviste la **presentación**.

## 3. Restricciones críticas del rediseño

### 3.1 Los colores de servicio son DATO, no diseño — intocables
Cada servicio tiene su `svc.color` (hex) **configurado en el plan de guardias y guardado en Supabase**. Se elige por el usuario; el rediseño **no lo tokeniza ni lo restiliza**.
- Helper que lo devuelve: `app.js:2340` (fallback `#3b82f6`). Validación/default: `app.js:521`.
- Se pinta inline por JS: fondo de badges (`app.js:2662`, `app.js:3008`) y **color de texto** del nombre de servicio (`app.js:2750`).
- **Consecuencia para modo oscuro:** esos hex se eligieron para fondo claro. Usados como *texto* sobre fondo oscuro pueden volverse ilegibles. Regla de diseño: tratar `svc.color` como **chip de fondo con color de texto de contraste calculado**, o como **punto/borde de color** — nunca asumir que se lee como texto sobre oscuro. Cualquier hex arbitrario del usuario debe quedar legible.

### 3.2 Qué SÍ se tokeniza
Solo la **escala de grises neutros** (hoy hardcodeada y repetida por docenas: `#64748b`, `#cbd5e1`, `#e2e8f0`…) y los **acentos de chrome** `--ped/--adu/--fest/--merc`, que se ajustan a versiones legibles sobre fondo oscuro conservando su significado (pediatría/adultos/festivos/mercadillo). El *significado* de cada acento no se mueve.

## 4. Modelo de interacción — ya existe, se reviste

El patrón "clic en día → opciones" **ya está implementado**; lo que falta es que *parezca* Google Calendar.
- Calendario: cada celda hace `cell.onclick = () => openShiftModal(...)` (`app.js:2686`). El modal ya trae "Elegir"/"Quitar" (`app.js:2826`) vía `toggleShift`.
- Mercadillo: cada celda hace `openMercadoModal(...)` (`app.js:3013`), con "Vender" / "Cambiar" / "Comprar" (`app.js:3041`, `app.js:3057`).

**Trabajo real:** (a) que la rejilla se vea como un calendario de verdad; (b) convertir esos modales en un **panel de día**. En móvil eso es un **bottom sheet** (sube desde abajo, al alcance del pulgar, se cierra deslizando), no un modal centrado. Los modales se construyen como plantillas HTML **dentro de `app.js`** (`openShiftModal`, `openMercadoModal`): se reescribe cómo se *dibuja* el día, no cómo se *asigna* la guardia.

## 5. Estado actual — hallazgos del inventario

- **Cero `@media` en todo el CSS.** Hoy es "desktop fluido con `flex-wrap`". El responsive parte de lienzo limpio.
- **Grises Tailwind hardcodeados y repetidos** (no son variables): `#64748b` (~8×), `#cbd5e1` (~15×), `#e2e8f0` (repetidísimo), más acentos a mano (`#7c3aed` 5×, `#d97706`, `#ef4444` literal en vez de `--fest`).
- **Estilos inline por todo `index.html`** (colores, paddings, `display:none`): rediseñar obliga a tocar el HTML, no solo el CSS. Es la deuda dominante.
- **Doble `:root`** (`style.css:1` y `style.css:72`) — consolidar.
- **`!important` frágiles** (9 usos), incluido el hack `.notif-panel[style*="display: flex"]` (`style.css:254`) acoplado al inline style de JS.
- **`<head>` sin PWA:** falta `manifest.json`, iconos apple-touch, `theme-color`, `color-scheme`, metas `apple-mobile-web-app-*`. El `meta viewport` sí está bien (`index.html:5`) y hay `lang="es"`.
- **Iconografía = emojis** en texto (🗓️🛒🔒…): no temables como sistema de iconos. (Decisión abierta si se sustituyen o no.)
- Sin escala tipográfica: tamaños `rem` ad-hoc (`0.62`…`1.2`) sin sistema. Familia única `system-ui`.

## 6. Plan por capas

Orden pensado para no dejar la app en estado roto y respetar el trabajo por sección. Todo en la rama `feature/rediseno-calendario`.

- **Paso 0 — Verificar antes de tokenizar.** Confirmar en código/Supabase exactamente dónde vive cada `svc.color` y que ningún token propuesto los pisa. Resolver con el usuario las decisiones abiertas (§8).
- **Paso 1 — Fundación de tokens oscuros** en `:root`: fondos, superficies elevadas, texto, bordes; escala de espaciado y de radios (hoy `4/6/8/10/12/20px` a ojo); acentos de chrome dark-safe. **No** service colors.
- **Paso 2 — Extraer estilos inline** de `index.html` a clases que consuman los tokens.
- **Paso 3 — Piloto: calendario** (`#pane-cal`). Rejilla estilo Google Calendar (día legible, hoy resaltado, guardias con color de servicio como chip, buen target táctil) + panel de día como **bottom sheet** (reskin de `openShiftModal`, lógica intacta).
- **Paso 4 — Validación del piloto:** subagente `design-reviewer` (contraste y targets medidos) y, por tocar `app.js`, subagente `testing-lead` antes de proponer merge.
- **Paso 5 — Propagar al mercadillo** (`#pane-merc`): mismo patrón, reskin de `openMercadoModal`.
- **Paso 6 — Resto de vistas** (rotación, grupos, perfil, admin), vista por vista.
- **Paso 7 — Cabecera PWA:** `manifest.json`, iconos, `theme-color`, `color-scheme`, metas apple.

**Piloto = calendario. Tema = oscuro por defecto.** Cada capa se enseña en el navegador (preview) antes de propagar.

## 7. Workflow y agentes

- Rama **`feature/rediseno-calendario`**. Confirmar la rama exacta antes de cualquier push o merge. Merge hacia `GestionGuardias-BETA` solo tras validación del `testing-lead`. `main` es PRODUCCIÓN.
- Cualquier operación en Supabase: avisar con proyecto (`https://elmpelhplacgkgfuiwno.supabase.co`), tabla y SQL, y esperar confirmación.
- Subagentes disponibles (en `.claude/agents/`): **`design-reviewer`** (audita CSS/HTML contra usabilidad móvil: targets táctiles, contraste, legibilidad) y **`testing-lead`** (audita lógica antes de merge). Para reconocimiento amplio de solo lectura, usar el agente **Explore**. Pasarles siempre los fragmentos relevantes en el brief.

## 8. Decisiones abiertas — resolver con el usuario al arrancar

1. **Referencias visuales concretas** más allá de "estilo Google Calendar" (¿alguna captura o app de referencia?).
2. **Paleta exacta de neutros oscuros** (nivel de fondo, superficies, texto primario/secundario).
3. **`svc.color` en oscuro:** ¿chip de fondo con texto de contraste calculado, o punto/borde de color? (§3.1).
4. **Emojis como iconos:** ¿se mantienen o se migra a un set de iconos temables?
5. **Alcance del primer PR:** ¿solo el piloto de calendario, o calendario + mercadillo juntos?

---

### Primer mensaje sugerido para la conversación nueva
> Lee `GestionGuardias_REDISENO.md` y arranquemos el rediseño. Antes de tocar nada, repasemos juntos las decisiones abiertas de la §8 y confírmame el Paso 0. La rama será `feature/rediseno-calendario` — no la crees hasta que te lo confirme.
