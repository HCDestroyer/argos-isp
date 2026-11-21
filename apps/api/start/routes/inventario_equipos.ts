/*
|--------------------------------------------------------------------------
| Equipos del cliente (A3, contrato Iris 0.12.0 §3.10, A48)
|--------------------------------------------------------------------------
|
| Cambio de equipo en una sola transacción, intentos de recuperación («no se pudo recuperar»), declarar
| un equipo no recuperado y la cola de cobros de equipo, contactos de recuperación y garantías. Los
| handlers validan, revisan el acceso y llaman a la acción. Se montan desde `inventario.ts`.
|
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirAcceso } from '#billing/empresa'
import { exigirServicio } from '#core/acceso_empresa'
import * as v from '#inventario/validators'
import {
    CambioEquipo,
    CobroEquipo,
    ContactoRecuperacion,
    IntentoRecuperacion,
    PendienteNoRecuperado,
    Unidad,
    UnidadNoRecuperada,
} from '#inventario/esquemas'
import { empresaDeUnidad } from '#inventario/unidades'
import { exigirActorIrisDeCampo, exigirBodega } from '#inventario/acceso_http'
import { listarCobrosEquipo, pendientesDeDeclarar } from '#inventario/cobros_equipo'
import CambiarEquipo from '#inventario/actions/cambiar_equipo'
import RegistrarIntentoRecuperacion from '#inventario/actions/registrar_intento_recuperacion'
import DeclararNoRecuperada from '#inventario/actions/declarar_no_recuperada'
import RegistrarContactoRecuperacion from '#inventario/actions/registrar_contacto_recuperacion'
import { AprobarCobroEquipo, RechazarCobroEquipo } from '#inventario/actions/decidir_cobro_equipo'
import { EnviarGarantia, ResolverGarantia } from '#inventario/actions/garantia_unidad'
import db from '@adonisjs/lucid/services/db'
import { NoEncontrado } from '#shared/errores'

type Ctx = Parameters<typeof exigirBodega>[0]

/** La unidad es de una empresa del usuario y su bodega (si está en una) la puede operar. */
async function exigirUnidad(ctx: Ctx, unidadId: number) {
    const unidad = await empresaDeUnidad(unidadId)
    exigirAcceso(ctx, { empresa_id: unidad.empresa_id })
    if (unidad.bodega_id !== null) await exigirBodega(ctx, unidad.bodega_id)
}

const DESCRIPCION_IRIS =
    ' Con el token de Iris: X-Iris-Actor usuario:<id> obligatoria (400 cabecera_iris_requerida; asistente_ia 403 actor_ia_no_permitido); el servicio debe estar en las empresas del token (403 empresa_no_permitida); fecha (hora del teléfono) con recibido_en_iris dentro de la ventana de 72 h (422 rule ventana). Un conflicto (409) no se reintenta: se concilia leyendo GET /servicios/:id/equipos.'

