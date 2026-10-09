# Backlog de ideas

Ideas que aparecen fuera de secuencia. Se anotan **en el momento en que surgen**, ya triadas: es cuando el contexto está cargado y el triaje sale casi gratis. Reconstruirlo en frío semanas después cuesta una lectura entera del PRD.

Esto **no** es la lista de tareas pendientes — esa vive en el §9 del handover más reciente. Aquí solo llega lo que rompe la secuencia planificada.

**Nada entra sin posición y veredicto.** Una idea capturada ya viene triada — no hay bandeja de "pendiente de decidir". Dejarla flotando obliga a re-deliberar semanas después con el contexto frío, que es el coste que este ciclo existe para evitar.

Acabar lo que hay entre manos manda sobre lo nuevo, aunque lo nuevo sea mejor idea. Pero la posición no es "al final" por inercia: va **detrás del punto que ya vaya a abrir el mismo motor**, porque abrir un motor dos veces se paga dos veces. Solo si ninguno lo abre, final de cola.

Las cuatro preguntas del triaje están en `CLAUDE.md` §Ideas nuevas a media sesión. Aquí solo vive el formato de la ficha.

## Formato

```
### [ID] Título
- **Qué:** una frase
- **¿Tarde?:** no · sí — era de <punto cerrado>, reabrirlo cuesta <qué>
- **Impacto:** motor(es) a reabrir · lógica que se retoca · efecto visual
- **Dónde:** detrás de <punto>, que ya abre <motor> · final de cola
- **Veredicto:** entra · descartada — redundante con <X> / function bloat
- **Anotada:** YYYY-MM-DD
```

Al empezar un punto de la cola se mueve a las pendientes del handover y se marca aquí como promovido, con fecha. Las descartadas **se quedan, con el motivo** — evita volver a proponer lo mismo dentro de tres meses.

---

## Cola

*El orden de esta lista **es** la decisión. Insertar según la posición asignada al capturar.*

### [P-01] Bugs de `adminExpulsarUsuario`
- **Qué:** la expulsión falla en silencio y no degrada el rol del expulsado.
- **¿Tarde?:** no. Son bugs preexistentes, detectados el 2026-10-08 al revisar permisos.
- **Impacto:** `adminExpulsarUsuario` (`app.js:5198-5215`). No toca motores de turnos ni rotación. Sin efecto visual.
  - `app.js:5202` no lee `error` del `update`: la UI dice «Conectado ✅» aunque Supabase lo rechace.
  - Solo escribe `estado: 'historico'`; conserva `rol: 'delegado'`, así que un expulsado readmitido **vuelve con privilegios**.
- **Dónde:** detrás de **Paso 6 — panel de admin**, que ya abre esta misma zona (`renderAccountsList`, `app.js:4937-5215`). Abrirla dos veces se paga dos veces.
- **Veredicto:** entra. Son dos correcciones pequeñas y acotadas.
- **Anotada:** 2026-10-08

### [P-02] Ámbito por plan y apertura de la gestión de roles
- **Qué:** implementar PRD §3.5 (a, b, c, e). Tres niveles con alcance: Dueño en toda la especialidad, Admin y Delegado solo en **su plan actual**; abrir la gestión de delegados al Admin; permitir que un delegado destituya o expulse a otro delegado de su plan.
- **¿Tarde?:** no, decisión nueva (oct-2026). Pero **reabre** zona ya escrita: no es solo añadir.
- **Impacto:** el más amplio de la cola. 88 comprobaciones de rol en `app.js`, **ninguna consciente del plan**. Núcleo en `renderAccountsList` (`app.js:4937-5215`) y en las definiciones de `app.js:729-730`, `2000`, `2069-2071`, `4960`. Hay que derivar el plan del actor —`getSvcConfigForUser` y `getPlazasForDay` ya derivan el del residente— y filtrar por él. Renombrar `isDelegado` («delegado o superior», no «es delegado») toca puntos dispersos. Sin efecto visual directo, pero cambia qué botones se renderizan.
- **Choca con:** nada se elimina. El nivel `isDueño` **se conserva** y se documenta; lo que cambia es que Admin deja de ser global y gana la gestión de delegados de su plan.
- **No requiere cambio de esquema:** el cargo sigue a la persona al avanzar de plan (confirmado 2026-10-08), así que el plan se deriva de la fecha de inicio de residencia y no se almacena.
- **Dónde:** detrás de **[P-01]**, misma zona y mismo motor. Hacer los dos en la misma apertura.
- **Veredicto:** entra. Decidido con el usuario el 2026-10-08.
- **Anotada:** 2026-10-08
- **Prioridad al alza desde el 2026-10-08.** Al existir «Hacer Admin» ya hay admins que no son el Dueño, y las operaciones destructivas que siguen bajo `isAdmin` **sin ámbito de plan** pasan a ser alcanzables por ellos: `adminResetMonth` (`app.js:4802`, borra las guardias del mes **de todos los planes**), el borrado total del mes (`app.js:4585`), borrar registros del histórico (`app.js:4736`) y aplicar la propuesta de asignación (`app.js:6339`, `6464`). Lo que destruye la especialidad entera ya está cerrado con `esDueño`; esto es el escalón de abajo y es justo lo que el ámbito por plan debe acotar.

