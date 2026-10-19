import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { saldoProveedor } from '#ledger/proveedores'
import { cuadreCompras, libroCompras } from '#fiscal/libros'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import RegistrarCompraDesdeEgreso from '#ledger/actions/registrar_compra_desde_egreso'
import AnularCompra from '#ledger/actions/anular_compra'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import AnularEgreso from '#ledger/actions/anular_egreso'
import EditarProveedor from '#ledger/actions/editar_proveedor'
import CrearProveedor from '#ledger/actions/crear_proveedor'
import { codigoCaja, errorDe, saldoCuenta } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import {
    hacerAgenteRetencion,
    haceMeses,
    mesActual,
    nitPrueba,
    partidas,
    proveedorEn,
} from '#tests/ledger/ayudas_compras'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'

/**
 * Fase 5 (§3.4, §6.2, §7): proveedores, compras al contado y al crédito, desde un egreso, NCRE,
 * retenciones emitidas, anulación y el libro de compras cuadrado con 1.1.04.
 */

const IVA_CREDITO = CUENTAS_GT.IVA_CREDITO
const PROVEEDORES = CUENTAS_GT.PROVEEDORES

test.group('Fase 5 · proveedores y compras', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('proveedor: NIT con dígito verificador, duplicado 409, documento de solo lectura, version', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const malo = await errorDe(
            new CrearProveedor().execute({ empresa_id: e.B, nit: '1234567-8', nombre: 'Malo S.A.' }, e.ctx),
        )
        assert.equal(malo.status, 422)
        assert.include(malo.reglas, 'nit')
        const nit = nitPrueba()
        const p = await new CrearProveedor().execute(
            { empresa_id: e.B, nit: `${nit.slice(0, -1)}-${nit.slice(-1)}`, nombre: 'Tránsito IP S.A.' },
            e.ctx,
        )
        assert.equal(p.nit, nit)
        assert.equal(p.tipo, 'general')
        assert.equal(p.saldo, '0.00')
        const repetido = await errorDe(
            new CrearProveedor().execute({ empresa_id: e.B, nit, nombre: 'Otro' }, e.ctx),
        )
        assert.equal(repetido.codigo, 'proveedor_duplicado')
        // el mismo NIT en otra empresa es otro proveedor
        await new CrearProveedor().execute({ empresa_id: e.C, nit, nombre: 'Tránsito IP S.A.' }, e.ctx)

        const pequeno = await new CrearProveedor().execute(
            { empresa_id: e.B, nit: nitPrueba(), nombre: 'Tienda', tipo: 'pequeno_contribuyente' },
            e.ctx,
        )
        assert.equal(pequeno.regimen_isr, 'pequeno_contribuyente')
        const extranjero = await errorDe(
            new CrearProveedor().execute(
                { empresa_id: e.B, nit: 'US-998877', nombre: 'Upstream LLC' },
                e.ctx,
            ),
        )
        assert.equal(extranjero.status, 422)
        const noResidente = await new CrearProveedor().execute(
            { empresa_id: e.B, nit: 'us-998877', nombre: 'Upstream LLC', tipo: 'no_residente', pais: 'US' },
            e.ctx,
        )
        assert.equal(noResidente.tipo_documento, 'id_extranjero')
        assert.equal(noResidente.nit, 'US-998877')

        const editado = await new EditarProveedor().execute(
            {
                id: p.id,
                version: p.version,
                nombre: 'Tránsito IP, S.A.',
                regimen_isr: 'opcional_simplificado',
            },
            e.ctx,
        )
        assert.equal(editado.version, p.version + 1)
        assert.equal(editado.regimen_isr, 'opcional_simplificado')
        const viejo = await errorDe(
            new EditarProveedor().execute({ id: p.id, version: p.version, nombre: 'X S.A.' }, e.ctx),
        )
        assert.equal(viejo.codigo, 'conflicto_version')
        const nitNuevo = await errorDe(
            new EditarProveedor().execute({ id: p.id, version: editado.version, nit: nitPrueba() }, e.ctx),
        )
        assert.include(nitNuevo.reglas, 'campo_solo_lectura')
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'proveedor', entidad_id: p.id })
            .select('campo')
        assert.includeMembers(
            cambios.map((c) => c.campo),
            ['nombre', 'regimen_isr'],
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('compra al crédito: Gasto + 1.1.04 / 2.1.03 con auxiliar; NCRE la corrige; libro = 1.1.04', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const proveedor = await proveedorEn(e.B, e.ctx, { dias_credito: 30 })
        const fecha = haceMeses(0)
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                serie: 'a',
                numero: '1001',
                fecha_documento: fecha,
                condicion: 'credito',
                lineas: [
                    {
                        descripcion: 'Tránsito IP octubre',
                        tipo: 'servicio',
                        categoria: 'transito',
                        total: '1120.00',
                    },
                ],
            },
            e.ctx,
        )
        assert.equal(compra.serie, 'A')
        assert.equal(compra.base_servicios, '1000.00')
        assert.equal(compra.iva, '120.00')
        assert.isTrue(compra.credito_fiscal)
        assert.equal(compra.periodo_iva, mesActual())
        assert.equal(compra.saldo, '1120.00')
        assert.equal(compra.estado, 'vigente')
        assert.isNotNull(compra.vence_en)
        assert.deepEqual(await partidas('compra', compra.id), [
            [CUENTAS.GASTO_TRANSITO, '1000.00', '0.00', '+C_BASE_SERV'],
            [IVA_CREDITO, '120.00', '0.00', '+C_IVA'],
            [PROVEEDORES, '0.00', '1120.00', null],
        ])
        const saldo1 = await saldoProveedor(proveedor.id)
        assert.equal(saldo1.toFixed(2), '1120.00')
        const outbox = await db
            .from('audit.outbox')
            .where('evento', 'compra.registrada')
            .whereRaw(`payload->>'compra_id' = ?`, [String(compra.id)])
            .first()
        assert.equal(outbox?.payload.periodo_iva, mesActual().slice(0, 7))

        const duplicada = await errorDe(
            new RegistrarCompra().execute(
                {
                    proveedor_id: proveedor.id,
                    tipo_documento: 'FACT',
                    serie: 'A',
                    numero: '1001',
                    fecha_documento: fecha,
                    condicion: 'credito',
                    lineas: [{ descripcion: 'otra vez', total: '10.00' }],
                },
                e.ctx,
            ),
        )
        assert.equal(duplicada.status, 409)
        assert.equal(duplicada.codigo, 'compra_duplicada')

        // NCRE del proveedor: Proveedores / Gasto + 1.1.04, etiquetas en negativo
        const nota = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'NCRE',
                serie: 'A',
                numero: 'NC-7',
                fecha_documento: fecha,
                condicion: 'credito',
                compra_referencia_id: compra.id,
                lineas: [{ descripcion: 'Descuento por caída', categoria: 'transito', total: '112.00' }],
            },
            e.ctx,
        )
        assert.deepEqual(await partidas('compra', nota.id), [
            [CUENTAS.GASTO_TRANSITO, '0.00', '100.00', '-C_BASE_SERV'],
            [IVA_CREDITO, '0.00', '12.00', '-C_IVA'],
            [PROVEEDORES, '112.00', '0.00', null],
        ])
        const saldo2 = await saldoProveedor(proveedor.id)
        assert.equal(saldo2.toFixed(2), '1008.00')
        const excede = await errorDe(
            new RegistrarCompra().execute(
                {
                    proveedor_id: proveedor.id,
                    tipo_documento: 'NCRE',
                    numero: 'NC-8',
                    fecha_documento: fecha,
                    condicion: 'credito',
                    compra_referencia_id: compra.id,
                    lineas: [{ descripcion: 'demasiado', total: '2000.00' }],
                },
                e.ctx,
            ),
        )
        assert.equal(excede.codigo, 'ncre_excede_saldo')

        const libro = await libroCompras(e.B, {})
        assert.equal(libro.totales.iva_credito, '108.00')
        assert.equal(libro.totales.total, '1008.00')
        const cuadre = await cuadreCompras(e.B, {})
        assert.deepEqual(
            cuadre.map((c) => [c.libro, c.cuenta, c.cuadra]),
            [['108.00', '108.00', true]],
        )
        // la compra con una NCRE vigente no se anula
        const conNota = await errorDe(
            new AnularCompra().execute({ compra_id: compra.id, motivo: 'error' }, e.ctx),
        )
        assert.equal(conNota.codigo, 'compra_con_notas')
        await assert.rejects(() => db.from('ledger.compras').where('id', compra.id).update({ total: '1.00' }))
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('compra al contado por caja: crea su egreso sin otro asiento; anular la compra anula el egreso; el libro resta la anulación', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const proveedor = await proveedorEn(e.B, e.ctx)
        const cajaId = e.cajas.get(e.B)!
        const caja = await codigoCaja(cajaId)
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('F'),
                fecha_documento: haceMeses(0),
                condicion: 'contado',
                metodo: 'caja',
                caja_id: cajaId,
                lineas: [
                    { descripcion: 'Cable UTP', tipo: 'bien', total: '56.00' },
                    { descripcion: 'Agua pura', tipo: 'bien', exento: true, total: '10.00' },
                ],
            },
            e.ctx,
        )
        assert.equal(compra.base_bienes, '50.00')
        assert.equal(compra.exento, '10.00')
        assert.equal(compra.iva, '6.00')
        assert.equal(compra.total, '66.00')
        assert.equal(compra.saldo, '0.00')
        assert.isNotNull(compra.egreso_pago_id)
        assert.deepEqual(await partidas('compra', compra.id), [
            [CUENTAS.GASTO_OTROS, '50.00', '0.00', '+C_BASE_BIEN'],
            [CUENTAS.GASTO_OTROS, '10.00', '0.00', null],
            [IVA_CREDITO, '6.00', '0.00', '+C_IVA'],
            [caja, '0.00', '66.00', null],
        ])
        const egreso = await db.from('ledger.egresos').where('id', compra.egreso_pago_id!).firstOrFail()
        assert.equal(egreso.monto, '66.00')
        assert.equal(Number(egreso.compra_id), compra.id)
        assert.equal(Number(egreso.caja_id), cajaId)
        assert.lengthOf(await partidas('egreso', compra.egreso_pago_id!), 0)
        const directo = await errorDe(
            new AnularEgreso().execute({ egreso_id: compra.egreso_pago_id!, motivo: 'no' }, e.ctx),
        )
        assert.equal(directo.codigo, 'egreso_de_compra')

        const anulada = await new AnularCompra().execute(
            { compra_id: compra.id, motivo: 'factura duplicada' },
            e.ctx,
        )
        assert.equal(anulada.estado, 'anulada')
        assert.isNotNull(anulada.asiento_reverso_id)
        const todas = await partidas('compra', compra.id, false)
        assert.deepEqual(todas.slice(4), [
            [CUENTAS.GASTO_OTROS, '0.00', '50.00', '-C_BASE_BIEN'],
            [CUENTAS.GASTO_OTROS, '0.00', '10.00', null],
            [IVA_CREDITO, '0.00', '6.00', '-C_IVA'],
            [caja, '66.00', '0.00', null],
        ])
        const anulacionEgreso = await db
            .from('ledger.egresos_anulaciones')
            .where('egreso_id', compra.egreso_pago_id!)
            .first()
        assert.equal(Number(anulacionEgreso?.asiento_id), anulada.asiento_reverso_id)
        const otraVez = await errorDe(
            new AnularCompra().execute({ compra_id: compra.id, motivo: 'otra' }, e.ctx),
        )
        assert.equal(otraVez.codigo, 'compra_anulada')
        const libro = await libroCompras(e.B, {})
        assert.deepEqual(
            libro.filas.map((f) => [f.movimiento, f.iva_credito]),
            [
                ['registro', '6.00'],
                ['anulacion', '-6.00'],
            ],
        )
        assert.equal(libro.totales.iva_credito, '0.00')
        assert.equal(await saldoCuenta(e.B, IVA_CREDITO), '0.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('documentos sin crédito: FPEQ de un pequeño contribuyente; crédito fuera de la ventana 422 o al costo', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const pequeno = await proveedorEn(e.B, e.ctx, { tipo: 'pequeno_contribuyente' })
        const general = await proveedorEn(e.B, e.ctx)
        const fpeq = await new RegistrarCompra().execute(
            {
                proveedor_id: pequeno.id,
                tipo_documento: 'FPEQ',
                numero: unico('P'),
                fecha_documento: haceMeses(0),
                condicion: 'credito',
                lineas: [{ descripcion: 'Reparación de torre', total: '448.00' }],
            },
            e.ctx,
        )
        assert.equal(fpeq.iva, '0.00')
        assert.isFalse(fpeq.credito_fiscal)
        assert.deepEqual(await partidas('compra', fpeq.id), [
            [CUENTAS.GASTO_OTROS, '448.00', '0.00', '+C_PEQ'],
            [PROVEEDORES, '0.00', '448.00', null],
        ])
        const conCredito = await errorDe(
            new RegistrarCompra().execute(
                {
                    proveedor_id: pequeno.id,
                    tipo_documento: 'FPEQ',
                    numero: unico('P'),
                    fecha_documento: haceMeses(0),
                    condicion: 'credito',
                    credito_fiscal: true,
                    lineas: [{ descripcion: 'x', total: '10.00' }],
                },
                e.ctx,
            ),
        )
        assert.include(conCredito.reglas, 'credito_no_permitido')
        const fpeqGeneral = await errorDe(
            new RegistrarCompra().execute(
                {
                    proveedor_id: general.id,
                    tipo_documento: 'FPEQ',
                    numero: unico('P'),
                    fecha_documento: haceMeses(0),
                    condicion: 'credito',
                    lineas: [{ descripcion: 'x', total: '10.00' }],
                },
                e.ctx,
            ),
        )
        assert.include(fpeqGeneral.reglas, 'documento_no_permitido')

        // documento de hace 4 meses en el mes actual: fuera de la ventana de 2 meses
        const vieja = {
            proveedor_id: general.id,
            tipo_documento: 'FACT' as const,
            numero: unico('V'),
            fecha_documento: haceMeses(4),
            periodo_iva: mesActual(),
            condicion: 'credito' as const,
            lineas: [{ descripcion: 'Alquiler de poste', categoria: 'alquileres', total: '224.00' }],
        }
        const fuera = await errorDe(new RegistrarCompra().execute(vieja, e.ctx))
        assert.equal(fuera.codigo, 'credito_fiscal_extemporaneo')
        const sinCredito = await new RegistrarCompra().execute({ ...vieja, credito_fiscal: false }, e.ctx)
        assert.isFalse(sinCredito.credito_fiscal)
        assert.equal(sinCredito.fecha, mesActual())
        assert.deepEqual(await partidas('compra', sinCredito.id), [
            [CUENTAS.GASTO_ALQUILERES, '224.00', '0.00', '+C_SIN_CREDITO'],
            [PROVEEDORES, '0.00', '224.00', null],
        ])
        // en su mes (dentro de la ventana) toma el crédito con la fecha del documento
        const enSuMes = await new RegistrarCompra().execute(
            { ...vieja, numero: unico('V'), fecha_documento: haceMeses(1, 15), periodo_iva: undefined },
            e.ctx,
        )
        assert.equal(enSuMes.periodo_iva, haceMeses(1))
        assert.equal(enSuMes.fecha, haceMeses(1, 15))
        const futuro = await errorDe(
            new RegistrarCompra().execute(
                { ...vieja, numero: unico('V'), fecha_documento: haceMeses(0), periodo_iva: haceMeses(-1) },
                e.ctx,
            ),
        )
        assert.include(futuro.reglas, 'futuro')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('desde un egreso: reclasificación sin tocar su asiento; una sola vez; el egreso no se anula con compra vigente', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const proveedor = await proveedorEn(e.B, e.ctx, { nombre: 'EEGSA' })
        const egreso = await new RegistrarEgreso().execute(
            {
                categoria: 'energia',
                monto: '560.00',
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                proveedor: 'EEGSA',
                fecha: haceMeses(0),
            },
            e.ctx,
        )
        const antes = await partidas('egreso', egreso.id)
        const distinta = await errorDe(
            new RegistrarCompraDesdeEgreso().execute(
                {
                    egreso_id: egreso.id,
                    proveedor_id: proveedor.id,
                    tipo_documento: 'FACT',
                    numero: unico('E'),
                    fecha_documento: haceMeses(0),
                    lineas: [{ descripcion: 'Energía', categoria: 'energia', total: '600.00' }],
                },
                e.ctx,
            ),
        )
        assert.equal(distinta.codigo, 'compra_distinta_del_egreso')
        const compra = await new RegistrarCompraDesdeEgreso().execute(
            {
                egreso_id: egreso.id,
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('E'),
                fecha_documento: haceMeses(0),
                lineas: [{ descripcion: 'Energía', categoria: 'energia', total: '560.00' }],
            },
            e.ctx,
        )
        assert.equal(compra.egreso_id, egreso.id)
        assert.equal(compra.condicion, 'contado')
        assert.isNull(compra.egreso_pago_id)
        assert.deepEqual(await partidas('egreso', egreso.id), antes)
        assert.deepEqual(await partidas('compra', compra.id), [
            [CUENTAS.GASTO_ENERGIA, '500.00', '0.00', '+C_BASE_SERV'],
            [IVA_CREDITO, '60.00', '0.00', '+C_IVA'],
            [CUENTAS.GASTO_ENERGIA, '0.00', '560.00', null],
        ])
        assert.equal(await saldoCuenta(e.B, CUENTAS.GASTO_ENERGIA), '500.00')
        const otra = await errorDe(
            new RegistrarCompraDesdeEgreso().execute(
                {
                    egreso_id: egreso.id,
                    proveedor_id: proveedor.id,
                    tipo_documento: 'FACT',
                    numero: unico('E'),
                    fecha_documento: haceMeses(0),
                    lineas: [{ descripcion: 'Energía', categoria: 'energia', total: '560.00' }],
                },
                e.ctx,
            ),
        )
        assert.equal(otra.codigo, 'egreso_con_compra')
        const anularEgreso = await errorDe(
            new AnularEgreso().execute({ egreso_id: egreso.id, motivo: 'no' }, e.ctx),
        )
        assert.equal(anularEgreso.codigo, 'egreso_con_compra')

        // anulada la compra, el egreso sigue vigente y se puede volver a registrar
        await new AnularCompra().execute({ compra_id: compra.id, motivo: 'NIT equivocado' }, e.ctx)
        const egresoVigente = await db
            .from('ledger.egresos_anulaciones')
            .where('egreso_id', egreso.id)
            .first()
        assert.isNull(egresoVigente)
        const segunda = await new RegistrarCompraDesdeEgreso().execute(
            {
                egreso_id: egreso.id,
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('E'),
                fecha_documento: haceMeses(0),
                lineas: [{ descripcion: 'Energía', categoria: 'energia', total: '560.00' }],
            },
            e.ctx,
        )
        assert.equal(segunda.estado, 'vigente')
        // un egreso de hace 4 meses entra sin crédito (fuera de la ventana), sin 422
        const viejo = await new RegistrarEgreso().execute(
            {
                categoria: 'otros',
                monto: '112.00',
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                fecha: haceMeses(4),
            },
            e.ctx,
        )
        const tardia = await new RegistrarCompraDesdeEgreso().execute(
            {
                egreso_id: viejo.id,
                proveedor_id: proveedor.id,
                tipo_documento: 'FACT',
                numero: unico('E'),
                fecha_documento: haceMeses(4),
                periodo_iva: mesActual(),
                lineas: [{ descripcion: 'Repuestos', categoria: 'otros', total: '112.00' }],
            },
            e.ctx,
        )
        assert.isFalse(tardia.credito_fiscal)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('retenciones emitidas: agente de retención (15 % del IVA) y régimen opcional (7 % sin IVA)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await hacerAgenteRetencion(e.B, e.ctx)
        const opcional = await proveedorEn(e.B, e.ctx, { regimen_isr: 'opcional_simplificado' })
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: opcional.id,
                tipo_documento: 'FACT',
                numero: unico('R'),
                fecha_documento: haceMeses(0),
                condicion: 'credito',
                lineas: [{ descripcion: 'Mantenimiento de red', total: '3360.00' }],
            },
            e.ctx,
        )
        assert.deepEqual(
            compra.retenciones.map((r) => [r.impuesto_codigo, r.base, r.monto]),
            [
                ['RET_IVA_ESP_C', '360.00', '54.00'],
                ['RET_ISR_OPC_C', '3000.00', '210.00'],
            ],
        )
        assert.equal(compra.neto, '3096.00')
        assert.deepEqual(await partidas('compra', compra.id), [
            [CUENTAS.GASTO_OTROS, '3000.00', '0.00', '+C_BASE_SERV'],
            [IVA_CREDITO, '360.00', '0.00', '+C_IVA'],
            [CUENTAS_GT.RETENCIONES_IVA_POR_PAGAR, '0.00', '54.00', '+RET_IVA_EMI'],
            [CUENTAS_GT.RETENCIONES_ISR_POR_PAGAR, '0.00', '210.00', '+RET_ISR_EMI'],
            [PROVEEDORES, '0.00', '3096.00', null],
        ])
        // debajo del mínimo (Q2,500) no se retiene IVA; [] = ninguna
        const chica = await new RegistrarCompra().execute(
            {
                proveedor_id: opcional.id,
                tipo_documento: 'FACT',
                numero: unico('R'),
                fecha_documento: haceMeses(0),
                condicion: 'credito',
                retenciones: [],
                lineas: [{ descripcion: 'Viáticos', total: '112.00' }],
            },
            e.ctx,
        )
        assert.lengthOf(chica.retenciones, 0)
        // retención no residente explícita; una de venta no se acepta en una compra
        const extranjero = await proveedorEn(e.B, e.ctx, {
            tipo: 'no_residente',
            tipo_documento: 'id_extranjero',
            nit: unico('US').toUpperCase(),
            pais: 'US',
        })
        const tr = await new RegistrarCompra().execute(
            {
                proveedor_id: extranjero.id,
                tipo_documento: 'RECIBO',
                numero: unico('INV'),
                fecha_documento: haceMeses(0),
                condicion: 'credito',
                retenciones: [{ codigo: 'RET_ISR_NR_DATOS' }],
                lineas: [
                    { descripcion: 'Tránsito IP internacional', categoria: 'transito', total: '10000.00' },
                ],
            },
            e.ctx,
        )
        assert.deepEqual(
            tr.retenciones.map((r) => [r.impuesto_codigo, r.monto]),
            [['RET_ISR_NR_DATOS', '500.00']],
        )
        const deVenta = await errorDe(
            new RegistrarCompra().execute(
                {
                    proveedor_id: opcional.id,
                    tipo_documento: 'FACT',
                    numero: unico('R'),
                    fecha_documento: haceMeses(0),
                    condicion: 'credito',
                    retenciones: [{ codigo: 'RET_IVA_ESP' }],
                    lineas: [{ descripcion: 'x', total: '3360.00' }],
                },
                e.ctx,
            ),
        )
        assert.include(deVenta.reglas, 'retencion')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('multiempresa: el pago al contado no cruza NIT; la lista y el libro son de la empresa', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const proveedorB = await proveedorEn(e.B, e.ctx)
        const cruzada = await errorDe(
            new RegistrarCompra().execute(
                {
                    proveedor_id: proveedorB.id,
                    tipo_documento: 'FACT',
                    numero: unico('X'),
                    fecha_documento: haceMeses(0),
                    condicion: 'contado',
                    metodo: 'caja',
                    caja_id: e.cajas.get(e.C)!,
                    lineas: [{ descripcion: 'x', total: '112.00' }],
                },
                e.ctx,
            ),
        )
        assert.include(cruzada.reglas, 'cuenta_de_otra_empresa')
        const cuentaC = await errorDe(
            new RegistrarCompra().execute(
                {
                    proveedor_id: proveedorB.id,
                    tipo_documento: 'FACT',
                    numero: unico('X'),
                    fecha_documento: haceMeses(0),
                    condicion: 'credito',
                    lineas: [
                        { descripcion: 'x', cuenta: await codigoCaja(e.cajas.get(e.C)!), total: '112.00' },
                    ],
                },
                e.ctx,
            ),
        )
        assert.include(cuentaC.reglas, 'cuenta_compra')
        const libroC = await libroCompras(e.C, {})
        assert.lengthOf(libroC.filas, 0)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('rutas: proveedores, compras, anulación y libro con su cuadre; cajero sin permiso', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const nuevo = await estado(
            client
                .post('/api/v1/proveedores')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', unico('p'))
                .json({ nit: nitPrueba(), nombre: 'Claro Guatemala', dias_credito: 15 }),
            201,
        )
        const proveedor = nuevo.body()
        const lista = await estado(
            client.get('/api/v1/proveedores').bearerToken(e.token).headers(cabecera).qs({ buscar: 'claro' }),
            200,
        )
        assert.isTrue(lista.body().data.some((p: { id: number }) => p.id === proveedor.id))
        const clave = unico('c')
        const cuerpo = {
            proveedor_id: proveedor.id,
            tipo_documento: 'FACT',
            numero: unico('F'),
            fecha_documento: haceMeses(0),
            condicion: 'credito',
            lineas: [{ descripcion: 'Enlace dedicado', categoria: 'transito', total: '2240.00' }],
        }
        const creada = await estado(
            client
                .post('/api/v1/compras')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', clave)
                .json(cuerpo),
            201,
        )
        const repetida = await estado(
            client
                .post('/api/v1/compras')
                .bearerToken(e.token)
                .headers(cabecera)
                .header('Idempotency-Key', clave)
                .json(cuerpo),
            201,
        )
        assert.equal(repetida.body().id, creada.body().id)
        const compras = await estado(
            client.get('/api/v1/compras').bearerToken(e.token).headers(cabecera).qs({ pendientes: true }),
            200,
        )
        assert.isTrue(compras.body().data.some((c: { id: number }) => c.id === creada.body().id))
        const libro = await estado(
            client.get('/api/v1/libros/compras').bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.equal(libro.body().totales.iva_credito, '240.00')
        const csv = await client
            .get('/api/v1/libros/compras')
            .bearerToken(e.token)
            .headers(cabecera)
            .qs({ formato: 'csv' })
        csv.assertStatus(200)
        assert.include(csv.header('content-type'), 'text/csv')
        const cuadre = await estado(
            client.get('/api/v1/libros/compras/cuadre').bearerToken(e.token).headers(cabecera),
            200,
        )
        assert.isTrue(cuadre.body().every((c: { cuadra: boolean }) => c.cuadra))
        const anulada = await estado(
            client
                .post(`/api/v1/compras/${creada.body().id}/anular`)
                .bearerToken(e.token)
                .headers(cabecera)
                .json({ motivo: 'registrada en la empresa equivocada' }),
            200,
        )
        assert.equal(anulada.body().estado, 'anulada')

        const { token } = await usuarioConRoles(['cajero'])
        await estado(client.post('/api/v1/compras').bearerToken(token).json(cuerpo), 403)
        await estado(client.get('/api/v1/libros/compras').bearerToken(token), 403)
        await afirmarLibro(assert, [e.B, e.C])
    })
})
