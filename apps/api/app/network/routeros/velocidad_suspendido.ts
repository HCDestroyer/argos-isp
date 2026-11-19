/**
 * Velocidad del suspendido por defecto (`ROUTEROS_SUSPENDIDO_RATE_LIMIT` vacía): `2M/2M` (subida/bajada).
 * Lo que corta al suspendido es el firewall (`argos-corte`: solo DNS, el portal y el walled garden), no la
 * velocidad. La cola dinámica de RADIUS (`Mikrotik-Rate-Limit`), la del perfil `suspendido` y la cola estática
 * del WISP limitan el tráfico del cliente: con el `256k/256k` de antes, la primera carga de `/corte` (unos
 * 1,2 MB de JS y CSS sin comprimir) tardaba casi un minuto solo en bajar (bug v1.19.0 del PM), y la pasarela
 * de pago del walled garden igual. Desde el bypass del portal (`corte_router.ts`, `reglasBypass`) lo que va a
 * la página de corte no pasa por esta velocidad; DNS y walled garden sí.
 */
export const RATE_LIMIT_SUSPENDIDO_DEFECTO = '2M/2M'
