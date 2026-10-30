import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import AnularFactura from '#billing/actions/anular_factura'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import SustituirFactura from '#billing/actions/sustituir_factura'
import CambiarContingenciaFel from '#fiscal/actions/cambiar_contingencia_fel'
import ConfigurarFel from '#fiscal/actions/configurar_fel'
import ProbarCredencialesFel from '#fiscal/actions/probar_credenciales_fel'
import GuardarCredencialesFel from '#fiscal/actions/guardar_credenciales_fel'
import ReintentarDte from '#fiscal/actions/reintentar_dte'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'
import { configuracionFel } from '#fiscal/fel/configuracion'
import { controlFelFalso } from '#fiscal/fel/falso'
import { xmlDte } from '#fiscal/fel/xml_gt'
import { dteParaEnviar, verDte } from '#fiscal/fel/dte'
import { ejecutarColaFel } from '#fiscal/jobs'
import { errorDe, lineas } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import {
    IVA_DEBITO,
    IVA_POR_CERTIFICAR,
    adelantarReintento,
    cola,
    configurarModo,
    datosNit,
    dtesDe,
    empresasFel,
    envejecerDte,
    envejecerFactura,
    eventosDe,
    factura,
    saldo,
    servicioFel,
} from '#tests/fiscal/ayudas_fel'

/**
 * Localización fiscal, fase 3 (FEL): contrato §8, §10.1 y §10.9, con el certificador falso.
 */
test.group('FEL · configuración y credenciales', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('configuración con versión, credenciales cifradas que nunca salen y prueba contra el certificador', async ({
        assert,
        client,
    }) => {
        const e = await empresasFel('desactivada')
        const ver = await estado(
            client.get('/api/v1/fel/configuracion').bearerToken(e.token).header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.containSubset(ver.body(), { empresa_id: e.B, modo: 'desactivada', proveedor: 'falso' })
        assert.deepEqual(ver.body().credenciales[0].campos_visibles, { usuario: 'prueba' })
        assert.notInclude(JSON.stringify(ver.body()), 'llave-secreta-1')

        // la llave queda cifrada en la base y como *** en la auditoría
        const fila = await db.from('fiscal.fel_credenciales').where('empresa_id', e.B).firstOrFail()
        assert.match(fila.datos, /^v1\./)
        assert.notInclude(fila.datos, 'llave-secreta-1')
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'fel.guardar_credenciales')
            .where('empresa_id', e.B)
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.notInclude(JSON.stringify(auditoria.entrada), 'llave-secreta-1')
        assert.equal(auditoria.entrada.secreto, '***')
        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'fel_credenciales')
            .where('entidad_id', fila.id)
        assert.isTrue(cambios.every((c) => !JSON.stringify(c).includes('llave-secreta')))

        // versión: 409 con la vieja
        const version = Number(ver.body().version)
        await estado(
            client
                .put('/api/v1/fel/configuracion')
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .json({
                    empresa_id: e.B,
                    proveedor: 'falso',
                    ambiente: 'pruebas',
                    modo: 'opcional',
                    version,
                }),
            200,
        )
        await estado(
            client
                .put('/api/v1/fel/configuracion')
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .json({
                    empresa_id: e.B,
                    proveedor: 'falso',
                    ambiente: 'pruebas',
                    modo: 'obligatoria',
                    version,
                }),
            409,
        )
        // el proveedor falso no se admite en producción
        const prod = await errorDe(
            new ConfigurarFel().execute(
                {
                    empresa_id: e.B,
                    proveedor: 'falso',
                    ambiente: 'produccion',
                    modo: 'opcional',
                    version: version + 1,
                },
                e.ctx,
            ),
        )
        assert.equal(prod.status, 422)

        const prueba = await new ProbarCredencialesFel().execute(
            { empresa_id: e.B, ambiente: 'pruebas' },
            e.ctx,
        )
        assert.deepInclude(prueba.resultado_prueba, { ok: true })
        await new GuardarCredencialesFel().execute(
            { empresa_id: e.B, ambiente: 'pruebas', secreto: { usuario: 'prueba', llave: 'invalida' } },
            e.ctx,
        )
        const mala = await new ProbarCredencialesFel().execute(
            { empresa_id: e.B, ambiente: 'pruebas' },
            e.ctx,
        )
        assert.deepInclude(mala.resultado_prueba, { ok: false })
        // falta un campo obligatorio: 422 por campo
        const falta = await errorDe(
            new GuardarCredencialesFel().execute(
                { empresa_id: e.B, ambiente: 'pruebas', secreto: { usuario: 'x' } },
                e.ctx,
            ),
        )
        assert.include(falta.reglas, 'required')
        const configCambiada = await eventosDe('fiscal.config_cambiada', 'empresa_id', e.B)
        assert.isAbove(configCambiada.length, 0)
    })

    test('obligatoria no admite servicios con certificar_al = nunca (422 certificar_al_incompatible)', async ({
        assert,
    }) => {
        const e = await empresasFel('desactivada')
        await servicioFel(e, 'nunca')
        const error = await errorDe(configurarModo(e, e.B, 'obligatoria'))
        assert.equal(error.codigo, 'certificar_al_incompatible')
        await configurarModo(e, e.B, 'opcional')
    })
})

