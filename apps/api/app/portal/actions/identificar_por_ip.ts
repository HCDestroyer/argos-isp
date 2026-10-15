import { leerQuienSoy, type Lectura, type QuienSoy } from '#portal/consultas'
import { ConsultaPortalAuditada } from '#portal/actions/consulta_auditada'

export type { EstadoServicio, QuienSoy } from '#portal/consultas'
export { nombreParcial } from '#portal/consultas'

/**
 * Identifica el servicio de la página de corte a partir de la IP de origen
 * (`GET /portal/quien-soy`).
 *
 * Lectura pura (`leerQuienSoy` en `app/portal/consultas.ts`): no cambia estado ni emite eventos.
 * Se audita como `portal.quien_soy` porque es público y revela información de un cliente, una vez
 * por IP y servicio cada `PORTAL_AUDITORIA_VENTANA_S` (ver `ConsultaPortalAuditada`).
 *
 * Solo devuelve nombre parcial, estado y montos: nunca datos personales completos.
 */
export default class IdentificarPorIp extends ConsultaPortalAuditada<QuienSoy> {
    readonly nombre = 'portal.quien_soy'

    protected leer(ip: string): Promise<Lectura<QuienSoy>> {
        return leerQuienSoy(ip)
    }
}