const rutas: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/equipos/cambiar',
        operacion: 'serviciosCambiarEquipo',
        resumen:
            'Cambiar el equipo en comodato de un servicio: sale uno y entra otro en una sola transacción',
        etiqueta: 'inventario',
        permiso: 'servicios.cambiar_equipo',
        cuerpo: v.cambiarEquipoValidator,
        idempotente: true,
        descripcion:
            'Contrato Iris 0.12.0 §3.10 (A48), Idempotency-Key iris:cambio:<orden_id>:<sale_unidad_id>. La que sale (en comodato en el servicio: 409 unidad_no_es_del_servicio, o estado_unidad_cambiado si ya no lo está) se devuelve a la bodega de la que entra (baja del activo sin resultado) y queda disponible (funciona), en revisión (revision, danado) o en garantía (garantia); nunca se da de baja aquí. La que entra (unidad_id, serie o mac) sale de la bodega personal del técnico o de una cuadrilla de la que es miembro (403 no_es_miembro, 409 unidad_en_otra_bodega, antes de mirar su estado) y debe estar disponible (409 estado_unidad_cambiado). funciona con motivo danado o garantia: 422. cobro_propuesto (sin monto) entra en la cola de cobros de equipo. Emite inventario.comodato_devuelto, inventario.comodato_asignado, inventario.equipo_cambiado e inventario.unidad_estado_cambiado.' +
            DESCRIPCION_IRIS,
        respuesta: { status: 200, descripcion: 'Cambio hecho', esquema: CambioEquipo },
        handler: async (ctx, { cuerpo, params }) => {
            const actor = exigirActorIrisDeCampo(ctx)
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new CambiarEquipo().execute(
                { ...cuerpo, servicio_id: id, iris_actor: actor },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/equipos/:unidadId/no-recuperado',
        operacion: 'serviciosEquipoNoRecuperado',
        resumen:
            'No se pudo recuperar el equipo: registra un intento de recuperación (nunca declara la pérdida)',
        etiqueta: 'inventario',
        permiso: 'servicios.cambiar_equipo',
        cuerpo: v.noRecuperadoValidator,
        idempotente: true,
        limitada: true,
        descripcion:
            'Contrato Iris 0.12.0 §3.10 (A48), Idempotency-Key iris:no_recuperado:<orden_id>:<unidad_id>. intento_n lo calcula Argos; la unidad queda por recuperar (sin asiento). foto_ref (id opaco del adjunto de la orden) obligatoria con se_nego y equipo_perdido; ubicacion siempre (422). Uno por unidad al día: 429 demasiados_intentos. 409 unidad_no_es_del_servicio o estado_unidad_cambiado. Declarar la unidad no recuperada y cobrarla lo decide una persona (POST /inventario/unidades/:id/declarar-no-recuperada). Emite inventario.recuperacion_intentada (aviso al titular con la serie enmascarada).' +
            DESCRIPCION_IRIS,
        respuesta: { status: 201, descripcion: 'Intento registrado', esquema: IntentoRecuperacion },
        handler: async (ctx, { cuerpo, params }) => {
            const actor = exigirActorIrisDeCampo(ctx)
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new RegistrarIntentoRecuperacion().execute(
                { ...cuerpo, servicio_id: id, unidad_id: Number(params.unidadId), iris_actor: actor },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/unidades/:id/declarar-no-recuperada',
        operacion: 'inventarioDeclararNoRecuperada',
        resumen: 'Declarar un equipo no recuperado (y cobrar «Equipo no devuelto»)',
        etiqueta: 'inventario',
        permiso: 'inventario.cobrar_equipo',
        cuerpo: v.declararNoRecuperadaValidator,
        idempotente: true,
        descripcion:
            'A48 (§10.7 a): lo decide una persona, nunca el técnico. Exige intentos de técnicos distintos (inventario.configuracion.recuperacion_tecnicos_minimos, 2 de fábrica) o un contacto con el cliente registrado: si no, 422 intentos_insuficientes. Baja del activo a pérdida (1.2.02 + 5.3.06 / 1.2.01, sin kardex) y la unidad queda no_recuperada. Con monto: cargo único «Equipo no devuelto» al cliente del servicio (CxC / ingreso + IVA) y el cobro aprobado en la cola. 409 estado_unidad_cambiado si no está en comodato o por recuperar.',
        respuesta: { status: 200, descripcion: 'Unidad no recuperada', esquema: UnidadNoRecuperada },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirUnidad(ctx, id)
            return new DeclararNoRecuperada().execute({ ...cuerpo, unidad_id: id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/unidades/:id/contactos-recuperacion',
        operacion: 'inventarioContactoRecuperacion',
        resumen: 'Registrar un contacto con el cliente para recuperar el equipo',
        etiqueta: 'inventario',
        permiso: 'inventario.registrar_contacto_recuperacion',
        cuerpo: v.contactoRecuperacionValidator,
        idempotente: true,
        descripcion:
            'A48: cuenta como alternativa al mínimo de técnicos distintos para declarar el equipo no recuperado. Solo una unidad en comodato o por recuperar (409 estado_unidad_cambiado).',
        respuesta: { status: 201, descripcion: 'Contacto registrado', esquema: ContactoRecuperacion },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirUnidad(ctx, id)
            return new RegistrarContactoRecuperacion().execute(
                { ...cuerpo, unidad_id: id },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/unidades/:id/enviar-garantia',
        operacion: 'inventarioEnviarGarantia',
        resumen: 'Enviar a garantía una unidad en revisión (proveedor, RMA y vencimiento)',
        etiqueta: 'inventario',
        permiso: 'inventario.enviar_garantia',
        cuerpo: v.enviarGarantiaValidator,
        idempotente: true,
        descripcion:
            'A48: de revision (o la garantía abierta sin enviar de un cambio de equipo) a garantia. Sigue en su bodega y en 1.1.14: sin kardex ni asiento. 409 estado_unidad_cambiado en otro estado. Proveedor: proveedor_id (de la empresa) o proveedor_nombre (422).',
        respuesta: { status: 200, descripcion: 'Unidad en garantía', esquema: Unidad },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirUnidad(ctx, id)
            return new EnviarGarantia().execute({ ...cuerpo, unidad_id: id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/unidades/:id/resolver-garantia',
        operacion: 'inventarioResolverGarantia',
        resumen: 'Resolver la garantía: volvió reparada, reemplazada o rechazada',
        etiqueta: 'inventario',
        permiso: 'inventario.resolver_garantia',
        cuerpo: v.resolverGarantiaValidator,
        idempotente: true,
        descripcion:
            'A48: reparada → disponible (usada); reemplazada → la unidad toma la serie o MAC del equipo nuevo (422 serie_duplicada), disponible y nueva, al mismo costo (la anterior queda en la garantía); rechazada → vuelve a revision (repararla o darla de baja con POST /inventario/bajas). Sin kardex ni asiento. 409 estado_unidad_cambiado si no está en garantía.',
        respuesta: { status: 200, descripcion: 'Unidad', esquema: Unidad },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirUnidad(ctx, id)
            return new ResolverGarantia().execute({ ...cuerpo, unidad_id: id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/inventario/cobros-equipo',
        operacion: 'inventarioCobrosEquipo',
        resumen: 'Cola de cobros de equipo («Equipo no devuelto» y cobros propuestos desde un cambio)',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        query: v.listarCobrosEquipoValidator,
        respuesta: { status: 200, descripcion: 'Página de cobros', esquema: pagina(CobroEquipo) },
        handler: (ctx, { query }) =>
            listarCobrosEquipo(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/inventario/cobros-equipo/pendientes-declarar',
        operacion: 'inventarioPendientesNoRecuperados',
        resumen: 'Equipos por recuperar con intentos, que esperan que una persona los declare no recuperados',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        query: v.listarCobrosEquipoValidator,
        descripcion:
            'Con el número de intentos, de técnicos distintos y de contactos (la pantalla muestra cada intento con su actor, foto y ubicación en GET /inventario/unidades/:id).',
        respuesta: { status: 200, descripcion: 'Pendientes', esquema: lista(PendienteNoRecuperado) },
        handler: (ctx, { query }) => pendientesDeDeclarar(empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/cobros-equipo/:id/aprobar',
        operacion: 'inventarioAprobarCobroEquipo',
        resumen: 'Aprobar un cobro de equipo propuesto, con su monto (cargo único al cliente)',
        etiqueta: 'inventario',
        permiso: 'inventario.cobrar_equipo',
        cuerpo: v.aprobarCobroEquipoValidator,
        idempotente: true,
        versionada: true,
        descripcion:
            'Cargo único al cliente del servicio con el concepto indicado o «Equipo no devuelto» de la empresa (CxC / ingreso + IVA). 409 cobro_decidido si ya se decidió; 409 si cambió la version.',
        respuesta: { status: 200, descripcion: 'Cobro aprobado', esquema: CobroEquipo },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirCobro(ctx, id)
            return new AprobarCobroEquipo().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/cobros-equipo/:id/rechazar',
        operacion: 'inventarioRechazarCobroEquipo',
        resumen: 'Rechazar un cobro de equipo propuesto, con motivo',
        etiqueta: 'inventario',
        permiso: 'inventario.cobrar_equipo',
        cuerpo: v.rechazarCobroEquipoValidator,
        idempotente: true,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Cobro rechazado', esquema: CobroEquipo },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirCobro(ctx, id)
            return new RechazarCobroEquipo().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
]

async function exigirCobro(ctx: Ctx, id: number) {
    const fila = await db.from('inventario.cobros_equipo').where('id', id).select('empresa_id').first()
    if (!fila) throw new NoEncontrado(`El cobro de equipo ${id} no existe`)
    exigirAcceso(ctx, { empresa_id: Number(fila.empresa_id) })
}

export default rutas
