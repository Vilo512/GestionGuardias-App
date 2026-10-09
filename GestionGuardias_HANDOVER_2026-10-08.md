# Handover — Sesión del 8 de octubre de 2026

> **Primer handover escrito al terminar un punto, no con el contexto saturado.** Es el ciclo nuevo de `CLAUDE.md` funcionando.
>
> **Contexto que cambió todo hoy:** los R1 de MFyC empezaron a usar la app. Sobre **producción**, que sigue en el 15 de julio.

---

## 1. Resumen en una pantalla

| Bloque | Qué | Estado |
|---|---|---|
| A | Constitución del workflow: `CLAUDE.md` adelgazado, `BACKLOG.md`, `DECISIONES.md` | ✅ En BETA |
| B | **PRD v1.6** — permisos en tres niveles con ámbito por plan | ✅ En BETA |
| C | **Paso 6, primera vista**: `renderAccountsList` al tema oscuro + dispatcher `data-*` | ✅ En BETA, auditado |
| D | D-06 ampliado: el panel de Cuentas también escribe en simulación | ✅ Documentado, sin arreglar |
| E | Push a `origin/GestionGuardias-BETA` | ✅ En sync |
| F | AUDIT al día: MVP cerrado, W12 y W13 nuevas | ✅ En BETA |
| G | Limpieza de ramas: 7 locales → 3, 8 remotas → 3 | ✅ Hecho |
| H | Merge a `main` | ✅ **Hecho el 9-oct**: PR #21, merge `f62e0c1`. Producción = BETA `5ed44b5` — ver §6-septies |
| I | **[P-01]** Las escrituras de gobierno dejan de fallar en silencio | ✅ En BETA, auditado |
| J | **«Hacer Admin»** + cierre de la Zona de Peligro | ✅ En BETA, auditado dos veces |
| K | **Paso 6 · Horas** al tema oscuro + tarjetas en móvil | ✅ En BETA y en origin, auditado |

## 2. Lo urgente que no se tocó

**Producción lleva 12 semanas congelada** y los R1 están encima. `main` = `9dac519` (15-jul); BETA va **34+ commits por delante**. Lo que producción no tiene:

- **Ninguna función de escapado.** `escapeHtml` no existe en `main`, y hay **27 interpolaciones sin escapar** de `t.requester`, `t.s1`, `t.s2`, `t.target` y `t.timestamp` en el log y el buzón del mercadillo — superficie que lee toda la promoción.
- Todo el rediseño oscuro, la propuesta de asignación (N5) y D-04.

**Riesgo hoy: latente, no activo.** Los R1 usan planes ya creados, así que no hay nombres de servicio nuevos. Eso da margen, no permiso para olvidarlo.

**Decidido:** no desplegar a `main` el día uno de usuarios reales. Hacer P-01 y P-02 sobre BETA y subir **un solo despliegue** con todo.

## 3. Paso 6 — `renderAccountsList` (commits `470d0df`, `636965b`)

Se eligió esta sub-vista, no «el panel de admin», porque el panel **son seis** sub-vistas (~2.000 líneas, 73 colores fijos). Esta son 289 líneas y es la zona exacta de P-01 y P-02.

- 12 colores fijos → tokens. Bloque `.accounts-*` / `.account-row` en `style.css`.
- Las filas se elevan a `--surface-2`, así que el texto secundario va a `--text-2`: medido **4.57:1**, exactamente la cifra que agosto documentó. `--text-3` habría caído a 4.1:1.
- La fila pendiente **no lleva tinte ámbar translúcido** (aclara el fondo y hunde el contraste): se hunde a `--bg` y avisa por el borde. 9.64:1.
- Botones de 26-27px → **44px**. Aquí viven Expulsar, Quitar Delegado y Coronar Dueño: un toque mal dado en el móvil expulsa a alguien.
- **Los 5 `onclick` que interpolaban `nombre_mostrar` → `data-*` + `_bindAccountActions`.** Era la regla que el handover de agosto dejó escrita para el Paso 6. Fuera el parche `replace(/'/g,"\\'")`, que solo cubría la comilla simple.
- El badge marcaba `rol==='admin'` como «Dueño». Son niveles distintos: ahora Dueño sale de `creador_id` y Admin tiene badge propio. **Solo etiquetas — el reparto de poderes no se tocó.**
- Muerto eliminado: la variable `ev` y el `.account-row` legacy de tema claro.

