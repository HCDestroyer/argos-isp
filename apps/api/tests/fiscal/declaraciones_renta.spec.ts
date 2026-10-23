import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Usuario from '#core/models/usuario'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { errorDe, saldoCuenta, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { hacerAgenteRetencion, partidas, proveedorEn } from '#tests/ledger/ayudas_compras'
import { eventos, esquemas, exigirCampos } from '#tests/fiscal/ayudas_fiscal'
import { afirmarLibroPrC } from '#tests/fiscal/ayudas_renta'
import { relojFiscal } from '#fiscal/comun'
import { bloqueoVigente } from '#ledger/bloqueos'
import { checksVigentes } from '#ledger/checks'
import { calcularDatos } from '#fiscal/declaraciones'
import { isoPorVencer } from '#fiscal/declaraciones_renta'
import EditarParametro from '#fiscal/actions/editar_parametro'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import CalcularDeclaracion from '#fiscal/actions/calcular_declaracion'
import RevisarDeclaracion from '#fiscal/actions/revisar_declaracion'
import RegistrarPagoDeclaracion from '#fiscal/actions/registrar_pago_declaracion'
import AnularPagoDeclaracion from '#fiscal/actions/anular_pago_declaracion'
import RegistrarAjusteFiscal from '#fiscal/actions/registrar_ajuste_fiscal'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import CerrarEjercicio from '#ledger/actions/cerrar_ejercicio'
import ReabrirEjercicio from '#ledger/actions/reabrir_ejercicio'
import RegistrarPago from '#billing/actions/registrar_pago'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Fase 7 · PR C (contrato de localización fiscal §9.1, §9.3, §10.6 y §21): ISR opcional mensual,
 * ISR trimestral (renta presunta y cierre parcial con ajustes fiscales), ISO con
 * `fiscal.iso_acreditamientos`, ISR anual enlazado al cierre anual (y el ISO vencido a `5.3.03`),
 * declaraciones de retenciones y la anulación del pago de una declaración. Cada prueba termina en
 * `afirmarLibroPrC` (los invariantes del auditor, con la tolerancia temporal de `ayudas_renta.ts`).
 */

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
const MES = HOY.slice(0, 7)
const FIN = DateTime.fromISO(`${MES}-01`).endOf('month').toISODate()!
const SIGUIENTE = DateTime.fromISO(`${MES}-01`).plus({ months: 1 }).toFormat('yyyy-MM')
const TRIMESTRE = Math.floor((Number(MES.slice(5, 7)) - 1) / 3) + 1
const INICIO_TRIMESTRE = `${MES.slice(0, 4)}-${String(TRIMESTRE * 3 - 2).padStart(2, '0')}-01`

async function parametro(ctx: ContextoAccion, empresaId: number, clave: string, valor: unknown) {
    await new EditarParametro().execute(
        {
            empresa_id: empresaId,
            clave,
            valor,
            vigente_desde: '2014-01-01',
            motivo: `Prueba de la fase 7 PR C (${clave})`,
        },
        ctx,
    )
}

const inicioLibros = (ctx: ContextoAccion, empresaId: number, fecha: string) =>
    parametro(ctx, empresaId, 'inicio_libros', fecha)

function asiento(
    ctx: ContextoAccion,
    empresaId: number,
    fecha: string,
    debe: string,
    haber: string,
    monto: string,
) {
    return new RegistrarAsiento().execute(
        {
            empresa_id: empresaId,
            fecha,
            descripcion: 'Movimiento de prueba (ISR e ISO)',
            origen_tipo: 'ajuste',
            movimientos: [
                { cuenta: debe, debe: monto },
                { cuenta: haber, haber: monto },
            ],
        },
        ctx,
    )
}

async function cerrarMeses(ctx: ContextoAccion, empresaId: number, anio: number) {
    for (let mes = 1; mes <= 11; mes++) {
        await new CerrarPeriodo().execute({ empresa_id: empresaId, anio, mes }, ctx)
    }
}

const calcular = (
    ctx: ContextoAccion,
    empresaId: number,
    impuesto: string,
    periodo: string,
    extra: Record<string, unknown> = {},
) =>
    new CalcularDeclaracion().execute(
        { empresa_id: empresaId, impuesto: impuesto as any, periodo, ...extra },
        ctx,
    )

const revisar = (ctx: ContextoAccion, id: number) =>
    new RevisarDeclaracion().execute({ declaracion_id: id }, ctx)

function venta(empresaId: number, precio: string) {
    return servicioFacturado(empresaId, `${MES}-01`, { precio, instalacion: `${MES}-01` })
}

async function fechaAsiento(id: number) {
    const fila = (await db
        .from('ledger.asientos')
        .where('id', id)
        .select(db.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`))
        .firstOrFail()) as { fecha: string }
    return fila.fecha
}

async function filasIso(empresaId: number) {
    const filas = (await db
        .from('fiscal.iso_acreditamientos')
        .where('empresa_id', empresaId)
        .orderBy('id', 'asc')
        .select(
            'tipo',
            db.raw(`to_char(iso_periodo, 'YYYY-MM-DD') as iso_periodo`),
            db.raw('monto::text as monto'),
            db.raw(`to_char(acreditable_desde, 'YYYY-MM-DD') as desde`),
            db.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence`),
        )) as Array<{ tipo: string; iso_periodo: string; monto: string; desde: string; vence: string }>
    return filas.map((f) => [f.tipo, f.iso_periodo, f.monto, f.desde, f.vence])
}