test.group('FEL · aviso de cobro (certificar_al = pagar) y 2.1.11', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('el aviso registra el IVA en 2.1.11; al cubrirse se certifica y se reclasifica a 2.1.02; anular el pago no toca el DTE', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar')
        const f = s.facturas[0]!
        assert.equal(f.estado, 'emitida')
        assert.isTrue(await factura(f.id).then((r) => r.aviso_cobro))
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '-16.07')
        assert.equal(await saldo(e.B, IVA_DEBITO), '0.00')
        assert.lengthOf(await eventosDe('factura.emitida', 'factura_id', f.id), 1)

        // pago parcial: no se certifica
        const parcial = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '100.00', empresa_id: e.B },
            e.ctx,
        )
        await cola(e)
        assert.lengthOf(await dtesDe('factura', f.id), 0)
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '-16.07')

        // pago anulado antes de certificar: nada fiscal que revertir
        await new AnularPago().execute({ pago_id: parcial.id, motivo: 'error de caja' }, e.ctx)
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '-16.07')

        const pago = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        const corrida = await cola(e)
        assert.containSubset(corrida, { solicitados: 1, enviados: 1, errores: 0 })
        const [dte] = await dtesDe('factura', f.id)
        assert.containSubset(dte, { estado: 'certificado', tipo_dte: 'FACT', solicitud: 'automatico' })
        assert.isNotNull(dte!.autorizacion)
        assert.match(dte!.xml, /<dte:GTDocumento/)
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '0.00')
        assert.equal(await saldo(e.B, IVA_DEBITO), '-16.07')
        assert.deepEqual(await lineas('reclasificacion', Number(dte!.id)), [
            [IVA_POR_CERTIFICAR, '16.07', '0.00'],
            [IVA_DEBITO, '0.00', '16.07'],
        ])
        assert.lengthOf(await eventosDe('dte.certificado', 'dte_id', Number(dte!.id)), 1)
        // otra corrida no hace nada
        assert.containSubset(await cola(e), { solicitados: 0, enviados: 0 })
        await afirmarLibro(assert, e.B)

        // un pago anulado después de certificar no revierte nada fiscal
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'cheque rechazado' }, e.ctx)
        const despues = await verDte(Number(dte!.id))
        assert.equal(despues.estado, 'certificado')
        assert.equal(await saldo(e.B, IVA_DEBITO), '-16.07')
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '0.00')
        assert.include(['emitida', 'vencida'], await factura(f.id).then((r) => r.estado))
        await afirmarLibro(assert, e.B)
    })

    test('nota interna en un aviso sin DTE debita 2.1.11; después de certificar, NCRE con 2.1.02 y su DTE referido', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar', '224.00')
        const f = s.facturas[0]!
        const interna = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '22.40', motivo: 'descuento comercial' },
            e.ctx,
        )
        assert.equal(interna.iva, '2.40')
        assert.lengthOf(await dtesDe('nota_credito', interna.id), 0)
        assert.deepInclude(await lineas('nota_credito', interna.id), [IVA_POR_CERTIFICAR, '2.40', '0.00'])
        await afirmarLibro(assert, e.B)

        // se certifica a mano (antes de cobrarse) y la reclasificación lleva solo lo que quedaba
        await new SolicitarCertificacion().execute({ factura_id: f.id }, e.ctx)
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        assert.equal(dte!.estado, 'certificado')
        assert.deepEqual(await lineas('reclasificacion', Number(dte!.id)), [
            [IVA_POR_CERTIFICAR, '21.60', '0.00'],
            [IVA_DEBITO, '0.00', '21.60'],
        ])
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '0.00')

        const ncre = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '112.00', motivo: 'cargo indebido' },
            e.ctx,
        )
        assert.deepInclude(await lineas('nota_credito', ncre.id), [IVA_DEBITO, '12.00', '0.00'])
        const [dteNota] = await dtesDe('nota_credito', ncre.id)
        assert.containSubset(dteNota, { tipo_dte: 'NCRE', estado: 'pendiente' })
        assert.equal(dteNota!.referencia.autorizacion, dte!.autorizacion)
        await cola(e)
        assert.equal(await dtesDe('nota_credito', ncre.id).then((r) => r[0]!.estado), 'certificado')
        const xml = xmlDte(await dteParaEnviar(db.connection(), await verDte(Number(dteNota!.id))))
        assert.include(xml, 'ReferenciasNota')
        assert.include(xml, String(dte!.autorizacion))

        // el resto con otra NCRE deja todas las cuentas de la factura en cero
        await new EmitirNotaCredito().execute({ factura_id: f.id, monto: '89.60', motivo: 'baja' }, e.ctx)
        assert.equal(await saldo(e.B, IVA_DEBITO), '0.00')
        assert.equal(await saldo(e.B, IVA_POR_CERTIFICAR), '0.00')
        assert.equal(await saldo(e.B, '4.1.01'), '0.00')

        // fuera de la ventana de notas: 422
        const otro = await servicioFel(e, 'pagar')
        await new SolicitarCertificacion().execute({ factura_id: otro.facturas[0]!.id }, e.ctx)
        await cola(e)
        const [viejo] = await dtesDe('factura', otro.facturas[0]!.id)
        await envejecerDte(Number(viejo!.id), 3)
        const fuera = await errorDe(
            new EmitirNotaCredito().execute(
                { factura_id: otro.facturas[0]!.id, monto: '10.00', motivo: 'tarde' },
                e.ctx,
            ),
        )
        assert.equal(fuera.codigo, 'nota_fuera_de_plazo')
        await afirmarLibro(assert, e.B)
    })

    test('nota de crédito por línea: cada concepto con su IVA, la última toma el resto exacto', async ({
        assert,
    }) => {
        const e = await empresasFel('desactivada')
        const s = await servicioFel(e, 'pagar', '150.00')
        const f = s.facturas[0]!
        const [linea] = await db
            .from('billing.facturas_lineas')
            .where('factura_id', f.id)
            .orderBy('id', 'asc')
            .select('id', 'iva')
        const nota = await new EmitirNotaCredito().execute(
            {
                factura_id: f.id,
                motivo: 'días sin servicio',
                lineas: [{ linea_id: linea!.id, monto: '50.00' }],
            },
            e.ctx,
        )
        assert.equal(nota.monto, '50.00')
        assert.equal(nota.iva, '5.36')
        const resto = await new EmitirNotaCredito().execute(
            { factura_id: f.id, motivo: 'resto', lineas: [{ linea_id: linea!.id, monto: '100.00' }] },
            e.ctx,
        )
        assert.equal(resto.iva, '10.71')
        const filas = await db.from('billing.notas_credito_lineas').whereIn('nota_id', [nota.id, resto.id])
        assert.lengthOf(filas, 2)
        // más de lo que queda en la línea: 422 por campo
        const otra = await servicioFel(e, 'pagar')
        const [l2] = await db
            .from('billing.facturas_lineas')
            .where('factura_id', otra.facturas[0]!.id)
            .orderBy('id', 'asc')
            .select('id')
        const demas = await errorDe(
            new EmitirNotaCredito().execute(
                {
                    factura_id: otra.facturas[0]!.id,
                    motivo: 'x',
                    lineas: [{ linea_id: l2!.id, monto: '150.01' }],
                },
                e.ctx,
            ),
        )
        assert.equal(demas.status, 422)
        await afirmarLibro(assert, e.B)
    })
})

