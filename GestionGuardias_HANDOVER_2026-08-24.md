# Handover — Sesión del 24 de agosto de 2026

> **Para qué es este documento.** Cerrar el Paso 5 del rediseño (mercadillo) y la resolución de D-04, y dejar la siguiente sesión lista para arrancar sin releer nada.
>
> **⚠️ A diferencia del handover de julio, esto NO está fusionado.** Todo vive en la rama `feature/rediseno-mercadillo`, pendiente de una última auditoría y del merge. Lee la §2 antes de tocar nada.
>
> **Léete también:** `CLAUDE.md` (reglas del proyecto, se carga solo), `GestionGuardias_PRD.md` §3.3, §16.2 y §18 (actualizados en esta sesión) y `GestionGuardias_HANDOVER_2026-07-25.md` (la sesión anterior).

---

## 1. Resumen en una pantalla

| Bloque | Qué | Estado |
|---|---|---|
| A | **Paso 5**: mercadillo migrado al tema oscuro | ✅ Commiteado, verificado |
| B | **D-04**: unicidad del nombre de servicio dentro de cada plan | ✅ Commiteado, verificado |
| C | Cierre de dos auditorías del `testing-lead` | ✅ Commiteado, verificado |
| D | Aviso **al escribir** el nombre (en vez de al guardar) | ✅ Commiteado, verificado |
| E | Tercera pasada del `testing-lead` | ❌ Pendiente |
| F | Merge a `GestionGuardias-BETA` | ❌ Pendiente de confirmación |

**Estado visual de la app:** calendario y mercadillo en oscuro. **El resto sigue en claro** (rotación, grupos, perfil, ayuda, admin). Intencional: se extiende vista por vista.

---

## 2. Estado del repositorio

```
feature/rediseno-mercadillo  →  588c8d1   ← 6 commits, ninguno fusionado
GestionGuardias-BETA         →  2ea9481   ← sin tocar esta sesión
main                         →  d758f53   ← PRODUCCIÓN, sin tocar
```

El árbol de trabajo está limpio salvo este handover y ficheros sin trackear que ya venían de antes (ver §9). **Nada se ha fusionado**, así que `GestionGuardias-BETA` sigue intacta como punto de retorno y no hicieron falta ramas de backup.

### Commits de la sesión

| Commit | Qué |
|---|---|
| `588c8d1` | Aviso de nombre repetido **al escribirlo**, no al guardar |
| `3000759` | Cierra la segunda auditoría: D-04 Unicode, auto-zoom iOS, higiene |
| `e0f3f46` | Controles del sheet al mínimo táctil, y PRD v1.5 |
| `cbd4334` | **D-04: unicidad del nombre de servicio dentro de cada plan** |
| `c641250` | Cierra los hallazgos de la primera auditoría |
| `556035f` | **Rediseño del mercadillo (Paso 5)** |

---

## 3. Bloque A — Paso 5, el mercadillo

Reutiliza los componentes del calendario (`.cal-grid`, `.cal-cell`, `.sheet`); lo propio de la vista es el acento morado y las filas de operación.

- **Badges** con `contrastText()` e `icon('user')`. Los dos casos que el handover de julio marcaba como ilegibles: **PAC de 2.15:1 a 7.5:1** y **Pediatría de 2.54:1 a 9.36:1**. El VRE calcula su contraste sobre el `#94a3b8` que impone `.bg-vre` con `!important`, **no** sobre `svc.color`.
- **`openMercadoModal` es bottom sheet**, con el blindaje anti doble-toque del Paso 3. Salió del aislamiento `.modal:not(.sheet)`; quedan ahí los otros tres modales.
- **`btn-filter-merc`** usa `.cal-filter-btn--merc`; `toggleFilter()` ya no escribe estilos inline y trata los dos botones igual.
- Buzón y log migrados a tokens.

### Dos bugs que aparecieron al migrar

1. **`canBuy` estaba muerto.** Se declaraba en `false` y nunca se ponía a `true`, así que *«No hay guardias de compañeros disponibles en este día»* salía **siempre**, incluso listando compañeros justo encima.
2. **Los nombres de servicio volvían a ir dentro de `onclick`.** Un `UCI "Peque"` rompía el atributo — el mismo fallo que `fdb9cd5` cerró en el selector de propuesta. Todo el modal pasa a `data-*` escapado + `addEventListener` vía el dispatcher `_bindMercadoActions`.

> **Regla para el Paso 6:** en esta base de código, **cualquier `onclick` que interpole un nombre de servicio, plan o residente es un bug latente**. Son texto libre del admin. Ya ha aparecido tres veces.

