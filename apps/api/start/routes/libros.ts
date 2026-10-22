/*
|--------------------------------------------------------------------------
| Rutas de los libros legales con folio (A3, localización fiscal §7, fase 6 PR D)
|--------------------------------------------------------------------------
|
| Las monta `start/routes/ledger.ts`. El libro de compras en vista previa sigue en
| `start/routes/compras.ts` (`GET /libros/compras`, también con `formato=pdf`).
|
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirAcceso } from '#billing/empresa'
import { DESCRIPCION_EXPORTACION, empresaDelLibro } from '#start/routes/compras'
import * as v from '#fiscal/validators_libros'
import {
    EmisionLibro,
    FoliosLibro,
    HabilitacionLibro,
    ReporteLibroDiario,
    ReporteLibroMayor,
    ReporteLibroVentas,
} from '#fiscal/esquemas_libros'
import {
    LIBROS_HABILITABLES,
    construirLibro,
    esLibroEmitible,
    rangoFechas,
    type LibroEmitible,
} from '#fiscal/libros_legales'
import { DESCRIPCION_PDF, responderLibro } from '#fiscal/libros_http'
import {
    contenidoEmision,
    empresaDeEmision,
    foliosDe,
    listarEmisiones,
    listarHabilitaciones,
    verEmision,
} from '#fiscal/libros_emisiones'
import { NoEncontrado } from '#shared/errores'
import db from '@adonisjs/lucid/services/db'
import EmitirLibro from '#fiscal/actions/emitir_libro'
import HabilitarLibro from '#fiscal/actions/habilitar_libro'

function vistaPrevia(
    libro: Exclude<LibroEmitible, 'compras'>,
    operacion: string,
    resumen: string,
    descripcion: string,
    esquema: typeof ReporteLibroDiario,
): Ruta {
    return definirRuta({
        metodo: 'get',
        ruta: `/libros/${libro}`,
        operacion,
        resumen,
        etiqueta: 'libros',
        permiso: 'libros.ver',
        query: v.vistaPreviaLibroValidator,
        descripcion: descripcion + DESCRIPCION_EXPORTACION + DESCRIPCION_PDF,
        respuesta: { status: 200, descripcion: 'Libro (vista previa)', esquema },
        handler: async (ctx, { query }) => {
            const empresaId = await empresaDelLibro(ctx, query.empresa_id)
            return responderLibro(
                ctx,
                await construirLibro(libro, empresaId, rangoFechas(query)),
                query.formato,
            )
        },
    })
}

const vistas: Ruta[] = [
    vistaPrevia(
        'diario',
        'librosDiario',
        'Libro Diario (vista previa, sin folio)',
        'Cualquier rango (por defecto el mes en curso). Cada movimiento en una fila (fila = movimiento) y debajo el total de la partida (fila = total). Orden cronológico: fecha, partida (la guardada al cerrar el mes, §10.7; null en meses abiertos) y número del diario. totales suma solo los movimientos.',
        ReporteLibroDiario,
    ),
    vistaPrevia(
        'mayor',
        'librosMayor',
        'Libro Mayor (vista previa, sin folio)',
        'Por cuenta con saldo inicial o movimientos en el rango: saldo inicial (fila = saldo_inicial), cada movimiento con su saldo acumulado y el saldo final con el debe y el haber de la cuenta (fila = saldo_final). El saldo va según la naturaleza de la cuenta. totales suma el debe y el haber de los movimientos.',
        ReporteLibroMayor,
    ),
    vistaPrevia(
        'ventas',
        'librosVentas',
        'Libro de Ventas y Servicios Prestados (vista previa, sin folio)',
        'DTE certificados del rango (fecha de emisión) y, sin FEL, facturas que no son aviso de cobro (fecha de su asiento) y sus notas de crédito. Anulados con valores en cero; NCRE y notas restan. Los avisos de cobro sin DTE no entran (su IVA está en 2.1.11). retenciones = constancias de los pagos vigentes aplicados a la factura, en proporción a lo aplicado.',
        ReporteLibroVentas,
    ),
]

const habilitaciones: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/libros/habilitaciones',
        operacion: 'librosHabilitaciones',
        resumen: 'Rangos de folios habilitados de los libros (el más reciente primero)',
        etiqueta: 'libros',
        permiso: 'libros.ver',
        query: v.listarLibrosValidator,
        respuesta: {
            status: 200,
            descripcion: 'Página de habilitaciones',
            esquema: pagina(HabilitacionLibro),
        },
        handler: (ctx, { query }) =>
            listarHabilitaciones(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/libros/habilitaciones',
        operacion: 'librosHabilitar',
        resumen: 'Registrar un rango de folios habilitado de un libro (solo inserción)',
        etiqueta: 'libros',
        permiso: 'libros.habilitar',
        cuerpo: v.habilitarLibroValidator,
        idempotente: true,
        descripcion:
            'Rangos correlativos por libro: el primero empieza donde diga la autorización y cada uno nuevo en el folio siguiente al último habilitado (422 habilitacion_no_correlativa). fecha no futura. Una habilitación no se edita ni se borra.',
        respuesta: { status: 201, descripcion: 'Habilitación registrada', esquema: HabilitacionLibro },
        handler: async (ctx, { cuerpo }) => {
            ctx.response.status(201)
            return new HabilitarLibro().execute(cuerpo, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libros/folios',
        operacion: 'librosFolios',
        resumen: 'Folios de cada libro: el siguiente y cuántos quedan habilitados',
        etiqueta: 'libros',
        permiso: 'libros.ver',
        query: v.foliosLibrosValidator,
        respuesta: { status: 200, descripcion: 'Folios por libro', esquema: lista(FoliosLibro) },
        handler: async (ctx, { query }) => {
            const empresaId = await empresaDelLibro(ctx, query.empresa_id)
            const conexion = db.connection()
            return Promise.all(LIBROS_HABILITABLES.map((libro) => foliosDe(conexion, empresaId, libro)))
        },
    }),
]

const emisiones: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/libros/:libro/emitir',
        operacion: 'librosEmitir',
        resumen: 'Emisión oficial con folio de un libro (Diario, Mayor, Compras o Ventas)',
        etiqueta: 'libros',
        permiso: 'libros.emitir',
        cuerpo: v.emitirLibroValidator,
        parametros: { libro: v.libroEmitibleParametro },
        idempotente: true,
        descripcion:
            'Meses completos (desde y hasta van al primer y último día de su mes). Exige cada mes cerrado y el bloqueo global o duro hasta el fin del rango (422 periodo_sin_bloqueo, errors[] con rule mes_abierto o sin_bloqueo) y la cadena de hash verificada (409 integridad_rota). Toma el siguiente folio del libro y uno por página dentro de lo habilitado (422 folios_agotados). Guarda el archivo con su SHA-256 y el último sello y hash del cierre del último mes. Un rango que se cruza con una emisión anterior es una reimpresión (folios nuevos y la marca). Emite libro.emitido.',
        respuesta: { status: 201, descripcion: 'Emisión registrada', esquema: EmisionLibro },
        handler: async (ctx, { params, cuerpo }) => {
            const libro = String(params.libro)
            if (!esLibroEmitible(libro)) throw new NoEncontrado(`El libro ${libro} no se emite (todavía)`)
            const emision = await new EmitirLibro().execute({ ...cuerpo, libro }, ctx.contextoAccion())
            ctx.response.status(201)
            return emision
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libros/emisiones',
        operacion: 'librosEmisiones',
        resumen: 'Emisiones oficiales de los libros (la más reciente primero)',
        etiqueta: 'libros',
        permiso: 'libros.ver',
        query: v.listarLibrosValidator,
        respuesta: { status: 200, descripcion: 'Página de emisiones', esquema: pagina(EmisionLibro) },
        handler: (ctx, { query }) => listarEmisiones(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libros/emisiones/:id',
        operacion: 'librosEmision',
        resumen: 'Una emisión oficial de un libro',
        etiqueta: 'libros',
        permiso: 'libros.ver',
        respuesta: { status: 200, descripcion: 'Emisión', esquema: EmisionLibro },
        handler: async (ctx, { params }) => {
            const emision = await verEmision(Number(params.id))
            exigirAcceso(ctx, { empresa_id: emision.empresa_id })
            return emision
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libros/emisiones/:id/archivo',
        operacion: 'librosEmisionArchivo',
        resumen: 'Archivo de una emisión (PDF o XLSX) tal como se guardó',
        etiqueta: 'libros',
        permiso: 'libros.ver',
        descripcion:
            'Vuelve a calcular el SHA-256 del archivo y responde 409 archivo_alterado si no coincide con el registrado.',
        respuesta: { status: 200, descripcion: 'Archivo', contenido: 'application/octet-stream' },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, { empresa_id: await empresaDeEmision(id) })
            const archivo = await contenidoEmision(id)
            ctx.response.header('Content-Type', archivo.tipo)
            ctx.response.header('Content-Disposition', `attachment; filename="${archivo.nombre}"`)
            ctx.response.header('Cache-Control', 'private, no-store')
            ctx.response.send(archivo.contenido)
        },
    }),
]

export default [...vistas, ...habilitaciones, ...emisiones]