/** Usuario con un rol a la medida que solo tiene estos permisos. */
async function tokenConPermisos(permisos: string[]): Promise<string> {
    const [rol] = (await db
        .table('core.roles')
        .insert({ nombre: unico('rol'), descripcion: 'a la medida' })
        .returning('id')) as Array<{ id: number }>
    const filas = (await db.from('core.permisos').whereIn('nombre', permisos).select('id')) as Array<{
        id: number
    }>
    await db
        .table('core.roles_permisos')
        .multiInsert(filas.map((p) => ({ role_id: rol!.id, permiso_id: p.id })))
    const usuario = await Usuario.create({
        nombre: unico('Usuario'),
        email: `${unico('u')}@prueba.local`,
        password: 'clave-de-prueba',
        activo: true,
    })
    await db.table('core.usuarios_roles').insert({ usuario_id: usuario.id, role_id: rol!.id })
    const token = await Usuario.accessTokens.create(usuario)
    return token.value!.release()
}

test.group('Fase 7 · ISR opcional, retenciones y anulación del pago', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('ISR opcional: los dos cálculos, liquidación 5.5.01 / 1.1.06 + 2.1.07 sin bloqueo; el pago se anula y se registra otro', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await new CambiarRegimen().execute(
            {
                empresa_id: e.B,
                regimen: 'opcional_simplificado',
                vigente_desde: '2014-01-01',
                motivo: 'Inscripción',
            },
            e.ctx,
        )
        await inicioLibros(e.ctx, e.B, '2026-01-01')
        const s = await venta(e.B, '224.00')
        await venta(e.B, '224.00')
        // un cliente retiene el 7 % de su base (200.00)
        await new RegistrarPago().execute(
            {
                cliente_id: s.clienteId,
                metodo: 'caja',
                monto: '210.00',
                caja_id: e.cajas.get(e.B)!,
                empresa_id: e.B,
                retenciones: [{ codigo: 'RET_ISR_OPC', numero: unico('ct'), monto: '14.00' }],
            },
            e.ctx,
        )

        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const d = await calcular(e.ctx, e.B, 'isr_opcional_mensual', MES)
        assert.include(d.totales, {
            base: '400.00',
            retenciones: '14.00',
            base_retenida: '200.00',
            base_no_retenida: '200.00',
            isr_art44: '20.00',
            isr_art46: '28.00',
            isr: '28.00',
            retenciones_usadas: '14.00',
            a_pagar: '14.00',
        })
        assert.equal(d.formulario, 'SAT-1311')
        assert.includeMembers(
            d.parametros.map((p) => p.clave),
            [
                'isr_opcional_tramos',
                'isr_opcional_directo',
                'isr_opcional_no_retenido',
                'impuesto:RET_ISR_OPC',
            ],
        )
        assert.isAbove(d.detalle.notas!.length, 0)
        assert.sameMembers([...new Set(d.detalle.renglones.map((r) => r.seccion))], ['ventas', 'retenciones'])

        const revisada = await revisar(e.ctx, d.id)
        assert.equal(revisada.estado, 'revisada')
        assert.sameDeepMembers(await partidas('liquidacion_impuesto', d.id), [
            ['5.5.01', '28.00', '0.00', null],
            ['1.1.06', '0.00', '14.00', null],
            ['2.1.07', '0.00', '14.00', null],
        ])
        assert.equal(await fechaAsiento(revisada.asiento_id!), FIN)
        // el ISR no fija el bloqueo de impuestos (lo fijan IVA, pequeño contribuyente y retenciones)
        assert.isNull(await bloqueoVigente(db.connection(), e.B, 'impuestos'))
        assert.equal(await saldoCuenta(e.B, '1.1.06'), '0.00')

        const pagada = await new RegistrarPagoDeclaracion().execute(
            {
                declaracion_id: d.id,
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                fecha: `${SIGUIENTE}-05`,
            },
            e.ctx,
        )
        assert.include(pagada.pago, { impuesto: '14.00', total: '14.00' })
        assert.equal(await saldoCuenta(e.B, '2.1.07'), '0.00')
        const primerPago = pagada.pago!

        // el reverso directo sigue rechazado; la anulación es la acción propia
        const directo = await errorDe(
            new RevertirAsiento().execute({ asiento_id: primerPago.asiento_id, motivo: 'error' }, e.ctx),
        )
        assert.deepEqual([directo.status, directo.codigo], [409, 'asiento_de_declaracion'])
        const corto = await errorDe(
            new AnularPagoDeclaracion().execute({ declaracion_id: d.id, motivo: 'x' }, e.ctx),
        )
        assert.deepEqual([corto.status, corto.reglas], [422, ['minLength']])

        const anulada = await new AnularPagoDeclaracion().execute(
            { declaracion_id: d.id, motivo: 'Salió de otra cuenta' },
            e.ctx,
        )
        assert.isNull(anulada.pago)
        assert.lengthOf(anulada.pagos_anulados, 1)
        assert.include(anulada.pagos_anulados[0]!, { id: primerPago.id, total: '14.00' })
        assert.equal(anulada.pagos_anulados[0]!.anulacion.motivo, 'Salió de otra cuenta')
        assert.equal(await saldoCuenta(e.B, '2.1.07'), '-14.00')
        const reverso = await db
            .from('ledger.asientos')
            .where('reversa_de', primerPago.asiento_id)
            .select('id', 'origen_tipo')
            .firstOrFail()
        assert.deepEqual(
            [reverso.origen_tipo, Number(reverso.id)],
            ['pago_impuesto', anulada.pagos_anulados[0]!.anulacion.asiento_id],
        )
        const evento = await eventos('declaracion.pago_anulado', 'declaracion_id', d.id)
        assert.lengthOf(evento, 1)
        assert.include(evento[0]!, { monto: '14.00', pago_id: primerPago.id, motivo: 'Salió de otra cuenta' })
        const otraVez = await errorDe(
            new AnularPagoDeclaracion().execute({ declaracion_id: d.id, motivo: 'De nuevo' }, e.ctx),
        )
        assert.deepEqual([otraVez.status, otraVez.codigo], [409, 'declaracion_sin_pago'])

        // anulado, se registra otro pago por el mismo monto (lo anulado no cuenta como pagado)
        const segundo = await new RegistrarPagoDeclaracion().execute(
            { declaracion_id: d.id, metodo: 'caja', caja_id: e.cajas.get(e.B)!, fecha: `${SIGUIENTE}-05` },
            e.ctx,
        )
        assert.include(segundo.pago, { impuesto: '14.00' })
        assert.notEqual(segundo.pago!.id, primerPago.id)
        assert.lengthOf(segundo.pagos_anulados, 1)
        assert.equal(await saldoCuenta(e.B, '2.1.07'), '0.00')
        const repetido = await errorDe(
            new RegistrarPagoDeclaracion().execute(
                {
                    declaracion_id: d.id,
                    metodo: 'caja',
                    caja_id: e.cajas.get(e.B)!,
                    fecha: `${SIGUIENTE}-05`,
                },
                e.ctx,
            ),
        )
        assert.equal(repetido.codigo, 'declaracion_pagada')
        await afirmarLibroPrC(assert, [e.B, e.C])
    })

    test('retenciones de IVA (SAT-2340) e ISR desde las compras: sin asiento, bloqueo y check; el pago sale de 2.1.04', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await hacerAgenteRetencion(e.B, e.ctx)
        await inicioLibros(e.ctx, e.B, '2026-01-01')
        const opcional = await proveedorEn(e.B, e.ctx, { regimen_isr: 'opcional_simplificado' })
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: opcional.id,
                tipo_documento: 'FACT',
                numero: unico('R'),
                fecha_documento: HOY,
                condicion: 'credito',
                lineas: [{ descripcion: 'Mantenimiento de red', total: '3360.00' }],
            },
            e.ctx,
        )
        assert.lengthOf(compra.retenciones, 2)

        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const iva = await calcular(e.ctx, e.B, 'retenciones_iva', MES)
        assert.include(iva.totales, { base: '360.00', retenido: '54.00', a_pagar: '54.00' })
        assert.equal(iva.formulario, 'SAT-2340')
        assert.deepEqual(
            iva.detalle.renglones.map((r) => [r.seccion, r.tipo, r.iva, r.estado]),
            [['retenciones', 'RET_IVA_ESP_C', '54.00', 'registro']],
        )
        const isr = await calcular(e.ctx, e.B, 'retenciones_isr', MES)
        assert.include(isr.totales, { base: '3000.00', retenido: '210.00', a_pagar: '210.00' })

        const revisadaIva = await revisar(e.ctx, iva.id)
        assert.isNull(revisadaIva.asiento_id)
        assert.lengthOf(await partidas('liquidacion_impuesto', iva.id), 0)
        assert.equal(await bloqueoVigente(db.connection(), e.B, 'impuestos'), FIN)
        const checks = await checksVigentes(db.connection(), e.B, 'impuestos', `${MES}-01`)
        const retenciones = checks.find((c) => c.clave === 'retenciones_cuadradas')!
        assert.deepEqual(
            JSON.stringify([retenciones.resultado, retenciones.esperado, retenciones.obtenido]),
            JSON.stringify([
                'ok',
                'RET_ISR_EMI 210.00 · RET_IVA_EMI 54.00',
                'RET_ISR_EMI 210.00 · RET_IVA_EMI 54.00',
            ]),
        )
        await revisar(e.ctx, isr.id)

        // bajo el bloqueo, una retención etiquetada nueva del mes ya no entra
        const tardia = await errorDe(
            new RegistrarAsiento().execute(
                {
                    empresa_id: e.B,
                    fecha: HOY,
                    descripcion: 'Retención tardía',
                    origen_tipo: 'ajuste',
                    movimientos: [
                        { cuenta: '2.1.03', debe: '5.00', proveedor_id: opcional.id },
                        {
                            cuenta: '2.1.04',
                            haber: '5.00',
                            impuesto_codigo: 'RET_IVA_ESP_C',
                            cuadricula: '+RET_IVA_EMI',
                        },
                    ],
                },
                e.ctx,
            ),
        )
        assert.deepEqual([tardia.codigo, tardia.reglas], ['periodo_bloqueado', ['impuestos']])

        const pagada = await new RegistrarPagoDeclaracion().execute(
            {
                declaracion_id: iva.id,
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                fecha: `${SIGUIENTE}-05`,
            },
            e.ctx,
        )
        assert.include(pagada.pago, { impuesto: '54.00', total: '54.00' })
        const pagoRetenciones = await partidas('pago_impuesto', iva.id)
        assert.deepEqual(pagoRetenciones.map((p) => [p[0], p[1], p[2]])[0], ['2.1.04', '54.00', '0.00'])
        assert.equal(await saldoCuenta(e.B, '2.1.04'), '0.00')
        await afirmarLibroPrC(assert, [e.B, e.C])
    })

    test('periodos por periodicidad, renta presunta del trimestre y reglas del ISO sin confirmar', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await inicioLibros(e.ctx, e.B, '2026-01-01')
        await venta(e.B, '224.00')

        const formato = await errorDe(calcular(e.ctx, e.B, 'isr_trimestral', MES))
        assert.deepEqual([formato.status, formato.reglas], [422, ['periodo']])
        const anual = await errorDe(calcular(e.ctx, e.B, 'isr_anual', `${MES.slice(0, 4)}-T1`))
        assert.deepEqual([anual.status, anual.reglas], [422, ['periodo']])

        // renta presunta: 8 % de las ventas gravadas (200.00) × 25 % = 4.00
        const presunta = await calcularDatos(db.connection(), e.B, 'isr_trimestral', INICIO_TRIMESTRE)
        assert.include(presunta.totales, {
            ingresos: '200.00',
            renta_imponible: '16.00',
            isr: '4.00',
            iso_acreditado: '0.00',
            a_pagar: '4.00',
        })
        assert.includeMembers(
            presunta.parametros.map((p) => p.clave),
            ['isr_trimestral_metodo', 'isr_trimestral_presunta', 'isr_utilidades_tasa', 'iso_acreditamiento'],
        )
        const periodoTrimestre = `${MES.slice(0, 4)}-T${TRIMESTRE}`
        if (TRIMESTRE === 4) {
            // el 4.º trimestre va con la anual: no es obligación propia
            const cuarto = await errorDe(calcular(e.ctx, e.B, 'isr_trimestral', periodoTrimestre))
            assert.equal(cuarto.codigo, 'obligacion_no_aplica')
        }

        // ISO: sin iso_base_periodo, 422 por confirmar; otro valor, regla no soportada
        const sinBase = await errorDe(calcular(e.ctx, e.B, 'iso_trimestral', periodoTrimestre))
        assert.deepEqual(
            [sinBase.codigo, sinBase.reglas],
            ['parametro_sin_confirmar', ['parametro_sin_confirmar']],
        )
        await parametro(e.ctx, e.B, 'iso_base_periodo', 'trimestre_anterior')
        const otraBase = await errorDe(calcular(e.ctx, e.B, 'iso_trimestral', periodoTrimestre))
        assert.equal(otraBase.codigo, 'regla_no_soportada')
        await new EditarParametro().execute(
            {
                empresa_id: e.B,
                clave: 'iso_base_periodo',
                valor: 'anio_anterior',
                vigente_desde: '2015-01-01',
                motivo: 'Confirmado por el contador',
            },
            e.ctx,
        )
        const iso = await calcular(e.ctx, e.B, 'iso_trimestral', periodoTrimestre)
        assert.include(iso.totales, { ingresos_brutos: '0.00', impuesto: '0.00', a_pagar: '0.00' })
        assert.equal(iso.formulario, 'SAT-1608')
        await parametro(e.ctx, e.B, 'iso_acreditamiento', 'isr_a_iso')
        const otroModo = await errorDe(calcular(e.ctx, e.B, 'iso_trimestral', periodoTrimestre))
        assert.deepEqual([otroModo.codigo, otroModo.reglas], ['regla_no_soportada', ['regla_no_soportada']])
        await afirmarLibroPrC(assert, [e.B, e.C])
    })
})

