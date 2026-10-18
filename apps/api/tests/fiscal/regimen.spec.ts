import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import { parametro } from '#fiscal/parametros'
import { frasesVigentes } from '#fiscal/frases'
import { relojFiscal } from '#fiscal/comun'
import { contextoPrueba, estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { empresaInstalada, esquemas, eventos, exigirCampos } from '#tests/fiscal/ayudas_fiscal'

/**
 * Régimen (contrato §6.2; inv. A.2, LAT arts. 50 y 51): la primera configuración admite cualquier
 * fecha; un cambio rige solo desde el 1 de enero de un año futuro, con aviso a la SAT en diciembre.
 * Las frases siguen al régimen vigente en la fecha del documento.
 */

const original = relojFiscal.ahora
const fijarHoy = (fecha: string) => {
    relojFiscal.ahora = () => new Date(`${fecha}T18:00:00Z`)
}

async function claves(empresaId: number, fecha: string) {
    const leido22 = await frasesVigentes(empresaId, fecha)
    return leido22.map((f) => f.clave)
}

test.group('Localización fiscal · régimen', (group) => {
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('primera configuración con cualquier fecha; las frases cambian con el régimen', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['contabilidad'])
        const { empresaId } = await empresaInstalada()
        assert.deepEqual(await claves(empresaId, '2026-10-17'), ['isr_pagos_trimestrales'])

        const respuesta = await estado(
            client
                .post('/api/v1/fiscal/regimen')
                .bearerToken(token)
                .header('X-Empresa-Id', String(empresaId))
                .json({ regimen: 'opcional_simplificado', vigente_desde: '2020-03-15' }),
            201,
        )
        const leido47 = await esquemas()
        exigirCampos(assert, leido47.RegimenCambiado!, respuesta.body(), 'RegimenCambiado')
        assert.include(respuesta.body(), {
            regimen: 'opcional_simplificado',
            anterior: 'utilidades',
            primera_configuracion: true,
        })
        const leido53 = await parametro(empresaId, 'regimen', '2020-03-14')
        assert.equal(leido53.valor, 'utilidades')
        const leido54 = await parametro(empresaId, 'regimen', '2026-10-17')
        assert.equal(leido54.valor, 'opcional_simplificado')
        assert.deepEqual(await claves(empresaId, '2020-03-14'), ['isr_pagos_trimestrales'])
        assert.deepEqual(await claves(empresaId, '2026-10-17'), ['isr_retencion_definitiva'])

        const [evento] = await eventos('fiscal.config_cambiada', 'empresa_id', empresaId)
        assert.deepEqual(evento, { empresa_id: empresaId, campos: ['regimen', 'frases'] })
        const cambio = await db
            .from('audit.cambios')
            .where({
                entidad_tipo: 'parametro_fiscal',
                entidad_id: respuesta.body().valor_id,
                campo: 'regimen',
            })
            .first()
        assert.equal(cambio.antes, 'utilidades')
        assert.equal(cambio.despues, 'opcional_simplificado')
    })

    test('el régimen migrado de core.empresas no cuenta como configuración: el usuario lo reemplaza desde su fecha', async ({
        assert,
    }) => {
        const { empresaId } = await empresaInstalada({ regimen_isr: 'sujeto_pagos_trimestrales' })
        await new CambiarRegimen().execute(
            { regimen: 'pequeno_contribuyente', vigente_desde: '2024-01-01' },
            { ...contextoPrueba(), empresaId },
        )
        // aunque la fila de la instalación es de hoy, gana la del usuario
        assert.include(await parametro(empresaId, 'regimen', '2026-12-31'), {
            valor: 'pequeno_contribuyente',
            nivel: 'empresa',
        })
        assert.deepEqual(await claves(empresaId, '2026-12-31'), ['pc_sin_credito_fiscal'])
    })

    test('un cambio fuera del 1 de enero o sin aviso de diciembre: 422 regimen_fuera_de_plazo', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['contabilidad'])
        const { empresaId } = await empresaInstalada()
        const post = (cuerpo: Record<string, unknown>, status: number) =>
            estado(
                client
                    .post('/api/v1/fiscal/regimen')
                    .bearerToken(token)
                    .header('X-Empresa-Id', String(empresaId))
                    .json(cuerpo),
                status,
            )
        await post({ regimen: 'utilidades', vigente_desde: '2015-01-01' }, 201)

        fijarHoy('2026-10-17')
        const tipo = (r: { body(): { type: string } }) => r.body().type.replace('urn:argosisp:problema:', '')
        const mitad = await post(
            {
                regimen: 'opcional_simplificado',
                vigente_desde: '2027-03-01',
                aviso_sat: { numero: 'A-1', fecha: '2026-12-05' },
            },
            422,
        )
        assert.equal(tipo(mitad), 'regimen_fuera_de_plazo')
        assert.equal(mitad.body().errors[0].field, 'vigente_desde')
        // el 1 de enero del año en curso ya pasó
        assert.equal(
            tipo(
                await post(
                    {
                        regimen: 'opcional_simplificado',
                        vigente_desde: '2026-01-01',
                        aviso_sat: { numero: 'A-1', fecha: '2025-12-05' },
                    },
                    422,
                ),
            ),
            'regimen_fuera_de_plazo',
        )
        // sin aviso
        const sinAviso = await post({ regimen: 'opcional_simplificado', vigente_desde: '2027-01-01' }, 422)
        assert.equal(sinAviso.body().errors[0].field, 'aviso_sat')
        // aviso que no es de diciembre, o futuro
        const noviembre = await post(
            {
                regimen: 'opcional_simplificado',
                vigente_desde: '2027-01-01',
                aviso_sat: { numero: 'A-1', fecha: '2026-10-10' },
            },
            422,
        )
        assert.equal(noviembre.body().errors[0].field, 'aviso_sat.fecha')
        assert.equal(
            tipo(
                await post(
                    {
                        regimen: 'opcional_simplificado',
                        vigente_desde: '2027-01-01',
                        aviso_sat: { numero: 'A-1', fecha: '2026-12-05' },
                    },
                    422,
                ),
            ),
            'regimen_fuera_de_plazo',
        )

        // en diciembre, con su aviso: rige el 1 de enero y las frases cambian ese día
        fijarHoy('2026-12-10')
        await post(
            {
                regimen: 'opcional_simplificado',
                vigente_desde: '2027-01-01',
                aviso_sat: { numero: 'SAT-123', fecha: '2026-12-05' },
            },
            201,
        )
        const leido168 = await parametro(empresaId, 'regimen', '2026-12-31')
        assert.equal(leido168.valor, 'utilidades')
        const leido169 = await parametro(empresaId, 'regimen', '2027-01-01')
        assert.equal(leido169.valor, 'opcional_simplificado')
        assert.deepEqual(await claves(empresaId, '2026-12-31'), ['isr_pagos_trimestrales'])
        assert.deepEqual(await claves(empresaId, '2027-01-01'), ['isr_retencion_definitiva'])
        const fila = await db
            .from('fiscal.parametros_valores')
            .where({ empresa_id: empresaId, clave: 'regimen', vigente_desde: '2027-01-01' })
            .first()
        assert.include(fila.motivo, 'aviso SAT SAT-123 del 2026-12-05')

        // el mismo régimen no es un cambio
        fijarHoy('2027-12-10')
        const igual = await post(
            {
                regimen: 'opcional_simplificado',
                vigente_desde: '2028-01-01',
                aviso_sat: { numero: 'SAT-9', fecha: '2027-12-01' },
            },
            422,
        )
        assert.equal(igual.body().errors[0].rule, 'sin_cambio')
    })

    test('el régimen no se cambia por la ruta genérica de parámetros', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(
            client
                .post('/api/v1/fiscal/parametros/regimen/valores')
                .bearerToken(token)
                .header('X-Empresa-Id', '1')
                .json({ valor: 'pequeno_contribuyente', vigente_desde: '2030-01-01', motivo: 'Atajo' }),
            422,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:parametro_no_editable')
        const lectura = await usuarioConRoles(['lectura'])
        await estado(
            client
                .post('/api/v1/fiscal/regimen')
                .bearerToken(lectura.token)
                .json({ regimen: 'utilidades', vigente_desde: '2030-01-01' }),
            403,
        )
    })
})
