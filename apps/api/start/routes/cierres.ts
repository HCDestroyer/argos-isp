/*
|--------------------------------------------------------------------------
| Rutas de bloqueos y cierres del libro (A3, localización fiscal §9 y §10.4–§10.8, fase 6)
|--------------------------------------------------------------------------
|
| Las monta `start/routes/ledger.ts`.
|
*/
import db from '@adonisjs/lucid/services/db'
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirAcceso } from '#billing/empresa'
import { NoEncontrado } from '#shared/errores'
import * as v from '#ledger/validators_bloqueos'
import { BloqueoLibro, BloqueosEmpresa, ExcepcionBloqueo } from '#ledger/esquemas_bloqueos'
import { bloqueosVigentes, listarBloqueos, listarExcepciones, verExcepcion } from '#ledger/bloqueos'
import BloquearLibro from '#ledger/actions/bloquear_libro'
import BloquearDuro from '#ledger/actions/bloquear_duro'
import DesbloquearLibro from '#ledger/actions/desbloquear_libro'
import CrearExcepcionBloqueo from '#ledger/actions/crear_excepcion_bloqueo'
import RevocarExcepcionBloqueo from '#ledger/actions/revocar_excepcion_bloqueo'

async function empresasDe(ids: number[] | null): Promise<number[]> {
    if (ids !== null) return ids
    const filas = (await db.from('core.empresas').orderBy('id').select('id')) as Array<{ id: number }>
    return filas.map((f) => Number(f.id))
}

const bloqueos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/libro/bloqueos',
        operacion: 'libroBloqueos',
        resumen: 'Bloqueos vigentes por tipo de cada empresa',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.bloqueosVigentesValidator,
        descripcion:
            'Por empresa: el hasta vigente de global, ventas, compras, impuestos y duro (null = sin bloqueo) y la última fila de cada tipo. Un asiento con fecha ≤ hasta de un bloqueo que le aplica responde 422 periodo_bloqueado (409 bloqueo_duro), salvo con una excepción vigente.',
        respuesta: { status: 200, descripcion: 'Bloqueos por empresa', esquema: lista(BloqueosEmpresa) },
        handler: async (ctx, { query }) =>
            bloqueosVigentes(await empresasDe(empresasDeLaLista(ctx.empresa, query.empresas))),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/bloqueos/historial',
        operacion: 'libroBloqueosHistorial',
        resumen: 'Historia de bloqueos (el más reciente primero)',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.listarBloqueosValidator,
        respuesta: { status: 200, descripcion: 'Página de bloqueos', esquema: pagina(BloqueoLibro) },
        handler: (ctx, { query }) => listarBloqueos(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/libro/bloqueos',
        operacion: 'libroBloquear',
        resumen: 'Bloquear el libro hasta una fecha (global, ventas, compras o impuestos)',
        etiqueta: 'libro',
        permiso: 'libro.bloquear',
        cuerpo: v.bloquearValidator,
        idempotente: true,
        descripcion:
            'Solo avanza (422 bloqueo_regresivo: para retroceder, /libro/bloqueos/desbloquear); no futuro (422 bloqueo_futuro); nunca antes del duro (422 bloqueo_bajo_duro). Ventas: diario de ventas; compras: diario de compras y pagos a proveedores; impuestos: asientos con una cuenta de impuesto; global: todo. Emite libro.bloqueo_cambiado.',
        respuesta: { status: 201, descripcion: 'Bloqueo fijado', esquema: BloqueoLibro },
        handler: (ctx, { cuerpo }) => new BloquearLibro().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/libro/bloqueos/duro',
        operacion: 'libroBloquearDuro',
        resumen: 'Bloqueo duro del libro (irreversible; solo admin)',
        etiqueta: 'libro',
        permiso: 'libro.bloquear_duro',
        cuerpo: v.bloquearDuroValidator,
        idempotente: true,
        descripcion:
            'confirmacion = «BLOQUEO DURO hasta AAAA-MM-DD» (422 confirmacion_invalida). Solo avanza (422 bloqueo_regresivo). Exige meses cerrados, ningún DTE sin certificar y ninguna línea de extracto sin conciliar hasta esa fecha (422 bloqueo_duro_requisitos, errors[].rule = meses_abiertos, dte_pendientes, extractos_sin_conciliar). Después: nada con fecha ≤ hasta, ni con excepción (409 bloqueo_duro), y ningún mes se reabre. Emite libro.bloqueo_cambiado.',
        respuesta: { status: 201, descripcion: 'Bloqueo duro fijado', esquema: BloqueoLibro },
        handler: (ctx, { cuerpo }) => new BloquearDuro().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/libro/bloqueos/desbloquear',
        operacion: 'libroDesbloquear',
        resumen: 'Mover hacia atrás o quitar un bloqueo global, de ventas o de compras (con motivo)',
        etiqueta: 'libro',
        permiso: 'libro.desbloquear',
        cuerpo: v.desbloquearValidator,
        idempotente: true,
        descripcion:
            'hasta anterior al vigente o null (sin bloqueo). Impuestos no retrocede (422 bloqueo_regresivo: usar una excepción); el duro nunca (409 bloqueo_duro). 409 sin_bloqueo si el tipo no tiene. Emite libro.bloqueo_cambiado.',
        respuesta: { status: 201, descripcion: 'Bloqueo movido', esquema: BloqueoLibro },
        handler: (ctx, { cuerpo }) => new DesbloquearLibro().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/bloqueos/excepciones',
        operacion: 'libroExcepcionesBloqueo',
        resumen: 'Excepciones de bloqueo (la más reciente primero)',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.listarExcepcionesValidator,
        respuesta: { status: 200, descripcion: 'Página de excepciones', esquema: pagina(ExcepcionBloqueo) },
        handler: (ctx, { query }) => listarExcepciones(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/libro/bloqueos/excepciones',
        operacion: 'libroCrearExcepcionBloqueo',
        resumen: 'Excepción de bloqueo con fecha de fin (solo admin)',
        etiqueta: 'libro',
        permiso: 'libro.excepcion_bloqueo',
        cuerpo: v.crearExcepcionValidator,
        idempotente: true,
        descripcion:
            'Permite a usuario_id (null = todos) registrar bajo el bloqueo tipo hasta hasta_en. Sin hasta_en o con tipo duro: 422 excepcion_sin_fin. Cubre solo su tipo; cada asiento que entra por ella guarda excepcion_id.',
        respuesta: { status: 201, descripcion: 'Excepción creada', esquema: ExcepcionBloqueo },
        handler: (ctx, { cuerpo }) => new CrearExcepcionBloqueo().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/libro/bloqueos/excepciones/:id/revocar',
        operacion: 'libroRevocarExcepcionBloqueo',
        resumen: 'Revocar una excepción de bloqueo (con motivo)',
        etiqueta: 'libro',
        permiso: 'libro.excepcion_bloqueo',
        cuerpo: v.revocarExcepcionValidator,
        idempotente: true,
        descripcion: 'No cubre asientos nuevos desde ahora. 409 excepcion_revocada si ya lo estaba.',
        respuesta: { status: 200, descripcion: 'Excepción revocada', esquema: ExcepcionBloqueo },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            const excepcion = await verExcepcion(id)
            if (!excepcion) throw new NoEncontrado(`La excepción ${id} no existe`)
            exigirAcceso(ctx, { empresa_id: excepcion.empresa_id })
            return new RevocarExcepcionBloqueo().execute(
                { excepcion_id: id, motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            )
        },
    }),
]

export default [...bloqueos]
