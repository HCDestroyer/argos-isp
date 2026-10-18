import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { CUENTAS, PLAN_CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_AGREGADAS_GT, CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { PARAMETROS_GT } from '#fiscal/l10n/gt/parametros'
import { IMPUESTOS_GT } from '#fiscal/l10n/gt/impuestos'
import { instalarPaquete, paqueteDePais } from '#fiscal/instalador'
import { PAQUETE_GT_2026_1 } from '#fiscal/l10n/gt/index'
import { parametro } from '#fiscal/parametros'
import { hoyFiscal } from '#fiscal/comun'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { contextoPrueba, estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { registrarInstaladorLocalizacion } from '#core/localizacion'
import { verificadorNit } from '#core/nit_cui'
import { instaladorFiscal, tieneDocumentosFiscales } from '#fiscal/instalador_localizacion'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import { conteos, empresaInstalada, esquemas, eventos, exigirCampos } from '#tests/fiscal/ayudas_fiscal'

/**
 * Fase 2 de la localización fiscal: instalar `gt-2026.1` es aditivo e idempotente, no rompe el plan
 * base (`CUENTAS.*`) y deja en la empresa lo que ya tenía (régimen y establecimiento).
 */
test.group('Localización fiscal · instalación', (group) => {
    group.setup(() => registrarInstaladorLocalizacion(instaladorFiscal))
    group.each.teardown(() => soloEmpresaPrincipal())

    test('la migración instaló gt-2026.1 en la empresa 1 sin tocar el plan base', async ({ assert }) => {
        const instalacion = await db.from('fiscal.instalaciones').where('empresa_id', 1).orderBy('id').first()
        assert.equal(instalacion.localizacion_codigo, 'gt-2026.1')

        const cuentas = (await db
            .from('ledger.cuentas')
            .select('codigo', 'tipo', 'naturaleza', 'pais')) as Array<{
            codigo: string
            tipo: string
            naturaleza: string
            pais: string
        }>
        const porCodigo = new Map(cuentas.map((c) => [c.codigo, c]))
        for (const base of PLAN_CUENTAS) {
            assert.equal(porCodigo.get(base.codigo)?.tipo, base.tipo, base.codigo)
        }
        for (const gt of CUENTAS_AGREGADAS_GT) {
            assert.equal(porCodigo.get(gt.codigo)?.tipo, gt.tipo, gt.codigo)
        }
        assert.equal(porCodigo.get(CUENTAS.CXC_CLIENTES)!.naturaleza, 'deudora')
        assert.equal(porCodigo.get(CUENTAS.IVA_DEBITO)!.naturaleza, 'acreedora')
        assert.equal(porCodigo.get(CUENTAS_GT.CAPITAL_SOCIAL)!.tipo, 'patrimonio')
        assert.equal(porCodigo.get(CUENTAS_GT.CAPITAL_SOCIAL)!.naturaleza, 'acreedora')
        // contracuentas: depreciación acumulada (activo acreedor) e ingresos diferidos (ingreso deudor)
        assert.equal(porCodigo.get(`${CUENTAS_GT.DEPRECIACION_ACUMULADA}.01`)!.naturaleza, 'acreedora')
        assert.equal(porCodigo.get(CUENTAS_GT.INGRESOS_DIFERIDOS_LEALTAD)!.naturaleza, 'deudora')
        assert.isTrue(cuentas.every((c) => c.pais === 'GT'))

        const flujo = (await db
            .from('ledger.cuentas')
            .whereIn('codigo', [
                CUENTAS.CAJA_PRINCIPAL,
                `${CUENTAS_GT.PROPIEDAD_PLANTA_EQUIPO}.01`,
                CUENTAS_GT.CAPITAL_SOCIAL,
                CUENTAS.CXC_CLIENTES,
                CUENTAS.INGRESOS_INTERNET,
            ])
            .select('codigo', 'categoria_flujo', 'reinicia_anual')) as Array<{
            codigo: string
            categoria_flujo: string
            reinicia_anual: boolean
        }>
        const f = new Map(flujo.map((x) => [x.codigo, x]))
        assert.equal(f.get(CUENTAS.CAJA_PRINCIPAL)!.categoria_flujo, 'efectivo')
        assert.equal(f.get(`${CUENTAS_GT.PROPIEDAD_PLANTA_EQUIPO}.01`)!.categoria_flujo, 'inversion')
        assert.equal(f.get(CUENTAS_GT.CAPITAL_SOCIAL)!.categoria_flujo, 'financiamiento')
        assert.equal(f.get(CUENTAS.CXC_CLIENTES)!.categoria_flujo, 'operacion')
        assert.isTrue(f.get(CUENTAS.INGRESOS_INTERNET)!.reinicia_anual)
        assert.isFalse(f.get(CUENTAS.CXC_CLIENTES)!.reinicia_anual)

        // catálogo completo: parámetros, valores del paquete e impuestos
        const parametros = await db.from('fiscal.parametros').count('* as n').first()
        assert.equal(Number(parametros.n), PARAMETROS_GT.length)
        const versiones = IMPUESTOS_GT.reduce((n, i) => n + i.versiones.length, 0)
        const delPaquete = await db
            .from('fiscal.impuestos_versiones')
            .where('origen', 'paquete')
            .count('* as n')
            .first()
        assert.equal(Number(delPaquete.n), versiones)
    })

    test('instalar dos veces no agrega nada (por la API, 200 y ya_instalada)', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const antes = await conteos()
        const previos = await eventos('fiscal.localizacion_instalada', 'empresa_id', 1)
        const eventosAntes = previos.length
        const respuesta = await estado(
            client.post('/api/v1/fiscal/empresas/1/actualizar-localizacion').bearerToken(token).json({}),
            200,
        )
        const cuerpo = respuesta.body()
        assert.isTrue(cuerpo.resumen.ya_instalada)
        assert.deepEqual(cuerpo.resumen.cuentas, [])
        assert.deepEqual(cuerpo.resumen.valores, [])
        assert.deepEqual(cuerpo.resumen.impuestos, [])
        assert.isNull(cuerpo.resumen.instalacion_id)
        await estado(
            client.post('/api/v1/fiscal/empresas/1/actualizar-localizacion').bearerToken(token).json({}),
            200,
        )
        assert.deepEqual(await conteos(), antes)
        assert.lengthOf(await eventos('fiscal.localizacion_instalada', 'empresa_id', 1), eventosAntes)

        // el paquete aplicado directo (como la migración) tampoco agrega nada
        await db.transaction((trx) =>
            instalarPaquete(trx, PAQUETE_GT_2026_1, 1, { instaladaPor: null, hoy: hoyFiscal() }),
        )
        assert.deepEqual(await conteos(), antes)

        const todos = await esquemas()
        exigirCampos(assert, todos.ResultadoInstalacionFiscal!, cuerpo, 'ResultadoInstalacionFiscal')
    })

    test('empresa sin localización (fila creada fuera de empresas.crear) responde 422; al instalarla toma su régimen y establecimiento', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const empresaId = await crearEmpresaFila({
            regimen_isr: 'retencion_definitiva',
            codigo_establecimiento: 3,
        })
        const sin = await estado(
            client
                .get('/api/v1/fiscal/parametros')
                .bearerToken(token)
                .header('X-Empresa-Id', String(empresaId)),
            422,
        )
        assert.equal(sin.body().type, 'urn:argosisp:problema:localizacion_no_instalada')
        const vista = await estado(
            client.get(`/api/v1/fiscal/empresas/${empresaId}/localizacion`).bearerToken(token),
            200,
        )
        assert.isFalse(vista.body().instalada)
        assert.isTrue(vista.body().actualizacion_disponible)

        const antes = await conteos()
        const respuesta = await estado(
            client
                .post(`/api/v1/fiscal/empresas/${empresaId}/actualizar-localizacion`)
                .bearerToken(token)
                .json({ codigo: 'gt-2026.1' }),
            200,
        )
        const cuerpo = respuesta.body()
        assert.isFalse(cuerpo.resumen.ya_instalada)
        assert.isTrue(cuerpo.instalada)
        assert.equal(cuerpo.codigo, 'gt-2026.1')
        assert.lengthOf(cuerpo.resumen.establecimientos, 1)
        // solo se agregó lo de la empresa: el catálogo y los valores del paquete ya estaban
        const despues = await conteos()
        assert.equal(despues['ledger.cuentas'], antes['ledger.cuentas'])
        assert.equal(despues['fiscal.parametros_valores'], antes['fiscal.parametros_valores']! + 2) // inicio_libros y régimen
        assert.equal(despues['fiscal.instalaciones'], antes['fiscal.instalaciones']! + 1)
        assert.equal(despues['fiscal.establecimientos'], antes['fiscal.establecimientos']! + 1)

        const regimen = await parametro(empresaId, 'regimen', hoyFiscal())
        assert.equal(regimen.valor, 'opcional_simplificado')
        assert.equal(regimen.nivel, 'instalacion')
        const leido170 = await parametro(empresaId, 'inicio_libros', hoyFiscal())
        assert.equal(leido170.valor, hoyFiscal())

        const establecimiento = await db
            .from('fiscal.establecimientos')
            .where('empresa_id', empresaId)
            .first()
        assert.equal(establecimiento.codigo, 3)
        assert.isTrue(establecimiento.por_defecto)

        const frases = await estado(
            client.get('/api/v1/fiscal/frases').bearerToken(token).header('X-Empresa-Id', String(empresaId)),
            200,
        )
        assert.deepEqual(
            frases.body().vigentes.map((f: { clave: string }) => f.clave),
            ['isr_retencion_definitiva'],
        )

        const [evento] = await eventos('fiscal.localizacion_instalada', 'empresa_id', empresaId)
        assert.deepEqual(evento, { empresa_id: empresaId, pais: 'GT', codigo: 'gt-2026.1', de_codigo: null })
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'empresa', entidad_id: empresaId, campo: 'localizacion' })
            .first()
        assert.equal(cambio.despues, 'gt-2026.1')

        // segunda vez: nada
        const otra = await conteos()
        await estado(
            client
                .post(`/api/v1/fiscal/empresas/${empresaId}/actualizar-localizacion`)
                .bearerToken(token)
                .json({}),
            200,
        )
        assert.deepEqual(await conteos(), otra)
    })

    test('versión desconocida 422; país sin paquete 422; sin permiso 403', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(
            client
                .post('/api/v1/fiscal/empresas/1/actualizar-localizacion')
                .bearerToken(token)
                .json({ codigo: 'gt-1999.1' }),
            422,
        )
        assert.equal(r.body().errors[0].field, 'codigo')
        assert.throws(() => paqueteDePais('MX'), /No hay paquete/)
        const contabilidad = await usuarioConRoles(['contabilidad'])
        await estado(
            client
                .post('/api/v1/fiscal/empresas/1/actualizar-localizacion')
                .bearerToken(contabilidad.token)
                .json({}),
            403,
        )
        await estado(client.get('/api/v1/fiscal/localizaciones').bearerToken(contabilidad.token), 200)
    })

    test('GET /fiscal/localizaciones y /fiscal/empresas/:id/localizacion cumplen su esquema', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['lectura'])
        const todos = await esquemas()
        const lista = await estado(client.get('/api/v1/fiscal/localizaciones').bearerToken(token), 200)
        const gt = lista.body().find((l: { codigo: string }) => l.codigo === 'gt-2026.1')
        exigirCampos(assert, todos.LocalizacionFiscal!, gt, 'LocalizacionFiscal')
        assert.isTrue(gt.mas_reciente)
        const empresa = await estado(
            client.get('/api/v1/fiscal/empresas/1/localizacion').bearerToken(token),
            200,
        )
        exigirCampos(assert, todos.LocalizacionEmpresa!, empresa.body(), 'LocalizacionEmpresa')
        assert.equal(empresa.body().codigo, 'gt-2026.1')
        // catálogo de tipos de DTE del paquete (para el selector de frases, A4)
        const codigos = empresa.body().tipos_dte.map((t: { codigo: string }) => t.codigo)
        assert.includeMembers(codigos, ['FACT', 'FPEQ', 'NCRE', 'NDEB'])
        assert.deepInclude(empresa.body().tipos_dte[0], {
            codigo: 'FACT',
            regimenes: ['utilidades', 'opcional_simplificado'],
        })
    })

    test('instalarla en otra empresa no cambia los valores de la primera', async ({ assert }) => {
        const antes = await parametro(1, 'regimen', hoyFiscal())
        await empresaInstalada({ regimen_isr: 'pequeno_contribuyente' })
        assert.deepEqual(await parametro(1, 'regimen', hoyFiscal()), antes)
    })

    test('POST /empresas: la empresa nace con la localización instalada y el núcleo lee sus datos fiscales', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const cuerpoNit = String(Math.floor(1_000_000 + Math.random() * 8_999_999))
        const creada = await estado(
            client
                .post('/api/v1/empresas')
                .bearerToken(token)
                .json({
                    nit: `${cuerpoNit}${verificadorNit(cuerpoNit)}`,
                    razon_social: 'Fiscal de Prueba, S.A.',
                    nombre_comercial: 'Fiscal de Prueba',
                    regimen_isr: 'retencion_definitiva',
                    codigo_establecimiento: 4,
                }),
            201,
        )
        const empresaId = creada.body().id as number
        const vista = await estado(
            client.get(`/api/v1/fiscal/empresas/${empresaId}/localizacion`).bearerToken(token),
            200,
        )
        assert.include(vista.body(), {
            instalada: true,
            codigo: 'gt-2026.1',
            actualizacion_disponible: false,
        })
        const regimen = await parametro(empresaId, 'regimen', hoyFiscal())
        assert.include(regimen, { valor: 'opcional_simplificado', nivel: 'instalacion' })
        const [evento] = await eventos('fiscal.localizacion_instalada', 'empresa_id', empresaId)
        assert.deepEqual(evento, { empresa_id: empresaId, pais: 'GT', codigo: 'gt-2026.1', de_codigo: null })
        const auditoria = await db
            .from('audit.acciones')
            .where({ accion: 'fiscal.instalar', entidad_id: empresaId })
        assert.lengthOf(auditoria, 1)

        // regimen_isr y codigo_establecimiento de la empresa salen de fiscal
        await new CambiarRegimen().execute(
            { regimen: 'pequeno_contribuyente', vigente_desde: '2020-01-01', empresa_id: empresaId },
            contextoPrueba(),
        )
        const ficha = await estado(client.get(`/api/v1/empresas/${empresaId}`).bearerToken(token), 200)
        assert.include(ficha.body(), { regimen_isr: 'pequeno_contribuyente', codigo_establecimiento: 4 })
        // sin documentos fiscales la empresa puede cambiar de país (hoy solo hay GT)
        assert.isFalse(await tieneDocumentosFiscales(empresaId, db.connection()))
        assert.deepEqual(instaladorFiscal.paises(), ['GT'])
    })
})