**Verificado en Chromium:** canario OK; nombre `O'Brien <script>alert(1)</script> "X" & Co` → 0 scripts ejecutados, llega intacto a los 5 handlers; sin desbordamiento a 375px; contrastes de 4.57:1 a 13.36:1.

## 4. Lo que el `testing-lead` encontró

Tres hallazgos reales, los tres cerrados en `636965b`: el badge de Dueño se degradaba en silencio si fallaba la consulta a `promociones` (ahora se comprueba el error y se avisa), el `.account-row` legacy duplicado, y la regla `flex:1` de la `@media` que el comentario decía replicar y se había quedado fuera.

Y uno que **no** se arregló porque no es de este punto: **D-06 es más grande de lo documentado** (ver §5).

## 4-bis. «Hacer Admin» — y el agujero que destapó (`e77010a`, `5df8c68`, `78717cc`)

Pedido como «me falta un botón». No faltaba un botón: **no había ninguna forma de crear un admin.** El único camino a `rol:'admin'` era «Coronar Dueño», que traspasa la corona entera. El PRD describía un rol que la interfaz no sabía fabricar.

Matriz implementada, solo para el Dueño:

| El compañero es | Botones |
|---|---|
| residente | Expulsar · Hacer Delegado · **Hacer Admin** · Coronar Dueño |
| delegado | Expulsar · Quitar Delegado · **Hacer Admin** · Coronar Dueño |
| admin | Expulsar · **Quitar Admin** · Coronar Dueño |

«Quitar Admin» va en el lote a propósito: sin él era una puerta de un solo sentido, porque una fila de admin no mostraba ningún botón de rol.

### El bloqueante

El `testing-lead` detectó que el botón **convertía un agujero latente en uno real**, y tenía razón. Hasta ese momento el único `rol:'admin'` era el Dueño, así que buena parte del código asume «admin == Dueño». Las pestañas Ajustes y Seguridad se abrían con `isAdmin`, y dentro vive `adminDeletePromotion`, que **no tenía ninguna comprobación de rol** — solo un `confirm` y escribir «BORRAR». Nombrar admin a un R2 le daba un botón que borra la especialidad entera.

No es una sospecha: contra el código previo, la prueba «borrar/no-dueño: NO borra nada» **falla**.

Arreglado con un `esDueño` global derivado de `creador_id` (lo pone `loadPromoConfig`, que ya consultaba esa tabla). Las pestañas pasan a `esDueño`; `adminUpdatePromoDetails`, `adminBorrarPromocionVacia` y `adminVaciarGeneracion` también; y **`adminDeletePromotion` revalida contra el servidor**, porque una variable fijada al iniciar sesión quedaría obsoleta si la corona cambia de manos.

> **Lección para el resto del Paso 6 y para P-02:** cada vez que se cree un rol que antes no existía en la práctica, hay que buscar qué código asumía que no existía. Aquí fueron cinco sitios.

### Lo que sigue bajo `isAdmin` sin ámbito de plan

No es bloqueante y no se tocó, pero ahora lo alcanza un admin nombrado: `adminResetMonth` (`app.js:4802`, **borra las guardias del mes de todos los planes**), el borrado total del mes (`4585`), borrar histórico (`4736`) y aplicar la propuesta (`6339`, `6464`). Es exactamente lo que [P-02] debe acotar, y por eso subió de prioridad.

**Mientras el Dueño sea el único admin, la exposición es cero.** Se activa al nombrar al primero.

## 5. Decisiones y divergencias abiertas

| # | Qué | Dónde |
|---|---|---|
| **D-06** | **Ampliado.** No es solo el mercadillo: el panel de Cuentas tampoco comprueba `simulatedViewUser` en sus seis acciones, y la pestaña de Admin no se oculta al simular. Allí era incoherencia de vista; aquí son consecuencias de gobierno | PRD §3.3 · [P-05] |
| **§3.5** | Ocho divergencias entre el PRD v1.6 y el código. La grande: **no existe ámbito por plan**, 88 comprobaciones de rol y ninguna consciente del plan | PRD §3.5 · [P-02] |
| D-05, D-07, D-08, D-09 | Sin cambios desde agosto | PRD §18 |