---

## 4. Bloque B — D-04, unicidad del nombre de servicio

**Obligatoria dentro de cada plan; libre entre planes.** El mismo nombre en R1..R4 es el patrón normal y esperado —así se expresa que varios planes hacen «Urgencias HUAV» con cupos distintos— y `getSvcConfig(svcName, planName)` resuelve **primero el plan y luego el servicio**, así que cada uno recibe su configuración correcta. No hay herencia de reglas entre planes.

**Lo único plan-ciego hoy es el color:** `getServiceColor(svcName)` y `getAllUniqueServices()` devuelven el del **primer** plan que tenga ese nombre. Si se configura «Urgencias HUAV» en verde para R1 y azul para R3, todos los badges salen verdes. Es cosmético y está sin resolver.

**Mecanismo, en tres capas:**

1. **Al crear** — `adminAddService` autonumera («Nuevo Servicio 2, 3...») saltando los ocupados, así que pulsar «+ Servicio» dos veces nunca genera un duplicado. Igual `adminAddPlan` con los nombres de plan.
2. **Al escribir** — `revalidarNombresConfig()` salta en el `change` del campo y marca **in situ**, sin repintar: `renderAdminAjustes()` cerraría los acordeones y sacaría el foco a media edición. Recorre todos los campos, no solo el editado, porque corregir un nombre resuelve el choque de su pareja. Mensaje: *«Ya hay un "Urgencias HUAV" en este plan. Prueba con otro nombre: una variante como "Urgencias HUAV - Nivel 1" sí vale, otro idéntico no.»*
3. **Al guardar** — `adminSaveConfig` aborta, abre el `<details>` del plan afectado y lleva la vista al campo marcado. **Solo para servicios**: los nombres de plan avisan pero no bloquean (D-08).

**Criterio de choque:** NFC + colapso de espacios + minúsculas. **Las tildes sí diferencian.**

> `normalize('NFC')` no es adorno. `Pediatría` tecleada en Windows y la misma palabra pegada desde macOS son **cadenas distintas** —una lleva la tilde como carácter combinante— e **idénticas en pantalla**. Sin normalizar pasaban la validación y dejaban el segundo servicio inalcanzable para siempre. Lo cazó el `testing-lead`, no yo.

---

## 5. La regresión que introduje y hay que recordar

Metí un `trim()` en `syncConfigFromUI` al leer el nombre. Parecía higiene inofensiva. **Era una migración silenciosa.**

Una config que ya tuviera `"PAC Balaguer "` guardado se renombraba sola con solo tocar cualquier campo del panel —basta el `onchange` del selector de color—, y ni `state.shifts` (que guarda el nombre **como valor**) ni `state.habilitaciones` (que lo mete en la clave `svc@@plan`) se enteraban. Resultado: las guardias de ese servicio **desaparecen del calendario y del mercadillo**, y el servicio se queda **sin días habilitados**.

Eliminado. Ahora el espacio sobrante se **detecta** (choca con su gemelo sin espacio) y lo corrige el admin a propósito.

> ### ⚠️ Regla que sale de aquí
>
> **Ninguna rutina puede reescribir un nombre de servicio o de plan por su cuenta.** El nombre es una clave de facto en `state.shifts`, `state.habilitaciones` y los `trades` pendientes. Toda normalización va en la **clave de comparación**, nunca en el dato guardado. Ver D-07.

---

## 6. Hallazgos de las dos auditorías del `testing-lead`

Se invocó dos veces. Ambas encontraron cosas serias; conviene no saltárselo.

**Primera pasada** (sobre `556035f`):
- 🔴 El buzón y el log interpolaban `requester`, `target`, `s1`, `s2`, `undoRequester` y `timestamp` **sin escapar** — el mismo agujero que el commit cerraba en el sheet, pero en la superficie de *lectura*. El Log Público lo ve toda la promoción.
- 🔴 `renderMercadoCalendar` recorría `promoConfig.servicios`, que `adminSaveConfig` machaca con los del primer plan: en promociones de varios planes **la rejilla se quedaba sin badges** hasta recargar. Ahora usa `getAllUniqueServices()`, izada fuera del bucle.

**Segunda pasada** (sobre `c641250..e0f3f46`): el `trim()` de §5, la normalización Unicode de §4, el acordeón que ocultaba el aviso, y el auto-zoom de iOS de §7.

---

## 7. Lo que la medición contradijo (y lo que Chromium no ve)

