// ============================================================
// MAPA DE MÓDULOS
// ============================================================
// CONFIG_ESTADO          → src/modules/config.js          (~70 líneas)  | Depende de: ninguno
// HELPERS_UTILS          → src/modules/helpers.js          (~65 líneas)  | Depende de: state.festivos
// PERSISTENCIA           → src/modules/persistencia.js    (~135 líneas) | Depende de: CONFIG_ESTADO, supabaseClient, HELPERS_UTILS
// AUTH_SESION            → src/modules/auth.js            (~120 líneas) | Depende de: PERSISTENCIA, USUARIOS_ACCESOS, NAVEGACION
// USUARIOS_ACCESOS       → src/modules/usuarios.js        (~115 líneas) | Depende de: AUTH_SESION, GRUPOS_HOSPITALARIOS
// MOTOR_TEMPORAL         → src/modules/motorTemporal.js   (~70 líneas)  | Depende de: CONFIG_ESTADO, globalProfiles, promoConfig
// MOTOR_SALIENTES        → src/modules/motorSalientes.js  (~90 líneas)  | Depende de: MOTOR_TEMPORAL, HELPERS_UTILS
// MOTOR_ROTACION         → src/modules/motorRotacion.js   (~215 líneas) | Depende de: MOTOR_TEMPORAL, PERSISTENCIA, MOTOR_BALANCEO
// MOTOR_EVALUACION       → src/modules/motorEvaluacion.js (~185 líneas) | Depende de: MOTOR_ROTACION, MOTOR_SALIENTES, MOTOR_SUBASTAS, HELPERS_SERVICIOS
// MOTOR_MERCADILLO       → src/modules/motorMercadillo.js (~95 líneas)  | Depende de: MOTOR_SALIENTES
// MOTOR_SUBASTAS         → src/modules/motorSubastas.js   (~390 líneas) | Depende de: MOTOR_EVALUACION, MOTOR_TEMPORAL, HELPERS_SERVICIOS
// MOTOR_TURNO            → src/modules/motorTurno.js      (~210 líneas) | Depende de: MOTOR_EVALUACION, MOTOR_ROTACION, MOTOR_SUBASTAS
// MOTOR_BALANCEO         → src/modules/motorRotacion.js   (~35 líneas)  | Depende de: MOTOR_ROTACION  ← mismo archivo
// NAVEGACION             → src/modules/navegacion.js      (~120 líneas) | Depende de: MOTOR_TURNO, todos los render*
// HELPERS_SERVICIOS      → src/modules/helpersServicios.js (~55 líneas) | Depende de: promoConfig, state.habilitaciones
// CALENDARIO             → src/modules/calendario.js      (~225 líneas) | Depende de: MOTOR_TURNO, MOTOR_SUBASTAS, MOTOR_EVALUACION, HELPERS_SERVICIOS
// MODALES_CALENDARIO     → src/modules/modalesCalendario.js (~215 líneas)| Depende de: MOTOR_EVALUACION, MOTOR_TURNO, MOTOR_SUBASTAS
// MERCADILLO_RENDER      → src/modules/mercadillo.js      (~315 líneas) | Depende de: MOTOR_MERCADILLO, MOTOR_TEMPORAL, HELPERS_SERVICIOS
// ADMIN_AJUSTES          → src/modules/adminAjustes.js    (~440 líneas) | Depende de: promoConfig, supabaseClient
// ADMIN_CALENDARIO       → src/modules/adminCalendario.js (~155 líneas) | Depende de: HELPERS_SERVICIOS, state.festivos, state.habilitaciones
// ADMIN_EXCEPCIONES      → src/modules/adminExcepciones.js (~60 líneas) | Depende de: MOTOR_TURNO, state.pendingExceptions
// ADMIN_CUENTAS          → src/modules/adminCuentas.js    (~250 líneas) | Depende de: supabaseClient, MOTOR_ROTACION
// GRUPOS_HOSPITALARIOS   → src/modules/grupos.js          (~230 líneas) | Depende de: supabaseClient, AUTH_SESION
// ROTACION_EDITOR        → src/modules/rotacionEditor.js  (~555 líneas) | Depende de: MOTOR_ROTACION, MOTOR_BALANCEO, state.planRotations
// EXPORTACION            → src/modules/exportacion.js     (~245 líneas) | Depende de: MOTOR_MERCADILLO, state.shifts, XLSX
// PERFIL_USUARIO         → src/modules/perfilUsuario.js   (~285 líneas) | Depende de: MOTOR_TEMPORAL, supabaseClient, state.bajasLargas
// GRADUACION             → (inline, ~95 líneas)           | Depende de: MOTOR_ROTACION, MOTOR_TEMPORAL, XLSX
//
// HELPERS COMPARTIDOS (usados por 3+ módulos):
//   formatDateKey, getDayTag, getDaysInMonth, getRotationKey, getFirstDayOffset,
//   setStatus, saveState, getComputedShifts, getPlanForUserOnDate, getUserLevelOnDate,
//   getAllResidents, renderAll, checkAutomaticGraduation, MONTHS
//
// POSIBLES IMPORTS CIRCULARES:
//   MOTOR_EVALUACION ←→ MOTOR_SUBASTAS  (getUserProgress llama getAnalisisFestivos y viceversa)
//     → resuelto en código con guards _computingTurn / _computingAnalisis
//   MOTOR_TURNO ←→ MOTOR_EVALUACION  (getCurrentTurn → getUserProgress → getAnalisisFestivos → getCurrentTurn)
//     → resuelto con _computingTurn
// ============================================================
initApp();