## 6. Tareas pendientes

### Hecho y en BETA
- [x] Constitución del workflow (`4e0b33b`, `f013376`)
- [x] PRD v1.6 y backlog de permisos (`0d0eff3`)
- [x] Paso 6 · `renderAccountsList` (`470d0df`, `636965b`, `ee216fd`)
- [x] Paso 6 · **Rotación** (`renderRotationView` + `renderEditor` + `#pane-rot`), rama `feature/paso6-rotacion`. Ver §6-ter.
- [x] Paso 6 · **Grupos** (`renderGruposView` + `#pane-grupos`), rama `feature/paso6-grupos`. Ver §6-quater.
- [x] Paso 6 · **Horas** (`renderAdminHoras` + `#aview-horas`), rama `feature/paso6-horas`. Ver §6-quinquies.
- [x] Paso 6 · **Mi Perfil** (`renderPerfilUsuario`), rama `feature/paso6-perfil`. Ver §6-sexies. **Merge local en BETA, sin push.**

### Inmediato
- [x] **Push de BETA.** En sync con `origin/GestionGuardias-BETA`.
- [x] **Limpieza de ramas.** Locales 7 → 3 (`GestionGuardias-BETA`, `main`, `backup/main-mayo`); remotas 8 → 3 (`GestionGuardias-BETA`, `main`, `hot`).
- [ ] **`origin/hot`** (21-may): dos commits de subida por la web de GitHub que tocan `LICENSE`, `app.js`, `index.html` y `style.css`. Anterior a la primera sesión del proyecto, no está ni en `main` ni en BETA. Pendiente de revisar o borrar.