### [P-10] `adminVaciarGeneracion`: función muerta y destructiva
- **Qué:** expulsa a todos los residentes y borra guardias y calendarios de la especialidad. **No tiene ningún llamador** — ni botón en `index.html` ni llamada en `app.js`. Solo es alcanzable desde la consola.
- **¿Tarde?:** no, resto antiguo. Sale al cerrar las operaciones de especialidad entera.
- **Impacto:** ya le he puesto guarda de `esDueño` para que no se quede en la misma familia que acabamos de cerrar, pero eso no resuelve lo de fondo: o se borra, o se conecta a un botón.
- **Dónde:** final de cola, con [P-06] (el `datalist` huérfano). Son la misma clase de resto.
- **Veredicto:** entra como limpieza, pero **lo decide el usuario**: borrar una función destructiva que alguien pudo dejar a medias no es una llamada mía.
- **Anotada:** 2026-10-08

### [P-09] La sucesión automática no contempla que existan admins
- **Qué:** `iniciarProcesoSalida` (`app.js:2016-2020`) elige sucesor entre `delegados` (solo `rol==='delegado'`) y `residentes` (que **excluye** explícitamente a los admin). Se escribió cuando el único admin era el Dueño.
- **¿Tarde?:** sí — lo destapa «Hacer Admin», que hace que existan admins de verdad.
- **Impacto:** dos fallos concretos. **(a)** Dueño + un único admin, sin delegados ni residentes: las dos listas quedan vacías, `sucesor` es `undefined` y `sucesor.nombre_mostrar` lanza un `TypeError` que nadie captura (`app.js:1966`). No se escribe nada, no se ve mensaje, y el Dueño **no puede salir**. **(b)** Con gente de sobra, la corona va al primer delegado o residente en vez de a un admin, que es quien ya tiene la confianza.
- **Dónde:** con **[P-04]**, es la misma función. Orden correcto: admin → delegado → residente, y solo entre `aprobado`.
- **Veredicto:** entra. Detectado por el `testing-lead` al auditar «Hacer Admin».
- **Anotada:** 2026-10-08

### [P-07] Perfiles históricos que conservan su rol (dato heredado)
- **Qué:** P-01 hace que las bajas futuras degraden el rol, pero **no corrige lo ya guardado**. Quien fue expulsado antes del 8-oct-2026 sigue con `rol: 'admin'` o `'delegado'` y `estado: 'historico'` en la base. Y `adminAprobarUsuario` solo cambia `estado`, nunca toca `rol`: readmitir a uno de esos perfiles **le devuelve los privilegios**. Es el mismo bug que P-01 cierra, pero por la puerta del dato viejo.
- **¿Tarde?:** sí, en el sentido útil: P-01 selló la puerta y esto es lo que ya había entrado.
- **Impacto:** no es `app.js`, es una migración de datos en Supabase (`UPDATE perfiles SET rol = NULL WHERE estado = 'historico'`). Opcionalmente, que `adminAprobarUsuario` limpie el rol al readmitir, para que no dependa de una migración puntual.
- **Choca con:** nada. Pero **requiere autorización para leer y escribir en Supabase**, y antes conviene contar cuántas filas hay en ese estado.
- **Dónde:** detrás de **[P-01]**. No urge mientras no se readmita a nadie, y hoy la promoción es solo de R1.
- **Veredicto:** entra. Detectado por el `testing-lead` al auditar P-01.
- **Anotada:** 2026-10-08
- **Ampliado el 2026-10-08:** no basta con migrar el dato viejo. `ejecutarSalidaFinal` (`app.js:2080-2085`) tampoco limpia el rol al abandonar un grupo, así que un admin que se va queda `pendiente` **conservando `rol:'admin'`**, y el Dueño de la especialidad a la que solicite entrar lo aprueba —`adminAprobarUsuario` solo toca `estado`— y entra ya como Admin, con insignia, **sin que nadie se lo haya concedido**. Antes era un borde improbable; con «Hacer Admin» es alcanzable por cualquier admin nombrado.

