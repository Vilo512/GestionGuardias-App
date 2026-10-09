# GestionGuardias-App

App de asignación de guardias médicas. Vanilla JS sin build step: `index.html` + `style.css` + 15 scripts clásicos en `js/` (ver el mapa en `js/arranque.js`), backend en Supabase.

## Documentos

| Archivo | Qué es | Cuándo se lee |
|---|---|---|
| `GestionGuardias_PRD.md` | **Especificación** de producto, por dominio (§8 turnos, §9 rotación, §11 mercadillo…). No contiene plan. | Por secciones. **Nunca entero.** |
| `GestionGuardias_AUDIT.md` | Deuda técnica y hoja de ruta. | Por secciones. **Nunca entero.** |
| `GestionGuardias_HANDOVER_<fecha>.md` | Estado al cerrar la última sesión. El más reciente manda. | §11 + §9 al abrir sesión. |
| `GestionGuardias_BACKLOG.md` | Cola de ideas fuera de secuencia, ya triadas. Define su propio formato. | Al abrir y al cerrar. |
| `GestionGuardias_DECISIONES.md` | Decisiones cerradas, con motivo y fecha. | **Solo si salta un disparador.** |
| `GestionGuardias_REDISENO.md` | Plan del rediseño visual + PWA. | Si el punto en curso es de rediseño. |

## Ciclo de sesión

**Una sesión = un punto.** No encadenar puntos: cada turno re-envía el historial entero y la calidad cae al final.

1. **Apertura.** §11 y §9 del handover más reciente. Nada más. Si el usuario ya dice qué toca, ni eso.
2. **Contexto bajo demanda.** La sección del PRD y el archivo de `js/` que haga falta, cuando haga falta. Nunca lecturas completas "por contexto".
3. **Ejecución.** Rama temporal → `testing-lead` → merge a BETA.
4. **Cierre, siempre.** Actualizar pendientes del handover y dejar en una frase qué toca después. El handover se escribe al terminar un punto, no cuando el contexto está saturado.

## Ideas nuevas a media sesión

No implementar. No abrir el PRD entero. No dejarla flotando. Se tría en el momento y entra en la cola de `GestionGuardias_BACKLOG.md` **con posición y veredicto**. Nada queda "pendiente de decidir".

**Las cuatro preguntas:**

1. **¿Llega tarde?** ¿Era de un punto ya cerrado? Implica reabrir algo ya validado: decirlo con el coste.
2. **¿Qué impacto tiene?** Qué **motor** hay que reabrir · qué **lógica ya escrita** se retoca, o si solo añade · qué le hace al **render** (ver §UI).
3. **¿Dónde es más barato meterla?** Detrás del punto que **ya vaya a abrir ese motor**: abrirlo dos veces se paga dos veces. Si ninguno lo abre, final de cola.
4. **¿Debería morir?** **Redundante** con algo existente o encolado · **function bloat**: superficie nueva para un caso marginal. Se propone con motivo; decide el usuario.

**Innegociable:** el punto en curso no se interrumpe, ni aunque la idea sea mejor. Adelantar solo si el usuario lo pide, cerrando antes lo que esté a medias.

Si invalida algo **ya construido**, se anota y ya está. Si invalida un punto **encolado y no empezado**, anotarlo *en ese punto* para no construir lo que se va a tirar. Anotar, nunca reordenar solo.

## Disparadores de revisión

Las decisiones viven en `GestionGuardias_DECISIONES.md` y no se re-proponen. Pero si se cumple uno de estos, **avisar una vez con el dato concreto**; decide el usuario. Sin disparador, silencio.

- Un archivo de `js/` supera las **1.500 líneas** → proponer cómo partirlo.
- Tercera regresión en el **mismo motor** en sesiones distintas.
- Un bug de case-sensitivity cuesta **más de una sesión**.
- Un cambio visual obliga a tocar **más de 3 zonas de `style.css`** a la vez.
- Un movimiento de código por script **no pasa la verificación byte a byte**, o aparecen **tildes rotas** en un archivo del proyecto.
- Una rama `feature/` va a fusionarse a BETA **sin haber subido la versión MENOR** → avisar antes del merge.
- Un cambio de arquitectura o un hito de producto → **proponer subir la MAYOR**.

