# Reparto de `app.js` en `js/` — plan de ejecución

> **Para quien lo ejecute (Sonnet, intensidad media):** este documento basta. No hace falta leer `app.js`, el PRD ni el AUDIT. Sigue los pasos en orden; si una comprobación falla, **para y avisa**, no improvises.
>
> Planificado el 9-oct-2026 sobre `GestionGuardias-BETA` en **`a13549b`** (etiqueta `pre-reparto-v3.8`). El reparto se ensayó entero ese día: exacto byte a byte, y en el navegador cargan las 242 funciones.

---

## 1. Qué se hace y por qué es seguro

`app.js` (8.001 líneas) pasa a 15 scripts clásicos en `js/`, cargados en orden desde `index.html`. Sigue siendo vanilla, sin build step y con ámbito global compartido (`DECISIONES.md` §2). **No se reescribe código: se mueve.**

Lo que dijo el inventario de nivel superior:
- 278 sentencias: **242 declaraciones de función**, 35 `let`/`const`/`window.x = function` que no ejecutan lógica, y **una sola llamada: `initApp();` (línea 748).**
- Ningún nombre de función ni de variable está repetido, así que el orden de los archivos no cambia qué función gana.

**El único cambio con intención:** `initApp();` pasa al último archivo (`arranque.js`). Hace `await getSession()`, y al volver llama a `nav()`, `renderUserHeader()` y compañía. Con un solo archivo, eso siempre ocurría con todo cargado. Partido en varios, la respuesta puede llegar entre un script y el siguiente, y el `catch` se tragaría el `ReferenceError` mostrando solo «Error de sesión».

**Las dos trampas que ya se encontraron:**
1. **`sed -n` sin `-b` quita los `\r`.** El árbol de trabajo está en CRLF (`core.autocrlf=true`) y el `sed` de Git Bash, en modo texto, los elimina. **Usar siempre `sed -b -n`.** La verificación lo detecta.
2. **`.vercelignore` es una lista blanca.** Si no se añade `js/`, producción se publica sin JavaScript.

---

## 2. El reparto

Rangos inclusivos, en líneas de `app.js` en `a13549b`. Cuando un archivo tiene varios rangos, van **en ese orden**.

| # | Archivo | Rangos | Líneas | Contenido |
|---|---|---|---|---|
| 1 | `nucleo.js` | 47–610 | 564 | config y estado, helpers, persistencia, notificaciones |
| 2 | `sesion.js` | 611–747 · 749–991 | 380 | auth y sesión, usuarios y accesos |
| 3 | `motores.js` | 992–1852 · 7743–7898 | 1.017 | temporal, salientes, rotación, evaluación, mercadillo, balanceo |
| 4 | `turno.js` | 6727–7441 | 715 | subastas, turno, bajas y activos, utilidades `window.*` de depuración |
| 5 | `grupos.js` | 1853–2131 | 279 | grupos hospitalarios, protección y sucesión |
| 6 | `calendario.js` | 2132–2535 · 1–46 · 2536–3098 | 1.013 | navegación, helpers de servicios, `getCellBackgroundStyle`, calendario, modales, admin turno |
| 7 | `mercadillo.js` | 3099–3289 | 191 | render y modales del mercadillo |
| 8 | `exportacion.js` | 3989–4173 · 7899–7959 | 246 | exportación general y del mercadillo |
| 9 | `admin-ajustes.js` | 3290–3988 | 699 | ajustes |
| 10 | `admin-calendario.js` | 4174–4981 | 808 | calendario admin, festivos, patrón de huecos, excepciones |
| 11 | `admin-cuentas.js` | 4982–5482 | 501 | cuentas |
| 12 | `rotacion-editor.js` | 5483–6133 | 651 | editor de rotación, controles, sorteo |
| 13 | `propuesta.js` | 6134–6726 | 593 | propuesta de asignación (N5) |
| 14 | `perfil.js` | 7442–7742 | 301 | mi perfil |
| 15 | `arranque.js` | 7960–8001 · 748 | 43 | mapa de módulos + `initApp();` |

**Orden de carga** en `index.html`: el de la tabla. Solo hay dos restricciones: `nucleo.js` primero (crea `state` y `supabaseClient`) y `arranque.js` el último.

---

## 3. Ejecución

