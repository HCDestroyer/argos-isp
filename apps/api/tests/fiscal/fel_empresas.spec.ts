import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { verificadorNit } from '#core/nit_cui'
import ActualizarLocalizacion from '#fiscal/actions/actualizar_localizacion'
import CrearEstablecimiento from '#fiscal/actions/crear_establecimiento'
import GuardarCredencialesFel from '#fiscal/actions/guardar_credenciales_fel'
import ProbarCredencialesFel from '#fiscal/actions/probar_credenciales_fel'
import { configuracionFel, estadoFel } from '#fiscal/fel/configuracion'
import { registrarInstaladorLocalizacion } from '#core/localizacion'
import { instaladorFiscal } from '#fiscal/instalador_localizacion'
import { configurarModo } from '#tests/fiscal/ayudas_fel'
import { prepararEmpresas, type Empresas } from '#tests/contabilidad/ayudas_contabilidad'

/**
 * Certificador ligado a empresa + proveedor + ambiente (`contratos/fel-establecimientos.md` lote 2):
 * las credenciales son una fila por (empresa, proveedor, ambiente); `GET /fel/configuracion` dice si
 * la empresa está lista para certificar (`lista`, `faltantes`) con lo **guardado**; «Probar» prueba
 * el proveedor que se le indica. Nada se mezcla entre empresas.
 */

const INFILE = { usuario_api: 'u-api', llave_api: 'k-api', usuario_firma: 'u-firma', llave_firma: 'k-firma' }
const FALSO = { usuario: 'prueba', llave: 'llave-secreta-1' }

function nitValidoNuevo(): string {
    const cuerpo = String(Math.floor(1_000_000 + Math.random() * 8_999_999))
    return `${cuerpo}${verificadorNit(cuerpo)}`
}

/** B y C con la localización GT; B con NIT válido y su establecimiento 1. */
async function empresas(): Promise<Empresas> {
    registrarInstaladorLocalizacion(instaladorFiscal)
    const e = await prepararEmpresas()
    for (const empresaId of [e.B, e.C]) {
        await new ActualizarLocalizacion().execute({ empresa_id: empresaId }, e.ctx)
    }
    await db.from('core.empresas').where('id', e.B).update({ nit: nitValidoNuevo() })
    await establecimientoActivo(e, e.B)
    return e
}

async function establecimientoActivo(e: Empresas, empresaId: number) {
    const hay = await db
        .from('fiscal.establecimientos')
        .where({ empresa_id: empresaId, activo: true })
        .first()
    if (!hay) {
        await new CrearEstablecimiento().execute(
            { empresa_id: empresaId, codigo: 1, nombre: 'Casa matriz', por_defecto: true },
            e.ctx,
        )
    }
}

async function guardar(e: Empresas, empresaId: number, proveedor: 'falso' | 'infile') {
    return new GuardarCredencialesFel().execute(
        {
            empresa_id: empresaId,
            ambiente: 'pruebas',
            proveedor,
            secreto: proveedor === 'falso' ? FALSO : INFILE,
        },
        e.ctx,
    )
}

async function usuarioEnEmpresas(roles: string[], empresasIds: number[]) {
    const datos = await usuarioConRoles(roles)
    await db.from('core.usuarios').where('id', datos.usuario.id).update({ alcance_global: false })
    await db
        .table('core.usuarios_empresas')
        .multiInsert(
            empresasIds.map((empresaId) => ({ usuario_id: datos.usuario.id, empresa_id: empresaId })),
        )
    return datos
}