**Contraste — dos hallazgos que conviene no volver a descubrir:**

| Hallazgo | Detalle |
|---|---|
| El suelo de `--text-3` es **específico de `--surface`** | Sobre `--surface-2` cae a 4.1:1. El texto secundario de cualquier elemento elevado debe ser `--text-2` (4.57:1) |
| Los rojos de aviso sobre `--surface-2` | `--fest-d` se queda en 4.36:1, y un tinte rojo translúcido lo **empeora** porque aclara el fondo (3.59:1). Se hunden a `--bg` (5.82:1) y el aviso lo da el borde, como `button.danger` |

**Un error de medición propio, por si se repite:** reporté los botones `.danger` a 7.59:1. La función de medida leía su `background: transparent` como negro. El fondo real es `--surface-2` y daban 4.36:1. **Al medir contraste hay que componer el alpha sobre el fondo real**, no leer el `backgroundColor` computado a secas.

**iOS — lo que el entorno no puede ver:**

> El entorno de trabajo es **Chromium**. No hay forma de ejecutar WebKit ni iOS Safari aquí.

El `testing-lead` detectó por lectura que los tres `<select>` del panel de día iban a `0.8rem` inline y que el viewport no lleva `maximum-scale`: **Safari hace zoom automático al enfocar cualquier control por debajo de 16px**. Un residente tocando «Ajustar Modalidad» a las 3 de la mañana se encontraba el sheet fuera de pantalla. El `font-size` salió del inline a `.sheet-select` y la `@media` móvil lo sube a 16px.

Lo que **sí** se pudo probar del `<input type="date">`: simulando el patrón de iOS (`change` tres veces seguidas, luego `value=''`, luego fecha pasada, luego válida) el área se repinta bien, queda exactamente un botón enlazado cada vez y el nodo del input nunca se reemplaza. Sigue siendo simulación.

**Estrés del sheet en móvil (375x812) con 10 compañeros y 8 servicios:** un solo contenedor con scroll (cero scroll anidado), 1900px de contenido limitados a 714px por `max-height: 88vh`, pie pegajoso visible sin tapar el último botón, sin desbordamiento horizontal. Sin problemas.

---

## 8. Decisiones abiertas (PRD §18)

| # | Qué | Nota |
|---|---|---|
| **D-05** | Umbral de `contrastText()` | Sigue en 3:1. Reapareció en el mercadillo y se dejó igual |
| **D-06** | Guardas de simulación en el mercadillo | §3.3 promete que la simulación es «puramente visual», pero **ningún punto de escritura del mercadillo comprueba `simulatedViewUser`**. No hay suplantación (el trade se graba con el `loggedInUser` real) pero sí incoherencia: la rejilla está filtrada por el simulado y la operación acaba siendo del admin |
| **D-07** | Renombrar un servicio deja huérfanas sus guardias | La razón de que D-04 **señale en vez de corregir**. Pide una migración sobre `shifts`, `habilitaciones` y `trades`, o pasar a identificar el servicio por `id` |
| **D-08** | Unicidad del nombre de **plan** | Dos planes homónimos hacen que los residentes del segundo cobren cupos y reglas del primero, **sin error visible**. `adminAddPlan` ya no los genera solo (autonumera), pero nada impide teclearlo. Decidido: **avisar, no bloquear el guardado** |

### Idea descartada, con motivo

Se propuso que el sistema añadiera automáticamente «(R1)», «(R2)»... al nombre del servicio según su plan. **Se descartó:** es un renombrado masivo, es decir D-07 aplicado a todo el histórico de golpe — todas las guardias de urgencias ya registradas dejarían de casar con ningún servicio. Además rompería la deduplicación (el mercadillo ofrecería cuatro botones de «Comprar a Externo» para un solo servicio) y metería ruido a residentes que solo están en un plan.

**Si se quiere diferenciar por plan, la palanca correcta es hacer plan-consciente `getServiceColor`**, no el nombre: pasarle el plan donde ya se conoce (`planVistaCtx`), igual que ya hacen `getPlazasForDay` e `isServiceEnabledOnDate`. No toca ningún dato guardado.

---

## 9. Tareas pendientes