Todo en **Git Bash**, desde la raíz del repo. Tres commits en la rama `feature/reparto-js`.

### Paso 0 — Precondiciones

```bash
git switch GestionGuardias-BETA && git pull --ff-only
git status --short
sha256sum app.js
```

- `git status` tiene que salir **vacío**.
- El hash de `app.js` tiene que ser **`632fcea87db29b5c6457794bef3353506a1f650d46f9d827cbb6dce2ea4fb0a2`**. Si no coincide, alguien tocó `app.js` después del plan: **los rangos ya no valen. Parar y avisar.**

```bash
git switch -c feature/reparto-js
```

### Paso 1 — Commit A: mover (sin cambiar ni un byte)

**1a. Cortar.** Copiar el bloque tal cual:

```bash
mkdir js && O=app.js && J=js && \
sed -b -n '47,610p' $O > "$J/nucleo.js" && \
{ sed -b -n '611,747p' $O; sed -b -n '749,991p' $O; } > "$J/sesion.js" && \
{ sed -b -n '992,1852p' $O; sed -b -n '7743,7898p' $O; } > "$J/motores.js" && \
sed -b -n '6727,7441p' $O > "$J/turno.js" && \
sed -b -n '1853,2131p' $O > "$J/grupos.js" && \
{ sed -b -n '2132,2535p' $O; sed -b -n '1,46p' $O; sed -b -n '2536,3098p' $O; } > "$J/calendario.js" && \
sed -b -n '3099,3289p' $O > "$J/mercadillo.js" && \
{ sed -b -n '3989,4173p' $O; sed -b -n '7899,7959p' $O; } > "$J/exportacion.js" && \
sed -b -n '3290,3988p' $O > "$J/admin-ajustes.js" && \
sed -b -n '4174,4981p' $O > "$J/admin-calendario.js" && \
sed -b -n '4982,5482p' $O > "$J/admin-cuentas.js" && \
sed -b -n '5483,6133p' $O > "$J/rotacion-editor.js" && \
sed -b -n '6134,6726p' $O > "$J/propuesta.js" && \
sed -b -n '7442,7742p' $O > "$J/perfil.js" && \
{ sed -b -n '7960,8001p' $O; sed -b -n '748p' $O; } > "$J/arranque.js" && \
ls js | wc -l
```

Debe dar **15**.

**1b. Verificar, antes de borrar `app.js`.** Guardar el script del §4 en el **scratchpad** (no en el repo) como `verificar-reparto.js` y ejecutar:

```bash
node <scratchpad>/verificar-reparto.js app.js js
for f in js/*.js; do node --check "$f" || echo "SINTAXIS MAL: $f"; done
```

Tiene que terminar en `Todo OK: el reparto es exacto.`, con `Bytes: original 458761, suma de archivos 458761 (iguales)`, y sin ningún `SINTAXIS MAL`. **Si algo falla: `rm -rf js`, parar y avisar.**

**1c. Retirar `app.js` y cablear.**

```bash
git rm -q app.js
```

Con la herramienta de edición:

- **`index.html`**:
  - En la línea 10, `style.css?v=3.8` → `style.css?v=4.0.0`.
  - Sustituir la línea 391 (`<script src="app.js?v=3.8"></script>`) por:

```html
    <!-- Orden de carga: nucleo.js primero (estado y cliente Supabase) y arranque.js
         el último (llama a initApp() cuando ya están definidas todas las funciones).
         El orden del resto no afecta: solo declaran funciones. -->
    <script src="js/nucleo.js?v=4.0.0"></script>
    <script src="js/sesion.js?v=4.0.0"></script>
    <script src="js/motores.js?v=4.0.0"></script>
    <script src="js/turno.js?v=4.0.0"></script>
    <script src="js/grupos.js?v=4.0.0"></script>
    <script src="js/calendario.js?v=4.0.0"></script>
    <script src="js/mercadillo.js?v=4.0.0"></script>
    <script src="js/exportacion.js?v=4.0.0"></script>
    <script src="js/admin-ajustes.js?v=4.0.0"></script>
    <script src="js/admin-calendario.js?v=4.0.0"></script>
    <script src="js/admin-cuentas.js?v=4.0.0"></script>
    <script src="js/rotacion-editor.js?v=4.0.0"></script>
    <script src="js/propuesta.js?v=4.0.0"></script>
    <script src="js/perfil.js?v=4.0.0"></script>
    <script src="js/arranque.js?v=4.0.0"></script>
```

