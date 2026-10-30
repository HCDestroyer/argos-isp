/*
|--------------------------------------------------------------------------
| Rutas de QoS por clases: prioridad por protocolo en el árbol (A2)
|--------------------------------------------------------------------------
|
| `.claude/integration/contratos/qos.md`. Solo validan, revisan alcance y llaman acciones. Las monta
| `start/routes/network.ts`.
*/
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, type Ruta } from '#shared/rutas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { pagina } from '#shared/openapi/esquemas'
import { Prohibido } from '#shared/errores'
import { exigirAlcance } from '#core/acl'
import * as v from '#network/validators'
import { ClaseQos, PerfilQos, PerfilQosDetalle, Router } from '#network/esquemas'
import { listarPerfiles, usoPerfil, verPerfil } from '#network/consultas/qos'
import CrearPerfilQos from '#network/actions/crear_perfil_qos'
import CrearClaseQos from '#network/actions/crear_clase_qos'
import EditarClaseQos from '#network/actions/editar_clase_qos'
import { ActivarClaseQos, DesactivarClaseQos } from '#network/actions/cambiar_estado_clase_qos'
import AsignarPerfilQos from '#network/actions/asignar_perfil_qos'

/** 403 si el perfil es de una empresa fuera del alcance del usuario. */
function exigirPerfilVisible(ctx: HttpContext, empresaId: number | null, id: number) {
    const permitidas = ctx.empresa?.permitidas
    if (empresaId === null || permitidas === null || permitidas === undefined) return
    if (!permitidas.includes(empresaId)) throw new Prohibido(`No tienes acceso al perfil de QoS ${id}`)
}

const qos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/qos/perfiles',
        operacion: 'qosPerfiles',
        resumen: 'Perfiles de QoS por clases (comunes y de la empresa activa)',
        descripcion: 'Cada perfil con sus clases (activas primero, por orden) y sus advertencias.',
        etiqueta: 'qos',
        permiso: 'qos.ver',
        query: v.listarPerfilesQosValidator,
        respuesta: { status: 200, descripcion: 'Página de perfiles', esquema: pagina(PerfilQos) },
        handler: (ctx, { query }) => listarPerfiles(query, empresasDeLaLista(ctx.empresa)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/qos/perfiles/:id',
        operacion: 'qosVerPerfil',
        resumen: 'Ver un perfil de QoS con su costo en cada router que lo usa',
        descripcion:
            '`routers[]`: routers activos con este perfil (el suyo o el predeterminado), cuántos planes priorizan ' +
            'por clases y el costo (hojas del árbol, reglas de mangle, tipos de cola) contra el límite.',
        etiqueta: 'qos',
        permiso: 'qos.ver',
        respuesta: { status: 200, descripcion: 'Perfil', esquema: PerfilQosDetalle },
        handler: async (ctx, { params }) => {
            const perfil = await verPerfil(Number(params.id))
            exigirPerfilVisible(ctx, perfil.empresa_id, perfil.id)
            return { ...perfil, routers: await usoPerfil(perfil.id) }
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/qos/perfiles',
        operacion: 'qosCrearPerfil',
        resumen: 'Crear un perfil de QoS copiando las clases de otro (por defecto, el predeterminado)',
        descripcion:
            'Sin `empresa_id`, común a todas las empresas (solo con alcance global; 403 `empresa_no_permitida`). ' +
            '409 `qos_nombre_duplicado`.',
        etiqueta: 'qos',
        permiso: 'qos.gestionar',
        cuerpo: v.crearPerfilQosValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Perfil creado', esquema: PerfilQos },
        handler: (ctx, { cuerpo }) => new CrearPerfilQos().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/qos/perfiles/:id/clases',
        operacion: 'qosCrearClase',
        resumen: 'Agregar una clase a un perfil de QoS',
        descripcion:
            'Valida el perfil como quedaría y el costo en cada router que lo usa (422 `qos_resto`, `qos_max_clases`, ' +
            '`qos_garantizado`, `qos_reglas`, `qos_puertos`, `qos_reclasifica`, `qos_costo`). Emite ' +
            '`qos.config_cambiada`: los routers se reconcilian solos.',
        etiqueta: 'qos',
        permiso: 'qos.gestionar',
        cuerpo: v.crearClaseQosValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Clase creada', esquema: ClaseQos },
        handler: (ctx, { cuerpo, params }) =>
            new CrearClaseQos().execute({ ...cuerpo, perfil_id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/qos/clases/:id',
        operacion: 'qosEditarClase',
        resumen: 'Editar una clase de QoS',
        descripcion: 'Lo ausente queda igual. 409 si la `version` no coincide; 422 como al crear.',
        etiqueta: 'qos',
        permiso: 'qos.gestionar',
        cuerpo: v.editarClaseQosValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Clase actualizada', esquema: ClaseQos },
        handler: (ctx, { cuerpo, params }) =>
            new EditarClaseQos().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/qos/clases/:id/desactivar',
        operacion: 'qosDesactivarClase',
        resumen: 'Desactivar una clase de QoS (no se borra)',
        descripcion: '«resto» no se desactiva (422 `qos_resto`). Ya inactiva: 200 sin cambios.',
        etiqueta: 'qos',
        permiso: 'qos.gestionar',
        cuerpo: v.estadoClaseQosValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Clase desactivada', esquema: ClaseQos },
        handler: (ctx, { cuerpo, params }) =>
            new DesactivarClaseQos().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/qos/clases/:id/activar',
        operacion: 'qosActivarClase',
        resumen: 'Volver a activar una clase de QoS',
        descripcion: 'Revisa el perfil y el costo (422). Ya activa: 200 sin cambios.',
        etiqueta: 'qos',
        permiso: 'qos.gestionar',
        cuerpo: v.estadoClaseQosValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Clase activada', esquema: ClaseQos },
        handler: (ctx, { cuerpo, params }) =>
            new ActivarClaseQos().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/qos-perfil',
        operacion: 'routersQosPerfil',
        resumen: 'Elegir el perfil de QoS por clases del router (null = el predeterminado)',
        descripcion:
            'El perfil debe ser común o de la empresa sugerida del router (422 `qos_empresa`) y caber en el límite ' +
            'de hojas (422 `qos_costo`). Emite `qos.config_cambiada`; el router se reconcilia si algún plan usa qos.',
        etiqueta: 'routers',
        permiso: 'qos.gestionar',
        cuerpo: v.asignarPerfilQosValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Router con el perfil nuevo', esquema: Router },
        handler: (ctx, { cuerpo, params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return new AsignarPerfilQos().execute(
                {
                    router_id: Number(params.id),
                    version: cuerpo.version,
                    qos_perfil_id: cuerpo.qos_perfil_id,
                    motivo: cuerpo.motivo,
                },
                ctx.contextoAccion(),
            )
        },
    }),
]

export default qos
