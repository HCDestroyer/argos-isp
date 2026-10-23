/*
|--------------------------------------------------------------------------
| Declaraciones (A3, fase 7 PR B; contrato de localización fiscal §9.3, §10.6, §11 y §21)
| Borradores calculados: el sistema nunca presenta nada a la SAT.
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirEmpresaPeticion } from '#billing/empresa'
import db from '@adonisjs/lucid/services/db'
import * as v from '#fiscal/validators'
import { AjusteFiscal, Declaracion, DeclaracionDetalle, DeclaracionRevisada } from '#fiscal/esquemas'
import { BancoLibro } from '#ledger/esquemas'
import { listarBancosLibro } from '#ledger/bancos'
import { libroEmpresasValidator } from '#ledger/validators'
import { hashActual, listarDeclaraciones, verDeclaracion } from '#fiscal/declaraciones'
import CalcularDeclaracion from '#fiscal/actions/calcular_declaracion'
import RevisarDeclaracion from '#fiscal/actions/revisar_declaracion'
import MarcarDeclaracionPresentada from '#fiscal/actions/marcar_declaracion_presentada'
import RegistrarPagoDeclaracion from '#fiscal/actions/registrar_pago_declaracion'
import AnularPagoDeclaracion from '#fiscal/actions/anular_pago_declaracion'
import RegistrarAjusteFiscal, { listarAjustes } from '#fiscal/actions/registrar_ajuste_fiscal'

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
        ruta: '/declaraciones/cuentas-pago',
        operacion: 'declaracionesCuentasPago',
        resumen: 'Bancos del libro de los que puede salir el pago de una declaración',
        etiqueta: 'fiscal',
        permiso: 'declaraciones.pagar',
        query: libroEmpresasValidator,
        descripcion:
            'Lo mismo que GET /libro/bancos (su id es el banco_id de registrar-pago con metodo banco) para quien paga declaraciones sin egresos.ver (pedido de A4). El número va enmascarado.',
        respuesta: { status: 200, descripcion: 'Bancos del libro', esquema: lista(BancoLibro) },
        handler: (ctx, { query }) => listarBancosLibro(empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/declaraciones/ajustes',
        operacion: 'declaracionesAjustesListar',
        resumen: 'Ajustes fiscales del ISR de un año (con sus anulaciones)',
        etiqueta: 'fiscal',
        permiso: 'declaraciones.ver',
        query: v.listarAjustesValidator,
        respuesta: { status: 200, descripcion: 'Ajustes del año', esquema: lista(AjusteFiscal) },
        handler: (ctx, { query }) =>
            listarAjustes(
                { anio: query.anio, trimestre: query.trimestre ?? null },
                empresasDeLaLista(ctx.empresa, query.empresas),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/declaraciones/ajustes',
        operacion: 'declaracionesAjustesRegistrar',
        resumen: 'Registrar (o anular con anula_a) un ajuste fiscal del ISR',
        etiqueta: 'fiscal',
        permiso: 'declaraciones.ajustar',
        cuerpo: v.ajusteFiscalValidator,
        idempotente: true,
        descripcion:
            'Lleva el resultado contable a la renta imponible del ISR por cierre parcial (trimestre) o anual (trimestre null): suma o resta. Solo inserción; anula_a anula un ajuste (409 ajuste_anulado si ya lo estaba). 409 ejercicio_cerrado en un ajuste anual de un año cerrado. El borrador del periodo queda desactualizado.',
        respuesta: { status: 201, descripcion: 'Ajuste registrado', esquema: AjusteFiscal },
        handler: (ctx, { cuerpo }) => new RegistrarAjusteFiscal().execute(cuerpo, ctx.contextoAccion()),
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
        resumen: 'Calcular el borrador de una declaración del periodo (IVA, PC, ISR, ISO o retenciones)',
        etiqueta: 'fiscal',
        permiso: 'declaraciones.calcular',
        cuerpo: v.calcularDeclaracionValidator,
        idempotente: true,
        descripcion:
            'Versión nueva desde los documentos y el libro del periodo (AAAA-MM, AAAA-Tn o AAAA según el impuesto). 422 periodo, antes_de_inicio_libros, obligacion_no_aplica, parametro_sin_confirmar, regla_no_soportada (iso_acreditamiento isr_a_iso, iso_base_periodo distinto de anio_anterior, iso_exencion_inicio); 409 declaracion_revisada / declaracion_presentada sin sustitutiva, ejercicio_cerrado (ISR anual de un año cerrado). Emite declaracion.calculada.',
        respuesta: { status: 201, descripcion: 'Borrador', esquema: Declaracion },
        handler: (ctx, { cuerpo }) => new CalcularDeclaracion().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/declaraciones/:id/revisar',
        operacion: 'declaracionRevisar',
        resumen:
            'Revisar el borrador: liquidación obligatoria (y bloqueo de impuestos en IVA, PC y retenciones)',
        etiqueta: 'fiscal',
        permiso: 'declaraciones.revisar',
        parametros: ID,
        idempotente: true,
        descripcion:
            'Asiento de liquidación (liquidacion_impuesto, diario IMP) con fecha del último día del periodo (sustitutiva: la diferencia, con fecha de hoy): IVA 2.1.02 / 1.1.04 + 1.1.05 + 2.1.06; PC 5.3.04 / 2.1.09; ISR opcional 5.5.01 / 1.1.06 + 2.1.07; ISR trimestral 1.1.07 / 2.1.07 + 1.1.08; ISO 1.1.08 / 2.1.08; ISR anual y retenciones sin asiento. Bloqueo impuestos al último día en IVA, PC y retenciones. 409 declaracion_desactualizada, declaracion_sustituida, declaracion_revisada, ncre_sin_certificar, ejercicio_cerrado (ISR anual), iso_sin_saldo; 422 periodo_en_curso, checks_pendientes (iva_cuadrado, iva_liquidado, retenciones_cuadradas). IVA y PC: si cambia el remanente que deja, rectifica en la misma transacción cada mes posterior ya revisado (cascada[]; 409 cascada_bloqueada si uno no se puede). Emite declaracion.revisada (motivo cascada en los rectificados) y libro.bloqueo_cambiado.',
        respuesta: {
            status: 200,
            descripcion: 'Declaración revisada y los meses rectificados en cascada',
            esquema: DeclaracionRevisada,
        },
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
            'Asiento pago_impuesto: la cuenta por pagar del impuesto (2.1.06 IVA, 2.1.09 PC, 2.1.07 ISR, 2.1.08 ISO, 2.1.04 / 2.1.05 retenciones) + 5.4.02 (mora y multa si es tardío) / Caja o Banco (bancos: GET /declaraciones/cuentas-pago). 422 sin_monto_a_pagar; 409 declaracion_pagada (ya tiene un pago vigente), declaracion_no_revisada, declaracion_sustituida. Emite declaracion.pagada.',
        respuesta: { status: 201, descripcion: 'Declaración con su pago', esquema: Declaracion },
        handler: (ctx, { params, cuerpo }) =>
            new RegistrarPagoDeclaracion().execute(
                { declaracion_id: Number(params.id), ...cuerpo },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/declaraciones/:id/anular-pago',
        operacion: 'declaracionAnularPago',
        resumen: 'Anular el pago vigente de una declaración (reverso de su asiento)',
        etiqueta: 'fiscal',
        permiso: 'declaraciones.anular_pago',
        parametros: ID,
        cuerpo: v.anularPagoDeclaracionValidator,
        idempotente: true,
        descripcion:
            'Revierte el asiento pago_impuesto (fecha de hoy o la indicada, no anterior al pago) y guarda la anulación (solo inserción): el pago pasa a pagos_anulados y se puede registrar otro. 409 declaracion_sin_pago. Emite declaracion.pago_anulado.',
        respuesta: { status: 200, descripcion: 'Declaración sin el pago anulado', esquema: Declaracion },
        handler: (ctx, { params, cuerpo }) =>
            new AnularPagoDeclaracion().execute(
                { declaracion_id: Number(params.id), ...cuerpo },
                ctx.contextoAccion(),
            ),
    }),
]

export default declaraciones
