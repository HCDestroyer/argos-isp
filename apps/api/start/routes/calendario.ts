/*
|--------------------------------------------------------------------------
| Calendario fiscal (A3, fase 7 PR A; contrato de localización fiscal §3.7, §9.3, §11 y §21)
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirEmpresaPeticion } from '#billing/empresa'
import * as v from '#fiscal/validators'
import { FeriadoAgregado, FeriadosFiscales, ObligacionFiscal } from '#fiscal/esquemas'
import { hoyFiscal } from '#fiscal/comun'
import { listarFeriados, listarObligaciones, verObligacion } from '#fiscal/calendario'
import AgregarFeriado from '#fiscal/actions/agregar_feriado'

const calendario: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/obligaciones',
        operacion: 'fiscalObligaciones',
        resumen: 'Calendario fiscal: obligaciones por vencimiento',
        etiqueta: 'fiscal',
        permiso: 'declaraciones.ver',
        query: v.listarObligacionesValidator,
        descripcion:
            'De la empresa activa (o empresas=todas con alcance global), por vence_en ascendente. Las genera el cron fiscal:calendario para todo lo pendiente hasta el periodo en curso, según el régimen y las banderas vigentes en cada periodo; un vencimiento en día inhábil (sábado, domingo o fiscal.feriados) corre al siguiente hábil. dias_restantes y vencida se calculan con la fecha de hoy en Guatemala.',
        respuesta: { status: 200, descripcion: 'Página de obligaciones', esquema: pagina(ObligacionFiscal) },
        handler: (ctx, { query }) =>
            listarObligaciones(query, empresasDeLaLista(ctx.empresa, query.empresas), hoyFiscal()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/obligaciones/:id',
        operacion: 'fiscalObligacion',
        resumen: 'Ver una obligación del calendario fiscal',
        etiqueta: 'fiscal',
        permiso: 'declaraciones.ver',
        respuesta: { status: 200, descripcion: 'Obligación', esquema: ObligacionFiscal },
        handler: async (ctx, { params }) => {
            const obligacion = await verObligacion(Number(params.id), hoyFiscal())
            exigirEmpresaPeticion(ctx.empresa, obligacion.empresa_id)
            return obligacion
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/feriados',
        operacion: 'fiscalFeriados',
        resumen: 'Feriados (días inhábiles para los plazos) de un año',
        etiqueta: 'fiscal',
        permiso: 'fiscal.ver',
        query: v.consultaFeriadosValidator,
        descripcion:
            'Globales. vigentes = fechas inhábiles del año (la última fila de cada fecha, activa); historial = todas las altas y retiros. Sin filas solo son inhábiles sábados y domingos (confirmar con contador).',
        respuesta: { status: 200, descripcion: 'Feriados', esquema: FeriadosFiscales },
        handler: (_ctx, { query }) => listarFeriados(query.anio ?? Number(hoyFiscal().slice(0, 4))),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/fiscal/feriados',
        operacion: 'fiscalAgregarFeriado',
        resumen: 'Agregar o retirar un feriado',
        etiqueta: 'fiscal',
        permiso: 'fiscal.configurar',
        cuerpo: v.agregarFeriadoValidator,
        idempotente: true,
        descripcion:
            'Global: requiere alcance global (403 alcance_global_requerido). Solo inserción; activo = false lo retira. En la misma transacción recalcula el calendario de todas las empresas (vencimientos sin presentar). Emite fiscal.parametros_cambiados (claves [feriados]). 409 feriado_duplicado; 422 feriado_inexistente.',
        respuesta: {
            status: 201,
            descripcion: 'Feriado y recalculo del calendario',
            esquema: FeriadoAgregado,
        },
        handler: (ctx, { cuerpo }) => new AgregarFeriado().execute(cuerpo, ctx.contextoAccion()),
    }),
]

export default calendario
