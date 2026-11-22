/*
|--------------------------------------------------------------------------
| Equipos del cliente y bienvenida (A6): contrato Iris 0.9.0 §12
|--------------------------------------------------------------------------
|
| A32 (aprovisionar), A33 (estado del equipo), A35 (Wi-Fi) y A37 (reenviar la bienvenida), con
| SmartOLT (fibra) y GenieACS (TR-069) por empresa (`#integraciones/equipos`), y la configuración de
| esas dos integraciones (`/integraciones/equipos`).
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
import { exigirAccesoEmpresa, exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import { CabeceraIrisRequerida, exigirActorIris } from '#integraciones/iris/atencion'
import * as v from '#integraciones/equipos/validators'
import { estadoEquipo } from '#integraciones/equipos/equipos'
import AprovisionarServicio from '#integraciones/equipos/actions/aprovisionar_servicio'
import CambiarWifiServicio from '#integraciones/equipos/actions/cambiar_wifi_servicio'
import ConfigurarEquipos from '#integraciones/equipos/actions/configurar_equipos'
import ProbarEquipos from '#integraciones/equipos/actions/probar_equipos'
import { vistaConfig } from '#integraciones/equipos/configuracion'
import {
    iniciadoPor,
    leerAprovisionamiento,
    vistaAprovisionamiento,
    vistaAprovisionamientoAjeno,
} from '#integraciones/equipos/aprovisionamientos'
import { exigeCapacidades, exigirCapacidad, exigirServicioIris } from '#integraciones/equipos/capacidades'
import { esTokenIris } from '#integraciones/iris/atencion'
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
            ssid: nulable(texto),
            leido_en: instante,
        },
        ['tipo', 'serie', 'mac', 'modelo', 'firmware', 'fuente', 'ssid'],
    ),
)

const AprovisionamientoAceptado = definirEsquema(
    'AprovisionamientoAceptado',
    objeto({ aprovisionamiento_id: idEsquema, estado: enumerado(['en_proceso', 'listo', 'fallido']) }),
)

const Aprovisionamiento = definirEsquema(
    'Aprovisionamiento',
    objeto(
        {
            aprovisionamiento_id: idEsquema,
            servicio_id: idEsquema,
            empresa_id: idEsquema,
            origen_tipo: nulable(texto),
            origen_id: nulable(texto),
            iniciado_por: enumerado(['argos', 'iris']),
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
            equipo: objeto({
                tipo: enumerado(['ont', 'cpe_wireless', 'router_tr069']),
                serie: nulable(texto),
                mac: nulable(texto),
                unidad_id: nulable(idEsquema),
                modelo: nulable(texto),
                gestionado: booleano,
            }),
            senal: nulable(
                objeto({ rx_dbm: nulable({ type: 'number' }), tx_dbm: nulable({ type: 'number' }) }),
            ),
            creado_en: instante,
            actualizado_en: instante,
        },
        // 0.14.3: para un aprovisionamiento que no inició ese conector la respuesta se recorta
        ['pasos', 'reintentable', 'detalle', 'servicio_estado', 'equipo', 'senal', 'creado_en'],
    ),
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

const ResultadoPruebaSistema = objeto(
    {
        ok: booleano,
        latencia_ms: nulable({ type: 'integer' }),
        error: nulable(texto),
        olts: lista(objeto({ id: texto, name: texto })),
    },
    ['olts'],
)
const Capacidades = objeto({ ftth: booleano, wireless: booleano, tr069: booleano })

const ConfigEquipos = definirEsquema(
    'ConfigEquipos',
    objeto({
        empresa_id: idEsquema,
        activo: booleano,
        smartolt: objeto({
            url: nulable(texto),
            token: nulable(enumerado(['***'])),
            probado_en: nulable(instante),
            prueba_ok: nulable(booleano),
            prueba_error: nulable(texto),
        }),
        genieacs: objeto({
            url: nulable(texto),
            usuario: nulable(texto),
            clave: nulable(enumerado(['***'])),
            ca: booleano,
            probado_en: nulable(instante),
            prueba_ok: nulable(booleano),
            prueba_error: nulable(texto),
        }),
        pppoe_por_acs: booleano,
        perfiles: lista(
            objeto({
                smartolt_olt_id: texto,
                plan_id: nulable(idEsquema),
                authorization_preset_id: { type: 'integer' },
                pon_type: enumerado(['gpon', 'epon']),
            }),
        ),
        capacidades: Capacidades,
        version: { type: 'integer' },
    }),
)

const PruebaEquipos = definirEsquema(
    'PruebaEquipos',
    objeto({
        probado_en: instante,
        smartolt: nulable(ResultadoPruebaSistema),
        genieacs: nulable(ResultadoPruebaSistema),
        capacidades: Capacidades,
    }),
)

const rutas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/integraciones/equipos',
        operacion: 'equiposConfigVer',
        resumen: 'Configuración de SmartOLT y GenieACS de la empresa activa (sin secretos)',
        descripcion:
            'Token de SmartOLT y clave de GenieACS como `***` (o null). `capacidades` es lo que se informa a Iris en ' +
            '`capacidades.aprovisionamiento`: solo con la integración encendida y su última prueba en ok.',
        etiqueta: 'integraciones',
        permiso: 'equipos.ver',
        respuesta: { status: 200, descripcion: 'Configuración', esquema: ConfigEquipos },
        handler: async (ctx) => vistaConfig(exigirEmpresaActivaDelContexto(ctx.contextoAccion())),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/integraciones/equipos',
        operacion: 'equiposConfigurar',
        resumen: 'Guardar SmartOLT y GenieACS de la empresa activa',
        descripcion:
            'Secretos: omitido = se conserva, null = se borra, texto = se reemplaza; se guardan cifrados y nunca vuelven. ' +
            'Cambiar URL o secreto borra la última prueba (la capacidad vuelve a false hasta probar). `perfiles` ' +
            'reemplaza la tabla de perfiles de autorización de SmartOLT por OLT y plan. `version` 0 la primera vez; ' +
            'desactualizada: 409.',
        etiqueta: 'integraciones',
        permiso: 'equipos.configurar',
        cuerpo: v.configurarEquiposValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Configuración guardada', esquema: ConfigEquipos },
        handler: async (ctx, { cuerpo }) => new ConfigurarEquipos().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/equipos/probar',
        operacion: 'equiposProbar',
        resumen: 'Probar la conexión con SmartOLT y GenieACS (configuración guardada)',
        descripcion:
            'SmartOLT: `GET /api/system/get_olts` (devuelve las OLT para armar los perfiles). GenieACS: una búsqueda de ' +
            'un dispositivo en el NBI. Guarda el resultado de cada uno; de eso sale la capacidad. No falla si un sistema ' +
            'no responde: devuelve su error.',
        etiqueta: 'integraciones',
        permiso: 'equipos.probar',
        respuesta: { status: 200, descripcion: 'Resultado de la prueba', esquema: PruebaEquipos },
        handler: async (ctx) => new ProbarEquipos().execute({}, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/equipo',
        operacion: 'serviciosVerEquipo',
        resumen: 'Estado del equipo del cliente: en línea, señal y firmware (contrato Iris 0.9.0 §12.3, A33)',
        descripcion:
            'Lee SmartOLT (estado y señal de la ONU) y GenieACS (último contacto, firmware, modelo y SSID). Responde la ' +
            'lectura guardada si tiene menos de 60 s (`leido_en`). Sin equipo gestionado (la empresa sin SmartOLT ni ACS ' +
            'probados, o el equipo sin registro en ninguno): `409 equipo_sin_gestion` con `extensions.equipos[]` (los ' +
            'equipos en comodato del inventario), sin `extensions` para el asistente de IA. Si ningún sistema responde: ' +
            '`503 equipo_sin_respuesta`. `ssid` es una extensión de Argos (no está en el contrato). Con el token de Iris, ' +
            '`X-Iris-Actor` obligatoria; con ' +
            '`asistente_ia` la respuesta 200 solo trae `servicio_id`, `tecnologia`, `en_linea`, `senal`, `ultimo_contacto` ' +
            'y `leido_en`. Nunca la clave Wi-Fi ni credenciales del equipo. Con el token de Iris ≥ 0.14.3, alcance ' +
            'primero (servicio de otra empresa: 404) y sin la marca `estado_equipo`, `422 capacidad_no_disponible`.',
        etiqueta: 'servicios',
        permiso: 'servicios.ver_equipo',
        respuesta: { status: 200, descripcion: 'Estado del equipo', esquema: EstadoEquipo },
        handler: async (ctx, { params }) => {
            const asistente = esAsistente(ctx)
            const id = Number(params.id)
            // 0.14.3 §4.3: alcance, después la marca `estado_equipo`, después `equipo_sin_gestion`
            const reglas = await exigeCapacidades(ctx)
            const empresaId = await exigirServicioIris(ctx, id, reglas)
            if (reglas) await exigirCapacidad(empresaId, 'estado_equipo')
            return estadoEquipo(id, { asistente })
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/aprovisionar',
        operacion: 'serviciosAprovisionar',
        resumen: 'Aprovisionar y activar desde la orden de Iris (contrato Iris 0.9.0 §12.2, A32)',
        descripcion:
            'Asíncrono (`202 { aprovisionamiento_id, estado: en_proceso }`): el worker autoriza la ONT en SmartOLT con el ' +
            'perfil de su OLT y plan, configura PPPoE (si la empresa lo pide) y el Wi-Fi inicial por GenieACS, asigna IP, ' +
            'hace el comodato y activa el servicio; el resultado llega por `instalacion.aprovisionada` o ' +
            '`instalacion.fallida` y por `GET /aprovisionamientos/:id`. Repetir la misma `Idempotency-Key` ' +
            '(`iris:aprovisionar:<orden_id>:<intento>`) devuelve `200` con el estado final si ya terminó. Errores: ' +
            '`409 servicio_no_pendiente`, `409 aprovisionamiento_en_curso` (`extensions.aprovisionamiento_id` e ' +
            '`iniciado_por`: `argos` | `iris`), ' +
            '`409 unidad_en_otra_bodega`, `422 equipo_invalido`, `422 wifi_invalido`, `422 wifi_no_disponible`, ' +
            '`422 aprovisionamiento_no_disponible` y `422 plan_no_permitido`. Con el token de Iris, `X-Iris-Actor` de una ' +
            'persona (el asistente nunca aprovisiona). La clave Wi-Fi se guarda cifrada solo hasta terminar y nunca se audita. ' +
            'Contrato Iris 0.14.3 (token de Iris ≥ 0.14.3): servicio fuera del token 404; `wifi` sin la marca `wifi` ' +
            '`422 capacidad_no_disponible`; la unidad se busca por `unidad_id`, `serie` o `mac` en todo el inventario: ' +
            'con `tecnico` (vínculo I1 en la empresa, si no `403 actor_desconocido`) en su bodega personal o de cuadrilla, ' +
            'o ya asignada al servicio; sin `tecnico`, ya asignada; en otro lugar `409 unidad_en_otra_bodega` sin decir ' +
            'dónde. Desde el panel de Argos: `origen_tipo: argos_panel`, `origen_id: null` y sin `instalacion.*` a Iris.',
        etiqueta: 'servicios',
        permiso: 'servicios.aprovisionar',
        cuerpo: v.aprovisionarValidator,
        idempotente: 'obligatoria',
        respuesta: {
            status: 202,
            descripcion: 'Aprovisionamiento aceptado',
            esquema: AprovisionamientoAceptado,
        },
        releerRepeticion: async (guardada) => {
            const id = Number(
                (guardada.body as { aprovisionamiento_id?: unknown } | null)?.aprovisionamiento_id,
            )
            const fila = Number.isSafeInteger(id) && id > 0 ? await leerAprovisionamiento(id) : null
            if (!fila || fila.estado === 'en_proceso') return null
            return { status: 200, body: await vistaAprovisionamiento(fila) }
        },
        handler: async (ctx, { cuerpo, params }) => {
            exigirActorIris(ctx, { sinAsistente: true })
            const id = Number(params.id)
            const reglas = await exigeCapacidades(ctx)
            const empresaId = await exigirServicioIris(ctx, id, reglas)
            // 0.14.3: `wifi` sin la marca → 422 capacidad_no_disponible (no wifi_no_disponible)
            if (reglas && cuerpo.wifi) await exigirCapacidad(empresaId, 'wifi')
            return new AprovisionarServicio().execute(
                {
                    ...cuerpo,
                    servicio_id: id,
                    idempotency_key: ctx.request.header('idempotency-key') ?? null,
                },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/aprovisionamientos/:id',
        operacion: 'aprovisionamientosVer',
        resumen: 'Estado de un aprovisionamiento (contrato Iris 0.9.0 §12.2)',
        descripcion:
            '`estado` `en_proceso`, `listo` o `fallido`; `pasos[]` (`ip`, `equipo`, `wifi`, `activacion`) con su estado; ' +
            '`causa`, `reintentable` y `detalle` con `fallido`; `equipo { tipo, serie, mac, unidad_id, modelo, gestionado }`. ' +
            'Nunca el SSID ni la clave del Wi-Fi inicial. De otra empresa o inexistente: `404`. `iniciado_por` ' +
            '(0.14.3): `argos` (panel, `origen_tipo: argos_panel`) o `iris`. Al token de Iris, uno que no inició Iris ' +
            'se le responde recortado: `aprovisionamiento_id`, `servicio_id`, `empresa_id`, `origen_tipo`, `origen_id: null`, ' +
            '`iniciado_por`, `estado`, `causa` y `actualizado_en`.',
        etiqueta: 'servicios',
        permiso: 'servicios.aprovisionar',
        respuesta: { status: 200, descripcion: 'Aprovisionamiento', esquema: Aprovisionamiento },
        handler: async (ctx, { params }) => {
            const fila = await leerAprovisionamiento(Number(params.id))
            const contexto = ctx.contextoAccion()
            // 0.14.3: fuera de las empresas del token, el mismo 404 que uno que no existe
            if (
                !fila ||
                (contexto.empresasPermitidas && !contexto.empresasPermitidas.includes(fila.empresa_id))
            ) {
                throw new NoEncontrado(`El aprovisionamiento ${String(params.id)} no existe`)
            }
            exigirAccesoEmpresa(contexto, fila.empresa_id)
            // 0.14.3: al token de Iris, uno que no inició Iris (el panel de Argos) se le responde recortado
            if (esTokenIris(ctx) && iniciadoPor(fila.origen_tipo) !== 'iris') {
                return vistaAprovisionamientoAjeno(fila)
            }
            return vistaAprovisionamiento(fila)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/wifi',
        operacion: 'serviciosCambiarWifi',
        resumen: 'Cambiar el Wi-Fi pedido desde Iris (contrato Iris 0.9.0 §12.4, A35)',
        descripcion:
            'Asíncrono (`202 { solicitud_id, estado: en_proceso }` y webhook `equipo.wifi_resuelto`): el worker lo aplica ' +
            'por GenieACS (`setParameterValues` en TR-098 o TR-181). `409 equipo_sin_gestion` si el equipo no está en el ' +
            'ACS de la empresa; `429 demasiados_cambios_wifi` (con `Retry-After`) después de 3 cambios por servicio en el ' +
            'día de Guatemala. Con `aplicado` se avisa al titular. Valida `422 wifi_invalido` (al menos SSID o clave; SSID de ' +
            '1 a 32, clave de 8 a 63) y `422 verificacion_requerida` (`verificacion { metodo, verificado_en, cliente_id }` ' +
            'del titular del servicio; el asistente de IA solo `codigo_telefono`, `codigo_correo` o `datos_titular` y de ' +
            'menos de 10 min; una persona además `presencial` o `llamada_verificada`). Con el token de Iris, `X-Iris-Actor` ' +
            'obligatoria y, con el asistente, `X-Iris-Conversacion`. `Idempotency-Key` obligatoria. La clave nunca se ' +
            'guarda, se audita ni vuelve. Con el token de Iris ≥ 0.14.3: servicio de otra empresa 404 y sin la marca ' +
            '`wifi`, `422 capacidad_no_disponible` (antes que `equipo_sin_gestion`).',
        etiqueta: 'servicios',
        permiso: 'servicios.cambiar_wifi',
        cuerpo: v.cambiarWifiValidator,
        idempotente: 'obligatoria',
        respuesta: { status: 202, descripcion: 'Cambio aceptado', esquema: WifiAceptado },
        limitada: true,
        handler: async (ctx, { cuerpo, params }) => {
            const origen = exigirActorIris(ctx)
            if (origen?.actor === 'asistente_ia' && !origen.conversacion) {
                throw new CabeceraIrisRequerida(
                    'X-Iris-Conversacion es obligatoria cuando el asistente de IA pide el cambio',
                )
            }
            const id = Number(params.id)
            const reglas = await exigeCapacidades(ctx)
            const empresaId = await exigirServicioIris(ctx, id, reglas)
            if (reglas) await exigirCapacidad(empresaId, 'wifi')
            return new CambiarWifiServicio().execute(
                {
                    ...cuerpo,
                    servicio_id: id,
                    idempotency_key: ctx.request.header('idempotency-key') ?? null,
                },
                ctx.contextoAccion(),
            )
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
            'con `Retry-After`. `Idempotency-Key` obligatoria (`iris:bienvenida:<orden_id>:<n>`). Con el token de Iris ' +
            '≥ 0.14.3: servicio de otra empresa 404 y sin la marca `bienvenida`, `422 capacidad_no_disponible`.',
        etiqueta: 'servicios',
        permiso: 'servicios.reenviar_bienvenida',
        cuerpo: v.reenviarBienvenidaValidator,
        idempotente: 'obligatoria',
        respuesta: { status: 202, descripcion: 'Bienvenida en cola', esquema: BienvenidaEnCola },
        handler: async (ctx, { cuerpo, params }) => {
            exigirActorIris(ctx)
            const id = Number(params.id)
            const reglas = await exigeCapacidades(ctx)
            const empresaId = await exigirServicioIris(ctx, id, reglas)
            if (reglas) await exigirCapacidad(empresaId, 'bienvenida')
            return new ReenviarBienvenida().execute({ ...cuerpo, servicio_id: id }, ctx.contextoAccion())
        },
    }),
]

export default rutas