test.group('Fase 7 · ISO, ISR trimestral y anual con el cierre anual', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())
    group.each.timeout(240_000)

    test('ISO 2022 acredita al ISR 2023 (trimestral y anual); el cierre 2023 toma el ISR de la declaración y el de 2025 pasa el ISO vencido a 5.3.03', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await inicioLibros(e.ctx, e.B, '2021-01-01')
        await parametro(e.ctx, e.B, 'iso_base_periodo', 'anio_anterior')
        await parametro(e.ctx, e.B, 'isr_trimestral_metodo', 'cierre_parcial')
        const banco = '1.1.02.01'

        // 2021: capital, ingresos y gastos; ejercicio cerrado sin ISR
        await asiento(e.ctx, e.B, '2021-01-04', banco, '3.1.01', '120000.00')
        await asiento(e.ctx, e.B, '2021-03-10', banco, '4.1.01', '8000.00')
        await asiento(e.ctx, e.B, '2021-05-20', '5.2.99', banco, '2000.00')
        await cerrarMeses(e.ctx, e.B, 2021)
        await new CerrarEjercicio().execute({ empresa_id: e.B, anio: 2021, isr: { monto: '0.00' } }, e.ctx)

        // ISO 2022-T1: la mayor entre ¼ del activo neto (126000) y ¼ de los ingresos (8000), al 1 %
        const iso = await calcular(e.ctx, e.B, 'iso_trimestral', '2022-T1')
        assert.include(iso.totales, {
            activo_neto: '126000.00',
            ingresos_brutos: '8000.00',
            margen_bruto: '100.00',
            base_activo: '31500.00',
            base_ingresos: '2000.00',
            base: '31500.00',
            impuesto: '315.00',
            a_pagar: '315.00',
        })
        assert.deepEqual(
            [iso.periodo_desde, iso.periodo_hasta, iso.formulario],
            ['2022-01-01', '2022-03-31', 'SAT-1608'],
        )
        const isoRevisado = await revisar(e.ctx, iso.id)
        assert.sameDeepMembers(await partidas('liquidacion_impuesto', iso.id), [
            ['1.1.08', '315.00', '0.00', null],
            ['2.1.08', '0.00', '315.00', null],
        ])
        assert.equal(await fechaAsiento(isoRevisado.asiento_id!), '2022-03-31')
        assert.deepEqual(
            JSON.stringify(await filasIso(e.B)),
            JSON.stringify([['origen', '2022-01-01', '315.00', '2023-01-01', '2025-12-31']]),
        )

        // 2023-T1 por cierre parcial: 1000 − 420 + 20 (no deducible) − 100 (ajuste) = 500 × 25 % = 125
        await asiento(e.ctx, e.B, '2023-02-10', banco, '4.1.01', '1000.00')
        await asiento(e.ctx, e.B, '2023-02-15', '5.2.99', banco, '400.00')
        await asiento(e.ctx, e.B, '2023-03-01', '5.4.02', banco, '20.00')
        const ajuste = await new RegistrarAjusteFiscal().execute(
            {
                empresa_id: e.B,
                anio: 2023,
                trimestre: 1,
                efecto: 'resta',
                concepto: 'Renta exenta',
                monto: '100.00',
            },
            e.ctx,
        )
        // un ajuste anual registrado y anulado no cuenta
        const anual50 = await new RegistrarAjusteFiscal().execute(
            { empresa_id: e.B, anio: 2023, efecto: 'suma', concepto: 'Por error', monto: '50.00' },
            e.ctx,
        )
        const anulacion = await new RegistrarAjusteFiscal().execute(
            { anula_a: anual50.id, concepto: 'Registrado por error' },
            e.ctx,
        )
        assert.deepEqual(
            [anulacion.anula_a, anulacion.efecto, anulacion.monto, anulacion.trimestre],
            [anual50.id, 'suma', '50.00', null],
        )
        const dos = await errorDe(
            new RegistrarAjusteFiscal().execute({ anula_a: anual50.id, concepto: 'Otra vez' }, e.ctx),
        )
        assert.equal(dos.codigo, 'ajuste_anulado')

        const t1 = await calcular(e.ctx, e.B, 'isr_trimestral', '2023-T1')
        assert.include(t1.totales, {
            ingresos: '1000.00',
            gastos: '420.00',
            no_deducibles: '20.00',
            ajustes_suma: '0.00',
            ajustes_resta: '100.00',
            renta_imponible: '500.00',
            isr: '125.00',
            iso_disponible: '315.00',
            iso_acreditado: '125.00',
            a_pagar: '0.00',
        })
        assert.equal(t1.formulario, 'SAT-1361')
        assert.include(
            t1.detalle.calculo!.map((r) => r.documento),
            `Ajuste ${ajuste.id}: Renta exenta`,
        )
        await revisar(e.ctx, t1.id)
        assert.sameDeepMembers(await partidas('liquidacion_impuesto', t1.id), [
            ['1.1.07', '125.00', '0.00', null],
            ['1.1.08', '0.00', '125.00', null],
        ])

        // ISR anual 2023: 600 × 25 % = 150; los pagos trimestrales (125) y el ISO (25) lo cubren
        const anual = await calcular(e.ctx, e.B, 'isr_anual', '2023')
        assert.include(anual.totales, {
            renta_imponible: '600.00',
            isr: '150.00',
            pagos_trimestrales: '125.00',
            trimestral_acreditado: '125.00',
            iso_disponible: '190.00',
            iso_acreditado: '25.00',
            iso_por_vencer: '0.00',
            a_pagar: '0.00',
        })
        assert.equal(anual.formulario, 'SAT-1411')
        await cerrarMeses(e.ctx, e.B, 2023)
        // con la anual, el ISR no se escribe a mano; y debe estar revisada
        const manual = await errorDe(
            new CerrarEjercicio().execute({ empresa_id: e.B, anio: 2023, isr: { monto: '150.00' } }, e.ctx),
        )
        assert.deepEqual([manual.status, manual.codigo], [422, 'isr_de_declaracion'])
        const sinRevisar = await errorDe(
            new CerrarEjercicio().execute({ empresa_id: e.B, anio: 2023 }, e.ctx),
        )
        assert.deepEqual([sinRevisar.status, sinRevisar.codigo], [422, 'declaracion_sin_revisar'])
        const anualRevisada = await revisar(e.ctx, anual.id)
        assert.isNull(anualRevisada.asiento_id)
        const filasTrasAnual = await filasIso(e.B)
        assert.deepEqual(
            filasTrasAnual.map((f) => [f[0], f[2]]),
            [
                ['origen', '315.00'],
                ['acreditado', '125.00'],
                ['acreditado', '25.00'],
            ],
        )

        const cierre2023 = await new CerrarEjercicio().execute({ empresa_id: e.B, anio: 2023 }, e.ctx)
        assert.deepEqual(
            [
                cierre2023.isr,
                cierre2023.isr_acreditado_trimestral,
                cierre2023.isr_acreditado_iso,
                cierre2023.resultado_antes_isr,
            ],
            ['150.00', '125.00', '25.00', '580.00'],
        )
        assert.equal(await saldoCuenta(e.B, '1.1.07'), '0.00')
        const sustitutiva = await errorDe(calcular(e.ctx, e.B, 'isr_anual', '2023', { sustitutiva: true }))
        assert.deepEqual([sustitutiva.status, sustitutiva.codigo], [409, 'ejercicio_cerrado'])

        // el ISO de 2022 se acredita en 2023, 2024 y 2025: en el cierre 2024 todavía no vence
        assert.lengthOf(await isoPorVencer(db.connection(), e.B, 2024), 0)
        // 2025: vence el 31-dic; lo no acreditado (165) pasa a 5.3.03 en el cierre
        const porVencer = await isoPorVencer(db.connection(), e.B, 2025)
        assert.deepEqual(
            porVencer.map((v) => [v.iso_periodo, v.saldo.toFixed(2)]),
            [['2022-01-01', '165.00']],
        )
        await cerrarMeses(e.ctx, e.B, 2025)
        const cierre2025 = await new CerrarEjercicio().execute(
            { empresa_id: e.B, anio: 2025, isr: { monto: '0.00' } },
            e.ctx,
        )
        assert.equal(cierre2025.resultado_antes_isr, '-165.00')
        const asientosCierre = await partidas('cierre_anual', cierre2025.id)
        assert.includeDeepMembers(asientosCierre, [
            ['5.3.03', '165.00', '0.00', null],
            ['1.1.08', '0.00', '165.00', null],
        ])
        assert.equal(await saldoCuenta(e.B, '1.1.08'), '0.00')
        const filasTrasCierre = await filasIso(e.B)
        assert.deepEqual(filasTrasCierre.at(-1), [
            'vencido',
            '2022-01-01',
            '165.00',
            '2023-01-01',
            '2025-12-31',
        ])
        assert.lengthOf(await isoPorVencer(db.connection(), e.B, 2025), 0)

        // reabrir 2025 revierte la baja: el ISO vuelve a estar por vencer
        await new ReabrirEjercicio().execute(
            { empresa_id: e.B, anio: 2025, motivo: 'Revisión del contador' },
            e.ctx,
        )
        const reabierto = await isoPorVencer(db.connection(), e.B, 2025)
        assert.deepEqual(
            reabierto.map((v) => v.saldo.toFixed(2)),
            ['165.00'],
        )
        assert.equal(await saldoCuenta(e.B, '1.1.08'), '165.00')
        await afirmarLibroPrC(assert, [e.B, e.C])
    })
})

