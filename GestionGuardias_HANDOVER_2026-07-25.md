# Handover — Sesión del 25 de julio de 2026

> **Para qué es este documento.** Cerrar la sesión de rediseño visual + propuesta por servicio y dejar la siguiente lista para arrancar sin releer nada. Todo lo descrito está **fusionado y desplegado en `GestionGuardias-BETA` (ggsbeta.vercel.app)**. `main` no se ha tocado.
>
> **Léete también:** `CLAUDE.md` (reglas del proyecto, se carga solo), `GestionGuardias_REDISENO.md` (brief del rediseño, sigue vigente para los pasos pendientes) y `GestionGuardias_PRD.md` §8.5 y §16.2 (actualizados en esta sesión).

---

## 1. Resumen en una pantalla

Se hicieron **dos bloques de trabajo** y se cazaron **dos bugs latentes** que no eran del rediseño.

| Bloque | Qué | Estado |
|---|---|---|
| A | Rediseño visual: tema oscuro + piloto del calendario | ✅ En BETA |
| B | Propuesta de asignación **servicio a servicio** | ✅ En BETA |
| C | Bug: `async` huérfano que abortaba `app.js` al cargar | ✅ Corregido |
| D | Bug: `repeat(7, 1fr)` descuadraba la rejilla | ✅ Corregido |

**Estado visual actual de la app:** el calendario está rediseñado en oscuro. **El resto de vistas siguen en claro** (mercadillo, rotación, grupos, perfil, ayuda, admin), así que se ven "a medias". Es intencional y acordado: se irá extendiendo vista por vista.

---

## 2. Estado del repositorio

```
GestionGuardias-BETA  →  fdb9cd5   ← desplegado en ggsbeta.vercel.app
main                  →  d758f53   ← PRODUCCIÓN, sin tocar
```

**Backups de rescate** (por si hay que volver atrás):

| Rama | Apunta a | Revierte |
|---|---|---|
| `backup/beta-pre-propuesta-svc` | `197e100` | La propuesta por servicio |
| `backup/beta-pre-fix-async` | `2a941fd` | El arreglo del `async` huérfano |

Volver atrás en local:
```bash
git reset --hard backup/beta-pre-propuesta-svc
```
El remoto exigiría *force-push*: **preguntar antes**.

**Ramas de trabajo ya fusionadas** (se pueden borrar cuando se quiera): `feature/rediseno-calendario`, `test/rediseno-sobre-beta`, `fix/async-huerfano`, `feature/propuesta-por-servicio`.

### Commits de la sesión (los 13, de más reciente a más antiguo)

| Commit | Qué |
|---|---|
| `fdb9cd5` | Escapado seguro de nombres de servicio en el selector |
| `9f87cfc` | **Propuesta servicio a servicio, con selector previo** |
| `197e100` | **Elimina `async` huérfano que abortaba el script** |
| `2a941fd` | Declara `color-scheme` para los controles nativos |
| `2dc67e3` | Restaura `color` por defecto de `.shift-badge` (regresión propia) |
| `b0c61dc` | Evita paneles de día duplicados al doble-toque |
| `9b6db38` | Contadores de plazas solo en escritorio; en móvil al panel |
| `c6e9127` | Contador de plazas con punto de color exacto |
| `6db2616` | Contadores junto al número de día, sin recuadro |
| `a02f60e` | Cierra los 2 bloqueantes de la auditoría |
| `30271e7` | Correcciones del `design-reviewer` |
| `400d722` | **Piloto del calendario: rejilla + bottom sheet** |
| `8878384` | **Fundación de tokens oscuros + shell compartido** |

---

## 3. Bloque A — Rediseño visual

### Decisiones cerradas (no reabrir sin motivo)

| Tema | Decisión |
|---|---|
| Referencia | Google Calendar en modo oscuro |
| Paleta | `--bg #202124`, `--surface #2d2e30`, `--surface-2 #35363a`, `--border #3c4043`, `--text #e8eaed`, `--text-2 #9aa0a6`, `--text-3 #92979d` |
| `svc.color` de fondo | Hex **exacto** del plan, sin derivar |
| `svc.color` de texto | **Prohibido.** Chip de fondo con texto calculado, o punto de color + texto neutro |
| Contraste sobre chip | Blanco por defecto; negro solo si el blanco no llega a 3:1 |
| Iconos | SVG inline `icon()`, migrados solo en el calendario |
| Alcance por PR | Una vista por PR |

### La regla que no se puede romper

> **`svc.color` es DATO del plan de guardias**, lo elige el usuario y vive en Supabase. No se tokeniza, no se altera, no se guarda en CSS.