### [P-08] Dos valores distintos para «sin rol»
- **Qué:** la columna `rol` guarda a la vez `null` (lo que usan `adminRenunciarPrivilegios` y ahora la expulsión) y la cadena `'residente'` (lo que pasa la UI al llamar a `adminCambiarRol`), pese a que el JSDoc de esa función declara `{'admin'|'delegado'|null}`.
- **¿Tarde?:** no, preexistente.
- **Impacto:** casi ninguno. Todas las lecturas de `.rol` comparan contra `'admin'` y `'delegado'`, así que los dos centinelas caen igual en la rama «sin privilegio». **Una excepción:** `app.js:4807` usa `.neq('rol','admin')`, y en SQL `NULL <> 'admin'` es `NULL`, no `true` — los de `rol = null` quedan fuera del `UPDATE` y los de `'residente'` dentro. Está en `adminVaciarGeneracion`, que **no tiene ningún llamador**, así que hoy no pasa nada; pero es la prueba de que los dos valores no son intercambiables en cuanto se toca SQL.
- **Dónde:** final de cola. Conviene hacerlo con [P-07], que ya toca la misma columna.
- **Veredicto:** entra como limpieza de baja prioridad.
- **Anotada:** 2026-10-08

### [P-04] Sucesión forzosa del Dueño
- **Qué:** implementar PRD §3.5 (d). Que un Dueño no pueda graduarse, darse de baja ni renunciar sin traspasar antes la corona a alguien activo en la especialidad, y que se le avise cuando se acerque el fin de su residencia.
- **¿Tarde?:** no — nunca se especificó. Sale a la luz al documentar que cada especialidad DEBE tener Dueño.
- **Impacto:** `adminTraspasarCorona` y `adminRenunciarPrivilegios` ya existen, y `app.js:4998` ya bloquea la renuncia. Lo que falta es atar la **graduación** al mismo bloqueo, que vive en otro sitio: la lógica de fin de residencia / paso a histórico. Sin efecto visual más allá de un aviso.
- **Choca con:** nada.
- **Dónde:** detrás de **[P-02]** — comparte la zona de gestión de roles, y conviene hacerlo con el modelo de alcance ya en pie.
- **Veredicto:** entra. Riesgo de bloqueo permanente de una especialidad si no se hace, aunque no es urgente mientras el Dueño siga en activo.
- **Anotada:** 2026-10-08
- **Ampliado el 2026-10-08** por la auditoría de P-01, que encontró dos agujeros más en esta misma lógica:
  - **La sucesión automática puede coronar a alguien dado de baja.** `iniciarProcesoSalida` (`app.js:1990-2018`) consulta `estado IN ('aprobado','historico')` pero **no filtra por estado** al construir `otrosUsuarios`, `delegados` ni `residentes`. Dos efectos: el camino de «hibernación» (`otrosUsuarios.length === 0`) nunca se alcanza mientras queden históricos, y el sucesor elegido puede ser una persona expulsada, que recibe `rol: 'admin'` y `creador_id` **sin dejar de estar de baja**.
  - **Un Dueño en solitario puede renunciar sin traspasar.** El candado de `renderAccountsList` (`app.js:5015`) solo aplica con `isDueño && aprobados.length > 1`. Estando solo ve el botón normal, se pone `rol: null` y conserva `creador_id`: pierde el acceso al panel de admin y no queda nadie que pueda devolvérselo.