- **`.vercelignore`**: la línea `!/app.js` → `!/js/`.

```bash
git add js index.html .vercelignore
git commit -m "refactor: reparte app.js en 15 scripts de js/ (v4.0.0)"
```

Git avisará de que va a convertir CRLF en LF: es lo esperado, porque el repositorio guarda los archivos en LF. El mensaje de commit lleva la línea `Co-Authored-By` habitual.

### Paso 2 — Commit B: limpieza revisable (herramienta de edición, nada de scripts)

En las cabeceras de sección de `js/*.js` quedan restos del plan de módulos ES que se descartó:
- **35 líneas** `// Exportar a: src/modules/…`
- **32 líneas** `// Líneas estimadas: ~N`

Borrarlas todas. Las de `Dependencias externas:` y `Helpers que usa:` **se quedan**. Para comprobarlo:

```bash
grep -c "Exportar a:\|Líneas estimadas:" js/*.js
```

Tiene que dar 0 en todos los archivos.

En `js/calendario.js`, borrar la línea `// REVISAR: podría pertenecer a HELPERS_SERVICIOS`: la función ya queda junto a esa sección.

En `js/arranque.js`, sustituir el bloque `MAPA DE MÓDULOS` (desde la primera línea `// ====` hasta la última, ambas incluidas) por:

```js
// ============================================================
// ARRANQUE — último script de index.html
// ============================================================
// Mapa de archivos (orden de carga):
//   nucleo.js           config y estado, helpers, persistencia, notificaciones
//   sesion.js           auth y sesión, usuarios y accesos
//   motores.js          temporal, salientes, rotación, evaluación, mercadillo, balanceo
//   turno.js            subastas, turno, bajas y activos, utilidades window.* de depuración
//   grupos.js           grupos hospitalarios, protección y sucesión
//   calendario.js       navegación, helpers de servicios, calendario, modales
//   mercadillo.js       render y modales del mercadillo
//   exportacion.js      exportación general y del mercadillo
//   admin-ajustes.js    ajustes
//   admin-calendario.js calendario admin, festivos, patrón de huecos, excepciones
//   admin-cuentas.js    cuentas
//   rotacion-editor.js  editor de rotación, controles, sorteo
//   propuesta.js        propuesta de asignación (N5)
//   perfil.js           mi perfil
//   arranque.js         este archivo
//
// Ciclos de llamadas (resueltos en código, no por el orden de carga):
//   MOTOR_EVALUACION ←→ MOTOR_SUBASTAS: guards _computingTurn / _computingAnalisis
//   MOTOR_TURNO → MOTOR_EVALUACION → MOTOR_SUBASTAS → MOTOR_TURNO: guard _computingTurn
//
// initApp() va aquí, y no en sesion.js, porque su continuación tras el
// primer await puede ejecutarse entre un <script> y el siguiente.
// ============================================================

```

Debajo queda `initApp();`.

Borrar las carpetas vacías de `src/` (restos de mayo; git no las sigue):

```bash
find src -type f | wc -l
rmdir src/core src/engine src/ui src/utils src
```

El `find` tiene que dar 0.

Después, `node --check` sobre cada archivo y:

```bash
git commit -am "refactor: limpia cabeceras obsoletas de src/modules y rehace el mapa de arranque"
```

### Paso 3 — Commit C: documentación

Con la herramienta de edición:

**`CLAUDE.md`**
- Línea 3: `` `index.html` + `style.css` + `app.js` `` → `` `index.html` + `style.css` + 15 scripts clásicos en `js/` (ver el mapa en `js/arranque.js`) ``.
- § Disparadores: `` `app.js` supera las **8.000 líneas** → proponer reparto por motores en varios `<script>`. `` → `` Un archivo de `js/` supera las **1.500 líneas** → proponer cómo partirlo. ``
- § Calidad del código, el punto de `node --check`: `` las utilidades `window.*` del final del archivo `` → `` las utilidades `window.*` de `js/turno.js` ``.
- § Calidad del código, el punto del `?v=`: `` **Si tocas `app.js` o `style.css`, sube el `?v=` de los dos en `index.html`.** `` → `` **Si tocas `js/` o `style.css`, sube la versión en todos los `?v=` de `index.html`** (16: los 15 scripts y el CSS; ver § Versionado). ``
- § Calidad del código, primer punto: `` nunca sobre todo `app.js` a la vez `` → `` un archivo de `js/` cada vez ``.
- Tabla de documentos: quitar la fila de `GestionGuardias_REPARTO.md` y borrar este archivo con `git rm`. El plan queda en la historia de git.

