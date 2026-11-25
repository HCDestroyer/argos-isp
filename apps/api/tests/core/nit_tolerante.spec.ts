import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { revisarNit, verificadorNit } from '#core/nit_cui'
import { ValidacionFallida } from '#shared/errores'
import ConfigurarFel from '#fiscal/actions/configurar_fel'
import GuardarCredencialesFel from '#fiscal/actions/guardar_credenciales_fel'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'
import { configuracionFel } from '#fiscal/fel/configuracion'
import { crearClienteFila } from '#tests/core/fabricas'
import { dtesDe, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'
import { sacarDeLaColaFel } from '#tests/contabilidad/ayudas_contabilidad'

/**
 * NIT tolerante (`contratos/fel-establecimientos.md` R1, lote 1): letras, dígitos y guiones; el
 * módulo 11 es advertencia (`nit_valido` en la empresa, `nit_cui_invalido` en el cliente). Lo
 * decide el certificador; el único rechazo local es pasar a producción con un NIT de empresa que
 * no cuadra (422 `nit_emisor_invalido`).
 */

function nitAleatorio(): string {
    const cuerpo = String(Math.floor(1_000_000 + Math.random() * 8_999_999))
    return `${cuerpo}${verificadorNit(cuerpo)}`
}

function reglaDe(fn: () => unknown): string {
    try {
        fn()
    } catch (error) {
        if (error instanceof ValidacionFallida) return error.errores![0]!.rule ?? ''
        throw error
    }
    return 'sin_error'
}

async function crearEmpresa(client: any, token: string, nit: string, status = 201) {
    return estado(
        client
            .post('/api/v1/empresas')
            .bearerToken(token)
            .json({ nit, razon_social: 'Demo, S.A.', nombre_comercial: unico('Demo') }),
        status,
    )
}

test.group('NIT tolerante: revisarNit', () => {
    test('normaliza y avisa; solo rechaza lo que no tiene forma de NIT', ({ assert }) => {
        assert.deepEqual(revisarNit('12521337'), { nit: '12521337', valido: true })
        assert.deepEqual(revisarNit('1252133-7'), { nit: '12521337', valido: true })
        assert.deepEqual(revisarNit('12345-67-K'), { nit: '1234567K', valido: false })
        assert.deepEqual(revisarNit('5769373K'), { nit: '5769373K', valido: false })
        assert.deepEqual(revisarNit('ABC-123'), { nit: 'ABC123', valido: false })
        assert.deepEqual(revisarNit('1000000000K'), { nit: '1000000000K', valido: false })
        assert.deepEqual(revisarNit('1170142K'), { nit: '1170142K', valido: false })
        for (const malo of ['-', 'A', '12#45', 'X'.repeat(21), '']) {
            assert.equal(
                reglaDe(() => revisarNit(malo)),
                'nit',
                malo,
            )
        }
    })
})

test.group('NIT tolerante: empresas y clientes', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('empresa con el NIT demo de INFILE y con letras: 201 con nit_valido false; duplicados 409', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        // el NIT demo puede existir de otra corrida en una empresa activa: se libera
        await db.from('core.empresas').whereIn('nit', ['1170142K', 'DEMO123']).whereNot('id', 1).update({
            activa: false,
        })
        const demo = await crearEmpresa(client, token, '1170142K')
        assert.include(demo.body(), { nit: '1170142K', nit_valido: false })
        const repetido = await crearEmpresa(client, token, '1170142-K', 409)
        assert.isTrue(String(repetido.body().type).endsWith('nit_duplicado'))

        const letras = await crearEmpresa(client, token, 'DEMO-123')
        assert.include(letras.body(), { nit: 'DEMO123', nit_valido: false })
        await crearEmpresa(client, token, 'demo 123', 409)

        const id = letras.body().id as number
        const valido = await estado(
            client
                .put(`/api/v1/empresas/${id}`)
                .bearerToken(token)
                .json({ version: letras.body().version, nit: '12521337' }),
            200,
        )
        assert.include(valido.body(), { nit: '12521337', nit_valido: true })
        await estado(
            client
                .put(`/api/v1/empresas/${id}`)
                .bearerToken(token)
                .json({ version: valido.body().version, nit: 'CF' }),
            422,
        )
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'empresa', entidad_id: id })
            .select('campo')
        assert.notInclude(
            cambios.map((c) => c.campo),
            'nit_valido',
            'nit_valido es derivado: no se audita',
        )
    })

    test('cliente con NIT de letras: 201 marcado, tipo nit; corregirlo apaga la marca', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const creado = await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({ nombre: unico('Letras'), tipo_documento_fiscal: 'nit', nit_cui: 'ABC-123' }),
            201,
        )
        assert.include(creado.body(), {
            tipo_documento_fiscal: 'nit',
            nit_cui: 'ABC123',
            nit_cui_invalido: true,
        })
        const fila = await db.from('core.clientes').where('id', creado.body().id).first()
        assert.equal(fila.tipo_documento_fiscal, 'nit', 'el trigger no lo vuelve cf')

        const corregido = await estado(
            client
                .put(`/api/v1/clientes/${creado.body().id}`)
                .bearerToken(token)
                .json({ version: creado.body().version, nit_cui: '12345679' }),
            200,
        )
        assert.include(corregido.body(), { tipo_documento_fiscal: 'nit', nit_cui_invalido: false })

        const sinTipo = await estado(
            client
                .post('/api/v1/clientes')
                .bearerToken(token)
                .json({ nombre: unico('Sin tipo'), nit_cui: '1234567' }),
            201,
        )
        assert.include(sinTipo.body(), { tipo_documento_fiscal: 'nit', nit_cui_invalido: true })
    })
})

