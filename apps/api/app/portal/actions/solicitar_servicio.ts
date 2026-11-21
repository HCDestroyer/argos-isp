import { DomainAction, type Transaccion } from '#shared/domain_action'
import { llamarIrisJson, type SesionIris } from '#portal/soporte/iris_portal'
import { solicitudSoporte, type SolicitudSoporte, type TipoSolicitud } from '#portal/soporte/vistas'

export interface EntradaSolicitarServicio {
    clienteId: number
    empresaId: number
    sesion: SesionIris
    /** UUID del envío: `argos:portal:solicitud:<clave>` */
    clave: string
    tipo: TipoSolicitud
    servicio_id?: number | null
    direccion?: string | null
    coordenadas?: string | null
    plan_interes_id?: number | null
    comentario?: string | null
    telefono_contacto?: string | null
}

/**
 * `portal.solicitar_servicio` (`POST /portal/soporte/solicitudes`, contrato Iris 0.9.0 §11.7, A31):
 * el cliente pide un servicio nuevo, un cambio de plan, un traslado u otra cosa. En Iris es un
 * prospecto de ventas con origen `portal_argos` (emite `prospecto.creado`); un asesor lo revisa,
 * cotiza y lo convierte en orden. Argos no guarda nada: audita con actor `cliente`, canal `portal`.
 * Una abierta del mismo tipo y servicio responde 409 `solicitud_abierta` con `solicitud_id`. Solo
 * con sesión `documento`.
 */
export default class SolicitarServicioPortal extends DomainAction<
    EntradaSolicitarServicio,
    SolicitudSoporte
> {
    readonly nombre = 'portal.solicitar_servicio'
    protected readonly camposEntradaOcultos = ['sesion']

    protected async handle(input: EntradaSolicitarServicio, t: Transaccion): Promise<SolicitudSoporte> {
        t.fijarEmpresa(input.empresaId)
        const cuerpo: Record<string, unknown> = { tipo: input.tipo }
        for (const campo of [
            'servicio_id',
            'direccion',
            'coordenadas',
            'plan_interes_id',
            'comentario',
            'telefono_contacto',
        ] as const) {
            const valor = input[campo]
            if (valor !== undefined && valor !== null && valor !== '') cuerpo[campo] = valor
        }
        const solicitud = solicitudSoporte(
            await llamarIrisJson<unknown>({
                metodo: 'POST',
                clienteId: input.clienteId,
                empresaId: input.empresaId,
                sesion: input.sesion,
                ruta: '/solicitudes',
                cuerpo,
                idempotencia: `argos:portal:solicitud:${input.clave}`,
            }),
        )
        t.fijarEntidad('solicitud_iris', solicitud.id)
        t.anotarAuditoria({ numero: solicitud.numero })
        return solicitud
    }
}