> **Sobre `main` local.** Estaba divergido: 8 commits de finales de mayo (serie W7) que no estaban ni en `origin/main` ni en BETA. El arreglo **sí** estaba en ambos por otra vía (PR #6 fusionado con otros SHA), así que se realineó con `git reset --hard origin/main`. La historia vieja se conserva en **`backup/main-mayo`** por si acaso; se puede borrar cuando haya confianza.

> **Merge a `main`: descartado hoy, con conocimiento de causa.** Se planteó y se decidió que no. El merge está limpio —0 conflictos, y los 13 commits que `main` tenía de más son merges de PR sin código propio—, pero saldrían 43 commits el día uno de usuarios reales, con la app mitad oscura y mitad clara y sin haber probado iOS jamás. Se mantiene el plan: P-01 y P-02 sobre BETA, y **un solo despliegue** con todo.

### Cola (orden decidido en `GestionGuardias_BACKLOG.md`)
- [x] **[P-01]** Hecho — ver abajo
- [ ] **[P-02]** Ámbito por plan y apertura de la gestión de roles — el grande
- [ ] **[P-05]** D-06 ampliado
- [ ] **[P-04]** Sucesión forzosa del Dueño — **ampliado** por la auditoría de P-01: la sucesión automática puede coronar a alguien dado de baja, y un Dueño en solitario puede renunciar sin traspasar
- [ ] **[P-09]** La sucesión automática no contempla admins — con Dueño + un único admin, el Dueño **no puede salir**: lanza y nadie lo captura
- [ ] **[P-07]** Perfiles históricos que conservan su rol — dato heredado, necesita migración en Supabase
- [ ] **[P-03]** Las guardas son solo de cliente; RLS sin verificar
- [ ] **[P-06]** `datalist` huérfano · **[P-08]** dos valores para «sin rol» · **[P-10]** `adminVaciarGeneracion` muerta

> **Nada de esto urge.** Los R1 están en producción sobre el código de julio, que funciona. Todo lo de hoy vive en BETA sin desplegar, y el riesgo nuevo solo se activa si se nombra un admin.

## 6-bis. P-01 — escrituras de gobierno (commits `6b9d718`, `1f70a2e`)

El bug declarado era uno; la auditoría estática encontró que **cuatro de las seis** funciones de gobierno ignoraban el `error` de Supabase. Se arreglaron las cuatro, más una quinta que salió en la revisión.

- **`adminExpulsarUsuario`**: comprueba el error, y el `return` va **antes** de tocar `historialEventos`. Antes, si la escritura fallaba, el estado local registraba una salida que en la base no había ocurrido. Además degrada `rol: null` en la misma escritura: un delegado dado de baja conservaba el rol y **volvía con privilegios** si se le readmitía.
- **`adminTraspasarCorona`**: son tres escrituras sin transacción. Ahora se comprueban las tres, se aborta informando del estado resultante, y se **reordenaron** para que cualquier fallo parcial sea recuperable — promover → mover corona → degradarse. El orden viejo movía la corona primero y un fallo en el paso 2 la dejaba en alguien sin rol de admin.
- **`adminRenunciarPrivilegios`** y **`adminRechazarUsuario`**: comprueban el error; el primero ya no recarga tapando el fallo.
- **`adminAprobarUsuario`**: dejaba el status clavado en «Aprobando…».
- **`renderAccountsList`**: guarda de sesión. Sin ella lanzaba tras crear la promesa de timeout y antes del `Promise.race`, dejando un rechazo sin capturar **en cada carga sin sesión**.
- **`index.html`**: `?v=3.2` llevaba clavado desde el 15-jul con 18 commits tocando `app.js`, y `style.css` no tenía cache-busting. Al desplegar, quien ya hubiera entrado habría recibido el JS de julio con el CSS nuevo. Ambos a `3.3`, y regla añadida a `CLAUDE.md`.

**Verificación:** 29 pruebas de comportamiento que ejecutan el código real extraído de `app.js` con dobles de Supabase — **22 fallan contra la versión previa**, así que discriminan. Más `node --check`, canario, y un listener de `unhandledrejection` confirmando que el rechazo desapareció. El fichero de pruebas quedó en el scratchpad; **no está en el repo** y conviene decidir si se adopta, porque hoy el proyecto no tiene tests.

### Paso 6 — vistas que faltan
`renderAdminAjustes` (23 colores), ~~rotación~~ (hecha), `renderAdminCalendar` (16), ~~`renderGruposView`~~ (hecha), `renderAdminHoras` (13), `renderAdminExceptions` (7, **lleva dentro [P-11]**), `renderAdminSeguridad` (2).

> Las cifras de esta tabla salieron de rangos de líneas estimados a ojo y **algunas estaban mal**: «rotación» se midió como 274 líneas y son 143 repartidas en dos funciones. Antes de abrir cada vista, medirla de verdad acotando por la siguiente declaración de función.

## 6-ter. Paso 6 — Rotación (rama `feature/paso6-rotacion`)

Clases propias `.rot-*`. **`.rot-group` y `.editor-row` no se tocaron**, porque Excepciones también las usa y migrarán con ella. Las capas son card `--surface` → grupo `--surface-2` → fila `--bg`. Los botones de acento van en outline sobre `--bg`. El color significa: ámbar = fijos, rojo = excluido, azul = grupo anterior / fusionar, verde = grupo siguiente. Todos los controles miden al menos 44px. El ✕ (quitar, sin confirmación) tiene tamaño fijo, va a la derecha y lleva un gap de 8px en móvil.

- **El handover anterior se equivocaba:** «cero `onclick` con nombres interpolados» no era cierto. 👻 y 📌 hacían `toggleResidente*('${res}')`. Pasaron a `data-rot-*` con el delegado `_bindRotEditorActions`, y además se escapan los nombres y los `<option>`. Se probó con `D'Angelo` y `Plan <b>O'Neil</b>`.
- `testing-lead`: sin bloqueantes. Su único hallazgo de fondo es preexistente y fue al backlog como **[P-11]**.
- `design-reviewer`: aplicados ✕ separado, borde `--border-2` en botones neutros y selects, ✂️ sin el ámbar de «fijo» y tipografía de nombres a 16px y de la zona de peligro a 0.85rem. **Quedan abiertos:** emoji sobre relleno activo a ~2.8:1, estimado y dependiente de plataforma (verificar en iOS/Android), y `button:hover` pegajoso en táctil (global, no de esta vista).
- `?v=` en **3.5**.

### Sin verificar (límite del entorno)
- [ ] **WebKit / iOS Safari.** Todo se validó en Chromium. Sigue igual que en agosto.

## 6-quater. Paso 6 — Grupos (rama `feature/paso6-grupos`, commits `08db77d`, `1094703`)

Clases `.grp-*`, mismas capas que Rotación (card `--surface` → fila `--surface-2`, acciones en outline sobre `--bg`). Cero `style=` y cero colores fijos en la vista.

- **Delegación:** `onclick="solicitarCambioGrupo('${p.id}')"` y el de salir pasan a `data-grp-act` + `_bindGruposActions` (enlazado una vez a `#pane-grupos`). Hospital, servicio, nombre y el mensaje de error se escapan: antes un nombre de promoción con HTML se inyectaba tal cual, y cualquier usuario puede crear promociones.
- **Bugs de paso:** guarda de sesión (el `visibilitychange` de `initApp` llama sin perfil); el error de red dejaba la lista en «Cargando…»; un `promocion_id` que apunta a una promoción borrada dejaba «Mi grupo» en «Cargando…» para siempre, ahora avisa y ofrece salir.
- **`index.html`:** el botón «Crear» era blanco sobre `--adu` a 3.7:1 → `button.primary`. Ojo: `button.danger` le gana en especificidad a una clase sola; por eso es `button.grp-leave`.
- `testing-lead`: sin bloqueantes. Anota que «Cancelar Solicitud» (`index.html:72`, fuera de esta pestaña) conserva `onclick` inline: estático, sin interpolación, no aplica la regla.
- `design-reviewer`: sin fallos AA. Aplicados servicio/contenedor a `--text` (`--text-2` sobre `--surface-2` da 4.57:1), azul solo en la acción, badge a 0.9rem sin ✅ verde sobre verde, intro a 1rem. **Queda abierto** el mismo de siempre: `button:hover` pegajoso en táctil, global.
- **Al recargar el harness**, `initApp` vuelve a crear el `supabaseClient` real: asignar el doble **después** del reload, no antes.
- `?v=` en **3.6**.
- **Finales de línea:** `index.html` se guarda en el repo con CRLF y `core.autocrlf=true` lo convierte a LF al hacer `add` → el diff sale entero. Si se edita con `sed`, `unix2dos` + `git -c core.autocrlf=false add index.html`.

## 6-quinquies. Paso 6 — Horas (rama `feature/paso6-horas`, commits `11ce18e`, `b2baf11`, merge `072aff4`)

Clases `.hrs-*`, cero `style=`. En escritorio es una tabla con cabecera `--surface-2`. **En móvil, una tarjeta `--surface-2` por residente**: el nombre a ancho completo y las cuatro cifras en 2x2 con su etiqueta (`data-label` + `td::before`). La cabecera queda oculta solo a la vista, no a los lectores de pantalla. Antes era una tabla de 5 columnas con scroll horizontal a 375px.

- El nombre pasa por `escapeHtml` y su celda pasa a `<th scope="row">`.
- `testing-lead`: sin bloqueantes. Especificidad y escapado verificados.
- `design-reviewer`: sin fallos AA. Aplicado: etiqueta en `--text-2` a 14px, valores a 16px (el de «Horas mes» a 1.05rem) sin partir, y estado vacío sin cursiva. **Queda abierto:** con `display:block` en la tabla, VoiceOver puede perder los roles de tabla en móvil. Se resolvería con `role=` explícitos; no se hizo porque es una vista de gestión de solo lectura.
- `app.js` baja de 7.988 a **7.982 líneas**. `?v=` en **3.7**.
- Sin verificar en WebKit/iOS, igual que el resto.

## 6-sexies. Paso 6 — Mi Perfil (rama `feature/paso6-perfil`, commits `e5e59db`, `c0188a8`, merge `ae00c01`)

Clases `.prf-*`. Capas: card `--surface` → bloques `--surface-2`. Los 73 `style=` se quedan en 3, que son custom properties de la barra (`--x`, `--w`), dato calculado. El blanco **no** venía de `#pane-perfil`, que no lleva estilos: era todo inline.

- **Bug de paso:** la card de horas tenía `grid-column: span 2`. En la rejilla de una columna del móvil eso creaba una columna implícita y **toda la página hacía scroll horizontal**. Ahora es `1 / -1`, y `minmax(min(320px, 100%), 1fr)` para móviles de 320px.
- **Delegación:** `_bindPerfilActions` sobre `#contenido-principal` (`data-prf-act` y `data-prf-filtro`). Borrar ausencia resuelve el id contra `state.bajasLargas` en vez de usar `Number()`, que daba `NaN` con bajas sin id. Se escapan el nombre, el plan, el motivo y la fecha.
- Los tres botones de guardar pasan a `button.primary`. Antes eran morado, azul a 3.7:1 y `--dark`, sin significado. En móvil las cifras del mes van en fila etiqueta–valor.
- **Token nuevo `--border-input` (#80868b):** `--border-2` daba 2.25:1 como contorno de campo sobre `--surface`. Solo lo usa Perfil. Candidato a generalizarse en el resto de inputs.
- `testing-lead`: sin bloqueantes. El menor del id está aplicado. Mandó al backlog la doble pulsación de «Añadir ausencia» (**[P-12]**) y amplió **[P-05]** con las escrituras de Perfil en modo simulación.
- `design-reviewer`: aplicados sus dos fallos AA. Las marcas de la barra desaparecían en «exceso» (rojo sobre rojo) y ahora llevan halo `--bg` y 3px. El contorno de los campos y la pista pasan a `--border-input`. También el título de página a 1.4rem en móvil y el placeholder a `--text-2`. La falta de `:focus-visible` global va a **[P-13]**.
- `?v=` en **3.8**. ~~Sin verificar en WebKit/iOS~~ → el usuario lo probó en Safari/iPhone (ver §6-septies).

## 6-septies. Merge a `main` — reevaluado y listo (sin ejecutar)

El usuario planteó si se podía subir ya, porque lo que queda es casi todo invisible para el residente. Repasamos los tres motivos del descarte de la mañana:

| Motivo | Estado |
|---|---|
| App mitad oscura, mitad clara | **Resuelto para el residente.** Calendario, sheets, mercadillo, Grupos y Perfil son oscuros. Lo que queda claro es de gestión: Calendario admin, Excepciones, Ajustes, Seguridad y los `.modal:not(.sheet)` (exportar, propuesta de mes, importar festivos, crear promoción). |
| 43 commits el día uno de usuarios reales | Ese día ya pasó. Esperar solo agranda el salto, y producción sigue **sin `escapeHtml`** (§2). |
| iOS nunca probado | **Hecho el 8-oct.** El usuario probó en Safari/iPhone: el flujo del residente funciona. Dos hallazgos, ninguno bloqueante: [P-14] y [P-15]. |

**Comprobado en el código (sin tocar Supabase):** `main` y BETA usan el **mismo proyecto** (`elmpelhplacgkgfuiwno`) y las mismas 4 tablas. BETA no usa columnas nuevas ni RPC, y no hay service worker. ggsbeta lleva semanas leyendo datos escritos por producción, así que la compatibilidad ya está probada en la práctica. `main` no tiene commits propios (0 en `BETA..origin/main`), así que el merge sale sin conflictos.

**Bloqueante encontrado y cerrado: el despliegue incluía el repo entero.** No había `.vercelignore`, así que backlog, handovers, PRD y AUDIT, con la descripción de los huecos de permisos ([P-03]), entraban en cada despliegue. **Corrección de un diagnóstico mío:** dije que en ggsbeta estaban públicos porque respondían 200, pero ese 200 era la página de login de Vercel, porque `Invoke-WebRequest` sigue las redirecciones. Con `curl` se ve un **302 al SSO de Vercel en todas las rutas**, `/` incluida: staging está detrás de Vercel Authentication y nunca fue público. El riesgo real era **producción**, cuyo dominio normalmente no está protegido. Arreglado con un **`.vercelignore` en lista blanca** (`index.html`, `app.js`, `style.css`, `LICENSE`), commit `b98d9b9`, ya en `origin`. Todo lo nuevo queda fuera por defecto. **Si la app empieza a cargar un recurso nuevo (iconos o manifest de la PWA), hay que añadirlo ahí**, o se publicará roto.

**Sin verificar todavía:** por la protección no pude comprobar el despliegue desde fuera. Lo tiene que mirar el usuario con sesión de Vercel: `ggsbeta.vercel.app/` debe cargar la app y `ggsbeta.vercel.app/CLAUDE.md` debe dar 404. **Hacerlo antes del merge**: si la lista blanca fallara, el fallo pasaría a producción.

**Condiciones acordadas para el merge:**
1. ✅ Prueba en iPhone real.
2. **No nombrar ningún admin hasta cerrar [P-02].** Con «Hacer Admin» ya disponible, un admin nombrado alcanza `adminResetMonth` y compañía, y además dispara [P-09]. Los delegados no tienen ese problema.
3. ⏳ `.vercelignore` desplegado en staging. **Falta comprobarlo** con sesión de Vercel (ver arriba).

**Ejecutado el 9-oct**, con confirmación triple. El usuario comprobó la condición 3 en staging: `/CLAUDE.md` da 404 y la app va en `3.8`. La condición 2 sigue vigente: solo delegados, ningún admin hasta [P-02]. Fusionado en [Vilo512/GestionGuardias-App#21](https://github.com/Vilo512/GestionGuardias-App/pull/21), con commit de merge `f62e0c1` (83 commits). Los dos despliegues de producción en Vercel (`gestionguardiasapp` y `gestionguardiassb`) terminaron en `success`. `GestionGuardias-BETA` se conserva, y `deleteBranchOnMerge` está desactivado en el repo. Tras el merge, `main` y BETA tienen el mismo contenido.

**Corrección:** arriba dice «0 commits en `BETA..origin/main`», y era falso: había 13. Son los merges de los PR #8–#20 y tres arreglos que BETA ya tenía con otro hash. `git diff 7ba860e origin/main` salía vacío, así que no aportaban código. Para comprobar si `main` lleva algo propio, lo que vale es el diff del contenido, no el número de commits.

✅ **Verificado en producción por el usuario (9-oct):** la app carga con `?v=3.8` y `/CLAUDE.md` da 404.

## 7. Método — lo que funcionó hoy

1. **Medir antes de elegir.** «Empieza por el panel de admin» parecía un punto hasta que se contaron las líneas: eran seis sub-vistas. La medición cambió el plan.
2. **Verificar antes de escribir en el PRD.** Dos veces hoy una suposición mía habría quedado escrita como spec: que producción no tenía unas guardas (era una función que no existe) y que «promoción» significaba lo mismo en tu cabeza y en la base de datos (no: la tabla `promociones` guarda **especialidades**).
3. **Una decisión sin motivo citable no es una decisión.** El veto a partir `app.js` resultó ser una línea descriptiva del AUDIT endurecida. Ahora está reclasificada como estado heredado.
4. **`testing-lead` con el diff y con lo ya verificado en el brief.** Encontró tres cosas reales sin repetir nada.

## 8. Arranque rápido de la próxima sesión

**Siguiente: `renderAdminSeguridad`** (ahora en `js/admin-ajustes.js`). **El reparto de `app.js` en `js/` está hecho (v4.0.0, 9-oct):** 15 scripts, verificado byte a byte y en el harness. Fusionado a BETA (`40d2df8`) y comprobado en staging con sesión real por el usuario: todo funciona. Sin pendientes del reparto. El plan queda en la historia de git (`GestionGuardias_REPARTO.md`). `app.js` ya no existe: donde este handover dice `app.js`, léase `js/`.

> **9-oct, tarde (histórico): el reparto estaba planificado, no ejecutado.**
> - **Decidido:** 15 scripts clásicos en `js/`; disparador nuevo de 1.500 líneas por archivo; versionado `MAYOR.MENOR.PARCHE` (el reparto abre la 4.0.0); la regla de herramientas se separa en editar a mano y mover por script.
> - **Ensayado entero:** el reparto sale exacto byte a byte, los 15 archivos pasan `node --check`, y en el harness cargan las 242 funciones, las 6 utilidades `window.*` y la pantalla de ayuda sin sesión.
> - **Hallazgos:** la única llamada al cargar es `initApp();`, que pasa a `arranque.js`; `sed` sin `-b` quita los `\r`; `.vercelignore` necesita `!/js/`.
> - **Backup:** etiqueta `pre-reparto-v3.8` sobre `a13549b` y copia local ignorada en `_backup/` (con `LEEME.md`).
> - **Sin probar:** el flujo con sesión real. Se prueba en staging tras el merge (Paso 6 del plan).
> - De paso: el aviso `Multiple GoTrueClient instances` de la consola viene de `initApp`, que crea un cliente nuevo de Supabase en cada `visibilitychange`. Ya existía y no es del reparto. Triado como **[P-16]**, al final de la cola.

**El merge a `main` se hizo el 9-oct (§6-septies) y producción ya tiene el estado de BETA.**

### Cola del Paso 6 — decidida por el usuario el 8-oct

1. ~~**`renderPerfilUsuario`** (Mi Perfil)~~ — hecho
2. **`renderAdminSeguridad`** ← **la próxima sesión empieza aquí**
3. **`renderAdminCalendar`**

> **⚠️ Disparador cruzado:** tras Mi Perfil, `app.js` tiene **8.001 líneas** (umbral 8.000). Hay que proponer el reparto por motores en varios `<script>` y que decida el usuario, antes de abrir Seguridad. La migración de Perfil sumó 19 líneas netas: la función de eventos nueva más la corrección del borrado.

Una sesión por punto. Quedan fuera de la cola, sin fecha: `renderAdminExceptions` (arrastra [P-11]) y `renderAdminAjustes` (más la zona de promoción de `index.html:330-349`).

**Sobre el punto 1:** Es una vista de residente **sin migrar**: lo de §6-quater de que «ya no quedan vistas de residente» era falso. Comprobado en el harness el 8-oct: tarjetas blancas de la paleta clara dentro de la app oscura, con 12 `var(--dark)`, fondos `#f8fafc` y grises `#64748b`/`#94a3b8` fijos, e inputs ya oscuros por los estilos globales, así que la vista queda mezclada. La ve **todo residente**, así que gana a cualquier vista de gestión por alcance. Ocupa 181 líneas con 73 `style=`. Puede que el blanco de las tarjetas venga también de `#pane-perfil` en `index.html:205`: comprobarlo al abrir. Para probarla en el harness: asignar `currentUserProfile` y llamar a `renderPerfilUsuario()`. Tiene dos selectores (año y mes) y cuatro formularios (residencia, contrato, ausencias): aplicar la regla de 16px y 44px en móvil.

Medición del 8-oct, contando `style="` hasta la siguiente declaración de función:

| Vista | Líneas | `style=` | Nota |
|---|---|---|---|
| `renderAdminSeguridad` | 33 | 5 | Solo Dueño |
| `renderAdminExceptions` | 37 | 28 | Arrastra [P-11] |
| `renderPerfilUsuario` | 181 | 73 | **Sin migrar** (comprobado). Vista de residente: va primero |
| `renderAdminAjustes` | 216 | 91 | Solo Dueño. Además, `index.html` tiene la zona de promoción con colores claros fijos (`:330-349`) |
| `renderAdminCalendar` | 275 | 19 | Admins y delegados |

> **Disparador:** `app.js` tiene **7.982 líneas** (umbral 8.000). Migrar a clases resta líneas, así que solo lo cruza un punto que **añada** lógica. Si pasa, avisar y proponer el reparto por motores antes de empezar.

### Recordatorios del ciclo

- **Disparador cruzado:** `app.js` tiene **8.001 líneas**. Respondido con el plan de reparto (arriba).
- Subir el `?v=` en `index.html`. Van por **`3.8`**; el reparto los pasa a **`4.0.0`** (`CLAUDE.md` § Versionado).
- `node --check` no basta: canario en navegador.
- Banco de pruebas de comportamiento en el scratchpad (`p01-test.js`). **No está en el repo**; pendiente de decidir si se adopta.
- Servidor de pruebas: entrada `gg-harness` en `.claude/launch.json` (puerto 8126).

> **Para probar vistas sin sesión de Supabase (corrige lo que decía antes):** los `let` de nivel superior **sí** se pueden asignar desde `javascript_tool` (`currentUserProfile`, `isAdmin`, `isDelegado`, `editingGroups`, `state`…). Lo que hay que hacer siempre es **anular `saveState = async () => {}` antes de pulsar nada**: si no, se escribiría en el Supabase real.
