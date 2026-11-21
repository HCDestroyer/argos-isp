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
import { definirEsquema, nulable, objeto, pagina, texto, instante } from '#shared/openapi/esquemas'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import { exigirServicio } from '#core/acceso_empresa'
import { esTokenIris, exigirActorIris } from '#integraciones/iris/atencion'
import * as vi from '#core/validators_instalacion'
import ReservarIpServicio from '#core/actions/reservar_ip_servicio'
import CambiarPlanPendiente from '#core/actions/cambiar_plan_pendiente'
import CompletarDatosServicio from '#core/actions/completar_datos_servicio'
import { listarCambiosTitularIris } from '#core/consultas/titulares_iris'
import { empresasDeLaLista } from '#shared/empresa_activa'
import CambiarTitularServicio, { EvidenciaRequerida } from '#core/actions/cambiar_titular_servicio'
import { Servicio } from '#core/esquemas'
import RegistrarIdentidadCliente from '#core/actions/registrar_identidad_cliente'
import VerIdentidadCliente from '#core/actions/ver_identidad_cliente'
import { leerFoto } from '#core/identidad'
import { exigirCliente } from '#core/acceso_empresa'
import { Prohibido, ValidacionFallida } from '#shared/errores'
import { booleano, entero, enumerado, id as idEsquema, lista } from '#shared/openapi/esquemas'

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

const IdentidadRegistrada = definirEsquema(
    'IdentidadRegistrada',
    objeto({ identidad_id: idEsquema, version: entero }),
)

const IdentidadCliente = definirEsquema(
    'IdentidadCliente',
    objeto({
        identidad_id: idEsquema,
        version: entero,
        vigente: booleano,
        documento_tipo: enumerado(['dpi', 'pasaporte']),
        documento_numero: texto,
        nombre: { ...texto, description: 'Como aparece en el documento' },
        metodo: enumerado(['foto_documento', 'revision_panel']),
        confirmada: {
            ...booleano,
            description:
                'false: cliente con historial sin documento; no vale para verificar hasta que el titular la confirme',
        },
        verificado_en: instante,
        tiene_reverso: booleano,
        origen_tipo: nulable(texto),
        origen_id: nulable(texto),
        created_at: instante,
    }),
)

/** Una sola foto por parte (`frente`, `reverso`). */
export function archivoUnico(ctx: HttpContext, campo: string): MultipartFile | null {
    const archivos = ctx.request.files(campo)
    if (archivos.length > 1) {
        throw new ValidacionFallida([{ field: campo, rule: 'unico', message: 'Una sola foto por parte' }])
    }
    return archivos[0] ?? null
}

/** El token de Iris nunca lee la identidad (§3.4.3: Iris no la puede leer de vuelta). */
function exigirNoIris(ctx: HttpContext) {
    if (esTokenIris(ctx)) throw new Prohibido('Iris no lee la identidad del titular')
}

const TitularCambiado = definirEsquema(
    'TitularCambiado',
    objeto({
        servicio_id: idEsquema,
        titular: objeto({
            cliente_id: idEsquema,
            existente: { ...booleano, description: 'El titular ya era cliente (documento y nombre iguales)' },
        }),
        posible_duplicado: {
            ...booleano,
            description:
                'Otro cliente con el mismo nombre o teléfono y otro documento: lo revisa una persona de Argos',
        },
        identidad_id: idEsquema,
        de_cliente_id: idEsquema,
        de_cliente_eliminado: booleano,
    }),
)

const CambioTitularIris = definirEsquema(
    'CambioTitularIris',
    objeto({
        id: idEsquema,
        servicio_id: idEsquema,
        empresa_id: idEsquema,
        de_cliente_id: idEsquema,
        a_cliente_id: idEsquema,
        existente: booleano,
        posible_duplicado: booleano,
        de_cliente_eliminado: booleano,
        motivo_codigo: enumerado(['menor_de_edad', 'otro']),
        origen_tipo: nulable(texto),
        origen_id: nulable(texto),
        ocurrido_en: instante,
    }),
)

