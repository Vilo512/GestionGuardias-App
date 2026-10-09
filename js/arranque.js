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

initApp();
