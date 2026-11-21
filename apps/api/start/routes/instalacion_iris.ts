/*
|--------------------------------------------------------------------------
| De la venta a la instalación (A1): contrato Iris 0.10.0 §3.4
|--------------------------------------------------------------------------
|
| Rutas que Iris llama desde la orden de instalación (y el personal desde el panel). Con el token de
| Iris: `X-Iris-Actor` obligatoria y nunca el asistente (`403 actor_ia_no_permitido`); el alcance
| de servicios de Iris (`403 servicio_no_de_iris`) lo revisa cada acción con `desdeIris`.
|
*/
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, type Ruta } from '#shared/rutas'
import { definirEsquema, nulable, objeto, texto, instante } from '#shared/openapi/esquemas'
import { exigirServicio } from '#core/acceso_empresa'
import { esTokenIris, exigirActorIris } from '#integraciones/iris/atencion'
import * as vi from '#core/validators_instalacion'
import ReservarIpServicio from '#core/actions/reservar_ip_servicio'

/** Con el token de Iris: `X-Iris-Actor` obligatoria y nunca el asistente de IA. */
export function desdeIris(ctx: HttpContext): boolean {
    exigirActorIris(ctx, { sinAsistente: true })
    return esTokenIris(ctx)
}

const ReservaIp = definirEsquema(
    'ReservaIp',
    objeto({
        ipv4: nulable(texto),
        prefijo_v6: { ...nulable(texto), description: 'Prefijo IPv6 delegado reservado (o null)' },
        prefijo_enlace_v6: nulable(texto),
        vence_en: {
            ...nulable(instante),
            description:
                'Si no se activa antes, la reserva se libera (30 días); null si la IP no es una reserva en sitio',
        },
    }),
)

const instalacion: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/reservar-ip',
        operacion: 'serviciosReservarIp',
        resumen: 'Reservar en sitio la IP de un servicio pendiente (contrato Iris 0.10.0 §3.4.1)',
        descripcion:
            'Para IP fija o amarre IP-MAC, cuando el equipo necesita la IP antes de activar (con PPPoE no hace ' +
            'falta). Solo en `pendiente_instalacion` (`422 servicio_no_pendiente`). Una segunda llamada devuelve ' +
            'la misma reserva. Sin IP libre: `422 sin_ip_disponible`. La activación la usa; se libera al retirar y ' +
            'vence a los 30 días sin activar. Iris: `Idempotency-Key = iris:reservar_ip:<orden_id>:<router_id>`, ' +
            '`X-Iris-Actor` y solo servicios de Iris (`403 servicio_no_de_iris`).',
        etiqueta: 'servicios',
        permiso: 'servicios.reservar_ip',
        cuerpo: vi.reservarIpValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Reserva', esquema: ReservaIp },
        handler: async (ctx, { cuerpo, params }) => {
            const iris = desdeIris(ctx)
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new ReservarIpServicio().execute({ ...cuerpo, id, desdeIris: iris }, ctx.contextoAccion())
        },
    }),
]

export default instalacion