## Control de versiones

- `GestionGuardias-BETA` es la **rama de integración** (staging, ggsbeta.vercel.app) y el único destino de merge por defecto.
- `main` es **PRODUCCIÓN** y está protegida. **Cualquier merge hacia `main` requiere confirmación triple y explícita**, caso por caso. Nunca por iniciativa propia ni como paso implícito.
- Flujo: rama temporal (`feature/` o `fix/`) → `testing-lead` → merge a BETA. No se comitea directo sobre `BETA` ni `main`.
- Confirma la rama exacta antes de cualquier push o merge.

### Versionado

Una sola versión para toda la app, `MAYOR.MENOR.PARCHE`. Es la que va en **todos** los `?v=` de `index.html`, así que subirla es también el cache-busting.

- **PARCHE**: cualquier cambio en JS o CSS que no sea una feature (fix, refactor, ajuste visual).
- **MENOR**: cada rama `feature/` que se fusiona a BETA. El parche vuelve a 0.
- **MAYOR**: un cambio de arquitectura o un hito de producto. Lo propone Claude y decide el usuario. El reparto de `app.js` abre la **4.0.0**; antes se usaba `MAYOR.MENOR` y la última fue la 3.8.
- El commit de merge a BETA lleva la versión: `merge: <qué> (v4.1.0)`. El handover la anota al cerrar.

## Calidad del código

- Trabaja por sección o motor, un archivo de `js/` cada vez.
- Antes de modificar, auditoría estática de la zona: no dejes funciones muertas ni callbacks huérfanos.
- Vigila mayúsculas/minúsculas: fuente recurrente de bugs aquí.
- `node --check` no basta: un throw de nivel superior mata los `let`/`const` posteriores y el hoisting lo disimula. Comprobar consola del navegador y las utilidades `window.*` de `js/turno.js`.
- **Si tocas `js/` o `style.css`, sube la versión en todos los `?v=` de `index.html`** (16: los 15 scripts y el CSS; ver § Versionado). Es el único cache-busting que hay. Estuvo clavado en `3.2` durante 18 commits: al desplegar, quien ya hubiera entrado recibía el JS cacheado junto al CSS nuevo.

## UI

Los residentes usan esto en el móvil, a las 3 de la mañana. La legibilidad y el tamaño de los objetivos táctiles pesan más que la densidad de información. Cualquier cambio visual se juzga primero en pantalla pequeña.

## Validación

Antes de fusionar a BETA, invoca `testing-lead` con los fragmentos de código relevantes en el brief: trabaja sobre lo que le incluyas, no explora `js/` a ciegas. Para iteraciones visuales, `design-reviewer` con el CSS/HTML.

No abras subagentes para planificar: arrancan en frío y re-derivan contexto ya cargado.

## Supabase

Proyecto GestionGuardias: `https://elmpelhplacgkgfuiwno.supabase.co`

**Avisa antes de cualquier operación**, indicando proyecto exacto, tabla y SQL. Espera confirmación.

## Herramientas

**Cambiar código: herramientas de edición directa.** Cada cambio tiene que verse como antes → después. Nada de scripts (Python, `sed -i`, expresiones regulares en bloque) que reescriban el contenido de `.js`, `.html` o `.css`.

**Mover código sin cambiarlo** (sacar rangos de líneas, juntar o renombrar archivos): se permite con `sed -b -n`, `cat` o `git mv` en Git Bash, si después se demuestra que el contenido es el mismo byte a byte. **`sed` siempre con `-b`**: sin él, el `sed` de Git Bash quita los `\r` de los finales de línea CRLF. Nunca con `Set-Content` ni `Out-File` de PowerShell, ni con Python sin `encoding='utf-8'`: estropean las tildes.

Python solo para cálculos que no toquen archivos del proyecto.
