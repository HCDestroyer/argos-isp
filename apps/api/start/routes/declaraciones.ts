/*
|--------------------------------------------------------------------------
| Declaraciones (A3, fase 7 PR B; contrato de localización fiscal §9.3, §10.6, §11 y §21)
| Borradores calculados: el sistema nunca presenta nada a la SAT.
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirEmpresaPeticion } from '#billing/empresa'
import db from '@adonisjs/lucid/services/db'
import * as v from '#fiscal/validators'
import { Declaracion, DeclaracionDetalle } from '#fiscal/esquemas'
import { hashActual, listarDeclaraciones, verDeclaracion } from '#fiscal/declaraciones'
import CalcularDeclaracion from '#fiscal/actions/calcular_declaracion'
import RevisarDeclaracion from '#fiscal/actions/revisar_declaracion'
import MarcarDeclaracionPresentada from '#fiscal/actions/marcar_declaracion_presentada'
import RegistrarPagoDeclaracion from '#fiscal/actions/registrar_pago_declaracion'

const ID = { id: { type: 'integer', minimum: 1, description: 'Declaración (una versión)' } }

const declaraciones: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/declaraciones',
        operacion: 'declaracionesListar',
        resumen: 'Declaraciones (todas las versiones), de la más reciente a la más antigua',
        etiqueta: 'fiscal',
        permiso: 'declaraciones.ver',
        query: v.listarDeclaracionesValidator,
        respuesta: { status: 200, descripcion: 'Página de declaraciones', esquema: pagina(Declaracion) },
        handler: (ctx, { query }) =>
            listarDeclaraciones(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/declaraciones/:id',
        operacion: 'declaracionVer',
        resumen: 'Ver una declaración con su detalle y si sus datos cambiaron',
        etiqueta: 'fiscal',
        permiso: 'declaraciones.ver',
        parametros: ID,
        descripcion:
            'desactualizada = el datos_hash recalculado con los datos de hoy es otro: revisar y marcar presentada responden 409 declaracion_desactualizada (calcule otra versión).',
        respuesta: { status: 200, descripcion: 'Declaración', esquema: DeclaracionDetalle },
        handler: async (ctx, { params }) => {
            const d = await verDeclaracion(Number(params.id))
            exigirEmpresaPeticion(ctx.empresa, d.empresa_id)
            const actual = d.estado === 'sustituida' ? d.datos_hash : await hashActual(db.connection(), d)
            return { ...d, desactualizada: actual !== d.datos_hash }
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/declaraciones/calcular',
        operacion: 'declaracionCalcular',
        resumen: 'Calcular el borrador de una declaración (IVA o pequeño contribuyente) del mes',
        etiqueta: 'fiscal',
        permiso: 'declaraciones.calcular',
        cuerpo: v.calcularDeclaracionValidator,
        idempotente: true,
        descripcion:
            'Versión nueva desde el libro de ventas, el de compras y las constancias de retención del mes. 422 antes_de_inicio_libros, obligacion_no_aplica, impuesto_no_soportado, parametro_sin_confirmar; 409 declaracion_revisada / declaracion_presentada sin sustitutiva. Emite declaracion.calculada.',
        respuesta: { status: 201, descripcion: 'Borrador', esquema: Declaracion },
        handler: (ctx, { cuerpo }) => new CalcularDeclaracion().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/declaraciones/:id/revisar',
        operacion: 'declaracionRevisar',
        resumen: 'Revisar el borrador: liquidación obligatoria y bloqueo de impuestos',
        etiqueta: 'fiscal',
        permiso: 'declaraciones.revisar',
        parametros: ID,
        idempotente: true,
        descripcion:
            'Asiento de liquidación (liquidacion_impuesto, diario IMP) con fecha del último día del mes (sustitutiva: la diferencia, con fecha de hoy) y bloqueo impuestos en ese día, en la misma transacción. 409 declaracion_desactualizada, declaracion_sustituida, declaracion_revisada, ncre_sin_certificar; 422 periodo_en_curso, checks_pendientes (iva_cuadrado, iva_liquidado). Emite declaracion.revisada y libro.bloqueo_cambiado.',
        respuesta: { status: 200, descripcion: 'Declaración revisada', esquema: Declaracion },
        handler: (ctx, { params }) =>
            new RevisarDeclaracion().execute({ declaracion_id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/declaraciones/:id/marcar-presentada',
        operacion: 'declaracionMarcarPresentada',
        resumen: 'Registrar lo presentado en la Agencia Virtual (el sistema no envía nada)',
        etiqueta: 'fiscal',
        permiso: 'declaraciones.presentar',
        parametros: ID,
        cuerpo: v.marcarPresentadaValidator,
        idempotente: true,
        descripcion:
            'Sin asiento. 409 declaracion_no_revisada, declaracion_presentada, declaracion_sustituida, declaracion_desactualizada. La obligación pasa a presentada. Emite declaracion.presentada.',
        respuesta: { status: 200, descripcion: 'Declaración presentada', esquema: Declaracion },
        handler: (ctx, { params, cuerpo }) =>
            new MarcarDeclaracionPresentada().execute(
                { declaracion_id: Number(params.id), ...cuerpo },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/declaraciones/:id/registrar-pago',
        operacion: 'declaracionRegistrarPago',
        resumen: 'Registrar el pago de una declaración revisada o presentada',
        etiqueta: 'fiscal',
        permiso: 'declaraciones.pagar',
        parametros: ID,
        cuerpo: v.pagoDeclaracionValidator,
        idempotente: true,
        descripcion:
            'Asiento pago_impuesto: 2.1.06 (o 2.1.09) + 5.4.02 (mora y multa si es tardío) / Caja o Banco. 422 sin_monto_a_pagar; 409 declaracion_pagada, declaracion_no_revisada, declaracion_sustituida. Emite declaracion.pagada.',
        respuesta: { status: 201, descripcion: 'Declaración con su pago', esquema: Declaracion },
        handler: (ctx, { params, cuerpo }) =>
            new RegistrarPagoDeclaracion().execute(
                { declaracion_id: Number(params.id), ...cuerpo },
                ctx.contextoAccion(),
            ),
    }),
]

export default declaraciones
