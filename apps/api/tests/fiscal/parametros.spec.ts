import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import EditarParametro from '#fiscal/actions/editar_parametro'
import { parametro, valorParametro } from '#fiscal/parametros'
import { impuesto } from '#fiscal/impuestos'
import { hoyFiscal } from '#fiscal/comun'
import { cacheParametros, publicarInvalidacion } from '#fiscal/cache_parametros'
import { contextoPrueba, estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { empresaInstalada, esquemas, eventos, exigirCampos } from '#tests/fiscal/ayudas_fiscal'

/**
 * Parámetros con vigencia (contrato §3.2, §4 y §5): solo inserción, la cadena empresa →
 * instalación → global → paquete, un valor nuevo no cambia el pasado, lo sin valor responde 422 y
 * cada empresa tiene los suyos.
 */

async function usuarioEnEmpresas(roles: string[], empresas: number[]) {
    const datos = await usuarioConRoles(roles)
    await db.from('core.usuarios').where('id', datos.usuario.id).update({ alcance_global: false })
    await db
        .table('core.usuarios_empresas')
        .multiInsert(empresas.map((empresaId) => ({ usuario_id: datos.usuario.id, empresa_id: empresaId })))
    return datos
}

test.group('Localización fiscal · parámetros con vigencia', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('una tasa vieja se lee con el valor de su fecha (ISR 31 % en 2013, 28 % en 2014, 25 % desde 2015)', async ({
        assert,
    }) => {
        const leido33 = await impuesto(1, 'ISR_UTILIDADES', '2013-06-30')
        assert.equal(leido33.tasa, '31.00')
        const leido34 = await impuesto(1, 'ISR_UTILIDADES', '2014-12-31')
        assert.equal(leido34.tasa, '28.00')
        const leido35 = await impuesto(1, 'ISR_UTILIDADES', '2026-10-17')
        assert.equal(leido35.tasa, '25.00')
        // el límite de pequeño contribuyente 2026 no se inventa para 2025
        assert.equal(await valorParametro(1, 'pc_limite_anual', '2026-03-01'), '500285.00')
        await assert.rejects(() => parametro(1, 'pc_limite_anual', '2025-12-31'), /pc_limite_anual/)
    })

    test('un valor nuevo con vigencia futura no cambia hoy ni el pasado; deja audit.cambios y evento', async ({
        assert,
    }) => {
        const { empresaId } = await empresaInstalada()
        const ctx = { ...contextoPrueba(), empresaId }
        const creado = await new EditarParametro().execute(
            {
                clave: 'credito_fiscal_ventana_meses',
                valor: 3,
                vigente_desde: '2099-01-01',
                motivo: 'Reforma de prueba',
            },
            ctx,
        )
        assert.equal(creado.nivel, 'empresa')
        assert.equal(creado.anterior, 2)
        assert.equal(await valorParametro(empresaId, 'credito_fiscal_ventana_meses', hoyFiscal()), 2)
        assert.equal(await valorParametro(empresaId, 'credito_fiscal_ventana_meses', '2015-05-01'), 2)
        assert.equal(await valorParametro(empresaId, 'credito_fiscal_ventana_meses', '2099-01-01'), 3)

        const cambio = await db
            .from('audit.cambios')
            .where({
                entidad_tipo: 'parametro_fiscal',
                entidad_id: creado.id,
                campo: 'credito_fiscal_ventana_meses',
            })
            .first()
        assert.equal(cambio.antes, 2)
        assert.equal(cambio.despues, 3)
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'fiscal.editar_parametros', entidad_id: creado.id })
            .first()
        assert.equal(accion.resultado, 'ok')
        assert.equal(Number(accion.empresa_id), empresaId)
        const emitidos = await eventos('fiscal.parametros_cambiados', 'empresa_id', empresaId)
        const evento = emitidos.find((e) => (e.claves as string[])[0] === 'credito_fiscal_ventana_meses')
        assert.deepEqual(evento, {
            empresa_id: empresaId,
            claves: ['credito_fiscal_ventana_meses'],
            vigente_desde: '2099-01-01',
        })
    })

    test('cadena empresa → global → paquete, y dos empresas con valores distintos', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const a = await empresaInstalada()
        const b = await empresaInstalada()
        const leer = (empresaId: number, fecha: string) =>
            parametro(empresaId, 'consumidor_final_limite', fecha)

        const leido97 = await leer(a.empresaId, '2090-01-01')
        assert.equal(leido97.nivel, 'paquete')
        // global desde 2090 (alcance global)
        await estado(
            client
                .post('/api/v1/fiscal/parametros/consumidor_final_limite/valores')
                .bearerToken(token)
                .header('X-Empresa-Id', String(a.empresaId))
                .json({
                    valor: '3000.00',
                    vigente_desde: '2090-01-01',
                    motivo: 'Valor global de prueba',
                    ambito: 'global',
                }),
            201,
        )
        // la empresa B se adelanta con el suyo desde 2091
        const propio = await estado(
            client
                .post('/api/v1/fiscal/parametros/consumidor_final_limite/valores')
                .bearerToken(token)
                .header('X-Empresa-Id', String(b.empresaId))
                .json({ valor: '4000.00', vigente_desde: '2091-01-01', motivo: 'Valor propio de prueba' }),
            201,
        )
        const leido121 = await esquemas()
        exigirCampos(assert, leido121.ValorParametroCreado!, propio.body(), 'ValorParametroCreado')

        const leido123 = await leer(a.empresaId, '2089-12-31')
        assert.equal(leido123.valor, '2500.00')
        assert.include(await leer(a.empresaId, '2090-06-01'), { valor: '3000.00', nivel: 'global' })
        assert.include(await leer(a.empresaId, '2091-06-01'), { valor: '3000.00', nivel: 'global' })
        assert.include(await leer(b.empresaId, '2090-06-01'), { valor: '3000.00', nivel: 'global' })
        assert.include(await leer(b.empresaId, '2091-06-01'), { valor: '4000.00', nivel: 'empresa' })

        // la lista por la API, con su esquema
        const lista = await estado(
            client
                .get('/api/v1/fiscal/parametros?fecha=2091-06-01')
                .bearerToken(token)
                .header('X-Empresa-Id', String(b.empresaId)),
            200,
        )
        const todos = await esquemas()
        exigirCampos(assert, todos.ParametrosFiscales!, lista.body(), 'ParametrosFiscales')
        for (const p of lista.body().parametros) {
            exigirCampos(assert, todos.ParametroFiscal!, p, `ParametroFiscal ${p.clave}`)
        }
        const cf = lista
            .body()
            .parametros.find((p: { clave: string }) => p.clave === 'consumidor_final_limite')
        assert.include(cf, {
            valor: '4000.00',
            nivel: 'empresa',
            fuente: 'inv. C.2 (Reglamento del IVA, art. 30.9, reformado por el AG 12-2023)',
        })
        const historial = await estado(
            client
                .get('/api/v1/fiscal/parametros/consumidor_final_limite/historial')
                .bearerToken(token)
                .header('X-Empresa-Id', String(b.empresaId)),
            200,
        )
        exigirCampos(assert, todos.HistorialParametroFiscal!, historial.body(), 'HistorialParametroFiscal')
        assert.deepEqual(
            historial.body().valores.map((v: { nivel: string }) => v.nivel),
            ['paquete', 'global', 'empresa'],
        )

        // un usuario de la empresa A no edita en la B ni pone valores globales
        const soloA = await usuarioEnEmpresas(['contabilidad'], [a.empresaId])
        await estado(
            client
                .post('/api/v1/fiscal/parametros/consumidor_final_limite/valores')
                .bearerToken(soloA.token)
                .json({
                    valor: '1.00',
                    vigente_desde: '2092-01-01',
                    motivo: 'Intento',
                    empresa_id: b.empresaId,
                }),
            403,
        )
        const global = await estado(
            client
                .post('/api/v1/fiscal/parametros/consumidor_final_limite/valores')
                .bearerToken(soloA.token)
                .json({ valor: '1.00', vigente_desde: '2092-01-01', motivo: 'Intento', ambito: 'global' }),
            403,
        )
        assert.equal(global.body().type, 'urn:argosisp:problema:alcance_global_requerido')
    })

    test('sin valor y marcado contador: 422 parametro_sin_confirmar hasta que el contador lo llena', async ({
        assert,
    }) => {
        const { empresaId } = await empresaInstalada()
        const error = await parametro(empresaId, 'interes_resarcitorio', hoyFiscal()).catch((e) => e)
        assert.equal(error.status, 422)
        assert.equal(error.tipo, 'urn:argosisp:problema:parametro_sin_confirmar')
        assert.equal(error.errores[0].field, 'interes_resarcitorio')

        await new EditarParametro().execute(
            {
                clave: 'interes_resarcitorio',
                valor: '12.50',
                vigente_desde: '2026-07-01',
                motivo: 'Tasa que confirmó el contador',
            },
            { ...contextoPrueba(), empresaId },
        )
        assert.equal(await valorParametro(empresaId, 'interes_resarcitorio', hoyFiscal()), '12.50')
        // antes de su vigencia sigue sin valor
        await assert.rejects(() => parametro(empresaId, 'interes_resarcitorio', '2026-06-30'))
    })

    test('no editables, fuera de rango, periodo cerrado y vigencia duplicada', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { empresaId } = await empresaInstalada()
        const post = (clave: string, cuerpo: Record<string, unknown>, status: number) =>
            estado(
                client
                    .post(`/api/v1/fiscal/parametros/${clave}/valores`)
                    .bearerToken(token)
                    .header('X-Empresa-Id', String(empresaId))
                    .json({ motivo: 'Prueba de validación', vigente_desde: '2095-01-01', ...cuerpo }),
                status,
            )
        const tipo = (r: { body(): { type: string } }) => r.body().type.replace('urn:argosisp:problema:', '')

        assert.equal(tipo(await post('moneda', { valor: 'USD' }, 422)), 'parametro_no_editable')
        assert.equal(tipo(await post('regimen', { valor: 'utilidades' }, 422)), 'parametro_no_editable')
        assert.equal(
            tipo(await post('reserva_legal_pct', { valor: '5.00', ambito: 'global' }, 422)),
            'parametro_no_editable',
        )
        const rango = await post('reserva_legal_pct', { valor: '4.00' }, 422)
        assert.equal(tipo(rango), 'parametro_fuera_de_rango')
        assert.include(rango.body().errors[0], { field: 'valor', rule: 'minimo' })
        const tope = await post(
            'depreciacion',
            {
                valor: {
                    equipo_red: '10.00',
                    computacion: '40.00',
                    mobiliario: '20.00',
                    vehiculos: '20.00',
                    herramientas: '25.00',
                    edificios: '5.00',
                    otros: '10.00',
                },
            },
            422,
        )
        assert.include(tope.body().errors[0], { field: 'valor.computacion', rule: 'maximo' })
        const forma = await post('multa_declaracion_tardia', { valor: { por_dia: '50.00' } }, 422)
        assert.include(forma.body().errors[0], { field: 'valor.maximo', rule: 'required' })
        assert.equal(
            tipo(await post('isr_trimestral_metodo', { valor: 'otro' }, 422)),
            'parametro_fuera_de_rango',
        )
        await post('no_existe', { valor: 1 }, 404)

        // menos depreciación que la legal sí se admite
        await post(
            'depreciacion',
            {
                valor: {
                    equipo_red: '10.00',
                    computacion: '25.00',
                    mobiliario: '20.00',
                    vehiculos: '20.00',
                    herramientas: '25.00',
                    edificios: '5.00',
                    otros: '10.00',
                },
            },
            201,
        )
        await post('pc_alertas', { valor: ['75.00', '90.00', '100.00'] }, 201)

        // periodo cerrado: agosto de 2026 de esta empresa
        await new CerrarPeriodo().execute({ anio: 2026, mes: 8, empresa_id: empresaId }, contextoPrueba())
        const bloqueado = await post('nota_ventana_meses', { valor: 3, vigente_desde: '2026-08-15' }, 422)
        assert.equal(tipo(bloqueado), 'vigencia_en_periodo_bloqueado')
        assert.equal(bloqueado.body().errors[0].field, 'vigente_desde')
        assert.equal(
            tipo(await post('nota_ventana_meses', { valor: 3, vigente_desde: '2026-01-01' }, 422)),
            'vigencia_en_periodo_bloqueado',
        )
        await post('nota_ventana_meses', { valor: 3, vigente_desde: '2026-09-01' }, 201)
        assert.equal(
            tipo(await post('nota_ventana_meses', { valor: 4, vigente_desde: '2026-09-01' }, 409)),
            'vigencia_duplicada',
        )
    })

    test('caché por empresa: se invalida al editar y por el aviso entre procesos, nunca por TTL', async ({
        assert,
    }) => {
        await cacheParametros.activar()
        try {
            assert.isTrue(cacheParametros.lista)
            const { empresaId } = await empresaInstalada()
            assert.equal(await valorParametro(empresaId, 'libros_ventana_meses', '2096-01-01'), 2)
            // la acción invalida al confirmar
            await new EditarParametro().execute(
                {
                    clave: 'libros_ventana_meses',
                    valor: 3,
                    vigente_desde: '2096-01-01',
                    motivo: 'Prueba de caché',
                },
                { ...contextoPrueba(), empresaId },
            )
            assert.equal(await valorParametro(empresaId, 'libros_ventana_meses', '2096-01-01'), 3)

            // otro proceso escribió (aquí, directo en la base): la caché sigue con lo anterior…
            await db.table('fiscal.parametros_valores').insert({
                pais: 'GT',
                empresa_id: empresaId,
                clave: 'libros_ventana_meses',
                valor: JSON.stringify(4),
                vigente_desde: '2097-01-01',
                origen: 'usuario',
                motivo: 'Escrito por otro proceso',
            })
            assert.equal(await valorParametro(empresaId, 'libros_ventana_meses', '2097-01-01'), 3)
            // …hasta que llega su aviso por Pub/Sub
            await publicarInvalidacion(empresaId, 'otro-proceso')
            let valor: unknown = 3
            for (let i = 0; i < 50 && valor !== 4; i++) {
                await new Promise((r) => setTimeout(r, 20))
                valor = await valorParametro(empresaId, 'libros_ventana_meses', '2097-01-01')
            }
            assert.equal(valor, 4)
        } finally {
            await cacheParametros.desactivar()
        }
    })
})
