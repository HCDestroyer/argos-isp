/*
|--------------------------------------------------------------------------
| Equipos del cliente y bienvenida (A6): contrato Iris 0.9.0 §12
|--------------------------------------------------------------------------
|
| A32 (aprovisionar), A33 (estado del equipo), A35 (Wi-Fi) y A37 (reenviar la bienvenida), con
| SmartOLT (varias instancias) y el ACS (GenieACS, uno por empresa) (`#integraciones/equipos`), y la
| configuración de cada uno por separado (`/integraciones/smartolt/*`, `/integraciones/acs`).
|
*/
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, type Ruta } from '#shared/rutas'
import {
    definirEsquema,
    pagina,
    enumerado,
    id as idEsquema,
    instante,
    lista,
    nulable,
    objeto,
    texto,
    booleano,
} from '#shared/openapi/esquemas'
import { NoEncontrado, Problema } from '#shared/errores'
import { exigirAccesoEmpresa, exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import { CabeceraIrisRequerida, exigirActorIris } from '#integraciones/iris/atencion'
import * as v from '#integraciones/equipos/validators'
import { estadoEquipo, gestionEquipoServicio } from '#integraciones/equipos/equipos'
import { exigirServicio } from '#core/acceso_empresa'
import AprovisionarServicio from '#integraciones/equipos/actions/aprovisionar_servicio'
import CambiarWifiServicio from '#integraciones/equipos/actions/cambiar_wifi_servicio'
import ConfigurarAcs from '#integraciones/equipos/actions/configurar_acs'
import ProbarAcs from '#integraciones/equipos/actions/probar_acs'
import { vistaAcs } from '#integraciones/equipos/acs'
import CrearInstanciaSmartOlt from '#integraciones/equipos/actions/crear_instancia_smartolt'
import EditarInstanciaSmartOlt from '#integraciones/equipos/actions/editar_instancia_smartolt'
import EliminarInstanciaSmartOlt from '#integraciones/equipos/actions/eliminar_instancia_smartolt'
import ProbarInstanciaSmartOlt from '#integraciones/equipos/actions/probar_instancia_smartolt'
import VincularOltSmartOlt from '#integraciones/equipos/actions/vincular_olt_smartolt'
import { listarInstancias, verInstancia } from '#integraciones/equipos/smartolt_instancias'
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

const ConfigAcs = definirEsquema(
    'ConfigAcs',
    objeto({
        empresa_id: idEsquema,
        activo: booleano,
        operativo: booleano,
        url: nulable(texto),
        usuario: nulable(texto),
        clave: nulable(enumerado(['***'])),
        ca: booleano,
        probado_en: nulable(instante),
        prueba_ok: nulable(booleano),
        prueba_error: nulable(texto),
        prueba_latencia_ms: nulable({ type: 'integer' }),
        probado_por: nulable(texto),
        pppoe_por_acs: booleano,
        version: { type: 'integer' },
    }),
)

const PruebaAcs = definirEsquema(
    'PruebaAcs',
    objeto({
        ok: booleano,
        latencia_ms: nulable({ type: 'integer' }),
        error: nulable(texto),
        config: ConfigAcs,
    }),
)

const OltSmartOlt = definirEsquema(
    'OltSmartOlt',
    objeto({
        id: idEsquema,
        smartolt_olt_id: texto,
        nombre: nulable(texto),
        hardware: nulable(texto),
        ip: nulable(texto),
        presente: booleano,
        origen: enumerado(['sincronizada', 'manual']),
        olt: nulable(objeto({ id: idEsquema, nombre: texto })),
        perfiles: lista(
            objeto({
                plan_id: nulable(idEsquema),
                authorization_preset_id: { type: 'integer' },
                pon_type: enumerado(['gpon', 'epon']),
            }),
        ),
    }),
)

const InstanciaSmartOlt = definirEsquema(
    'InstanciaSmartOlt',
    objeto({
        id: idEsquema,
        empresa_id: nulable(idEsquema),
        compartida: booleano,
        nombre: texto,
        nota: nulable(texto),
        url: texto,
        token: enumerado(['***']),
        activo: booleano,
        operativa: booleano,
        probado_en: nulable(instante),
        prueba_ok: nulable(booleano),
        prueba_error: nulable(texto),
        prueba_latencia_ms: nulable({ type: 'integer' }),
        probado_por: nulable(texto),
        olts_sincronizadas_en: nulable(instante),
        version: { type: 'integer' },
        olts: lista(OltSmartOlt),
    }),
)

const PruebaInstanciaSmartOlt = definirEsquema(
    'PruebaInstanciaSmartOlt',
    objeto({
        ok: booleano,
        latencia_ms: nulable({ type: 'integer' }),
        error: nulable(texto),
        instancia: InstanciaSmartOlt,
        vinculadas_por_nombre: lista(objeto({ id: idEsquema, smartolt_olt_id: texto, olt_id: idEsquema })),
    }),
)

const GestionEquipo = definirEsquema(
    'GestionEquipo',
    objeto({
        servicio_id: idEsquema,
        empresa_id: idEsquema,
        smartolt: objeto({
            disponible: booleano,
            origen: enumerado(['guardada', 'olt', 'unica', 'sin_buscar', 'ninguna']),
            instancia: nulable(
                objeto({
                    id: idEsquema,
                    nombre: texto,
                    url: texto,
                    operativa: booleano,
                    compartida: booleano,
                }),
            ),
            cuentas: lista(objeto({ id: idEsquema, nombre: texto })),
            olt_argos: nulable(objeto({ id: idEsquema, nombre: texto })),
            olt_smartolt: nulable(objeto({ id: idEsquema, smartolt_olt_id: texto, nombre: nulable(texto) })),
            puerto_pon: nulable(texto),
            perfil: nulable(
                objeto({
                    authorization_preset_id: { type: 'integer' },
                    pon_type: enumerado(['gpon', 'epon']),
                }),
            ),
        }),
        acs: objeto({
            configurado: booleano,
            activo: booleano,
            operativo: booleano,
            pppoe_por_acs: booleano,
        }),
        equipo: nulable(
            objeto({
                tipo: enumerado(['ont', 'cpe_wireless', 'router_tr069']),
                serie: nulable(texto),
                mac: nulable(texto),
                modelo: nulable(texto),
                onu_external_id: nulable(texto),
                en_acs: booleano,
            }),
        ),
    }),
)

const rutas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/equipo/gestion',
        operacion: 'serviciosGestionEquipo',
        resumen: 'Qué cuenta y OLT de SmartOLT usa el servicio y qué hace el ACS con él (ficha del servicio)',
        descripcion:
            'Solo lee Argos: no llama a SmartOLT ni al ACS (el estado en vivo es `GET /servicios/:id/equipo`). `origen` dice ' +
            'cómo se elige la cuenta: la guardada, la de la OLT ligada, la única operativa o `sin_buscar` (se busca la ' +
            'serie en `cuentas` al aprovisionar). Para el panel: con el token de Iris, 403.',
        etiqueta: 'servicios',
        permiso: 'servicios.ver_equipo',
        respuesta: { status: 200, descripcion: 'Gestión del equipo', esquema: GestionEquipo },
        handler: async (ctx, { params }) => {
            if (esTokenIris(ctx)) {
                throw new Problema(
                    403,
                    'solo_panel',
                    'Solo para el panel',
                    'Esta lectura es del panel de Argos',
                )
            }
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return gestionEquipoServicio(id)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/integraciones/smartolt/instancias',
        operacion: 'smartoltInstanciasListar',
        resumen: 'Instancias (cuentas, subdominios) de SmartOLT de la empresa activa y las compartidas',
        descripcion:
            'Cada instancia con sus OLT (las de `get_olts`), su vínculo con la OLT de Argos y sus perfiles por plan. El token ' +
            'nunca sale (`***`). `operativa` = encendida y con la última prueba en ok. En una compartida, quien no tiene ' +
            'alcance global solo ve las OLT sin vínculo o ligadas a OLT de Argos suyas o compartidas.',
        etiqueta: 'integraciones',
        permiso: 'smartolt.ver',
        query: v.listarInstanciasSmartOltValidator,
        respuesta: { status: 200, descripcion: 'Página de instancias', esquema: pagina(InstanciaSmartOlt) },
        handler: async (ctx, { query }) => listarInstancias(ctx.contextoAccion(), query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/integraciones/smartolt/instancias/:id',
        operacion: 'smartoltInstanciasVer',
        resumen: 'Una instancia de SmartOLT con sus OLT (sin el token)',
        etiqueta: 'integraciones',
        permiso: 'smartolt.ver',
        respuesta: { status: 200, descripcion: 'Instancia', esquema: InstanciaSmartOlt },
        handler: async (ctx, { params }) => verInstancia(ctx.contextoAccion(), Number(params.id)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/smartolt/instancias',
        operacion: 'smartoltInstanciasCrear',
        resumen: 'Registrar una instancia de SmartOLT (de la empresa activa o compartida)',
        descripcion:
            '`409 subdominio_duplicado` si esa cuenta ya está registrada en la instalación; `409 instancia_duplicada` si ' +
            'el nombre ya existe en la empresa. `compartida: true` solo con alcance global (`403 empresa_no_permitida`). ' +
            'Nace sin probar. Emite `equipos.config_cambiada`.',
        etiqueta: 'integraciones',
        permiso: 'smartolt.crear_instancia',
        cuerpo: v.crearInstanciaSmartOltValidator,
        respuesta: { status: 201, descripcion: 'Instancia registrada', esquema: InstanciaSmartOlt },
        handler: async (ctx, { cuerpo }) =>
            new CrearInstanciaSmartOlt().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/integraciones/smartolt/instancias/:id',
        operacion: 'smartoltInstanciasEditar',
        resumen: 'Editar una instancia de SmartOLT (nombre, URL, token, encendido, nota y perfiles)',
        descripcion:
            'Token omitido = se conserva. Cambiar URL o token borra la última prueba. `perfiles` reemplaza los perfiles de ' +
            'las OLT de esta instancia. Una compartida solo con alcance global. `version` desactualizada: 409.',
        etiqueta: 'integraciones',
        permiso: 'smartolt.editar_instancia',
        cuerpo: v.editarInstanciaSmartOltValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Instancia guardada', esquema: InstanciaSmartOlt },
        handler: async (ctx, { cuerpo, params }) =>
            new EditarInstanciaSmartOlt().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'delete',
        ruta: '/integraciones/smartolt/instancias/:id',
        operacion: 'smartoltInstanciasEliminar',
        resumen: 'Eliminar una instancia de SmartOLT sin uso (`409 instancia_en_uso`)',
        etiqueta: 'integraciones',
        permiso: 'smartolt.eliminar_instancia',
        respuesta: { status: 204, descripcion: 'Instancia eliminada' },
        handler: async (ctx, { params }) => {
            await new EliminarInstanciaSmartOlt().execute({ id: Number(params.id) }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/smartolt/instancias/:id/probar',
        operacion: 'smartoltInstanciasProbar',
        resumen: 'Probar una instancia de SmartOLT y sincronizar sus OLT (una sola llamada a `get_olts`)',
        descripcion:
            'Con lo guardado. No llama a otras instancias. Guarda la prueba y, si responde, la lista de OLT; las nuevas ' +
            'con el mismo nombre que una sola OLT de Argos libre se vinculan solas (`vinculadas_por_nombre`). No falla si ' +
            'SmartOLT no responde: devuelve su error.',
        etiqueta: 'integraciones',
        permiso: 'smartolt.probar_instancia',
        respuesta: { status: 200, descripcion: 'Resultado de la prueba', esquema: PruebaInstanciaSmartOlt },
        handler: async (ctx, { params }) =>
            new ProbarInstanciaSmartOlt().execute({ id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/smartolt/olts/:id/vincular',
        operacion: 'smartoltOltsVincular',
        resumen: 'Ligar una OLT de SmartOLT con la OLT de la red de acceso de Argos (null la desliga)',
        descripcion:
            '`409 olt_ya_vinculada` si esa OLT de Argos ya está ligada a otra; `422 olt_de_otra_empresa` si es de otra ' +
            'empresa que la instancia. De este vínculo sale la instancia de un servicio (por su servidor PPPoE → VLAN → ' +
            'puerto PON → OLT).',
        etiqueta: 'integraciones',
        permiso: 'smartolt.vincular_olt',
        cuerpo: v.vincularOltSmartOltValidator,
        respuesta: { status: 200, descripcion: 'OLT ligada', esquema: OltSmartOlt },
        handler: async (ctx, { cuerpo, params }) =>
            new VincularOltSmartOlt().execute(
                { id: Number(params.id), olt_id: cuerpo.olt_id },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/integraciones/acs',
        operacion: 'acsVer',
        resumen: 'ACS (GenieACS) de la empresa activa, sin la clave',
        descripcion:
            'Un ACS por empresa, independiente de SmartOLT. `clave` como `***` (o null). `operativo` = encendido, con URL y ' +
            'la última prueba en ok: de ahí sale `tr069` de `capacidades.aprovisionamiento`. `version` 0 = nunca guardado.',
        etiqueta: 'integraciones',
        permiso: 'acs.ver',
        respuesta: { status: 200, descripcion: 'ACS', esquema: ConfigAcs },
        handler: async (ctx) => vistaAcs(exigirEmpresaActivaDelContexto(ctx.contextoAccion())),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/integraciones/acs',
        operacion: 'acsConfigurar',
        resumen: 'Guardar el ACS (GenieACS) de la empresa activa',
        descripcion:
            'Clave: omitida = se conserva, null = se borra, texto = se reemplaza; se guarda cifrada y nunca vuelve. Cambiar ' +
            'URL, usuario, clave o certificado borra la última prueba. `activo: true` exige URL (422). `version` 0 la ' +
            'primera vez; desactualizada: 409. Emite `equipos.config_cambiada`.',
        etiqueta: 'integraciones',
        permiso: 'acs.configurar',
        cuerpo: v.configurarAcsValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'ACS guardado', esquema: ConfigAcs },
        handler: async (ctx, { cuerpo }) => new ConfigurarAcs().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/acs/probar',
        operacion: 'acsProbar',
        resumen: 'Probar la conexión con el ACS de la empresa activa (configuración guardada)',
        descripcion:
            'Una búsqueda de un dispositivo en el NBI con la autenticación guardada. No llama a SmartOLT. Guarda el ' +
            'resultado y no falla si el ACS no responde: devuelve su error.',
        etiqueta: 'integraciones',
        permiso: 'acs.probar',
        respuesta: { status: 200, descripcion: 'Resultado de la prueba', esquema: PruebaAcs },
        handler: async (ctx) => new ProbarAcs().execute({}, ctx.contextoAccion()),
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
