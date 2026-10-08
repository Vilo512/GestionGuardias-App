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

### [P-04] Sucesión forzosa del Dueño
- **Qué:** implementar PRD §3.5 (d). Que un Dueño no pueda graduarse, darse de baja ni renunciar sin traspasar antes la corona a alguien activo en la especialidad, y que se le avise cuando se acerque el fin de su residencia.
- **¿Tarde?:** no — nunca se especificó. Sale a la luz al documentar que cada especialidad DEBE tener Dueño.
- **Impacto:** `adminTraspasarCorona` y `adminRenunciarPrivilegios` ya existen, y `app.js:4998` ya bloquea la renuncia. Lo que falta es atar la **graduación** al mismo bloqueo, que vive en otro sitio: la lógica de fin de residencia / paso a histórico. Sin efecto visual más allá de un aviso.
- **Choca con:** nada.
- **Dónde:** detrás de **[P-02]** — comparte la zona de gestión de roles, y conviene hacerlo con el modelo de alcance ya en pie.
- **Veredicto:** entra. Riesgo de bloqueo permanente de una especialidad si no se hace, aunque no es urgente mientras el Dueño siga en activo.
- **Anotada:** 2026-10-08

### [P-03] Las guardas de permisos son solo de cliente
- **Qué:** las 88 comprobaciones de rol viven en el navegador; los 28 puntos de escritura a Supabase no están protegidos por RLS verificado. Un residente con devtools se las salta todas.
- **¿Tarde?:** no — nunca se especificó. Sale a la luz al abrir permisos (P-02) y al entrar usuarios reales.
- **Impacto:** no es `app.js`: son políticas en Supabase. Sin efecto visual.
- **Dónde:** independiente de la cola visual; **no comparte motor con nada**. Final de cola, pero con una salvedad: su severidad no depende del orden del rediseño, así que si se decide atacarla, se saca de aquí y se trata como su propio punto.
- **Veredicto:** entra, sin estimar. Requiere primero leer el estado real de RLS en Supabase, lo que necesita autorización del usuario.
- **Anotada:** 2026-10-08

## Promovidas

*(vacía)*

## Descartadas

*(vacía)*
