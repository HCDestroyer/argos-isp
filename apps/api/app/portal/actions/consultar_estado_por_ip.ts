import { leerEstado, type EstadoPortal, type Lectura } from '#portal/consultas'
import { ConsultaPortalAuditada } from '#portal/actions/consulta_auditada'

export type { EstadoPortal } from '#portal/consultas'

/**
 * Estado en vivo para la página de corte (`GET /portal/estado`): la consulta cada 5 s después de
 * pagar o de una promesa hasta ver `activo`. Identifica por IP igual que `portal.quien_soy`, pero
 * solo devuelve estado y monto adeudado: sin nombre ni IP ni ningún otro dato del cliente.
 *
 * Lectura pura (`leerEstado`). Se audita como `portal.estado` una vez por IP y servicio cada
 * `PORTAL_AUDITORIA_VENTANA_S`, no en cada consulta (ver `ConsultaPortalAuditada`).
 */
export default class ConsultarEstadoPorIp extends ConsultaPortalAuditada<EstadoPortal> {
    readonly nombre = 'portal.estado'

    protected leer(ip: string): Promise<Lectura<EstadoPortal>> {
        return leerEstado(ip)
    }
}