**`GestionGuardias_DECISIONES.md` §2**: añadir al final:

> **Hecho el YYYY-MM-DD** (v4.0.0): 15 scripts en `js/`, plan en la historia de git (`GestionGuardias_REPARTO.md`). Disparador nuevo: un archivo de `js/` supera las 1.500 líneas.

**`.claude/agents/testing-lead.md`**, línea 22: `` leer `app.js` (7.000+ líneas) de principio a fin `` → `` leer los archivos de `js/` enteros ``.

**Handover**: actualizar el §8 del handover más reciente. El reparto está hecho, y lo siguiente es `renderAdminSeguridad` (está en `js/admin-ajustes.js`).

```bash
git commit -am "docs: reparto de app.js hecho (v4.0.0)"
```

### Paso 4 — Verificación en el navegador

`preview_start` con `gg-harness` y navegar a `http://localhost:8126/index.html`. Esperar ~3 s y ejecutar con `javascript_tool`:

```js
await new Promise(r => setTimeout(r, 2500));
const files = [...document.querySelectorAll('script[src^="js/"]')].map(s => s.getAttribute('src'));
const names = [];
for (const f of files) { const t = await (await fetch(f)).text(); for (const m of t.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)/gm)) names.push(m[1]); }
const missing = names.filter(n => typeof window[n] !== 'function');
const winUtils = ['debugTurn','resetConfigMes','fixPlanBaseMonth','resetAllConfigMes','resetSubastaEstado','adminEditarFechas'].map(n => n + ':' + typeof window[n]);
const lets = ['state','supabaseClient','promoConfig','authSession','currentUserProfile','todasLasPromociones','_propuestaMes','FESTIVOS_CCAA_ES','MONTHS'].map(n => { try { return n + ':' + typeof eval(n); } catch (e) { return n + ':ERROR ' + e.message; } });
({ scripts: files.length, funciones: names.length, faltan: missing, winUtils, lets, help: document.getElementById('pane-help')?.style.display })
```

**Resultado esperado** (es el del ensayo del 9-oct):
- `scripts: 15`, `funciones: 242`, `faltan: []`.
- Las 6 utilidades `window.*` salen como `function`.
- Las 9 variables salen como `object`, ninguna como `ERROR`.
- `help: "block"`: sin sesión, la app enseña la ayuda, igual que antes.

`read_console_messages` no debe mostrar errores. El aviso `Multiple GoTrueClient instances` ya existía antes y **no** es del reparto.

**No pulsar nada que escriba.** Si hiciera falta interactuar, antes `saveState = async () => {}`.

### Paso 5 — `testing-lead` y merge

Brief para `testing-lead`:
- El objetivo y el §1 de este documento.
- La salida de `verificar-reparto.js` y la del Paso 4.
- `git diff --stat GestionGuardias-BETA...feature/reparto-js`.
- El diff completo de los commits B y C, que son pequeños. El A no hace falta, porque lo cubre la verificación byte a byte.

Que compruebe sobre todo:
1. El orden de los `<script>`.
2. `!/js/` en `.vercelignore`.
3. Que en el commit B solo se borraron comentarios: `git diff HEAD~2 HEAD~1 -- js | grep '^[-+][^-+]' | grep -v '^-// \(Exportar a\|Líneas estimadas\|REVISAR\)'` solo debe enseñar el bloque del mapa de `arranque.js`.

Merge a BETA **confirmando la rama exacta con el usuario**, con el mensaje `merge: reparto de app.js en js/ (v4.0.0)`. Push, previa confirmación.

### Paso 6 — Comprobación en staging (la hace el usuario, con sesión de Vercel)

- `ggsbeta.vercel.app/js/nucleo.js` devuelve código, no un 404.
- `ggsbeta.vercel.app/app.js` da 404.
- `ggsbeta.vercel.app/CLAUDE.md` sigue dando 404.
- **Entrar con sesión real:** calendario, mercadillo, Mi Perfil y, con el rol de delegado, el panel de admin. Es lo único que el harness no puede probar.

