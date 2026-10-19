/*
|--------------------------------------------------------------------------
| Rutas de servicios adicionales (A1): catálogo, motivos de cortesía, asignaciones y planes
|--------------------------------------------------------------------------
|
| `contratos/adicionales.md`. Solo validan, revisan alcance y permisos, y llaman acciones. Las
| monta `start/routes/core.ts`.
|
*/
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, type Ruta } from '#shared/rutas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { lista, pagina } from '#shared/openapi/esquemas'
import { Prohibido } from '#shared/errores'
import { alcanceDePermiso } from '#core/acl'
import { exigirServicio } from '#core/acceso_empresa'
import { alcancesDelToken } from '#middleware/autorizar_middleware'
import {
    adicionalesDelPlan,
    listarAdicionales,
    listarAsignaciones,
    listarBloqueos,
    listarMotivosCortesia,
    verAdicional,
} from '#core/adicionales'
import CrearAdicional from '#core/actions/crear_adicional'
import EditarAdicional from '#core/actions/editar_adicional'
import DesactivarAdicional from '#core/actions/desactivar_adicional'
import CrearMotivoCortesia from '#core/actions/crear_motivo_cortesia'
import DesactivarMotivoCortesia from '#core/actions/desactivar_motivo_cortesia'
import AgregarAdicionalServicio from '#core/actions/agregar_adicional_servicio'
import EditarAdicionalServicio from '#core/actions/editar_adicional_servicio'
import QuitarAdicionalServicio from '#core/actions/quitar_adicional_servicio'
import VerCredencialAdicional from '#core/actions/ver_credencial_adicional'
import DefinirAdicionalesPlan from '#network/actions/definir_adicionales_plan'
import * as v from '#core/validators'
import {
    Adicional,
    AdicionalPlan,
    AdicionalServicio,
    BloqueoAdicional,
    CredencialAdicional,
    MotivoCortesia,
} from '#core/esquemas'

/** ¿Tiene el actor `servicios.adicional_cortesia`? (la acción responde 403 si hace falta y no) */
async function permiteCortesia(ctx: HttpContext): Promise<boolean> {
    const usuario = ctx.auth.user
    if (!usuario) return false
    return (
        (await alcanceDePermiso(usuario.id, 'servicios.adicional_cortesia', alcancesDelToken(ctx))) !== null
    )
}

/** 403 si el recurso es de una empresa fuera del alcance del usuario (como `exigirServicio`). */
function exigirEmpresaDelRecurso(ctx: HttpContext, empresaId: number | null) {
    const permitidas = ctx.empresa?.permitidas
    if (empresaId === null || permitidas === null || permitidas === undefined) return
    if (!permitidas.includes(empresaId)) {
        throw new Prohibido(`No tienes acceso a la empresa ${empresaId}`)
    }
}

