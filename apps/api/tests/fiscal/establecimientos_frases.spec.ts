import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { empresaInstalada, esquemas, eventos, exigirCampos } from '#tests/fiscal/ayudas_fiscal'

/**
 * Establecimientos de la SAT (uno por defecto por empresa) y frases manuales (solo inserción;
 * las del régimen salen del régimen).
 */
test.group('Localización fiscal · establecimientos y frases', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('alta, duplicado, cambio del por defecto, versión y reglas del por defecto', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['contabilidad'])
        const { empresaId } = await empresaInstalada()

        const uno = await estado(
            client
                .post('/api/v1/fiscal/establecimientos')
                .bearerToken(token)
                .header('X-Empresa-Id', String(empresaId))
                .json({
                    codigo: 1,
                    nombre: 'Oficina central',
                    municipio: 'Guatemala',
                    departamento: 'Guatemala',
                }),
            201,
        )
        assert.isTrue(uno.body().por_defecto)
        const leido34 = await esquemas()
        exigirCampos(assert, leido34.EstablecimientoFiscal!, uno.body(), 'EstablecimientoFiscal')
        const dup = await estado(
            client
                .post('/api/v1/fiscal/establecimientos')
                .bearerToken(token)
                .header('X-Empresa-Id', String(empresaId))
                .json({ codigo: 1, nombre: 'Otro' }),
            409,
        )
        assert.equal(dup.body().type, 'urn:argosisp:problema:establecimiento_duplicado')

        const dos = await estado(
            client
                .post('/api/v1/fiscal/establecimientos')
                .bearerToken(token)
                .header('X-Empresa-Id', String(empresaId))
                .json({
                    codigo: 2,
                    nombre: 'Sucursal',
                    por_defecto: true,
                }),
            201,
        )
        assert.isTrue(dos.body().por_defecto)
        const lista = await estado(
            client
                .get('/api/v1/fiscal/establecimientos')
                .bearerToken(token)
                .header('X-Empresa-Id', String(empresaId)),
            200,
        )
        assert.deepEqual(
            lista.body().map((e: { codigo: number; por_defecto: boolean }) => [e.codigo, e.por_defecto]),
            [
                [2, true],
                [1, false],
            ],
        )

        // el por defecto no se desmarca ni se desactiva directo
        const desmarcar = await estado(
            client
                .put(`/api/v1/fiscal/establecimientos/${dos.body().id}`)
                .bearerToken(token)
                .json({ version: dos.body().version, activo: false }),
            422,
        )
        assert.equal(desmarcar.body().type, 'urn:argosisp:problema:establecimiento_por_defecto')
        // versión vieja: 409
        await estado(
            client
                .put(`/api/v1/fiscal/establecimientos/${uno.body().id}`)
                .bearerToken(token)
                .json({ version: 1, nombre: 'X' }),
            409,
        )
        const unoAhora = await estado(
            client.get(`/api/v1/fiscal/establecimientos/${uno.body().id}`).bearerToken(token),
            200,
        )
        const vuelve = await estado(
            client
                .put(`/api/v1/fiscal/establecimientos/${uno.body().id}`)
                .bearerToken(token)
                .json({ version: unoAhora.body().version, por_defecto: true, direccion: 'Zona 1' }),
            200,
        )
        assert.include(vuelve.body(), { por_defecto: true, direccion: 'Zona 1' })
        const defectos = await db
            .from('fiscal.establecimientos')
            .where({ empresa_id: empresaId, por_defecto: true })
        assert.lengthOf(defectos, 1)

        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'establecimiento', entidad_id: dos.body().id, campo: 'por_defecto' })
            .orderBy('id')
        assert.deepEqual(
            cambios.map((c) => c.despues),
            [true, false],
        )
        const leido115 = await eventos('fiscal.config_cambiada', 'empresa_id', empresaId)
        assert.isAtLeast(leido115.length, 3)
    })

    test('frases manuales: alta, retiro sin UPDATE, del régimen 422, tipo de DTE 422', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['contabilidad'])
        const { empresaId } = await empresaInstalada()
        const post = (cuerpo: Record<string, unknown>, status: number) =>
            estado(
                client
                    .post('/api/v1/fiscal/frases')
                    .bearerToken(token)
                    .header('X-Empresa-Id', String(empresaId))
                    .json({ motivo: 'Resolución de pago directo', ...cuerpo }),
                status,
            )
        const creada = await post(
            {
                tipo_frase: 2,
                escenario: 1,
                texto: 'Pago directo, resolución de prueba',
                tipos_dte: ['fact'],
                vigente_desde: '2026-10-01',
                resolucion: { numero: 'R-1', fecha: '2026-09-30' },
            },
            201,
        )
        const todos = await esquemas()
        exigirCampos(assert, todos.FraseFiscal!, creada.body(), 'FraseFiscal')
        assert.deepEqual(creada.body().tipos_dte, ['FACT'])
        await post(
            { tipo_frase: 2, escenario: 1, texto: 'Otra', tipos_dte: ['FACT'], vigente_desde: '2026-10-01' },
            409,
        )
        await post({ tipo_frase: 2, escenario: 1, activa: false, vigente_desde: '2026-11-01' }, 201)
        const inactiva = await post(
            { tipo_frase: 2, escenario: 1, activa: false, vigente_desde: '2026-12-01' },
            422,
        )
        assert.equal(inactiva.body().type, 'urn:argosisp:problema:frase_inactiva')
        const delRegimen = await post(
            { tipo_frase: 1, escenario: 1, texto: 'x', tipos_dte: ['FACT'], vigente_desde: '2026-10-01' },
            422,
        )
        assert.equal(delRegimen.body().type, 'urn:argosisp:problema:frase_del_regimen')
        const dte = await post(
            { tipo_frase: 4, escenario: 1, texto: 'x', tipos_dte: ['NABN'], vigente_desde: '2026-10-01' },
            422,
        )
        assert.equal(dte.body().errors[0].field, 'tipos_dte.0')

        const vista = (fecha: string) =>
            estado(
                client
                    .get(`/api/v1/fiscal/frases?fecha=${fecha}`)
                    .bearerToken(token)
                    .header('X-Empresa-Id', String(empresaId)),
                200,
            )
        const octubre = await vista('2026-10-15')
        exigirCampos(assert, todos.FrasesFiscales!, octubre.body(), 'FrasesFiscales')
        assert.deepEqual(
            octubre.body().vigentes.map((f: { clave: string }) => f.clave),
            ['isr_pagos_trimestrales', 'manual:2-1'],
        )
        for (const f of octubre.body().vigentes) {
            exigirCampos(assert, todos.FraseFiscal!, f, `FraseFiscal ${f.clave}`)
        }
        const noviembre = await vista('2026-11-15')
        assert.deepEqual(
            noviembre.body().vigentes.map((f: { clave: string }) => f.clave),
            ['isr_pagos_trimestrales'],
        )
        assert.lengthOf(noviembre.body().historial, 2)
    })
})
