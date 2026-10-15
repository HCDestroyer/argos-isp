import type { ContextoAccion } from '#shared/contexto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import type { Lectura } from '#portal/consultas'
import { ventanaAuditoria, type VentanaAuditoria } from '#portal/auditoria_unica'

export interface EntradaConsultaPortal {
    /** IP de origen ya resuelta (`ipOrigenDeLaPeticion`), IPv4 o IPv6. */
    ip: string
}

/**
 * Consulta pública del portal por IP que se audita una vez por ventana (regla 9 sin llenar la
 * línea de tiempo del cliente con cada visita a `/corte` o cada consulta del estado en vivo).
 *
 * 1. Lee (`leer`, de solo lectura: no cambia estado ni emite eventos).
 * 2. Si es la primera vez que esta IP consulta este servicio con esta acción dentro de la ventana
 *    (`auditoria_unica.ts`), escribe `audit.acciones` con `RegistrarConsultaPortal`: actor
 *    sistema, canal `portal`, entrada `{ ip }` y entidad `servicio` si se identificó.
 * 3. Responde siempre, se audite o no.
 *
 * Si la lectura falla, el error se audita (sin ventana) y se relanza, igual que en `DomainAction`.
 */
export abstract class ConsultaPortalAuditada<Salida> {
    /** Nombre de la acción en `audit.acciones` (`portal.quien_soy`, `portal.estado`). */
    abstract readonly nombre: string

    protected abstract leer(ip: string): Promise<Lectura<Salida>>

    async execute(
        input: EntradaConsultaPortal,
        ctx: ContextoAccion,
        opciones: { ventana?: VentanaAuditoria } = {},
    ): Promise<Salida> {
        let lectura: Lectura<Salida>
        try {
            lectura = await this.leer(input.ip)
        } catch (error) {
            await new RegistrarConsultaPortal(this.nombre, null, error).execute(input, ctx)
            throw error
        }

        const ventana = opciones.ventana ?? ventanaAuditoria()
        if (await ventana.reclamar(this.nombre, input.ip, lectura.servicioId)) {
            try {
                await new RegistrarConsultaPortal(this.nombre, lectura.servicioId).execute(input, ctx)
            } catch (error) {
                await ventana.liberar(this.nombre, input.ip, lectura.servicioId)
                throw error
            }
        }
        return lectura.respuesta
    }
}

/**
 * Escribe la fila de `audit.acciones` de una consulta del portal (la escribe `DomainAction`).
 * Con `error`, lo relanza para que quede auditado como `resultado = 'error'`.
 */
export class RegistrarConsultaPortal extends DomainAction<EntradaConsultaPortal, void> {
    constructor(
        readonly nombre: string,
        private readonly servicioId: number | null,
        private readonly error?: unknown,
    ) {
        super()
    }

    protected async handle(_input: EntradaConsultaPortal, t: Transaccion): Promise<void> {
        if (this.servicioId !== null) t.fijarEntidad('servicio', this.servicioId)
        if (this.error !== undefined) throw this.error
    }
}