### [P-05] D-06 ampliado — el panel de Cuentas escribe en modo simulación
- **Qué:** un admin en modo simulación puede expulsar, cambiar roles o coronar desde Admin → Cuentas, con efecto real. Ninguna de las seis acciones comprueba `simulatedViewUser`, y la pestaña de Admin no se oculta al simular: su visibilidad se fija al iniciar sesión según el rol real (`app.js:731-732`, `app.js:2110-2124`) y `activateSimulationMode` (`app.js:908-916`) no la toca.
- **¿Tarde?:** no — preexistente. D-06 se documentó en agosto como desviación **del mercadillo**; la auditoría del Paso 6 descubre que el alcance era mayor.
- **Impacto:** `adminAprobarUsuario`, `adminExpulsarUsuario`, `adminCambiarRol`, `adminTraspasarCorona`, `adminRenunciarPrivilegios`, `adminEditarFechas`. Sin efecto visual. Más grave que el caso del mercadillo: allí era incoherencia entre lo que se ve y lo que se escribe, aquí son consecuencias de gobierno.
- **Dónde:** detrás de **[P-01]**, misma zona. Conviene cerrarlo junto con la decisión D-06 del PRD §3.3, que sigue abierta.
- **Ampliación (8-oct, Mi Perfil):** las escrituras de Mi Perfil (`guardarFechaInicioPerfil`, `guardarFechaContratoPerfil`, `solicitarBajaPerfil`, `eliminarBajaPerfil`) operan sobre `currentUserProfile` sin mirar `simulatedViewUser`. Sin verificar si en simulación escriben sobre el perfil real; revisarlo en el mismo punto.
- **Veredicto:** entra.
- **Anotada:** 2026-10-08

### [P-06] `datalist` huérfano `lista-usuarios-aprobados`
- **Qué:** existe el `<datalist>` (`index.html:363`) y el JS que lo rellena en cada render (`app.js:4963-4964`), pero **ningún `<input list=...>` lo consume**. Se construye marcado en cada pintado para nada.
- **¿Tarde?:** no — resto antiguo, detectado al migrar la vista.
- **Impacto:** trivial. O se borra, o se conecta al input al que iba destinado.
- **Dónde:** final de cola. No comparte urgencia con nada.
- **Veredicto:** entra como limpieza, pero **lo decide el usuario**: borrar marcado de UI que alguien pudo dejar a medias no es una llamada mía.
- **Anotada:** 2026-10-08

### [P-03] Las guardas de permisos son solo de cliente
- **Qué:** las 88 comprobaciones de rol viven en el navegador; los 28 puntos de escritura a Supabase no están protegidos por RLS verificado. Un residente con devtools se las salta todas.
- **¿Tarde?:** no — nunca se especificó. Sale a la luz al abrir permisos (P-02) y al entrar usuarios reales.
- **Impacto:** no es `app.js`: son políticas en Supabase. Sin efecto visual.
- **Dónde:** independiente de la cola visual; **no comparte motor con nada**. Final de cola, pero con una salvedad: su severidad no depende del orden del rediseño, así que si se decide atacarla, se saca de aquí y se trata como su propio punto.
- **Veredicto:** entra, sin estimar. Requiere primero leer el estado real de RLS en Supabase, lo que necesita autorización del usuario.
- **Anotada:** 2026-10-08

### [P-11] Excepciones pinta nombres y motivos sin escapar
- **Qué:** `renderAdminExceptions` interpola motivos (`app.js:~4702`) y usuarios del log (`~4730`) en `innerHTML` sin `escapeHtml`. Es el mismo defecto que se cerró en Cuentas y en Rotación.
- **¿Tarde?:** no. Lo detectó el `testing-lead` al revisar Rotación (Paso 6).
- **Impacto:** solo plantillas de Excepciones. No toca motores. Es la misma zona que su migración visual (7 colores, y además usa `.rot-group`/`.editor-row`, que siguen vivos por ella).
- **Dónde:** **dentro** del Paso 6 · `renderAdminExceptions`, que ya abre esa plantilla. No es un punto propio.
- **Veredicto:** entra.
- **Anotada:** 2026-10-08

### [P-12] «Añadir ausencia» admite doble pulsación
- **Qué:** `solicitarBajaPerfil` no desactiva el botón durante `await saveState()`; dos toques rápidos crean dos bajas idénticas, y si caen en el mismo milisegundo comparten `id: Date.now()` y un borrado se lleva las dos.
- **¿Tarde?:** no — preexistente. Lo detectó el `testing-lead` al revisar la migración de Mi Perfil.
- **Impacto:** solo `solicitarBajaPerfil` (y conviene revisar `guardarFecha*Perfil`). Sin motor. Sin efecto visual salvo el estado `disabled`.
- **Dónde:** final de cola: Mi Perfil ya está cerrado y ningún punto encolado vuelve a abrirlo.
- **Veredicto:** entra.
- **Anotada:** 2026-10-08

