/*
|--------------------------------------------------------------------------
| Rutas de notificaciones (A6): plantillas y registro de envíos
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import { EnvioNotificacion, PlantillaNotificacion, RecordatorioPago } from '#notify/esquemas'
import { listarEnvios, listarPlantillas, listarRecordatorios } from '#notify/consultas'
import EditarPlantillaNotificacion from '#notify/actions/editar_plantilla_notificacion'
import EditarRecordatorio from '#notify/actions/editar_recordatorio'
import * as v from '#notify/validators'

const notify: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/notificaciones/plantillas',
        operacion: 'notificacionesPlantillasListar',
        resumen: 'Listar plantillas de notificación (por evento y canal)',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.ver',
        respuesta: { status: 200, descripcion: 'Plantillas', esquema: lista(PlantillaNotificacion) },
        handler: () => listarPlantillas(),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/notificaciones/plantillas/:id',
        operacion: 'notificacionesPlantillasEditar',
        resumen: 'Editar asunto, cuerpo o activación de una plantilla de notificación',
        descripcion: 'Valida la sintaxis Mustache (422). Variables en apps/api/app/notify/README.md.',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.editar',
        cuerpo: v.editarPlantillaNotificacionValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Plantilla actualizada', esquema: PlantillaNotificacion },
        handler: (ctx, { cuerpo, params }) =>
            new EditarPlantillaNotificacion().execute(
                { ...cuerpo, id: Number(params.id) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/notificaciones/envios',
        operacion: 'notificacionesEnviosListar',
        resumen: 'Registro de envíos (por cliente, evento, canal o estado)',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.ver',
        query: v.listarEnviosValidator,
        respuesta: { status: 200, descripcion: 'Página de envíos', esquema: pagina(EnvioNotificacion) },
        handler: (_ctx, { query }) => listarEnvios(query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/notificaciones/recordatorios',
        operacion: 'notificacionesRecordatoriosListar',
        resumen: 'Recordatorios de pago configurados (hasta tres)',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.ver',
        respuesta: { status: 200, descripcion: 'Recordatorios', esquema: lista(RecordatorioPago) },
        handler: () => listarRecordatorios(),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/notificaciones/recordatorios/:id',
        operacion: 'notificacionesRecordatoriosEditar',
        resumen: 'Configurar un recordatorio de pago: días respecto al vencimiento, hora y activo',
        etiqueta: 'notificaciones',
        permiso: 'notificaciones.editar',
        cuerpo: v.editarRecordatorioValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Recordatorio actualizado', esquema: RecordatorioPago },
        handler: (ctx, { cuerpo, params }) =>
            new EditarRecordatorio().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
]

export default notify
