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
| H | Merge a `main` | ⛔ **Descartado hoy a propósito** — ver §2 |

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

### Inmediato
- [x] **Push de BETA.** En sync con `origin/GestionGuardias-BETA`.
- [x] **Limpieza de ramas.** Locales 7 → 3 (`GestionGuardias-BETA`, `main`, `backup/main-mayo`); remotas 8 → 3 (`GestionGuardias-BETA`, `main`, `hot`).
- [ ] **`origin/hot`** (21-may): dos commits de subida por la web de GitHub que tocan `LICENSE`, `app.js`, `index.html` y `style.css`. Anterior a la primera sesión del proyecto, no está ni en `main` ni en BETA. Pendiente de revisar o borrar.

> **Sobre `main` local.** Estaba divergido: 8 commits de finales de mayo (serie W7) que no estaban ni en `origin/main` ni en BETA. El arreglo **sí** estaba en ambos por otra vía (PR #6 fusionado con otros SHA), así que se realineó con `git reset --hard origin/main`. La historia vieja se conserva en **`backup/main-mayo`** por si acaso; se puede borrar cuando haya confianza.

> **Merge a `main`: descartado hoy, con conocimiento de causa.** Se planteó y se decidió que no. El merge está limpio —0 conflictos, y los 13 commits que `main` tenía de más son merges de PR sin código propio—, pero saldrían 43 commits el día uno de usuarios reales, con la app mitad oscura y mitad clara y sin haber probado iOS jamás. Se mantiene el plan: P-01 y P-02 sobre BETA, y **un solo despliegue** con todo.

### Cola (orden decidido en `GestionGuardias_BACKLOG.md`)
- [ ] **[P-01]** Bugs de `adminExpulsarUsuario`: falla en silencio (`app.js:5202` no lee `error`) y no degrada el rol del expulsado
- [ ] **[P-02]** Ámbito por plan y apertura de la gestión de roles — el grande
- [ ] **[P-05]** D-06 ampliado
- [ ] **[P-04]** Sucesión forzosa del Dueño al graduarse
- [ ] **[P-03]** Las guardas son solo de cliente; RLS sin verificar
- [ ] **[P-06]** `datalist` huérfano

### Paso 6 — vistas que faltan
Por colores fijos: `renderAdminAjustes` (23), `renderRotationView` (18), `renderAdminCalendar` (16), `renderAdminHoras` (13), `renderAdminExceptions` (7), `renderAdminSeguridad` (2).

### Sin verificar (límite del entorno)
- [ ] **WebKit / iOS Safari.** Todo se validó en Chromium. Sigue igual que en agosto.

## 7. Método — lo que funcionó hoy

1. **Medir antes de elegir.** «Empieza por el panel de admin» parecía un punto hasta que se contaron las líneas: eran seis sub-vistas. La medición cambió el plan.
2. **Verificar antes de escribir en el PRD.** Dos veces hoy una suposición mía habría quedado escrita como spec: que producción no tenía unas guardas (era una función que no existe) y que «promoción» significaba lo mismo en tu cabeza y en la base de datos (no: la tabla `promociones` guarda **especialidades**).
3. **Una decisión sin motivo citable no es una decisión.** El veto a partir `app.js` resultó ser una línea descriptiva del AUDIT endurecida. Ahora está reclasificada como estado heredado.
4. **`testing-lead` con el diff y con lo ya verificado en el brief.** Encontró tres cosas reales sin repetir nada.

## 8. Arranque rápido de la próxima sesión

```bash
git log --oneline -1          # deberia ser d128e9b
git log origin/GestionGuardias-BETA..HEAD --oneline   # 6 commits sin pushear
```

Lo primero es decidir el push. Después, **[P-01] + [P-02] sobre la zona de Cuentas**, que acaba de quedar migrada y es la misma región: abrirla una vez en lugar de dos.

Servidor de pruebas: entrada `gg-harness` en `.claude/launch.json` (puerto 8126).

> **Para probar esta vista sin sesión de Supabase:** `currentUserProfile` es un `let` de nivel superior y **no** se puede inyectar desde la consola. Hay que montar el marcado a mano y llamar a `_bindAccountActions(el)`, que sí está en `window`. Las utilidades `window.*` del final del archivo y `escapeHtml` también lo están.
