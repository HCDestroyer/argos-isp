/**
 * Encabezado de las pantallas (layout «islas», decisión pendiente del PM entre dos maquetas):
 * - `dos-pastillas` (IslasA2): a la izquierda una pastilla con el buscador y los accesos rápidos; a
 *   la derecha otra con la caja, el estado del sistema, los avisos y el usuario.
 * - `una-pastilla` (IslasA1): el título de la pantalla libre a la izquierda y UNA pastilla a la
 *   derecha con el buscador, los accesos y los iconos.
 * Cambiar esta constante es todo lo que hace falta (`PanelPagina.vue`).
 */
export const DISENO_ENCABEZADO: 'una-pastilla' | 'dos-pastillas' = 'dos-pastillas'
