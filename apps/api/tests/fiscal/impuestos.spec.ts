import { test } from '@japa/runner'
import { impuesto } from '#fiscal/impuestos'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { empresaInstalada, esquemas, exigirCampos } from '#tests/fiscal/ayudas_fiscal'

/**
 * Impuestos como entidad con vigencia (estudio de Odoo #6 y #7): IVA incluido en el precio con su
 * cuenta de transición, retenciones como impuestos negativos y cuadrículas de base y cuota.
 */
test.group('Localización fiscal · impuestos', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('catálogo GT: IVA 12 % incluido, retenciones negativas, cuentas y cuadrículas', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['lectura'])
        const r = await estado(
            client.get('/api/v1/fiscal/impuestos').bearerToken(token).header('X-Empresa-Id', '1'),
            200,
        )
        const todos = await esquemas()
        exigirCampos(assert, todos.ImpuestosFiscales!, r.body(), 'ImpuestosFiscales')
        const por = new Map(r.body().impuestos.map((i: { codigo: string }) => [i.codigo, i]))
        for (const i of r.body().impuestos) {
            exigirCampos(assert, todos.ImpuestoFiscal!, i, `ImpuestoFiscal ${i.codigo}`)
        }
        assert.include(por.get('IVA12'), {
            tasa: '12.00',
            calculo: 'precio_incluido',
            incluido: true,
            cuenta_cuota: '2.1.02',
            cuenta_transicion: '2.1.11',
            cuadricula_base: 'iva_debito_base',
            cuadricula_cuota: 'iva_debito',
            nivel: 'paquete',
        })
        assert.include(por.get('RET_IVA_ESPECIAL_RECIBIDA'), {
            tasa: '-15.00',
            calculo: 'sobre_impuesto',
            base_impuesto: 'IVA12',
            cuenta_cuota: '1.1.05',
        })
        assert.include(por.get('RET_IVA_PUBLICO_RECIBIDA'), { tasa: '-25.00' })
        assert.include(por.get('RET_ISR_OPCIONAL_RECIBIDA'), { tasa: '-7.00', cuenta_cuota: '1.1.06' })
        assert.include(por.get('RET_ISR_NR_DATOS'), { tasa: '-5.00', cuenta_cuota: '2.1.05', uso: 'compra' })
        assert.include(por.get('ISO'), { tasa: '1.00', uso: 'declaracion' })
        for (const i of r.body().impuestos as Array<{ grupo: string; tasa: string; codigo: string }>) {
            assert.equal(i.grupo.startsWith('retencion'), i.tasa.startsWith('-'), i.codigo)
        }
    })

    test('una versión nueva de la tasa rige desde su fecha; el signo lo exige la ley', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { empresaId } = await empresaInstalada()
        const post = (codigo: string, cuerpo: Record<string, unknown>, status: number) =>
            estado(
                client
                    .post(`/api/v1/fiscal/impuestos/${codigo}/versiones`)
                    .bearerToken(token)
                    .header('X-Empresa-Id', String(empresaId))
                    .json({ motivo: 'Reforma de prueba', vigente_desde: '2098-01-01', ...cuerpo }),
                status,
            )
        const signo = await post('RET_IVA_ESPECIAL_RECIBIDA', { tasa: '15.00' }, 422)
        assert.include(signo.body().errors[0], { field: 'tasa', rule: 'signo' })
        const leido70 = await post('IVA12', { tasa: '-12.00' }, 422)
        assert.equal(leido70.body().errors[0].rule, 'signo')
        await post('NO_EXISTE', { tasa: '1.00' }, 404)

        const nueva = await post('IVA12', { tasa: '13.00' }, 201)
        const leido74 = await esquemas()
        exigirCampos(assert, leido74.ImpuestoFiscal!, nueva.body(), 'ImpuestoFiscal')
        assert.include(nueva.body(), {
            tasa: '13.00',
            nivel: 'empresa',
            cuenta_cuota: '2.1.02',
            cuadricula_cuota: 'iva_debito',
        })
        const leido81 = await impuesto(empresaId, 'IVA12', '2097-12-31')
        assert.equal(leido81.tasa, '12.00')
        const leido82 = await impuesto(empresaId, 'IVA12', '2098-01-01')
        assert.equal(leido82.tasa, '13.00')
        // la otra empresa no cambia
        const leido84 = await impuesto(1, 'IVA12', '2098-01-01')
        assert.equal(leido84.tasa, '12.00')
        await post('IVA12', { tasa: '14.00' }, 409)

        const historial = await estado(
            client
                .get('/api/v1/fiscal/impuestos/IVA12/historial')
                .bearerToken(token)
                .header('X-Empresa-Id', String(empresaId)),
            200,
        )
        const todos = await esquemas()
        exigirCampos(assert, todos.HistorialImpuestoFiscal!, historial.body(), 'HistorialImpuestoFiscal')
        assert.deepEqual(
            historial.body().versiones.map((v: { tasa: string; nivel: string }) => [v.tasa, v.nivel]),
            [
                ['12.00', 'paquete'],
                ['13.00', 'empresa'],
            ],
        )
    })
})
