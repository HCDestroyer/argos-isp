/*
|--------------------------------------------------------------------------
| Rutas de plantillas de recordatorio (A6, R1 del plan v3)
|--------------------------------------------------------------------------
|
| `contratos/recordatorios.md` §8. Solo validan, revisan empresa y alcance, y llaman acciones. Las
| monta `start/routes/notify.ts`. La vista previa y los próximos envíos son de R2.
|
*/
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista } from '#shared/openapi/esquemas'
import { EmpresaNoPermitida, empresasDeLaLista } from '#shared/empresa_activa'
import { exigirServicio } from '#core/acceso_empresa'
import {
    AsignacionRecordatorio,
    AsignacionRecordatorioMasiva,
    PlantillaRecordatorio,
    RecordatoriosDestino,
} from '#notify/esquemas'
import {
    empresaDeSuscripcion,
    listarPlantillasRecordatorio,
    obtenerPlantillaRecordatorio,
    recordatoriosDe,
} from '#notify/plantillas_recordatorio'
import CrearPlantillaRecordatorio from '#notify/actions/crear_plantilla_recordatorio'
import EditarPlantillaRecordatorio from '#notify/actions/editar_plantilla_recordatorio'
import RetirarPlantillaRecordatorio from '#notify/actions/retirar_plantilla_recordatorio'
import FijarPlantillaRecordatorioPorDefecto from '#notify/actions/fijar_plantilla_recordatorio_por_defecto'
import AsignarPlantillaRecordatorio from '#notify/actions/asignar_plantilla_recordatorio'
import AsignarPlantillaRecordatorioMasivo from '#notify/actions/asignar_plantilla_recordatorio_masivo'
import PersonalizarRecordatoriosServicio from '#notify/actions/personalizar_recordatorios_servicio'
import QuitarRecordatoriosPersonalizados from '#notify/actions/quitar_recordatorios_personalizados'
import * as v from '#notify/validators'

/** 403 `empresa_no_permitida` si la empresa queda fuera del alcance de la petición. */
function exigirEmpresa(ctx: HttpContext, empresaId: number) {
    const permitidas = ctx.empresa?.permitidas
    if (permitidas && !permitidas.includes(empresaId)) throw new EmpresaNoPermitida(empresaId)
}

const DESCRIPCION_PLANTILLA =
    'Plantilla con nombre de una empresa y sus pasos (hasta 8). Rige para un servicio así: la ' +
    'personalizada del servicio, si tiene; si no, la asignada al servicio o a la suscripción; si no, ' +
    'la por defecto de la empresa. Cada empresa nace con «Estándar» (los tres recordatorios de siempre).'