test.group('FEL · obligatoria con certificar_al = emitir', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('la factura nace por_certificar sin asiento ni evento; un error temporal se reintenta consultando primero y nunca duplica', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const cliente = await crearClienteFila(datosNit())
        controlFelFalso.siguiente.push('error_temporal')
        const s = await servicioFel(e, 'emitir', '150.00', cliente)
        const f = s.facturas[0]!
        assert.equal(f.estado, 'por_certificar')
        assert.lengthOf(await lineas('factura', f.id), 0)
        assert.lengthOf(await eventosDe('factura.emitida', 'factura_id', f.id), 0)
        const [pendiente] = await dtesDe('factura', f.id)
        assert.containSubset(pendiente, { estado: 'pendiente', receptor: { tipo: 'nit', id: '12345679' } })
        await afirmarLibro(assert, e.B)

        // 1.º: error temporal (reintento en 1 minuto)
        await cola(e)
        const [conError] = await dtesDe('factura', f.id)
        assert.containSubset(conError, { estado: 'error_temporal', intentos: 1 })
        assert.isNotNull(conError!.proximo_intento)
        assert.lengthOf(await lineas('factura', f.id), 0)

        // 2.º: el certificador lo registra pero se corta la respuesta
        await adelantarReintento(Number(conError!.id))
        controlFelFalso.siguiente.push('caida')
        await cola(e)
        assert.equal(await dtesDe('factura', f.id).then((r) => r[0]!.estado), 'error_temporal')
        assert.equal(controlFelFalso.llamadas.certificar, 2)

        // 3.º: consulta primero por identificador y toma el ya certificado, sin certificar otra vez
        await adelantarReintento(Number(conError!.id))
        await cola(e)
        const [certificado] = await dtesDe('factura', f.id)
        assert.equal(certificado!.estado, 'certificado')
        assert.equal(controlFelFalso.llamadas.certificar, 2)
        assert.isAbove(controlFelFalso.llamadas.consultar, 0)
        const intentos = await db.from('fiscal.dte_intentos').where('dte_id', certificado!.id).orderBy('id')
        assert.includeMembers(
            intentos.map((i) => i.operacion),
            ['certificar', 'consultar'],
        )

        // al certificarse: emitida, asiento con IVA débito, factura.emitida una vez
        const emitida = await factura(f.id)
        assert.equal(emitida.estado, 'emitida')
        assert.isFalse(emitida.aviso_cobro)
        assert.deepEqual(await lineas('factura', f.id), [
            ['1.1.03', '150.00', '0.00'],
            ['4.1.01', '0.00', '133.93'],
            [IVA_DEBITO, '0.00', '16.07'],
        ])
        assert.lengthOf(await eventosDe('factura.emitida', 'factura_id', f.id), 1)
        await cola(e)
        assert.lengthOf(await lineas('factura', f.id), 3)
        await afirmarLibro(assert, e.B)
    })

    test('consumidor final: Q2,499.99 certifica; desde Q2,500.00 exige NIT (rechazo local) y se reintenta tras corregirlo', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const cf = await crearClienteFila()
        const bajo = await servicioFel(e, 'emitir', '2499.99', cf)
        await cola(e)
        assert.equal(await dtesDe('factura', bajo.facturas[0]!.id).then((r) => r[0]!.estado), 'certificado')

        const cf2 = await crearClienteFila()
        const alto = await servicioFel(e, 'emitir', '2500.00', cf2)
        const f = alto.facturas[0]!
        const [rechazado] = await dtesDe('factura', f.id)
        assert.containSubset(rechazado, {
            estado: 'rechazado',
            ultimo_error: 'receptor_requerido',
            definitivo: true,
        })
        assert.equal(f.estado, 'por_certificar')
        assert.lengthOf(await eventosDe('dte.rechazado', 'dte_id', Number(rechazado!.id)), 1)
        await cola(e)
        assert.lengthOf(await dtesDe('factura', f.id), 1)
        const manual = await errorDe(new SolicitarCertificacion().execute({ factura_id: f.id }, e.ctx))
        assert.equal(manual.codigo, 'receptor_requerido')
        const reintento = await errorDe(new ReintentarDte().execute({ dte_id: Number(rechazado!.id) }, e.ctx))
        assert.equal(reintento.codigo, 'receptor_requerido')

        await db.from('core.clientes').where('id', cf2).update(datosNit())
        const nuevo = await new ReintentarDte().execute({ dte_id: Number(rechazado!.id) }, e.ctx)
        assert.notEqual(nuevo.identificador, rechazado!.identificador)
        await cola(e)
        assert.equal(await verDte(nuevo.id).then((r) => r.estado), 'certificado')
        assert.equal(await factura(f.id).then((r) => r.estado), 'emitida')
        await afirmarLibro(assert, e.B)
    })

    test('anulación: dentro del plazo en dos pasos con reverso exacto; fuera de plazo 422 con sugerencia de nota', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const cliente = await crearClienteFila(datosNit())
        const s = await servicioFel(e, 'emitir', '150.00', cliente)
        const f = s.facturas[0]!
        await cola(e)
        const pedido = await new AnularFactura().execute({ factura_id: f.id, motivo: 'error de plan' }, e.ctx)
        assert.equal(pedido.estado, 'emitida')
        assert.equal(pedido.fel_estado, 'anulacion_pendiente')
        assert.lengthOf(await eventosDe('factura.anulada', 'factura_id', f.id), 0)
        const otra = await errorDe(
            new AnularFactura().execute({ factura_id: f.id, motivo: 'otra vez' }, e.ctx),
        )
        assert.equal(otra.codigo, 'anulacion_en_proceso')

        const corrida = await cola(e)
        assert.equal(corrida.anulados, 1)
        const [dte] = await dtesDe('factura', f.id)
        assert.equal(dte!.estado, 'anulado')
        assert.equal(await factura(f.id).then((r) => r.estado), 'anulada')
        assert.lengthOf(await eventosDe('dte.anulado', 'dte_id', Number(dte!.id)), 1)
        assert.lengthOf(await eventosDe('factura.anulada', 'factura_id', f.id), 1)
        assert.equal(await saldo(e.B, IVA_DEBITO), '0.00')
        assert.equal(await saldo(e.B, '1.1.03'), '0.00')

        const vieja = await servicioFel(e, 'emitir', '150.00', cliente, e.C)
        await cola(e)
        // el plazo corre desde la emisión de la factura (decisión del líder), no desde la certificación
        await envejecerFactura(vieja.facturas[0]!.id, 2)
        const fuera = await errorDe(
            new AnularFactura().execute({ factura_id: vieja.facturas[0]!.id, motivo: 'tarde' }, e.ctx),
        )
        assert.equal(fuera.codigo, 'anulacion_fuera_de_plazo')
        assert.include(fuera.detalle, 'nota de crédito')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('una por_certificar anulada descarta su DTE sin enviarlo y no emite factura.anulada', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        await new AnularFactura().execute({ factura_id: f.id, motivo: 'servicio de prueba' }, e.ctx)
        const [dte] = await dtesDe('factura', f.id)
        assert.containSubset(dte, { estado: 'rechazado', ultimo_error: 'documento_anulado' })
        assert.lengthOf(await eventosDe('factura.anulada', 'factura_id', f.id), 0)
        await cola(e)
        assert.equal(controlFelFalso.llamadas.certificar, 0)
        await afirmarLibro(assert, e.B)
    })

    test('contingencia: la factura se emite y su DTE espera; al levantarla se certifica sin duplicar el asiento', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        await new CambiarContingenciaFel().execute(
            { empresa_id: e.B, activa: true, motivo: 'certificador caído' },
            e.ctx,
        )
        const s = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        assert.equal(f.estado, 'emitida')
        assert.lengthOf(await lineas('factura', f.id), 3)
        assert.containSubset(await dtesDe('factura', f.id).then((r) => r[0]), {
            estado: 'contingencia',
            contingencia: true,
        })
        await cola(e)
        assert.equal(await dtesDe('factura', f.id).then((r) => r[0]!.estado), 'contingencia')
        assert.lengthOf(await eventosDe('fel.contingencia_cambiada', 'empresa_id', e.B), 1)

        await new CambiarContingenciaFel().execute(
            { empresa_id: e.B, activa: false, motivo: 'volvió' },
            e.ctx,
        )
        await cola(e)
        assert.equal(await dtesDe('factura', f.id).then((r) => r[0]!.estado), 'certificado')
        assert.lengthOf(await lineas('factura', f.id), 3)
        assert.lengthOf(await eventosDe('factura.emitida', 'factura_id', f.id), 1)
        const config = await configuracionFel(e.B)
        assert.isFalse(config.contingencia_activa)
        await afirmarLibro(assert, e.B)
    })

    test('sustituir: con DTE certificado acredita con NCRE y emite la nueva del mismo periodo; sin DTE anula la original', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const cliente = await crearClienteFila(datosNit())
        const s = await servicioFel(e, 'emitir', '150.00', cliente)
        const f = s.facturas[0]!
        await cola(e)
        const r = await new SustituirFactura().execute(
            {
                factura_id: f.id,
                motivo: 'NIT equivocado',
                cliente_fiscal: {
                    tipo_documento_fiscal: 'nit',
                    nit_cui: '1234567K',
                    nombre_fiscal: 'Otro, S.A.',
                },
            },
            e.ctx,
        )
        assert.equal(r.tipo, 'nota_credito')
        assert.equal(r.original.estado, 'pagada')
        assert.equal(r.nueva.estado, 'por_certificar')
        const nueva = await factura(r.nueva.id)
        assert.match(nueva.clave_unica, /#s1$/)
        const periodos = await db
            .from('billing.facturas')
            .whereIn('id', [f.id, r.nueva.id])
            .select(db.raw("to_char(periodo, 'YYYY-MM-DD') as p"))
        assert.deepEqual(
            periodos.map((x) => x.p),
            ['2026-10-01', '2026-10-01'],
        )
        const [dteNuevo] = await dtesDe('factura', r.nueva.id)
        assert.containSubset(dteNuevo, { receptor: { id: '1234567K', nombre: 'Otro, S.A.' } })
        assert.lengthOf(await dtesDe('nota_credito', r.nota_credito_id!), 1)
        assert.lengthOf(await eventosDe('factura.sustituida', 'factura_id', f.id), 1)
        const repetida = await errorDe(
            new SustituirFactura().execute({ factura_id: f.id, motivo: 'otra vez' }, e.ctx),
        )
        assert.equal(repetida.codigo, 'sustitucion_no_permitida')
        await cola(e)
        assert.equal(await factura(r.nueva.id).then((x) => x.estado), 'emitida')

        // sin FEL: anula y emite
        await configurarModo(e, e.C, 'desactivada')
        const sinFel = await servicioFel(e, 'pagar', '150.00', undefined, e.C)
        const r2 = await new SustituirFactura().execute(
            { factura_id: sinFel.facturas[0]!.id, motivo: 'plan mal asignado' },
            e.ctx,
        )
        assert.equal(r2.tipo, 'anulacion')
        assert.equal(r2.original.estado, 'anulada')
        assert.equal(r2.nueva.estado, 'emitida')
        const pagada = await new RegistrarPago().execute(
            { cliente_id: sinFel.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.C },
            e.ctx,
        )
        const conPago = await errorDe(
            new SustituirFactura().execute({ factura_id: r2.nueva.id, motivo: 'otra' }, e.ctx),
        )
        assert.equal(conPago.codigo, 'sustitucion_no_permitida')
        await new AnularPago().execute({ pago_id: pagada.id, motivo: 'prueba' }, e.ctx)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('rechazo de la SAT: definitivo, visible y reintentable con otro identificador', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        controlFelFalso.siguiente.push('rechazado')
        const s = await servicioFel(e, 'emitir', '150.00', await crearClienteFila(datosNit()))
        await cola(e)
        const [rechazado] = await dtesDe('factura', s.facturas[0]!.id)
        assert.containSubset(rechazado, { estado: 'rechazado', definitivo: true })
        assert.include(rechazado!.ultimo_error, 'simulado')
        assert.equal((await factura(s.facturas[0]!.id).then((r) => r.fel_estado)) ?? 'rechazado', 'rechazado')
        await cola(e)
        assert.lengthOf(await dtesDe('factura', s.facturas[0]!.id), 1)
        await new ReintentarDte().execute({ dte_id: Number(rechazado!.id) }, e.ctx)
        await ejecutarColaFel()
        const todos = await dtesDe('factura', s.facturas[0]!.id)
        assert.lengthOf(todos, 2)
        assert.equal(todos[1]!.estado, 'certificado')
        await afirmarLibro(assert, e.B)
    })
})