test.group('FEL por empresa: certificador, proveedor y ambiente', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('cada empresa ve solo sus credenciales, una fila por proveedor y ambiente', async ({
        client,
        assert,
    }) => {
        const e = await empresas()
        await configurarModo(e, e.B, 'opcional')
        await guardar(e, e.B, 'falso')
        await guardar(e, e.B, 'infile')

        const deC = await estado(
            client.get('/api/v1/fel/configuracion').bearerToken(e.token).header('X-Empresa-Id', String(e.C)),
            200,
        )
        assert.deepEqual(deC.body().credenciales, [])
        const deB = await estado(
            client.get('/api/v1/fel/configuracion').bearerToken(e.token).header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.sameMembers(
            deB
                .body()
                .credenciales.map(
                    (c: { proveedor: string; ambiente: string }) => `${c.proveedor}/${c.ambiente}`,
                ),
            ['falso/pruebas', 'infile/pruebas'],
        )
        // nunca las llaves
        assert.notInclude(JSON.stringify(deB.body()), 'k-api')
        assert.notInclude(JSON.stringify(deB.body()), 'llave-secreta-1')
    })

    test('guardar credenciales de otra empresa: 403 sin acceso; con acceso se guardan en esa y no tocan la activa', async ({
        client,
        assert,
    }) => {
        const e = await empresas()
        await configurarModo(e, e.B, 'opcional')
        await guardar(e, e.B, 'falso')
        const versionB = (await db
            .from('fiscal.fel_credenciales')
            .where({ empresa_id: e.B, proveedor: 'falso', ambiente: 'pruebas' })
            .select('version')
            .firstOrFail()) as { version: number }

        const soloB = await usuarioEnEmpresas(['admin'], [e.B])
        await estado(
            client
                .put('/api/v1/fel/credenciales/pruebas')
                .bearerToken(soloB.token)
                .header('X-Empresa-Id', String(e.B))
                .json({ empresa_id: e.C, proveedor: 'falso', credenciales: FALSO }),
            403,
        )
        assert.isNull(await db.from('fiscal.fel_credenciales').where('empresa_id', e.C).first())

        await estado(
            client
                .put('/api/v1/fel/credenciales/pruebas')
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .json({ empresa_id: e.C, proveedor: 'falso', credenciales: FALSO }),
            200,
        )
        assert.isNotNull(await db.from('fiscal.fel_credenciales').where('empresa_id', e.C).first())
        const despuesB = (await db
            .from('fiscal.fel_credenciales')
            .where({ empresa_id: e.B, proveedor: 'falso', ambiente: 'pruebas' })
            .select('version')
            .firstOrFail()) as { version: number }
        assert.equal(Number(despuesB.version), Number(versionB.version), 'B no cambia')

        // lectura de otra empresa sin alcance: 403
        await estado(
            client.get('/api/v1/fel/configuracion').qs({ empresa_id: e.C }).bearerToken(soloB.token),
            403,
        )
    })

    test('probar con proveedor explícito prueba ese y no toca la fila del guardado', async ({
        client,
        assert,
    }) => {
        const e = await empresas()
        const actual = await configuracionFel(e.B)
        await estado(
            client
                .put('/api/v1/fel/configuracion')
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .json({
                    empresa_id: e.B,
                    proveedor: 'infile',
                    ambiente: 'pruebas',
                    modo: 'opcional',
                    version: actual.version,
                }),
            200,
        )
        await guardar(e, e.B, 'infile')
        await guardar(e, e.B, 'falso')

        const prueba = await estado(
            client
                .post('/api/v1/fel/credenciales/pruebas/probar')
                .qs({ empresa_id: e.B, proveedor: 'falso' })
                .bearerToken(e.token),
            200,
        )
        assert.include(prueba.body(), { proveedor: 'falso', ambiente: 'pruebas' })
        assert.deepInclude(prueba.body().resultado_prueba, { ok: true })
        const infile = await db
            .from('fiscal.fel_credenciales')
            .where({ empresa_id: e.B, proveedor: 'infile', ambiente: 'pruebas' })
            .firstOrFail()
        assert.isNull(infile.probada_en, 'la fila de INFILE no se probó')

        // sin proveedor: el guardado (INFILE), y sin credenciales de otro 422
        await estado(
            client
                .post('/api/v1/fel/credenciales/produccion/probar')
                .qs({ empresa_id: e.B, proveedor: 'infile' })
                .bearerToken(e.token),
            422,
        )
        const directo = await new ProbarCredencialesFel().execute(
            { empresa_id: e.B, ambiente: 'pruebas', proveedor: 'falso' },
            e.ctx,
        )
        assert.equal(directo.proveedor, 'falso')
    })

    test('lista y faltantes del proveedor y ambiente guardados', async ({ client, assert }) => {
        const e = await empresas()
        await configurarModo(e, e.B, 'opcional')
        const sinCredenciales = await estado(
            client.get('/api/v1/fel/configuracion').bearerToken(e.token).header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.include(sinCredenciales.body(), { lista: false, modo: 'opcional' })
        assert.include(sinCredenciales.body().faltantes, 'credenciales')

        await guardar(e, e.B, 'falso')
        assert.deepEqual(await estadoFel(e.B), { lista: true, faltantes: ['credenciales_sin_probar'] })
        await new ProbarCredencialesFel().execute({ empresa_id: e.B, ambiente: 'pruebas' }, e.ctx)
        const lista = await estado(
            client.get('/api/v1/fel/configuracion').bearerToken(e.token).header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.include(lista.body(), { lista: true })
        assert.deepEqual(lista.body().faltantes, [])

        // la respuesta del PUT también trae lista y faltantes
        const puesta = await estado(
            client
                .put('/api/v1/fel/configuracion')
                .bearerToken(e.token)
                .header('X-Empresa-Id', String(e.B))
                .json({
                    empresa_id: e.B,
                    proveedor: 'falso',
                    ambiente: 'pruebas',
                    modo: 'obligatoria',
                    version: lista.body().version,
                }),
            200,
        )
        assert.include(puesta.body(), { lista: true, modo: 'obligatoria' })

        // C: sin establecimiento activo y con NIT de prueba (no cuadra)
        await db.from('fiscal.establecimientos').where('empresa_id', e.C).delete()
        await configurarModo(e, e.C, 'opcional')
        await guardar(e, e.C, 'falso')
        const c = await estadoFel(e.C)
        assert.isFalse(c.lista)
        assert.includeMembers(c.faltantes, ['establecimiento', 'nit_emisor'])
    })

    test('obligatoria sin credenciales se guarda (P7) y el tablero lo avisa aparte de «FEL desactivada»', async ({
        client,
        assert,
    }) => {
        const e = await empresas()
        await configurarModo(e, e.B, 'obligatoria')
        const tablero = await estado(
            client.get('/api/v1/fiscal/tablero').bearerToken(e.token).header('X-Empresa-Id', String(e.B)),
            200,
        )
        const fel = JSON.stringify(tablero.body())
        assert.include(fel, 'FEL activa sin credenciales')
    })
})