const recordatorios: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/plantillas-recordatorio',
        operacion: 'plantillasRecordatorioListar',
        resumen: 'Listar plantillas de recordatorio de la empresa activa (sin las personalizadas)',
        descripcion:
            DESCRIPCION_PLANTILLA + ' La por defecto primero; las retiradas solo con `incluir_retiradas`.',
        etiqueta: 'notificaciones',
        permiso: 'recordatorios.ver',
        query: v.listarPlantillasRecordatorioValidator,
        respuesta: { status: 200, descripcion: 'Plantillas', esquema: lista(PlantillaRecordatorio) },
        handler: (ctx, { query }) =>
            listarPlantillasRecordatorio(empresasDeLaLista(ctx.empresa, query.empresas), {
                incluir_retiradas: query.incluir_retiradas,
            }),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/plantillas-recordatorio',
        operacion: 'plantillasRecordatorioCrear',
        resumen: 'Crear una plantilla de recordatorio con sus pasos',
        descripcion:
            DESCRIPCION_PLANTILLA +
            ' 409 `plantilla_duplicada` (nombre en la empresa); 422 si los pasos no son válidos (más de 8, ' +
            '`orden` repetido, días fuera de rango). `por_defecto: true` desplaza a la anterior.',
        etiqueta: 'notificaciones',
        permiso: 'recordatorios.crear',
        cuerpo: v.crearPlantillaRecordatorioValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Plantilla creada', esquema: PlantillaRecordatorio },
        handler: (ctx, { cuerpo }) => new CrearPlantillaRecordatorio().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/plantillas-recordatorio/:id',
        operacion: 'plantillasRecordatorioVer',
        resumen: 'Ver una plantilla de recordatorio con sus pasos',
        etiqueta: 'notificaciones',
        permiso: 'recordatorios.ver',
        respuesta: { status: 200, descripcion: 'Plantilla', esquema: PlantillaRecordatorio },
        handler: async (ctx, { params }) => {
            const plantilla = await obtenerPlantillaRecordatorio(Number(params.id))
            exigirEmpresa(ctx, plantilla.empresa_id)
            return plantilla
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/plantillas-recordatorio/:id',
        operacion: 'plantillasRecordatorioEditar',
        resumen: 'Editar nombre, descripción y pasos de una plantilla de recordatorio',
        descripcion:
            '`pasos` es el conjunto completo (los que no vengan se borran). No reenvía lo ya enviado. ' +
            '409 por `version`, `plantilla_duplicada` o `plantilla_personalizada` (se edita desde el servicio).',
        etiqueta: 'notificaciones',
        permiso: 'recordatorios.editar',
        cuerpo: v.editarPlantillaRecordatorioValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Plantilla actualizada', esquema: PlantillaRecordatorio },
        handler: (ctx, { cuerpo, params }) =>
            new EditarPlantillaRecordatorio().execute(
                { ...cuerpo, id: Number(params.id) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/plantillas-recordatorio/:id/retirar',
        operacion: 'plantillasRecordatorioRetirar',
        resumen: 'Retirar una plantilla de recordatorio (con motivo)',
        descripcion:
            'Quien ya la tiene la conserva; no se asigna más (409 `plantilla_retirada` al asignar). ' +
            '409 `plantilla_por_defecto` (fija otra antes), `plantilla_retirada`, `plantilla_personalizada` o por `version`.',
        etiqueta: 'notificaciones',
        permiso: 'recordatorios.retirar',
        cuerpo: v.retirarPlantillaRecordatorioValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Plantilla retirada', esquema: PlantillaRecordatorio },
        handler: (ctx, { cuerpo, params }) =>
            new RetirarPlantillaRecordatorio().execute(
                { ...cuerpo, id: Number(params.id) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/plantillas-recordatorio/:id/fijar-por-defecto',
        operacion: 'plantillasRecordatorioFijarPorDefecto',
        resumen: 'Hacer de esta la plantilla de recordatorio por defecto de su empresa',
        descripcion:
            'La anterior deja de serlo en la misma transacción. 409 `plantilla_retirada`, ' +
            '`plantilla_personalizada` o por `version`.',
        etiqueta: 'notificaciones',
        permiso: 'recordatorios.editar',
        cuerpo: v.fijarPlantillaRecordatorioPorDefectoValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Plantilla por defecto', esquema: PlantillaRecordatorio },
        handler: (ctx, { cuerpo, params }) =>
            new FijarPlantillaRecordatorioPorDefecto().execute(
                { ...cuerpo, id: Number(params.id) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/plantillas-recordatorio/:id/asignar-masivo',
        operacion: 'plantillasRecordatorioAsignarMasivo',
        resumen: 'Asignar la plantilla a varios servicios (uno por uno, todo o nada)',
        descripcion:
            'Cada servicio que cambia deja su fila de auditoría y su `recordatorios.asignacion_cambiada`. ' +
            'Si uno no puede recibirla (otra empresa, no existe) no se asigna a ninguno.',
        etiqueta: 'notificaciones',
        permiso: 'recordatorios.asignar',
        cuerpo: v.asignarPlantillaRecordatorioMasivoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Resultado', esquema: AsignacionRecordatorioMasiva },
        handler: (ctx, { cuerpo, params }) =>
            new AsignarPlantillaRecordatorioMasivo().execute(
                { plantilla_id: Number(params.id), servicio_ids: cuerpo.servicio_ids },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/recordatorios',
        operacion: 'serviciosRecordatoriosVer',
        resumen: 'Recordatorios que rigen para un servicio: plantilla efectiva y de dónde sale',
        etiqueta: 'notificaciones',
        permiso: 'recordatorios.ver',
        respuesta: { status: 200, descripcion: 'Recordatorios del servicio', esquema: RecordatoriosDestino },
        handler: async (ctx, { params }) => {
            await exigirServicio(ctx, Number(params.id))
            return recordatoriosDe({ servicioId: Number(params.id) })
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/recordatorios/asignar',
        operacion: 'serviciosRecordatoriosAsignar',
        resumen: 'Asignar una plantilla de recordatorio a un servicio (null = la por defecto)',
        descripcion:
            '422 `plantilla_de_otra_empresa` o `plantilla_personalizada`; 409 `plantilla_retirada`. ' +
            'La personalizada del servicio, si tiene, sigue mandando.',
        etiqueta: 'notificaciones',
        permiso: 'recordatorios.asignar',
        cuerpo: v.asignarPlantillaRecordatorioValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Asignación', esquema: AsignacionRecordatorio },
        handler: async (ctx, { cuerpo, params }) => {
            await exigirServicio(ctx, Number(params.id))
            return new AsignarPlantillaRecordatorio().execute(
                { servicio_id: Number(params.id), plantilla_id: cuerpo.plantilla_id },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/servicios/:id/recordatorios/personalizados',
        operacion: 'serviciosRecordatoriosPersonalizar',
        resumen: 'Poner o reemplazar los recordatorios personalizados de un servicio',
        descripcion:
            'Sus pasos sustituyen completos a los de la plantilla para este servicio. `version` 0 la crea; ' +
            'con valor, la de la personalizada (409 si cambió). 422 si los pasos no son válidos.',
        etiqueta: 'notificaciones',
        permiso: 'recordatorios.personalizar',
        cuerpo: v.personalizarRecordatoriosValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Plantilla personalizada', esquema: PlantillaRecordatorio },
        handler: async (ctx, { cuerpo, params }) => {
            await exigirServicio(ctx, Number(params.id))
            return new PersonalizarRecordatoriosServicio().execute(
                { ...cuerpo, servicio_id: Number(params.id) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/recordatorios/quitar-personalizados',
        operacion: 'serviciosRecordatoriosQuitarPersonalizados',
        resumen: 'Quitar los recordatorios personalizados de un servicio (vuelve a su plantilla)',
        descripcion: '404 si no tiene personalizados; 409 por `version` (la de la personalizada).',
        etiqueta: 'notificaciones',
        permiso: 'recordatorios.personalizar',
        cuerpo: v.quitarRecordatoriosPersonalizadosValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Recordatorios del servicio', esquema: RecordatoriosDestino },
        handler: async (ctx, { cuerpo, params }) => {
            await exigirServicio(ctx, Number(params.id))
            return new QuitarRecordatoriosPersonalizados().execute(
                { ...cuerpo, servicio_id: Number(params.id) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/suscripciones/:id/recordatorios',
        operacion: 'suscripcionesRecordatoriosVer',
        resumen: 'Recordatorios que rigen para una suscripción: plantilla efectiva y de dónde sale',
        descripcion:
            'Las suscripciones no tienen personalizados. 404 mientras no exista la suscripción (I1).',
        etiqueta: 'notificaciones',
        permiso: 'recordatorios.ver',
        respuesta: {
            status: 200,
            descripcion: 'Recordatorios de la suscripción',
            esquema: RecordatoriosDestino,
        },
        handler: async (ctx, { params }) => {
            exigirEmpresa(ctx, await empresaDeSuscripcion(Number(params.id)))
            return recordatoriosDe({ suscripcionId: Number(params.id) })
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/suscripciones/:id/recordatorios/asignar',
        operacion: 'suscripcionesRecordatoriosAsignar',
        resumen: 'Asignar una plantilla de recordatorio a una suscripción (null = la por defecto)',
        descripcion:
            '422 `plantilla_de_otra_empresa` o `plantilla_personalizada`; 409 `plantilla_retirada`; 404 si la ' +
            'suscripción no existe.',
        etiqueta: 'notificaciones',
        permiso: 'recordatorios.asignar',
        cuerpo: v.asignarPlantillaRecordatorioValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Asignación', esquema: AsignacionRecordatorio },
        handler: (ctx, { cuerpo, params }) =>
            new AsignarPlantillaRecordatorio().execute(
                { suscripcion_id: Number(params.id), plantilla_id: cuerpo.plantilla_id },
                ctx.contextoAccion(),
            ),
    }),
]

export default recordatorios
