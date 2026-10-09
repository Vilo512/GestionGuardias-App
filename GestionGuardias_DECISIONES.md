# Decisiones

Registro de decisiones cerradas. **No se lee en cada sesión** — solo cuando salta uno de los disparadores listados en `CLAUDE.md`, o cuando se cierra una decisión nueva.

Cerradas por defecto: no se re-proponen. Cada entrada lleva motivo, fecha y disparadores. Si un disparador se cumple, avisar **una vez**, con el dato concreto; decide el usuario. Sin disparador cumplido, silencio.

**Una decisión sin motivo verificable no es una decisión: es sedimento.** No inventarle uno a posteriori — reclasificarla como estado heredado, que es lo que pasó con el punto 2 de esta lista.

---

## 1. Vanilla JS sin build step

*Cerrada, motivo verificado. Última revisión: 2026-08-26.*

**Motivo:** sin build step no hay tooling que mantener, se despliega en Vercel tal cual y el ciclo de edición es inmediato. Fue elección consciente y replicada: el proyecto Incidencias se montó igual a propósito (2026-07-18). Migrar a bundler/Tailwind es un desvío grande que para en seco la hoja de ruta.

**Disparadores:**
- Tercera regresión en el mismo motor en sesiones distintas.
- Un bug de case-sensitivity que cueste más de una sesión resolverlo.
- Un cambio visual que obligue a tocar más de 3 zonas de `style.css` a la vez — señal de que falta un sistema de estilos.

---

## 2. `app.js` en un solo archivo — **no es una decisión**

*Reclasificado el 2026-08-26 como estado heredado.*

No hay rastro de que se decidiera. El archivo creció (4.600 líneas en mayo → 7.250 en agosto) y la línea descriptiva de la cabecera del AUDIT — «monolítico vanilla JS» — acabó leyéndose como norma. Durante meses `CLAUDE.md` prohibió incluso mencionar el tema, con lo que la revisión nunca llegaba.

**Sin veto.** Repartir el código en varios `<script>` clásicos cargados en orden desde `index.html` no contradice nada: sigue siendo vanilla, sigue sin build step, el ámbito global sigue compartido y el código se mueve sin reescribirse. Se hace cuando compense.

Ventaja añadida en este codebase: con archivos separados, un throw de nivel superior deja de llevarse por delante los `let`/`const` del resto del programa.

**Lo que sí sigue cerrado** es el paso a **módulos ES** (`<script type="module">`): cambia el scoping a ámbito por archivo y obligaría a declarar `export`/`import` en cada cruce de las ~7.250 líneas. Refactor grande; se decide aparte.

**Disparador:** `app.js` supera las 8.000 líneas → proponer un reparto concreto por motores.

---

## 3. `main` protegida · BETA como integración

*Cerrada. Sin disparadores: es política, no técnica.*

Detalle operativo en `CLAUDE.md` §Control de versiones.

---

## Cómo añadir una decisión

Solo llega aquí lo que se decidió **explícitamente y con motivo**. Si no se puede citar cuándo y por qué se decidió, no es una decisión: es estado heredado, y se anota como tal.

```
## N. Título
*Cerrada, motivo verificado. Última revisión: YYYY-MM-DD.*

**Motivo:** por qué, con la evidencia que lo respalda.

**Disparadores:** señales medibles que obligan a reabrirla.
```

Al añadir una entrada con disparadores, **copiar los disparadores a `CLAUDE.md`** — allí es donde se leen en cada sesión. Esta ficha solo se abre cuando uno salta.
