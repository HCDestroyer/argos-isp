/*
|--------------------------------------------------------------------------
| Tablero fiscal (A3, fase 8 PR A; contrato de localización fiscal §9.4 y §22)
| Solo lectura: no cambia el régimen ni presenta nada.
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import * as v from '#fiscal/validators'
import {
    ComparadorRegimenes,
    ConsejoOcultado,
    ConsejosFiscales,
    TableroFiscal,
} from '#fiscal/esquemas_tablero'
import { usuarioDelActor } from '#shared/contexto'
import { consejosFiscales } from '#fiscal/consejos'
import OcultarConsejo from '#fiscal/actions/ocultar_consejo'
import { tableroFiscal } from '#fiscal/tablero'
import { compararRegimenes } from '#fiscal/comparador'

const tablero: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/tablero',
        operacion: 'fiscalTablero',
        resumen:
            'Tablero fiscal: facturado, IVA, ISR, ISO, pequeño contribuyente, vencimientos, libros y FEL',
        etiqueta: 'fiscal',
        permiso: 'fiscal.ver',
        query: v.tableroValidator,
        descripcion:
            'De la empresa activa (empresas=todas con alcance global: una sección por empresa, sin totales). Cada bloque se calcula por separado con las funciones de las declaraciones y los libros: estado ok con sus datos, no_aplica con su motivo (régimen) o error con su problema RFC 9457 (parámetro sin confirmar, regla no soportada…) y sin cifras. Los estimados se calculan con los datos de hoy y no se guardan. Siempre 200 aunque un bloque falle.',
        respuesta: { status: 200, descripcion: 'Tablero', esquema: TableroFiscal },
        handler: (ctx, { query }) => tableroFiscal(empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/comparador',
        operacion: 'fiscalComparador',
        resumen: 'Comparador de regímenes (simulación; no cambia el régimen)',
        etiqueta: 'fiscal',
        permiso: 'fiscal.ver',
        query: v.comparadorValidator,
        descripcion:
            'Con los datos del libro de los últimos 12 meses terminados (desde inicio_libros) y los parámetros vigentes: R, margen fiscal m, ISR del régimen opcional (escala del art. 44 y 7 % plano), sobre utilidades, ISO como piso, margen de equilibrio m* y proyección a 12 meses con crecimiento (por ciento mensual; por defecto la tendencia). Cada parte es un bloque: si falta un parámetro trae su error sin cifras y las que dependen de él, 422 bloque_dependiente. supuestos marca lo que debe confirmar el contador; matices son las advertencias fijas. Sin «aplicar»: el cambio de régimen es POST /fiscal/regimen.',
        respuesta: { status: 200, descripcion: 'Comparación', esquema: ComparadorRegimenes },
        handler: (ctx, { query }) =>
            compararRegimenes(empresasDeLaLista(ctx.empresa, query.empresas), query.crecimiento ?? null),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/consejos',
        operacion: 'fiscalConsejos',
        resumen: 'Consejos fiscales desde las cifras del tablero y del comparador',
        etiqueta: 'fiscal',
        permiso: 'fiscal.ver',
        query: v.consejosValidator,
        descripcion:
            'Catálogo del paquete (l10n/gt/consejos.ts) evaluado con los bloques del tablero y del comparador y los parámetros vigentes: aplica (texto y las cifras de los bloques), no_aplica o sin_datos (un bloque fuente en error: va su problema y ningún texto). Todos con fuente, confirmar_contador y el aviso «Referencia; valídelo con su contador»; oculto según fiscal.consejos_ocultos (el del usuario manda sobre el de la empresa). Solo lectura.',
        respuesta: { status: 200, descripcion: 'Consejos', esquema: ConsejosFiscales },
        handler: (ctx, { query }) =>
            consejosFiscales(
                empresasDeLaLista(ctx.empresa, query.empresas),
                usuarioDelActor(ctx.contextoAccion().actor),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/fiscal/consejos/:clave/ocultar',
        operacion: 'fiscalConsejoOcultar',
        resumen: 'Ocultar un consejo fiscal (empresa o solo para mí)',
        etiqueta: 'fiscal',
        permiso: 'fiscal.configurar',
        parametros: { clave: { type: 'string', pattern: '^[a-z0-9_]+$', description: 'Clave del consejo' } },
        cuerpo: v.ocultarConsejoValidator,
        idempotente: true,
        descripcion:
            'Solo inserción en fiscal.consejos_ocultos (auditado); alcance empresa (por defecto) o usuario (el del usuario manda sobre el de la empresa). No toca nada contable. 404 si la clave no está en el catálogo.',
        respuesta: { status: 201, descripcion: 'Estado registrado', esquema: ConsejoOcultado },
        handler: (ctx, { params, cuerpo }) =>
            new OcultarConsejo().execute(
                { ...cuerpo, clave: String(params.clave), oculto: true },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/fiscal/consejos/:clave/mostrar',
        operacion: 'fiscalConsejoMostrar',
        resumen: 'Volver a mostrar un consejo fiscal (empresa o solo para mí)',
        etiqueta: 'fiscal',
        permiso: 'fiscal.configurar',
        parametros: { clave: { type: 'string', pattern: '^[a-z0-9_]+$', description: 'Clave del consejo' } },
        cuerpo: v.ocultarConsejoValidator,
        idempotente: true,
        descripcion:
            'Solo inserción en fiscal.consejos_ocultos (auditado); alcance empresa (por defecto) o usuario (el del usuario manda sobre el de la empresa). No toca nada contable. 404 si la clave no está en el catálogo.',
        respuesta: { status: 201, descripcion: 'Estado registrado', esquema: ConsejoOcultado },
        handler: (ctx, { params, cuerpo }) =>
            new OcultarConsejo().execute(
                { ...cuerpo, clave: String(params.clave), oculto: false },
                ctx.contextoAccion(),
            ),
    }),
]

export default tablero
