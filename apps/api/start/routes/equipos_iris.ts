/*
|--------------------------------------------------------------------------
| Equipos del cliente y bienvenida (A6): contrato Iris 0.9.0 §12
|--------------------------------------------------------------------------
|
| A32 (aprovisionar), A33 (estado del equipo), A35 (Wi-Fi) y A37 (reenviar la bienvenida). Argos aún
| no tiene SmartOLT ni ACS: las rutas de equipos responden el error de «sin capacidad» del contrato
| (`#integraciones/equipos/equipos`) y `capacidades.aprovisionamiento` sale en false.
|
*/
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, type Ruta } from '#shared/rutas'
import {
    definirEsquema,
    enumerado,
    id as idEsquema,
    instante,
    lista,
    nulable,
    objeto,
    texto,
    booleano,
} from '#shared/openapi/esquemas'
import { NoEncontrado } from '#shared/errores'
import { exigirServicio } from '#core/acceso_empresa'
import { CabeceraIrisRequerida, exigirActorIris } from '#integraciones/iris/atencion'
import * as v from '#integraciones/equipos/validators'
import { estadoEquipo } from '#integraciones/equipos/equipos'
import AprovisionarServicio from '#integraciones/equipos/actions/aprovisionar_servicio'
import CambiarWifiServicio from '#integraciones/equipos/actions/cambiar_wifi_servicio'
import ReenviarBienvenida from '#notify/actions/reenviar_bienvenida'

const EstadoEquipo = definirEsquema(
    'EstadoEquipo',
    objeto(
        {
            servicio_id: idEsquema,
            tecnologia: enumerado(['ftth', 'wireless']),
            tipo: enumerado(['ont', 'cpe_wireless', 'router_tr069']),
            serie: nulable(texto),
            mac: nulable(texto),
            modelo: nulable(texto),
            en_linea: booleano,
            senal: nulable({ type: 'object', additionalProperties: { type: 'number' } }),
            firmware: nulable(texto),
            ultimo_contacto: nulable(instante),
            fuente: enumerado(['smartolt', 'acs']),
            leido_en: instante,
        },
        ['tipo', 'serie', 'mac', 'modelo', 'firmware', 'fuente'],
    ),
)

const AprovisionamientoAceptado = definirEsquema(
    'AprovisionamientoAceptado',
    objeto({ aprovisionamiento_id: idEsquema, estado: enumerado(['en_proceso', 'listo', 'fallido']) }),
)

const Aprovisionamiento = definirEsquema(
    'Aprovisionamiento',
    objeto({
        aprovisionamiento_id: idEsquema,
        servicio_id: idEsquema,
        empresa_id: idEsquema,
        origen_tipo: nulable(texto),
        origen_id: nulable(texto),
        estado: enumerado(['en_proceso', 'listo', 'fallido']),
        pasos: lista(
            objeto({
                paso: enumerado(['ip', 'equipo', 'wifi', 'activacion']),
                estado: enumerado(['pendiente', 'hecho', 'fallido', 'no_aplica']),
                en: nulable(instante),
            }),
        ),
        causa: nulable(texto),
        reintentable: booleano,
        detalle: nulable(texto),
        servicio_estado: texto,
        creado_en: instante,
        actualizado_en: instante,
    }),
)

const WifiAceptado = definirEsquema(
    'WifiAceptado',
    objeto({ solicitud_id: idEsquema, estado: enumerado(['en_proceso']) }),
)

const BienvenidaEnCola = definirEsquema(
    'BienvenidaEnCola',
    objeto({ estado: enumerado(['en_cola']), bienvenida_id: idEsquema }),
)

/** Con el token de Iris, `X-Iris-Actor` obligatoria; true si habla el asistente de IA. */
function esAsistente(ctx: HttpContext): boolean {
    return exigirActorIris(ctx)?.actor === 'asistente_ia'
}