const instalacion: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/titulares-iris',
        operacion: 'reportesTitularesIris',
        resumen:
            'Cambios de titular que llegaron por Iris (para revisar los asignados a un cliente existente)',
        descripcion:
            'Contrato Iris 0.10.0 (ajuste aj, decisión 9 del PM): `existente=true` lista los servicios que Iris asignó al ' +
            'momento a un cliente que ya existía, para que caja o supervisión los revise. Filtrado por las empresas de la petición.',
        etiqueta: 'servicios',
        permiso: 'servicios.ver',
        query: vi.listarCambiosTitularValidator,
        respuesta: { status: 200, descripcion: 'Cambios de titular', esquema: pagina(CambioTitularIris) },
        handler: (ctx, { query }) => listarCambiosTitularIris(query, empresasDeLaLista(ctx.empresa)),
    }),
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
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/cambiar-plan',
        operacion: 'serviciosCambiarPlanPendiente',
        resumen: 'Cambiar el plan de un servicio pendiente de instalación (contrato Iris 0.10.0 §3.4.5)',
        descripcion:
            'Solo en `pendiente_instalacion` (`422 servicio_no_pendiente`), a un plan de `GET /planes?router_id=&modo=` ' +
            '(activo, del mismo modo y asignado a todos los routers o al del servicio; si no, `422 plan_no_permitido`). ' +
            'Sin factura ni prorrateo. `version` opcional (`409 conflicto_version`). Emite `servicio.config_cambiada` con ' +
            '`plan` y `precio` y la orden en `origen_tipo`/`origen_id`. Iris: `Idempotency-Key = iris:plan:<orden_id>:<cambio_id>`, ' +
            '`X-Iris-Actor` y solo servicios de Iris.',
        etiqueta: 'servicios',
        permiso: 'servicios.cambiar_plan_pendiente',
        cuerpo: vi.cambiarPlanPendienteValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Servicio con el plan nuevo', esquema: Servicio },
        handler: async (ctx, { cuerpo, params }) => {
            const iris = desdeIris(ctx)
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new CambiarPlanPendiente().execute(
                { ...cuerpo, id, desdeIris: iris },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/completar-datos',
        operacion: 'serviciosCompletarDatos',
        resumen: 'Completar los datos del titular y del lugar antes de activar (contrato Iris 0.10.0 §3.4.6)',
        descripcion:
            'Solo en `pendiente_instalacion` (`422 servicio_no_pendiente`) y para el cliente de ese servicio. Del cliente solo ' +
            'llena vacíos (`422 campo_ya_registrado`); el `nombre` se corrige solo con `identidad_id` de su identidad vigente. ' +
            'Cliente con historial: sin `telefono`, `movil`, `email`, `nombre`, `tipo_documento_fiscal` ni `nit_cui` ' +
            '(`422 cliente_con_historial`). Del servicio corrige dirección, referencia, coordenadas y `precision_m`. Teléfono y ' +
            'correo agregados no cuentan como registrados hasta que el titular los confirme. Emite `cliente.actualizado` y ' +
            '`servicio.datos_cambiados`. Iris: `Idempotency-Key = iris:datos:<orden_id>:<n>` y `X-Iris-Actor`.',
        etiqueta: 'servicios',
        permiso: 'servicios.completar_datos',
        cuerpo: vi.completarDatosValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Servicio', esquema: Servicio },
        handler: async (ctx, { cuerpo, params }) => {
            const iris = desdeIris(ctx)
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new CompletarDatosServicio().execute(
                { ...cuerpo, id, desdeIris: iris },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/cambiar-titular',
        operacion: 'serviciosCambiarTitular',
        resumen: 'Cambiar el titular de un servicio pendiente (contrato Iris 0.10.0 §3.4.4)',
        descripcion:
            '`multipart/form-data`: la parte `datos` (JSON) y las fotos `frente` y `reverso?` de A41. Quién es el titular lo ' +
            'decide Argos (nunca se manda `cliente_id`): mismo documento y nombre normalizado en la empresa del servicio → ese ' +
            'cliente (`existente: true`, aviso informativo); mismo documento y otro nombre → `422 titular_no_coincide`; si no, ' +
            'un cliente nuevo. Solo en pendiente (`422 servicio_no_pendiente`); sin `frente` o sin `coincide`, ' +
            '`422 evidencia_requerida`; 2 cambios por servicio y 10 por empresa y actor al día (`429 demasiados_cambios_titular` ' +
            'con `Retry-After`). El cliente anterior sin servicios ni movimientos se elimina. Emite `servicio.titular_cambiado` y ' +
            '`cliente.identidad_registrada`. Iris: `Idempotency-Key = iris:titular:<orden_id>:<cambio_id>` y `X-Iris-Actor`.',
        etiqueta: 'servicios',
        permiso: 'servicios.cambiar_titular',
        cuerpo: vi.cambiarTitularPartesValidator,
        multipart: {
            archivos: {
                frente: 'Foto del frente del documento del titular (JPEG o PNG, hasta 5 MB)',
                reverso: 'Foto del reverso (opcional)',
            },
            archivosOpcionales: ['frente', 'reverso'],
        },
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Titular cambiado', esquema: TitularCambiado },
        handler: async (ctx, { cuerpo, params }) => {
            const iris = desdeIris(ctx)
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            let json: unknown
            try {
                json = JSON.parse(cuerpo.datos)
            } catch {
                throw new ValidacionFallida([
                    { field: 'datos', rule: 'json', message: 'datos debe ser un JSON' },
                ])
            }
            const datos = await vi.cambiarTitularDatosValidator.validate(json)
            const frente = await leerFoto(archivoUnico(ctx, 'frente'), 'frente')
            if (!frente) throw new EvidenciaRequerida()
            const reverso = await leerFoto(archivoUnico(ctx, 'reverso'), 'reverso')
            return new CambiarTitularServicio().execute(
                { ...datos, id, frente, reverso, desdeIris: iris },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/clientes/:id/identidad',
        operacion: 'clientesRegistrarIdentidad',
        resumen: 'Registrar la identidad del titular (contrato Iris 0.10.0 §3.4.3)',
        descripcion:
            '`multipart/form-data`: `frente` (obligatoria) y `reverso` (opcional), JPEG o PNG hasta 5 MB (`413 tamano_excedido`, ' +
            '`422 mime_no_permitido`), y los campos de texto. `mayor_de_edad` y `coincide` deben ser true. Se guarda cifrada en ' +
            'reposo como versión nueva (solo quedan la vigente y la anterior). Desde Iris: `X-Iris-Actor`, nunca el asistente, ' +
            'solo para el cliente de un servicio pendiente de Iris (`422 cliente_sin_instalacion`, `403 servicio_no_de_iris`), ' +
            '`Idempotency-Key = iris:identidad:<orden_id>:<toma>`. Cliente con historial: documento y nombre deben coincidir ' +
            '(`422 titular_no_coincide`). Nunca escribe `nit_cui`. Emite `cliente.identidad_registrada` sin número ni foto. ' +
            'El `detail` y los `errors[]` nunca repiten el valor recibido.',
        etiqueta: 'clientes',
        permiso: 'clientes.registrar_identidad',
        cuerpo: vi.registrarIdentidadValidator,
        multipart: {
            archivos: {
                frente: 'Foto del frente del documento (JPEG o PNG, hasta 5 MB)',
                reverso: 'Foto del reverso (opcional)',
            },
            archivosOpcionales: ['reverso'],
        },
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Identidad registrada', esquema: IdentidadRegistrada },
        handler: async (ctx, { cuerpo, params }) => {
            const iris = desdeIris(ctx)
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            const frente = await leerFoto(archivoUnico(ctx, 'frente'), 'frente')
            if (!frente) {
                throw new ValidacionFallida([
                    { field: 'frente', rule: 'required', message: 'La foto del frente es obligatoria' },
                ])
            }
            const reverso = await leerFoto(archivoUnico(ctx, 'reverso'), 'reverso')
            return new RegistrarIdentidadCliente().execute(
                { ...cuerpo, cliente_id: id, frente, reverso, desdeIris: iris },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/clientes/:id/identidad',
        operacion: 'clientesVerIdentidad',
        resumen: 'Ver la identidad del titular: vigente y anterior (cada vista queda auditada)',
        descripcion: 'Solo con `clientes.ver_identidad`; nunca con el token de Iris (403).',
        etiqueta: 'clientes',
        permiso: 'clientes.ver_identidad',
        respuesta: {
            status: 200,
            descripcion: 'Identidades',
            esquema: objeto({ data: lista(IdentidadCliente) }),
        },
        handler: async (ctx, { params }) => {
            exigirNoIris(ctx)
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            const salida = await new VerIdentidadCliente().execute({ cliente_id: id }, ctx.contextoAccion())
            return { data: salida.tipo === 'datos' ? salida.identidades : [] }
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/clientes/:id/identidad/:identidadId/:parte',
        operacion: 'clientesVerFotoIdentidad',
        resumen: 'Ver una foto del documento del titular (cada vista queda auditada)',
        descripcion:
            '`parte` = `frente` o `reverso`. Solo con `clientes.ver_identidad`; nunca con el token de Iris (403).',
        etiqueta: 'clientes',
        permiso: 'clientes.ver_identidad',
        parametros: { parte: enumerado(['frente', 'reverso']) },
        respuesta: { status: 200, descripcion: 'Foto (JPEG o PNG)', contenido: 'image/*' },
        handler: async (ctx, { params }) => {
            exigirNoIris(ctx)
            const id = Number(params.id)
            const parte = String(params.parte)
            if (parte !== 'frente' && parte !== 'reverso') {
                throw new ValidacionFallida([{ field: 'parte', rule: 'enum', message: 'frente o reverso' }])
            }
            await exigirCliente(ctx, id)
            const salida = await new VerIdentidadCliente().execute(
                { cliente_id: id, identidad_id: Number(params.identidadId), parte },
                ctx.contextoAccion(),
            )
            if (salida.tipo !== 'foto') throw new ValidacionFallida([])
            ctx.response.header('Content-Type', salida.mime)
            ctx.response.header('Cache-Control', 'private, no-store')
            ctx.response.header('X-Content-Type-Options', 'nosniff')
            return salida.contenido
        },
    }),
]

export default instalacion