test.group('NIT tolerante: FEL', (group) => {
    group.each.teardown(async () => {
        // el DTE de producción (INFILE) no debe quedar en la cola de otras suites
        await sacarDeLaColaFel()
        await soloEmpresaPrincipal()
    })

    test('producción con NIT de empresa que no cuadra: 422 nit_emisor_invalido; pruebas: 200', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        await db.from('core.empresas').where('nit', 'DEMO123').whereNot('id', 1).update({ activa: false })
        const empresa = await crearEmpresa(client, token, 'DEMO-123')
        const id = empresa.body().id as number
        const base = { empresa_id: id, proveedor: 'infile', modo: 'opcional', version: 0 }
        const prod = await estado(
            client
                .put('/api/v1/fel/configuracion')
                .bearerToken(token)
                .header('X-Empresa-Id', String(id))
                .json({ ...base, ambiente: 'produccion' }),
            422,
        )
        assert.equal(prod.body().errors[0].rule, 'nit_emisor_invalido')
        assert.equal(prod.body().errors[0].field, 'ambiente')
        const pruebas = await estado(
            client
                .put('/api/v1/fel/configuracion')
                .bearerToken(token)
                .header('X-Empresa-Id', String(id))
                .json({ ...base, ambiente: 'pruebas' }),
            200,
        )
        assert.include(pruebas.body(), { ambiente: 'pruebas', modo: 'opcional' })
        // desactivada en producción no certifica: no exige el NIT
        await estado(
            client
                .put('/api/v1/fel/configuracion')
                .bearerToken(token)
                .header('X-Empresa-Id', String(id))
                .json({ ...base, modo: 'desactivada', ambiente: 'produccion', version: 1 }),
            200,
        )
    })

    test('receptor con la marca: en pruebas viaja el NIT; en producción sale CF', async ({ assert }) => {
        const e = await empresasFel('opcional')
        // sin tipo: lo clasifica el trigger (NIT con letras = nit marcado)
        const clienteId = await crearClienteFila({ nit_cui: 'ABC123' })
        const c = await db.from('core.clientes').where('id', clienteId).first()
        assert.include(c, { tipo_documento_fiscal: 'nit', nit_cui_invalido: true })

        // B: pruebas con el certificador falso
        const enPruebas = await servicioFel(e, 'emitir', '150.00', clienteId, e.B)
        await new SolicitarCertificacion().execute({ factura_id: enPruebas.facturas[0]!.id }, e.ctx)
        const [dtePruebas] = await dtesDe('factura', enPruebas.facturas[0]!.id)
        assert.include(dtePruebas!.receptor, { tipo: 'nit', id: 'ABC123' })

        // C: producción con INFILE (NIT de empresa válido); el DTE se crea pero no se envía
        await db.from('core.empresas').where('id', e.C).update({ nit: nitAleatorio() })
        const actual = await configuracionFel(e.C)
        await new ConfigurarFel().execute(
            {
                empresa_id: e.C,
                proveedor: 'infile',
                ambiente: 'produccion',
                modo: 'opcional',
                version: actual.version,
            },
            e.ctx,
        )
        await new GuardarCredencialesFel().execute(
            {
                empresa_id: e.C,
                ambiente: 'produccion',
                proveedor: 'infile',
                secreto: { usuario_api: 'u', llave_api: 'k', usuario_firma: 'u', llave_firma: 'f' },
            },
            e.ctx,
        )
        const enProduccion = await servicioFel(e, 'emitir', '150.00', clienteId, e.C)
        await new SolicitarCertificacion().execute({ factura_id: enProduccion.facturas[0]!.id }, e.ctx)
        const [dteProd] = await dtesDe('factura', enProduccion.facturas[0]!.id)
        assert.include(dteProd!.receptor, { tipo: 'cf', id: 'CF' })
        assert.equal(dteProd!.estado, 'pendiente')
    })
})