Y su corolario, que costó dos iteraciones descubrir: **un `svc.color` oscuro usado como color de texto sobre fondo oscuro es ilegible** (un azul marino desaparece). Por eso los contadores de plazas acabaron siendo *punto de color + número neutro*: el punto lleva el hex exacto y siempre coincide con el chip de su servicio.

### Helpers nuevos en `app.js`

| Función | Para qué |
|---|---|
| `contrastText(hex)` | Blanco o `#202124` según luminancia, para texto sobre un `svc.color` |
| `icon(name)` | SVG inline temable (`user`, `lock`, `check`, `x`, `calendar`) |
| `escapeHtml(s)` | Escapa `& < > " '` para texto que va por template string |

### Cómo conviven el tema oscuro y las vistas sin migrar

Los **4 modales aún no migrados** (crear promoción, mercadillo, importar festivos, propuesta de mes) se aíslan en contexto claro:

```css
.modal:not(.sheet) { background:#fff; color:#334155; color-scheme: light; }
```

El panel de día lleva la clase `.sheet` y queda excluido: ese sí es oscuro. **Cuando se migre un modal, hay que sacarlo de ese `:not()`.**

### Dos trampas que dejó el rediseño (leer antes de tocar CSS)

1. **`button.primary` es un contrato implícito.** Unos 26 sitios de `app.js` sobrescriben **solo** el `background` inline y heredan el color de texto de la clase. Por eso `--btn-primary` y `--btn-merc` **deben ser oscuros y el texto blanco**. Si se pone un fondo claro con texto oscuro, esos 26 botones quedan con texto invisible. Hay un comentario en el CSS avisando.

2. **`.shift-badge` necesita `color: #fff` por defecto.** Las etiquetas del mercadillo no llevan color inline y dependen de esa regla. Quitarla las deja con texto oscuro sobre `svc.color` oscuro.

---

## 4. Bloque B — Propuesta servicio a servicio

**Antes:** el botón calculaba todos los servicios con subasta de golpe.
**Ahora:** abre un selector, y solo lista servicios con huecos obligatorios pendientes.

```
📋 Proponer asignación — Octubre 2026
  Pediatría                        11 huecos
  PAC Balaguer                      9 huecos
  ┄ Todos los servicios a la vez ┄ 20 huecos
```

**Por qué importa (no es solo UX):** al calcular todos juntos, las asignaciones *hipotéticas* de Pediatría entraban en la simulación de PAC y descartaban gente por saliente aunque esas guardias no existieran. De uno en uno —aplicando antes de pasar al siguiente— cada cálculo parte de guardias reales.

**"Hueco obligatorio"** = día que dispara subasta + habilitado si el servicio lo requiere + `plazas > 0`. Ojo: **`plazasPorDia: 0` significa ILIMITADO**, y queda fuera de la subasta por diseño.

**Contrato del 3.er parámetro de `abrirPropuestaMesModal(y, m, soloSvc)`:**

| Valor | Comportamiento |
|---|---|
| `undefined` | Muestra el selector (o atajo si solo hay 1 servicio) |
| `null` | Todos los servicios |
| `'Pediatría'` | Solo ese servicio |

Se usa `soloSvc == null` (no `!soloSvc`) para distinguir "no filtrar" de un nombre vacío.

**Nota de seguridad:** los botones del selector se construyen **por DOM** (`createElement` + `textContent` + `addEventListener`), no por template string. El nombre de servicio es texto libre del admin y un `UCI "Peque"` rompía el atributo `onclick`. No volver a interpolarlo en HTML.

### Cómo decide a quién asignar (por si surge la duda otra vez)

No sigue la rotación de elección y no es aleatorio. Ordena por **carga histórica ascendente** según el `subastaCriterio` del servicio, desempata con `subastaDesempate`, y si sigue el empate baraja el tramo con **semilla derivada del histórico** (reproducible). Luego reparte en round-robin: asigna al primer candidato legal y lo manda al final de la cola.

---

## 5. Los dos bugs latentes (lección incluida)

### C — El `async` huérfano

**Síntoma:** el botón "Proponer asignación" era visible, se pulsaba y no pasaba nada.

**Causa:** en `app.js` había un token `async` suelto seguido de un JSDoc, sin su `function`. Por especificación, `async` + salto de línea antes de `function` se evalúa como **referencia a variable** → `ReferenceError` durante la carga → **aborta el resto del nivel superior del fichero**.

**Por qué nadie lo vio:** es **sintaxis válida**, así que `node --check` daba OK. Y las declaraciones de función **se elevan (hoisting)**, así que todas las funciones existían y la app parecía funcionar. Solo se perdían las inicializaciones `let`/`const` posteriores (`_propuestaMes` quedaba en zona muerta) y los registros `window.*` del final.

