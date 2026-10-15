/*
|--------------------------------------------------------------------------
| Rutas del portal del cliente (A5)
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { QuienSoy } from '#portal/esquemas'
import { ipOrigenDeLaPeticion } from '#portal/ip_origen'
import IdentificarPorIp from '#portal/actions/identificar_por_ip'
import { limitarPorIp } from '#portal/limite_peticiones'

const portal: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/portal/quien-soy',
        operacion: 'portalQuienSoy',
        resumen: 'Identifica al cliente por la IP de origen (página de corte)',
        descripcion:
            'Sin login. Solo devuelve nombre parcial, estado y montos. La IP de origen sale del socket, ' +
            'o de `X-Forwarded-For` (`PORTAL_CABECERA_IP`) solo si la conexión viene de un proxy listado ' +
            'en `PORTAL_PROXIES_CONFIABLES`. Límite por IP (IPv6: por /64): `PORTAL_LIMITE_PETICIONES` por ' +
            '`PORTAL_LIMITE_VENTANA_S` (30 por minuto por defecto); al pasarse responde 429 problem+json con `Retry-After`.',
        etiqueta: 'portal',
        seguridad: 'publico',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Identificación mínima', esquema: QuienSoy },
        handler: async (ctx) => {
            ctx.response.header('Cache-Control', 'no-store')
            const ip = ipOrigenDeLaPeticion(ctx)
            if (!ip) throw new Error('La conexión no trae una IP de origen válida')
            await limitarPorIp(ctx, 'quien-soy', ip)
            return new IdentificarPorIp().execute({ ip }, ctx.contextoAccion('portal'))
        },
    }),
]

export default portal