---

## 4. Script de verificación (`verificar-reparto.js`)

Solo lee. Se guarda en el scratchpad, nunca en el repo.

```js
// Verifica el reparto de app.js en js/*.js. Solo lectura.
// Uso: node verificar-reparto.js <app.js original> <carpeta js/>
// Comprueba: (1) los rangos cubren todas las líneas una sola vez;
//            (2) cada archivo es, byte a byte, la concatenación de sus rangos.
const fs = require('fs');
const path = require('path');

const REPARTO = [
  ['nucleo.js',           [[47, 610]]],
  ['sesion.js',           [[611, 747], [749, 991]]],
  ['motores.js',          [[992, 1852], [7743, 7898]]],
  ['turno.js',            [[6727, 7441]]],
  ['grupos.js',           [[1853, 2131]]],
  ['calendario.js',       [[2132, 2535], [1, 46], [2536, 3098]]],
  ['mercadillo.js',       [[3099, 3289]]],
  ['exportacion.js',      [[3989, 4173], [7899, 7959]]],
  ['admin-ajustes.js',    [[3290, 3988]]],
  ['admin-calendario.js', [[4174, 4981]]],
  ['admin-cuentas.js',    [[4982, 5482]]],
  ['rotacion-editor.js',  [[5483, 6133]]],
  ['propuesta.js',        [[6134, 6726]]],
  ['perfil.js',           [[7442, 7742]]],
  ['arranque.js',         [[7960, 8001], [748, 748]]],
];

const [orig, dir] = process.argv.slice(2);
const buf = fs.readFileSync(orig);
const lines = buf.toString('latin1').match(/[^\n]*\n|[^\n]+$/g); // latin1: 1 byte = 1 char, sin reinterpretar UTF-8
const N = lines.length;
let fallos = 0;

const usos = new Array(N + 1).fill(0);
for (const [, rangos] of REPARTO) for (const [a, b] of rangos) for (let l = a; l <= b; l++) usos[l]++;
const sinUsar = [], repetidas = [];
for (let l = 1; l <= N; l++) { if (usos[l] === 0) sinUsar.push(l); if (usos[l] > 1) repetidas.push(l); }
if (sinUsar.length || repetidas.length || usos.length - 1 !== N) {
  fallos++; console.log(`COBERTURA MAL: ${N} líneas, sin usar ${sinUsar.slice(0, 10)}, repetidas ${repetidas.slice(0, 10)}`);
} else console.log(`Cobertura OK: las ${N} líneas, una vez cada una.`);

let total = 0;
for (const [nombre, rangos] of REPARTO) {
  const esperado = Buffer.from(rangos.map(([a, b]) => lines.slice(a - 1, b).join('')).join(''), 'latin1');
  const p = path.join(dir, nombre);
  if (!fs.existsSync(p)) { fallos++; console.log(`FALTA ${nombre}`); continue; }
  const real = fs.readFileSync(p);
  total += real.length;
  const ok = real.equals(esperado);
  if (!ok) fallos++;
  const nl = (real.toString('latin1').match(/\n/g) || []).length;
  console.log(`${ok ? 'OK   ' : 'DIFIERE'} ${nombre.padEnd(20)} ${String(nl).padStart(5)} líneas  ${real.length} bytes`);
}
console.log(`Bytes: original ${buf.length}, suma de archivos ${total} ${buf.length === total ? '(iguales)' : '(DISTINTOS)'}`);
if (buf.length !== total) fallos++;
console.log(fallos ? `\n${fallos} FALLO(S). No seguir.` : '\nTodo OK: el reparto es exacto.');
process.exit(fallos ? 1 : 0);
```

---

## 5. Marcha atrás

- **Antes del merge:** `git switch GestionGuardias-BETA && git branch -D feature/reparto-js`. Nada ha salido de la rama.
- **Después del merge:** `git revert -m 1 <commit de merge>` sobre BETA, en su propia rama `fix/`. O volver a la etiqueta:

```bash
git switch -c rescate/pre-reparto pre-reparto-v3.8
```

- **Copia local sin git:** `_backup/2026-10-09_BETA-a13549b_pre-reparto/` (ignorada; tiene un `LEEME.md`). Solo existe en el disco de esta máquina.
