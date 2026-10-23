/*
|--------------------------------------------------------------------------
| Tablero fiscal (A3, fase 8 PR A; contrato de localización fiscal §9.4 y §22)
| Solo lectura: no cambia el régimen ni presenta nada.
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import * as v from '#fiscal/validators'
import { TableroFiscal } from '#fiscal/esquemas_tablero'
import { tableroFiscal } from '#fiscal/tablero'

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
]

export default tablero