const catalogo: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/adicionales',
        operacion: 'adicionalesListar',
        resumen: 'Catálogo de servicios adicionales (streaming, IPTV…) de la empresa activa',
        etiqueta: 'adicionales',
        permiso: 'adicionales.ver',
        query: v.listarAdicionalesValidator,
        respuesta: { status: 200, descripcion: 'Página de adicionales', esquema: pagina(Adicional) },
        handler: (ctx, { query }) => listarAdicionales(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/adicionales',
        operacion: 'adicionalesCrear',
        resumen: 'Crear un servicio adicional en el catálogo de la empresa',
        descripcion: '409 `adicional_duplicado` si el código ya existe en la empresa (también desactivado).',
        etiqueta: 'adicionales',
        permiso: 'adicionales.crear',
        cuerpo: v.crearAdicionalValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Adicional creado', esquema: Adicional },
        handler: (ctx, { cuerpo }) => new CrearAdicional().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/adicionales/motivos',
        operacion: 'adicionalesMotivos',
        resumen: 'Motivos de cortesía: los comunes y los de la empresa activa',
        etiqueta: 'adicionales',
        permiso: 'adicionales.ver',
        query: v.listarMotivosCortesiaValidator,
        respuesta: { status: 200, descripcion: 'Motivos de cortesía', esquema: lista(MotivoCortesia) },
        handler: (ctx, { query }) =>
            listarMotivosCortesia(empresasDeLaLista(ctx.empresa, query.empresas), { activo: query.activo }),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/adicionales/motivos',
        operacion: 'adicionalesCrearMotivo',
        resumen: 'Crear un motivo de cortesía de la empresa',
        descripcion: '409 `motivo_duplicado` si el código ya existe en la empresa o entre los comunes.',
        etiqueta: 'adicionales',
        permiso: 'adicionales.crear_motivo',
        cuerpo: v.crearMotivoCortesiaValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Motivo creado', esquema: MotivoCortesia },
        handler: (ctx, { cuerpo }) => new CrearMotivoCortesia().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/adicionales/motivos/:id/desactivar',
        operacion: 'adicionalesDesactivarMotivo',
        resumen: 'Desactivar un motivo de cortesía (no se borra)',
        descripcion: 'Un motivo común solo con alcance global (403 `empresa_no_permitida`).',
        etiqueta: 'adicionales',
        permiso: 'adicionales.desactivar_motivo',
        cuerpo: v.desactivarVersionadoValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Motivo desactivado', esquema: MotivoCortesia },
        handler: (ctx, { cuerpo, params }) =>
            new DesactivarMotivoCortesia().execute(
                { ...cuerpo, id: Number(params.id) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/adicionales/:id',
        operacion: 'adicionalesVer',
        resumen: 'Ver un servicio adicional del catálogo',
        etiqueta: 'adicionales',
        permiso: 'adicionales.ver',
        respuesta: { status: 200, descripcion: 'Adicional', esquema: Adicional },
        handler: async (ctx, { params }) => {
            const adicional = await verAdicional(Number(params.id))
            exigirEmpresaDelRecurso(ctx, adicional.empresa_id)
            return adicional
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/adicionales/:id',
        operacion: 'adicionalesEditar',
        resumen: 'Editar un servicio adicional del catálogo',
        etiqueta: 'adicionales',
        permiso: 'adicionales.editar',
        cuerpo: v.editarAdicionalValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Adicional actualizado', esquema: Adicional },
        handler: (ctx, { cuerpo, params }) =>
            new EditarAdicional().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/adicionales/:id/desactivar',
        operacion: 'adicionalesDesactivar',
        resumen: 'Desactivar un servicio adicional (no se borra; las asignaciones vigentes siguen)',
        etiqueta: 'adicionales',
        permiso: 'adicionales.desactivar',
        cuerpo: v.desactivarVersionadoValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Adicional desactivado', esquema: Adicional },
        handler: (ctx, { cuerpo, params }) =>
            new DesactivarAdicional().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
]

const deServicio: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/adicionales',
        operacion: 'serviciosAdicionales',
        resumen: 'Adicionales del servicio (sin credenciales)',
        descripcion: 'Del más reciente al más viejo; `estado` filtra activos o bajas.',
        etiqueta: 'servicios',
        permiso: 'servicios.ver',
        query: v.listarAdicionalesServicioValidator,
        respuesta: { status: 200, descripcion: 'Página de adicionales', esquema: pagina(AdicionalServicio) },
        handler: async (ctx, { params, query }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return listarAsignaciones(id, query)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/adicionales',
        operacion: 'serviciosAgregarAdicional',
        resumen: 'Agregar un adicional al servicio (incluido, cortesía o cobrado)',
        descripcion:
            '`cobrado` exige `precio` > 0; `cortesia` exige `motivo_id` y además el permiso ' +
            '`servicios.adicional_cortesia` (403). 422 `adicional_de_otra_empresa`, `adicional_inactivo` o ' +
            '`servicio_retirado`. Un mismo adicional puede agregarse varias veces.',
        etiqueta: 'servicios',
        permiso: 'servicios.agregar_adicional',
        cuerpo: v.agregarAdicionalServicioValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Adicional agregado', esquema: AdicionalServicio },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new AgregarAdicionalServicio().execute(
                { ...cuerpo, servicio_id: id, permiteCortesia: await permiteCortesia(ctx) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/servicios/:id/adicionales/:asignacionId',
        operacion: 'serviciosEditarAdicional',
        resumen: 'Editar un adicional del servicio (modalidad, identificador, credencial, precio, motivo)',
        descripcion:
            '409 si `version` cambió; 422 `adicional_dado_de_baja`. Pasar a `cortesia` o cambiar su motivo ' +
            'exige además `servicios.adicional_cortesia`. `credencial: null` la borra.',
        etiqueta: 'servicios',
        permiso: 'servicios.editar_adicional',
        cuerpo: v.editarAdicionalServicioValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Adicional actualizado', esquema: AdicionalServicio },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new EditarAdicionalServicio().execute(
                {
                    ...cuerpo,
                    servicio_id: id,
                    id: Number(params.asignacionId),
                    permiteCortesia: await permiteCortesia(ctx),
                },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/adicionales/:asignacionId/quitar',
        operacion: 'serviciosQuitarAdicional',
        resumen: 'Dar de baja un adicional del servicio (con fecha; nunca se borra)',
        descripcion: '409 si `version` cambió; 422 `adicional_dado_de_baja` si ya estaba de baja.',
        etiqueta: 'servicios',
        permiso: 'servicios.quitar_adicional',
        cuerpo: v.quitarAdicionalServicioValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Adicional dado de baja', esquema: AdicionalServicio },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new QuitarAdicionalServicio().execute(
                { ...cuerpo, servicio_id: id, id: Number(params.asignacionId) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/adicionales/:asignacionId/credencial',
        operacion: 'serviciosCredencialAdicional',
        resumen: 'Ver la credencial de un adicional del servicio (queda auditado)',
        descripcion: '422 `sin_credencial` si no tiene.',
        etiqueta: 'servicios',
        permiso: 'servicios.ver_credencial_adicional',
        respuesta: { status: 200, descripcion: 'Credencial en claro', esquema: CredencialAdicional },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new VerCredencialAdicional().execute(
                { servicio_id: id, id: Number(params.asignacionId) },
                ctx.contextoAccion(),
            )
        },
    }),
]

deServicio.push(
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/adicionales/:asignacionId/bloqueos',
        operacion: 'serviciosBloqueosAdicional',
        resumen: 'Historial de bloqueos y desbloqueos de un adicional (por la suspensión del servicio)',
        descripcion: 'Del más reciente al más viejo. El bloqueo lo pone y lo quita el estado del servicio.',
        etiqueta: 'servicios',
        permiso: 'servicios.ver',
        query: v.listarPaginadoValidator,
        respuesta: { status: 200, descripcion: 'Página de bloqueos', esquema: pagina(BloqueoAdicional) },
        handler: async (ctx, { params, query }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return listarBloqueos(id, Number(params.asignacionId), query)
        },
    }),
)