### Fusionado y validado en staging
- [x] **Tercera pasada del `testing-lead`** sobre la validación en vivo. Encontró dos serios —el scroll del guardado bloqueado apuntando al campo equivocado y el nombre de plan vacío que se guardaba— corregidos en `6ff00fb`.
- [x] **Merge a `GestionGuardias-BETA`** (`e75dca7`) y desplegado en ggsbeta. `main` sigue en `d758f53`, sin tocar.
- [x] **Validado en móvil real.** El auto-zoom de iOS ya no ocurre, los calendarios están correctos, y la legibilidad de badges y bottom sheets se confirma «espectacular» — que era el objetivo del Paso 5. Canario OK.
- [x] Avisos de nombre duplicado acortados a una línea (`cf2e680`), a petición tras usarlos en el móvil.

**Falsas alarmas de esa validación, por si reaparecen:** los contadores de plazas «no se ven» en móvil **por diseño** (Paso 3: no caben en la celda, se ven en el panel del día) y además solo salen con `plazasPorDia > 1`. Y la «ruleta» del selector de fecha es el date picker nativo de iOS; en escritorio y Android sale un desplegable, que es lo correcto.

### Verificado a medias (limitación del entorno, no descuido)
- [ ] **El foco al escribir un nombre duplicado, en un móvil real.** Está comprobado que el nodo del input no se reemplaza, que es condición necesaria pero no suficiente. Falta ver qué pasa en iOS cuando el `change` llega con el blur: el `<p>` de aviso pasa de `hidden` a visible y **desplaza el contenido inferior**, así que el segundo toque podría caer en el sitio equivocado.
- [ ] **WebKit / iOS Safari** en general. Todo el trabajo se validó en Chromium.

### Rediseño
- [ ] **Paso 6 — resto de vistas**, una por PR: rotación, grupos, perfil, ayuda, admin. Volumen medido en julio: ~88 textos grises y ~46 fondos claros inline. El panel de admin es el más cargado.
- [ ] **Paso 7 — PWA**: `manifest.json`, iconos, `theme-color`, metas `apple-mobile-web-app-*`. Instalable, **sin offline**.

### Limpieza — hecha
- [x] `.gitignore` (no había ninguno): fuera los worktrees de agentes, los ajustes locales, los Excel con guardias reales y el harness.
- [x] Borradas las 15 ramas ya fusionadas y el worktree de agente huérfano. **`fix/horas-W5` se conserva**: tiene un commit sin fusionar (ver arriba).
- [x] Borrado `outputs/GestionGuardias_PRD.md`, una copia en v1.2 de junio que convivía con el PRD vivo.
- [x] Borrado `fix_subasta.py`. Contenía dos parches al motor de subasta: uno sigue aplicado, y el otro se revirtió a propósito porque atascaba el mes en subasta con 0 guardias que repartir — el porqué está en `app.js:6690`. El script seguía presentándolo como pendiente.
- [x] Consolidadas las definiciones de agentes: entra `.claude/agents/` y `.claude/launch.json`, sale `agentes_prompts/` (versión de mayo que ya no gobernaba nada y describía tres expertos inexistentes).
- **Se conserva la entrada `gg-harness`** del launch.json, en contra de lo que proponía el handover de julio: es el servidor con el que se ha medido y verificado todo esto.

---

## 10. Método (funcionó, repetir)

1. **Auditoría estática de la zona antes de tocarla.** Los dos bugs del §3 salieron de ahí, no de la ejecución.
2. **Medir, no estimar.** Todos los contrastes y tamaños táctiles se comprobaron ejecutando JS contra el DOM real. Varias veces el número contradijo la intuición — y una vez la propia medición estaba mal (§7).
3. **`node --check` no basta.** Cargar la app y comprobar el canario:
   ```js
   ['debugTurn','resetConfigMes','fixPlanBaseMonth','resetAllConfigMes','resetSubastaEstado']
     .map(n => n + ': ' + typeof window[n])
   ```
   Si alguna sale `undefined`, el nivel superior murió antes de llegar al final.
4. **Inyectar estado falso en la página** para ejercitar vistas que exigen sesión de Supabase: `promoConfig`, `state`, `loggedInUser`, `curDate` y llamar al `render*` que toque. Es como se probaron el mercadillo, D-04 y el estrés del sheet sin tocar la base de datos.
5. **`testing-lead` con los fragmentos en el brief**, y darle explícitamente lo que YA has verificado para que no lo repita y se centre en lo demás. Las dos pasadas encontraron cosas serias.

---

## 11. Arranque rápido de la próxima sesión

```bash
git checkout feature/rediseno-mercadillo
git log --oneline -6      # debería empezar en 588c8d1
```

Lo primero pendiente es la tercera pasada del `testing-lead` sobre `3000759..588c8d1`, y después el merge (§9).

Servidor de pruebas: entrada `gg-harness` en `.claude/launch.json` (puerto 8126).