test.group('Fase 7 · PR C por la API', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('anular-pago, ajustes y cuentas-pago con su esquema y permisos; nombres en Declaracion; regla obligatoria', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        await inicioLibros(e.ctx, e.B, '2026-01-01')
        await venta(e.B, '224.00')
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const s = await esquemas()

        // quien paga declaraciones lista los bancos sin egresos.ver
        const pagador = await tokenConPermisos(['declaraciones.pagar'])
        const bancos = await estado(
            client.get('/api/v1/declaraciones/cuentas-pago').bearerToken(pagador).headers(cabecera),
            200,
        )
        const delLibro = await estado(
            client.get('/api/v1/libro/bancos').bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.deepEqual(bancos.body(), delLibro.body())
        for (const b of bancos.body()) exigirCampos(assert, s.BancoLibro!, b, 'BancoLibro')
        await estado(client.get('/api/v1/libro/bancos').bearerToken(pagador).headers(cabecera), 403)
        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client.get('/api/v1/declaraciones/cuentas-pago').bearerToken(cajero.token).headers(cabecera),
            403,
        )

        const creada = await estado(
            client
                .post('/api/v1/declaraciones/calcular')
                .bearerToken(e.token)
                .headers({ ...cabecera, 'Idempotency-Key': unico('decl') })
                .json({ impuesto: 'iva_mensual', periodo: MES }),
            201,
        )
        const id = creada.body().id
        exigirCampos(assert, s.Declaracion!, creada.body(), 'Declaracion')
        assert.isString(creada.body().calculada_por_nombre)
        assert.deepEqual(creada.body().pagos_anulados, [])
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const revisada = await estado(
            client
                .post(`/api/v1/declaraciones/${id}/revisar`)
                .bearerToken(e.token)
                .headers({ ...cabecera, 'Idempotency-Key': unico('rev') }),
            200,
        )
        assert.isString(revisada.body().revisada_por_nombre)
        await estado(
            client
                .post(`/api/v1/declaraciones/${id}/registrar-pago`)
                .bearerToken(e.token)
                .headers({ ...cabecera, 'Idempotency-Key': unico('pago') })
                .json({
                    metodo: 'cuenta_bancaria',
                    cuenta_bancaria_id: e.cuentas.get(e.B)!,
                    fecha: `${SIGUIENTE}-05`,
                }),
            201,
        )
        await estado(
            client
                .post(`/api/v1/declaraciones/${id}/anular-pago`)
                .bearerToken(pagador)
                .headers({ ...cabecera, 'Idempotency-Key': unico('anu') })
                .json({ motivo: 'Sin permiso' }),
            403,
        )
        const anulada = await estado(
            client
                .post(`/api/v1/declaraciones/${id}/anular-pago`)
                .bearerToken(e.token)
                .headers({ ...cabecera, 'Idempotency-Key': unico('anu') })
                .json({ motivo: 'Boleta equivocada' }),
            200,
        )
        exigirCampos(assert, s.Declaracion!, anulada.body(), 'Declaracion')
        assert.isNull(anulada.body().pago)
        exigirCampos(
            assert,
            s.PagoDeclaracionAnulado!,
            anulada.body().pagos_anulados[0],
            'PagoDeclaracionAnulado',
        )
        assert.isString(anulada.body().pagos_anulados[0].anulacion.anulado_por_nombre)

        // ajustes fiscales
        const ajuste = await estado(
            client
                .post('/api/v1/declaraciones/ajustes')
                .bearerToken(e.token)
                .headers({ ...cabecera, 'Idempotency-Key': unico('aj') })
                .json({
                    anio: 2026,
                    trimestre: 3,
                    efecto: 'suma',
                    concepto: 'Gasto sin factura',
                    monto: '10.00',
                }),
            201,
        )
        exigirCampos(assert, s.AjusteFiscal!, ajuste.body(), 'AjusteFiscal')
        const ajustes = await estado(
            client
                .get('/api/v1/declaraciones/ajustes')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ anio: 2026 }),
            200,
        )
        assert.deepEqual(
            ajustes.body().map((a: any) => [a.id, a.anulado_por_ajuste]),
            [[ajuste.body().id, null]],
        )
        await estado(
            client
                .post('/api/v1/declaraciones/ajustes')
                .bearerToken(cajero.token)
                .headers(cabecera)
                .json({ anio: 2026, efecto: 'suma', concepto: 'x y z', monto: '1.00' }),
            403,
        )

        // pedido de A4: regla tipada sin objeto libre; vigente_desde y nivel opcionales en el tipo hasta que
        // el panel ajuste tests/nuxt/calendarioFiscal.test.ts (desvío b de §21 PR C), pero la API los envía
        const regla = (s.ObligacionFiscal!.properties as Record<string, any>).regla
        assert.sameMembers(regla.required, ['parametro', 'valor', 'vence_base', 'corrido_a_habil'])
        assert.includeMembers(Object.keys(regla.properties), ['vigente_desde', 'nivel'])
        assert.notProperty(regla, 'additionalProperties')
        await afirmarLibroPrC(assert, [e.B, e.C])
    })
})