### [P-13] Sin estilo de foco propio en toda la app
- **Qué:** `style.css` no define `:focus-visible`; con teclado o lector el foco depende del navegador y sobre `--surface-2` puede quedar tenue. Propuesta: `outline: 2px solid var(--adu-d); outline-offset: 2px` global.
- **¿Tarde?:** no. Lo señaló el `design-reviewer` en Mi Perfil como sospecha sin medir.
- **Impacto:** una regla global en `style.css`; afecta a todas las vistas. Sin lógica.
- **Dónde:** al cierre del Paso 6, en la pasada global junto al `button:hover` pegajoso en táctil (abierto desde Rotación).
- **Veredicto:** entra.
- **Anotada:** 2026-10-08

### [P-14] El bottom sheet no se cierra arrastrando
- **Qué:** los sheets de día (`app.js:2853`) y de mercadillo (`app.js:3178`) solo se cierran tocando fuera o con «Cerrar». Muestran un asa de arrastre (`.sheet__grip`) que en móvil promete el gesto de deslizar hacia abajo, pero el gesto no existe.
- **¿Tarde?:** sí, era del paso del bottom sheet del rediseño, ya cerrado. Reabrirlo cuesta añadir un manejador táctil compartido. No reabre ningún motor.
- **Impacto:** lógica nueva, unas 30–40 líneas (touchstart/move/end, translateY y umbral). Solo debe cerrar si el contenido está con scroll arriba o si se arrastra desde el asa o la cabecera, para no robarle el scroll al contenido. Lo ven todos los residentes. Suma líneas a un `app.js` que ya pasa de 8.000.
- **Dónde:** final de cola, porque ningún punto encolado reabre el sheet. Por alcance es buena candidata a adelantarse si el usuario lo pide.
- **Veredicto:** entra. No bloquea el merge a `main`: tocar fuera y «Cerrar» funcionan.
- **Anotada:** 2026-10-08

### [P-15] Zoom de iOS al tocar campos de la configuración de planes
- **Qué:** los inputs de Ajustes (p. ej. `ventana_voluntaria_horas` en la configuración general y los campos de cada plan) están por debajo de 16px, y iOS hace zoom al enfocarlos. Lo vio el usuario en un dispositivo real.
- **¿Tarde?:** no. Es la regla de 16px y 44px, que aún no se ha aplicado porque `renderAdminAjustes` está sin migrar.
- **Impacto:** solo la plantilla de Ajustes, sin motor. Lo ve únicamente la gestión.
- **Dónde:** **dentro** del Paso 6 · `renderAdminAjustes`, que ya rehace esos campos. No es un punto propio.
- **Veredicto:** entra. No bloquea el merge a `main`.
- **Anotada:** 2026-10-08

### [P-16] Un cliente de Supabase nuevo cada vez que la pestaña vuelve a primer plano
- **Qué:** el «destructor de bloqueos» de `initApp` (`app.js:644`; tras el reparto, en `js/sesion.js`) ejecuta `supabaseClient = window.supabase.createClient(...)` en cada `visibilitychange`. La consola avisa de `Multiple GoTrueClient instances`, y `onAuthStateChange` sigue suscrito solo al primer cliente: un cierre o renovación de sesión puede no llegar a la app tras volver a la pestaña.
- **¿Tarde?:** no. Viene de antes y lo destapó la consola durante el ensayo del reparto (2026-10-09). No es una regresión.
- **Impacto:** solo el arranque y la sesión, sin motores. El parche existe por algo (Supabase se congelaba al volver a la pestaña): hay que entender ese bloqueo antes de quitarlo. Lo más probable es reusar el cliente y refrescar la sesión (`auth.startAutoRefresh` o `getSession`) en vez de recrearlo. Sin efecto visual.
- **Dónde:** final de cola. Ningún punto encolado abre la sesión.
- **Veredicto:** entra. Por ahora solo hay un aviso, sin fallo observado. Subiría si algún residente se queda con la sesión caducada al volver a la app.
- **Anotada:** 2026-10-09

## Promovidas

*(vacía)*

## Descartadas

*(vacía)*
