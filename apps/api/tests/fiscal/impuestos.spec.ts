import { test } from '@japa/runner'
import { impuesto } from '#fiscal/impuestos'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { empresaInstalada, esquemas, exigirCampos } from '#tests/fiscal/ayudas_fiscal'

/**
 * Impuestos como entidad con vigencia (contrato §10.2): IVA incluido en el precio con su cuenta de
 * transición, retenciones como impuestos negativos (`signo = -1`) y cuadrículas de base y cuota.
 */
test.group('Localización fiscal · impuestos', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('catálogo GT: IVA 12 % incluido, retenciones con signo -1, cuentas y cuadrículas', async ({
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
            signo: 1,
            calculo: 'porcentaje_incluido',
            incluido: true,
            cuenta_cuota: '2.1.02',
            cuenta_transicion: '2.1.11',
            cuadricula_base: 'V_BASE_SERV',
            cuadricula_cuota: 'V_IVA',
            nivel: 'paquete',
        })
        assert.include(por.get('IVA12_C'), {
            uso: 'compra',
            cuenta_cuota: '1.1.04',
            cuadricula_cuota: 'C_IVA',
        })
        assert.include(por.get('IVA_PC'), {
            tasa: '5.00',
            calculo: 'porcentaje_del_total',
            cuenta_cuota: '2.1.09',
        })
        assert.include(por.get('RET_IVA_ESP'), {
            tasa: '15.00',
            signo: -1,
            calculo: 'porcentaje_del_impuesto',
            base_impuesto: 'IVA12',
            cuenta_cuota: '1.1.05',
            cuadricula_cuota: 'RET_IVA_REC',
        })
        assert.include(por.get('RET_IVA_PUB'), { tasa: '25.00', signo: -1 })
        assert.include(por.get('RET_ISR_OPC'), { tasa: '7.00', cuenta_cuota: '1.1.06' })
        assert.include(por.get('RET_ISR_NR_DATOS'), { tasa: '5.00', cuenta_cuota: '2.1.05', uso: 'compra' })
        // las tasas de declaración siguen siendo parámetros (contrato §10.2)
        assert.isFalse(por.has('ISO'))
        for (const i of r.body().impuestos as Array<{ grupo: string; signo: number; codigo: string }>) {
            assert.equal(i.grupo.startsWith('retencion'), i.signo === -1, i.codigo)
        }
    })

    test('una versión nueva de la tasa rige desde su fecha; la tasa va en positivo', async ({
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
        // el signo no se escribe (validador) y la tasa no pasa de 100 (acción)
        await post('RET_IVA_ESP', { tasa: '-15.00' }, 422)
        const fuera = await post('IVA12', { tasa: '101.00' }, 422)
        assert.include(fuera.body().errors[0], { field: 'tasa', rule: 'tasa' })
        await post('NO_EXISTE', { tasa: '1.00' }, 404)

        const retencion = await post('RET_IVA_ESP', { tasa: '20.00' }, 201)
        assert.include(retencion.body(), { tasa: '20.00', signo: -1 })

        const nueva = await post('IVA12', { tasa: '13.00' }, 201)
        const todos = await esquemas()
        exigirCampos(assert, todos.ImpuestoFiscal!, nueva.body(), 'ImpuestoFiscal')
        assert.include(nueva.body(), { tasa: '13.00', signo: 1, nivel: 'empresa', cuadricula_cuota: 'V_IVA' })
        const antes = await impuesto(empresaId, 'IVA12', '2097-12-31')
        assert.equal(antes.tasa, '12.00')
        const despues = await impuesto(empresaId, 'IVA12', '2098-01-01')
        assert.equal(despues.tasa, '13.00')
        // la otra empresa no cambia
        const otra = await impuesto(1, 'IVA12', '2098-01-01')
        assert.equal(otra.tasa, '12.00')
        await post('IVA12', { tasa: '14.00' }, 409)

        const historial = await estado(
            client
                .get('/api/v1/fiscal/impuestos/IVA12/historial')
                .bearerToken(token)
                .header('X-Empresa-Id', String(empresaId)),
            200,
        )
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