const rutas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/equipo',
        operacion: 'serviciosVerEquipo',
        resumen: 'Estado del equipo del cliente: en línea, señal y firmware (contrato Iris 0.9.0 §12.3, A33)',
        descripcion:
            'Lee SmartOLT o el ACS. **Hoy Argos no tiene ninguno de los dos**: responde siempre `409 equipo_sin_gestion` ' +
            '(con `extensions.equipos[]`, los equipos en comodato del inventario: unidad, producto, serie, MAC y estado; ' +
            'sin `extensions` para el asistente de IA). Con el token de Iris, `X-Iris-Actor` obligatoria; con ' +
            '`asistente_ia` la respuesta 200 solo trae `servicio_id`, `tecnologia`, `en_linea`, `senal`, `ultimo_contacto` ' +
            'y `leido_en`. Nunca la clave Wi-Fi ni credenciales del equipo.',
        etiqueta: 'servicios',
        permiso: 'servicios.ver_equipo',
        respuesta: { status: 200, descripcion: 'Estado del equipo', esquema: EstadoEquipo },
        handler: async (ctx, { params }) => {
            const asistente = esAsistente(ctx)
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return estadoEquipo(id, { asistente })
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/aprovisionar',
        operacion: 'serviciosAprovisionar',
        resumen: 'Aprovisionar y activar desde la orden de Iris (contrato Iris 0.9.0 §12.2, A32)',
        descripcion:
            'Asíncrono en el contrato (`202`). **Hoy Argos no tiene SmartOLT ni ACS**: después de validar responde ' +
            '`422 aprovisionamiento_no_disponible` y `capacidades.aprovisionamiento` sale en false (Iris activa al cerrar, §3). ' +
            'Valida: `409 servicio_no_pendiente`, `422 equipo_invalido` (`ont` sin serie, `cpe_wireless` sin MAC, ' +
            '`planta` o `wireless` con otro tipo) y `422 wifi_invalido`. `Idempotency-Key` obligatoria ' +
            '(`iris:aprovisionar:<orden_id>:<intento>`). Con el token de Iris, `X-Iris-Actor` de una persona ' +
            '(el asistente nunca aprovisiona). La clave Wi-Fi nunca se guarda ni se audita.',
        etiqueta: 'servicios',
        permiso: 'servicios.aprovisionar',
        cuerpo: v.aprovisionarValidator,
        idempotente: 'obligatoria',
        respuesta: {
            status: 202,
            descripcion: 'Aprovisionamiento aceptado',
            esquema: AprovisionamientoAceptado,
        },
        handler: async (ctx, { cuerpo, params }) => {
            exigirActorIris(ctx, { sinAsistente: true })
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new AprovisionarServicio().execute({ ...cuerpo, servicio_id: id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/aprovisionamientos/:id',
        operacion: 'aprovisionamientosVer',
        resumen: 'Estado de un aprovisionamiento (contrato Iris 0.9.0 §12.2)',
        descripcion: 'Sin SmartOLT ni ACS no hay aprovisionamientos: responde `404 no_encontrado`.',
        etiqueta: 'servicios',
        permiso: 'servicios.aprovisionar',
        respuesta: { status: 200, descripcion: 'Aprovisionamiento', esquema: Aprovisionamiento },
        handler: async (_ctx, { params }) => {
            throw new NoEncontrado(`El aprovisionamiento ${String(params.id)} no existe`)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/wifi',
        operacion: 'serviciosCambiarWifi',
        resumen: 'Cambiar el Wi-Fi pedido desde Iris (contrato Iris 0.9.0 §12.4, A35)',
        descripcion:
            'Asíncrono en el contrato (`202` y webhook `equipo.wifi_resuelto`). **Hoy Argos no tiene SmartOLT ni ACS**: ' +
            'después de validar responde `409 equipo_sin_gestion`. Valida `422 wifi_invalido` (al menos SSID o clave; SSID de ' +
            '1 a 32, clave de 8 a 63) y `422 verificacion_requerida` (`verificacion { metodo, verificado_en, cliente_id }` ' +
            'del titular del servicio; el asistente de IA solo `codigo_telefono`, `codigo_correo` o `datos_titular` y de ' +
            'menos de 10 min; una persona además `presencial` o `llamada_verificada`). Con el token de Iris, `X-Iris-Actor` ' +
            'obligatoria y, con el asistente, `X-Iris-Conversacion`. `Idempotency-Key` obligatoria. La clave nunca se ' +
            'guarda, se audita ni vuelve.',
        etiqueta: 'servicios',
        permiso: 'servicios.cambiar_wifi',
        cuerpo: v.cambiarWifiValidator,
        idempotente: 'obligatoria',
        respuesta: { status: 202, descripcion: 'Cambio aceptado', esquema: WifiAceptado },
        handler: async (ctx, { cuerpo, params }) => {
            const origen = exigirActorIris(ctx)
            if (origen?.actor === 'asistente_ia' && !origen.conversacion) {
                throw new CabeceraIrisRequerida(
                    'X-Iris-Conversacion es obligatoria cuando el asistente de IA pide el cambio',
                )
            }
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new CambiarWifiServicio().execute({ ...cuerpo, servicio_id: id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/bienvenida/reenviar',
        operacion: 'serviciosReenviarBienvenida',
        resumen: 'Reenviar la bienvenida del servicio (contrato Iris 0.9.0 §12.5, A37)',
        descripcion:
            'Vuelve a mandar la bienvenida por los canales pedidos (`canales`; sin él, todos los configurados), con las ' +
            'mismas reglas que la primera. `202 { estado: en_cola }`; el resultado de cada canal llega con el webhook ' +
            '`servicio.bienvenida_cambiada` (`reenvio: true`). Errores: `409 servicio_no_activo`, `429 bienvenida_reciente` ' +
            '(antes de 10 min de la última) y `429 demasiados_reenvios` (más de 3 reenvíos por servicio en el día), los dos ' +
            'con `Retry-After`. `Idempotency-Key` obligatoria (`iris:bienvenida:<orden_id>:<n>`).',
        etiqueta: 'servicios',
        permiso: 'servicios.reenviar_bienvenida',
        cuerpo: v.reenviarBienvenidaValidator,
        idempotente: 'obligatoria',
        respuesta: { status: 202, descripcion: 'Bienvenida en cola', esquema: BienvenidaEnCola },
        handler: async (ctx, { cuerpo, params }) => {
            exigirActorIris(ctx)
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new ReenviarBienvenida().execute({ ...cuerpo, servicio_id: id }, ctx.contextoAccion())
        },
    }),
]

export default rutas