Era **anterior** al rediseño y a la propuesta. Estaba latente porque no había ningún `let` de nivel superior después de esa línea.

> ### ⚠️ Canario obligatorio para futuras sesiones
>
> **`node --check` NO basta para validar `app.js`.** Antes de dar por buena una entrega, cargar la app en el navegador y comprobar en consola que las utilidades del final del fichero están registradas:
>
> ```js
> ['debugTurn','resetConfigMes','fixPlanBaseMonth','resetAllConfigMes','resetSubastaEstado']
>   .map(n => n + ': ' + typeof window[n])
> ```
>
> Si alguna sale `undefined`, **el nivel superior murió antes de llegar al final**. Es el chequeo más barato que hay y ninguna auditoría estática lo detecta.

### D — El warping de la rejilla

`.cal-grid` usaba `repeat(7, 1fr)`, y `1fr` permite que el contenido **ensanche su columna**. Un día con dos contadores descuadraba la semana entera. Corregido a `repeat(7, minmax(0, 1fr))`.

---

## 6. Tareas pendientes

### Prioridad alta — continuar el rediseño

- [ ] **Paso 5 — Mercadillo (`#pane-merc`).** Es el siguiente natural: comparte `.cal-grid` y `.cal-cell` con el calendario, así que la rejilla ya va medio hecha. Hay que:
  - Cablear `contrastText()` en los badges (`app.js:3095`, `3125`, `3136` — verificar, se desplazan con cada edición). Hoy usan blanco fijo: **PAC se ve a 2.15:1 y Pediatría a 2.54:1**, ilegibles. Es deuda previa al rediseño, no una regresión.
  - Reskin de `openMercadoModal` a bottom sheet, mismo patrón que `openShiftModal`.
  - Migrar `btn-filter-merc`, que sigue con estilos inline en `toggleFilter()` (`app.js:2312` y `2315`).
  - Sacar el modal de mercadillo del `.modal:not(.sheet)`.
- [ ] **Paso 6 — Resto de vistas**, una por PR: rotación, grupos, perfil, ayuda, admin. Volumen medido: **~88 textos grises** (`#64748b` a ~2.9:1 sobre tarjeta oscura) y **~46 fondos claros inline**.
- [ ] **Paso 7 — PWA**: `manifest.json`, iconos, `theme-color`, metas `apple-mobile-web-app-*`. Instalable, **sin offline**.

### Decisiones abiertas

- [ ] **Umbral de `contrastText()`** (D-05). Usa 3:1 (texto grande) sobre chips de ~10.5px que pedirían 4.5:1. Subirlo pasaría a texto negro los servicios azules y rojos, que es justo lo que se quería evitar. Aparcado a propósito; reaparecerá en el mercadillo.
- [ ] **Unicidad del nombre de servicio** (D-04). No hay validación. Dos servicios homónimos en un plan romperían el selector de propuesta y todo lookup por nombre (`getSvcConfig`, `isServiceEnabledOnDate`). **Riesgo preexistente y transversal** — merece sesión propia, no un parche.

### Limpieza pendiente

- [ ] Borrar `_harness-calendario.html` (raíz, **sin trackear**) y la entrada `gg-harness` de `.claude/launch.json`. Era el banco de pruebas del rediseño; ya se valida directamente en ggsbeta. Nunca se comiteó.
- [ ] Borrar las ramas ya fusionadas listadas en §2.

---

## 7. Cómo se trabajó (para repetir el método)

1. **Rama temporal por bloque** → nunca commits directos sobre `BETA` ni `main`.
2. **Verificación medida, no a ojo.** Contrastes WCAG y tamaños táctiles se comprobaron ejecutando JS en el navegador, no estimando. Varias veces el número contradijo la intuición — el valor de gris que "parecía bien" daba 3.57:1 y hubo que recalcularlo hasta 4.62:1.
3. **Subagentes con los fragmentos en el brief.** `design-reviewer` (contraste y targets) y `testing-lead` (lógica antes de merge). Encontraron 2 bloqueantes y 1 serio que se habrían ido a BETA.
4. **Confirmación explícita de rama antes de cada push.** Y backup previo cuando el cambio era delicado.

**Lo que ninguna auditoría detectó:** el `async` huérfano y la regresión del `.shift-badge` (que solo se manifestaba al combinar dos cambios revisados por separado). Ambos aparecieron **ejecutando la app y mirando la consola**. Conclusión práctica: el análisis estático no sustituye a cargar la página.

---

## 8. Arranque rápido de la próxima sesión

```bash
git checkout GestionGuardias-BETA && git pull
git checkout -b feature/rediseno-mercadillo
```

Y antes de tocar nada, leer `GestionGuardias_REDISENO.md` §3.1 (colores de servicio) y §6 (plan por capas), que siguen vigentes.