const dePlan: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/planes/:id/adicionales',
        operacion: 'planesAdicionales',
        resumen: 'Adicionales que trae el plan (con su cantidad)',
        descripcion: 'De todas las empresas; cada servicio recibe solo los de su empresa.',
        etiqueta: 'planes',
        permiso: 'planes.ver',
        respuesta: { status: 200, descripcion: 'Adicionales del plan', esquema: lista(AdicionalPlan) },
        handler: (_ctx, { params }) => adicionalesDelPlan(Number(params.id), undefined, { exigirPlan: true }),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/planes/:id/adicionales',
        operacion: 'planesDefinirAdicionales',
        resumen: 'Definir los adicionales que trae el plan (reemplaza la lista)',
        descripcion:
            'Sube la `version` del plan (409 si cambió). No toca los servicios existentes: se aplica al crear ' +
            'un servicio o al cambiar de plan.',
        etiqueta: 'planes',
        permiso: 'planes.editar',
        cuerpo: v.definirAdicionalesPlanValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Adicionales del plan', esquema: lista(AdicionalPlan) },
        handler: (ctx, { cuerpo, params }) =>
            new DefinirAdicionalesPlan().execute(
                { ...cuerpo, plan_id: Number(params.id) },
                ctx.contextoAccion(),
            ),
    }),
]

export default [...catalogo, ...deServicio, ...dePlan]
