import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import {
    cuiValido,
    deducirTipoDocumento,
    nitValido,
    validarDocumentoFiscal,
    verificadorNit,
} from '#core/nit_cui'
import {
    registrarInstaladorLocalizacion,
    type InstalacionLocalizacion,
    type InstaladorLocalizacion,
} from '#core/localizacion'
import { NOMBRES_PERMISOS, ROLES_BASE, type Permiso } from '#core/permisos'
import { ValidacionFallida } from '#shared/errores'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { escenario, generar } from '#tests/billing/ayudas_billing'

/**
 * Localización fiscal, fase 1 (A1): país de la empresa con su instalador, documento fiscal del
 * cliente y permisos (`.claude/integration/contratos/localizacion-fiscal.md` §3.1, §10, §11, §13).
 */

/** NIT publicados (verificador módulo 11 comprobado a mano; ver `#core/nit_cui`). */
const NIT_REALES = {
    sat: '16693949', // Superintendencia de Administración Tributaria
    infile: '12521337', // INFILE, S.A., certificador FEL
    batres: '42932-5', // ejemplo de M. Batres (2008)
    segundoModulo: '1510972-0', // suma 110: exige (11 − 0) mod 11 = 0
    conK: '6-K',
}

function nitAleatorio(): string {
    const cuerpo = String(Math.floor(1_000_000 + Math.random() * 8_999_999))
    return `${cuerpo}${verificadorNit(cuerpo)}`
}

interface Llamada extends Omit<InstalacionLocalizacion, 'trx'> {
    enTransaccion: boolean
    /** país que la empresa ya tiene dentro de la transacción al llamar al instalador */
    paisEnTrx: string | null
}

/** Instalador falso de `fiscal` (A3 lo construye en paralelo): GT y SV, registra cada llamada. */
function instaladorFalso(opciones: { falla?: boolean; documentos?: boolean } = {}) {
    const llamadas: Llamada[] = []
    const instalador: InstaladorLocalizacion = {
        paises: () => ['GT', 'SV'],
        async instalar({ trx, ...resto }) {
            const fila = (await trx
                .from('core.empresas')
                .where('id', resto.empresaId)
                .select('pais')
                .first()) as {
                pais: string
            } | null
            llamadas.push({ ...resto, enTransaccion: trx.isTransaction, paisEnTrx: fila?.pais ?? null })
            if (opciones.falla) throw new Error('el paquete no se pudo instalar')
        },
        async tieneDocumentos() {
            return opciones.documentos === true
        },
    }
    registrarInstaladorLocalizacion(instalador)
    return llamadas
}

test.group('Localización fiscal: NIT, CUI y documento del receptor', () => {
    test('NIT con dígito verificador módulo 11: casos publicados', ({ assert }) => {
        for (const nit of Object.values(NIT_REALES)) assert.isTrue(nitValido(nit), nit)
        assert.equal(verificadorNit('1669394'), '9')
        assert.equal(verificadorNit('1252133'), '7')
        assert.isFalse(nitValido('16693948'), 'SAT con otro verificador')
        assert.isFalse(nitValido('12521330'), 'INFILE con otro verificador')
        assert.isFalse(nitValido('1510972-1'))
        assert.isFalse(nitValido('6-5'))
        assert.isFalse(nitValido('K'))
        assert.isFalse(nitValido('12345678901234'), 'más de 13 caracteres')
    })

    test('CUI: 13 dígitos con departamento 01-22 y municipio (Ley del RENAP, art. 4)', ({ assert }) => {
        assert.isTrue(cuiValido('1234567890101'))
        assert.isTrue(cuiValido('2345 67890 2201'))
        assert.isFalse(cuiValido('123456789010'), '12 dígitos')
        assert.isFalse(cuiValido('1234567892301'), 'departamento 23')
        assert.isFalse(cuiValido('1234567890001'), 'departamento 00')
        assert.isFalse(cuiValido('1234567890100'), 'municipio 00')
        assert.isFalse(cuiValido('12345678901A1'))
    })

    test('documento según su tipo: NIT, CUI, pasaporte y CF', ({ assert }) => {
        assert.deepEqual(validarDocumentoFiscal({ tipo: 'nit', valor: '1669394-9' }), {
            tipo_documento_fiscal: 'nit',
            nit_cui: '16693949',
            pais_fiscal: 'GT',
        })
        assert.deepEqual(validarDocumentoFiscal({ tipo: 'cui', valor: '1234 56789 0101' }), {
            tipo_documento_fiscal: 'cui',
            nit_cui: '1234567890101',
            pais_fiscal: 'GT',
        })
        assert.deepEqual(validarDocumentoFiscal({ tipo: 'pasaporte', valor: 'x1234567', pais: 'us' }), {
            tipo_documento_fiscal: 'pasaporte',
            nit_cui: 'X1234567',
            pais_fiscal: 'US',
        })
        assert.deepEqual(validarDocumentoFiscal({ tipo: 'cf', valor: null }), {
            tipo_documento_fiscal: 'cf',
            nit_cui: null,
            pais_fiscal: 'GT',
        })
        // sin tipo: se deduce como antes de la localización
        assert.equal(validarDocumentoFiscal({ valor: '12521337' }).tipo_documento_fiscal, 'nit')
        assert.equal(validarDocumentoFiscal({ valor: '1234567890101' }).tipo_documento_fiscal, 'cui')
        assert.equal(validarDocumentoFiscal({ valor: 'cf' }).tipo_documento_fiscal, 'cf')
        assert.equal(deducirTipoDocumento('1234567-0'), null)

        const campo = (fn: () => unknown) => {
            try {
                fn()
            } catch (error) {
                assert.instanceOf(error, ValidacionFallida)
                const errores = (error as ValidacionFallida).errores!
                return `${errores[0]!.field}:${errores[0]!.rule}`
            }
            assert.fail('debía fallar')
        }
        assert.equal(
            campo(() => validarDocumentoFiscal({ tipo: 'nit', valor: '16693948' })),
            'nit_cui:nit',
        )
        assert.equal(
            campo(() => validarDocumentoFiscal({ tipo: 'nit', valor: null })),
            'nit_cui:required',
        )
        assert.equal(
            campo(() => validarDocumentoFiscal({ tipo: 'cui', valor: '12521337' })),
            'nit_cui:cui',
        )
        assert.equal(
            campo(() => validarDocumentoFiscal({ tipo: 'pasaporte', valor: 'A1' })),
            'nit_cui:pasaporte',
        )
        assert.equal(
            campo(() => validarDocumentoFiscal({ tipo: 'cf', valor: '12521337' })),
            'nit_cui:cf',
        )
        assert.equal(
            campo(() => validarDocumentoFiscal({ tipo: 'nit', valor: '12521337', pais: 'SV' })),
            'pais_fiscal:pais',
        )
    })

    test('la clasificación en SQL (migración y trigger) coincide con #core/nit_cui', async ({ assert }) => {
        const casos = [
            ...Object.values(NIT_REALES),
            '16693948',
            '1234567890101',
            '1234567892301',
            '1234 56789 0101',
            'CF',
            '',
            'pasaporte',
            '1234567-0',
        ]
        for (const caso of casos) {
            const limpio = caso.replace(/[\s-]/g, '').toUpperCase()
            const { rows } = await db.rawQuery(
                'SELECT core.nit_valido(?) AS nit, core.cui_valido(?) AS cui, (core.clasificar_documento(?)).*',
                [limpio, limpio, caso],
            )
            const fila = rows[0] as { nit: boolean; cui: boolean; tipo: string; invalido: boolean }
            assert.equal(fila.nit, nitValido(limpio), `nit ${caso}`)
            assert.equal(fila.cui, cuiValido(limpio), `cui ${caso}`)
            const deducido = deducirTipoDocumento(caso)
            assert.equal(fila.invalido, deducido === null, `invalido ${caso}`)
            if (deducido) assert.equal(fila.tipo, deducido, `tipo ${caso}`)
        }
    })

    test('un cliente con NIT inválido queda marcado, no borrado (§11.1)', async ({ assert }) => {
        // Alta sin tipo, como el importador o el SQL anterior a la localización: lo clasifica el
        // trigger con la misma función que la migración.
        const insertar = async (nit_cui: string | null) => {
            const [fila] = (await db
                .table('core.clientes')
                .insert({ nombre: unico('Migrado'), nit_cui })
                .returning(['tipo_documento_fiscal', 'nit_cui', 'nit_cui_invalido', 'pais_fiscal'])) as Array<
                Record<string, unknown>
            >
            return fila!
        }
        assert.deepEqual(await insertar('1234567-0'), {
            tipo_documento_fiscal: 'nit',
            nit_cui: '1234567-0',
            nit_cui_invalido: true,
            pais_fiscal: 'GT',
        })
        assert.include(await insertar('1234567892302'), {
            tipo_documento_fiscal: 'cui',
            nit_cui_invalido: true,
        })
        assert.include(await insertar('abc'), {
            tipo_documento_fiscal: 'cf',
            nit_cui: 'abc',
            nit_cui_invalido: true,
        })
        assert.include(await insertar('12521337'), { tipo_documento_fiscal: 'nit', nit_cui_invalido: false })
        assert.include(await insertar(null), { tipo_documento_fiscal: 'cf', nit_cui_invalido: false })
        assert.include(await insertar('CF'), { tipo_documento_fiscal: 'cf', nit_cui_invalido: false })
    })
})

test.group('Localización fiscal: clientes por la API', () => {
    test('crear con tipo de documento, país, retención y sector público; auditado', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const requestId = unico('req')
        const creado = await estado(
            client.post('/api/v1/clientes').bearerToken(token).header('X-Request-Id', requestId).json({
                nombre: 'Municipalidad de Mixco',
                tipo: 'empresa',
                tipo_documento_fiscal: 'nit',
                nit_cui: '1252133-7',
                nombre_fiscal: 'MUNICIPALIDAD DE MIXCO',
                agente_retencion_iva: true,
                sector_publico: true,
            }),
            201,
        )
        assert.containsSubset(creado.body(), {
            tipo_documento_fiscal: 'nit',
            nit_cui: '12521337',
            nit_cui_invalido: false,
            pais_fiscal: 'GT',
            agente_retencion_iva: true,
            sector_publico: true,
        })
        const filasCambios = await db.from('audit.cambios').where('request_id', requestId)
        const campos = filasCambios.map((c) => c.campo)
        assert.includeMembers(campos, ['tipo_documento_fiscal', 'agente_retencion_iva', 'sector_publico'])

        const extranjero = await estado(
            client.post('/api/v1/clientes').bearerToken(token).json({
                nombre: 'John Smith',
                tipo_documento_fiscal: 'pasaporte',
                nit_cui: 'x 1234567',
                pais_fiscal: 'us',
            }),
            201,
        )
        assert.include(extranjero.body(), {
            tipo_documento_fiscal: 'pasaporte',
            nit_cui: 'X1234567',
            pais_fiscal: 'US',
        })

        // sin tipo: el de siempre (CF)
        const cf = await estado(
            client.post('/api/v1/clientes').bearerToken(token).json({ nombre: 'Sin NIT' }),
            201,
        )
        assert.include(cf.body(), { tipo_documento_fiscal: 'cf', nit_cui: null, pais_fiscal: 'GT' })

        const malos = [
            [{ tipo_documento_fiscal: 'nit', nit_cui: '16693948' }, 'nit_cui'],
            [{ tipo_documento_fiscal: 'cui', nit_cui: '1234567892301' }, 'nit_cui'],
            [{ tipo_documento_fiscal: 'cf', nit_cui: '16693949' }, 'nit_cui'],
            [{ tipo_documento_fiscal: 'nit', nit_cui: '16693949', pais_fiscal: 'SV' }, 'pais_fiscal'],
        ] as const
        for (const [datos, campo] of malos) {
            const r = await estado(
                client
                    .post('/api/v1/clientes')
                    .bearerToken(token)
                    .json({ nombre: 'Malo', ...datos }),
                422,
            )
            assert.equal(r.body().errors[0].field, campo, JSON.stringify(datos))
        }
    })

    test('editar un migrado inválido: lo demás se edita; al corregir el NIT se apaga la marca', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const [fila] = (await db
            .table('core.clientes')
            .insert({ nombre: unico('Migrado'), nit_cui: '1234567-0' })
            .returning('id')) as Array<{ id: number }>
        const id = fila!.id

        const invalidos = await estado(
            client.get('/api/v1/clientes').qs({ nit_cui_invalido: true, limit: 100 }).bearerToken(token),
            200,
        )
        assert.include(
            invalidos.body().data.map((c: { id: number }) => c.id),
            id,
        )

        const telefono = await estado(
            client
                .put(`/api/v1/clientes/${id}`)
                .bearerToken(token)
                .json({ version: 1, telefono: '5555-0000' }),
            200,
        )
        assert.include(telefono.body(), { nit_cui: '1234567-0', nit_cui_invalido: true, version: 2 })

        // cambiar solo el tipo revalida el número guardado
        await estado(
            client
                .put(`/api/v1/clientes/${id}`)
                .bearerToken(token)
                .json({ version: 2, tipo_documento_fiscal: 'nit' }),
            422,
        )
        const corregido = await estado(
            client
                .put(`/api/v1/clientes/${id}`)
                .bearerToken(token)
                .json({ version: 2, nit_cui: '1234567-9' }),
            200,
        )
        assert.include(corregido.body(), {
            tipo_documento_fiscal: 'nit',
            nit_cui: '12345679',
            nit_cui_invalido: false,
        })
        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'cliente')
            .where('entidad_id', id)
            .select('campo')
        assert.includeMembers(
            cambios.map((c) => c.campo),
            ['nit_cui', 'nit_cui_invalido'],
        )

        // un pasaporte conserva su tipo al cambiar solo el número
        const pasaporte = await estado(
            client.put(`/api/v1/clientes/${id}`).bearerToken(token).json({
                version: 3,
                tipo_documento_fiscal: 'pasaporte',
                nit_cui: 'AB123456',
                pais_fiscal: 'MX',
            }),
            200,
        )
        assert.include(pasaporte.body(), { tipo_documento_fiscal: 'pasaporte', pais_fiscal: 'MX' })
        const nuevo = await estado(
            client.put(`/api/v1/clientes/${id}`).bearerToken(token).json({ version: 4, nit_cui: 'AB999999' }),
            200,
        )
        assert.include(nuevo.body(), { tipo_documento_fiscal: 'pasaporte', nit_cui: 'AB999999' })
    })
})

test.group('Localización fiscal: país de la empresa', (group) => {
    group.each.teardown(async () => {
        registrarInstaladorLocalizacion(null)
        await soloEmpresaPrincipal()
    })

    test('las empresas existentes quedan en GT; GET /empresas/paises solo trae GT', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['lectura'])
        const principal = await estado(client.get('/api/v1/empresas/1').bearerToken(token), 200)
        assert.equal(principal.body().pais, 'GT')
        const otra = await crearEmpresaFila()
        const fila = await db.from('core.empresas').where('id', otra).select('pais').firstOrFail()
        assert.equal(fila.pais, 'GT')
        const paises = await estado(client.get('/api/v1/empresas/paises').bearerToken(token), 200)
        assert.deepEqual(paises.body(), [{ codigo: 'GT', nombre: 'Guatemala' }])
    })

    test('crear con país: GT por defecto, 422 pais_no_soportado sin paquete', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const creada = await estado(
            client
                .post('/api/v1/empresas')
                .bearerToken(token)
                .json({
                    nit: nitAleatorio(),
                    razon_social: 'Sin país, S.A.',
                    nombre_comercial: unico('SinPais'),
                }),
            201,
        )
        assert.equal(creada.body().pais, 'GT')
        const sv = await estado(
            client
                .post('/api/v1/empresas')
                .bearerToken(token)
                .json({
                    nit: nitAleatorio(),
                    razon_social: 'El Salvador, S.A. de C.V.',
                    nombre_comercial: unico('SV'),
                    pais: 'SV',
                }),
            422,
        )
        assert.include(sv.body(), { type: 'urn:argosisp:problema:pais_no_soportado' })
        assert.equal(sv.body().errors[0].field, 'pais')
    })

    test('crear llama al instalador en la misma transacción', async ({ client, assert }) => {
        const llamadas = instaladorFalso()
        const { token } = await usuarioConRoles(['admin'])
        const creada = await estado(
            client
                .post('/api/v1/empresas')
                .bearerToken(token)
                .json({
                    nit: nitAleatorio(),
                    razon_social: 'Con instalador, S.A.',
                    nombre_comercial: unico('Instalada'),
                    pais: 'gt',
                    regimen_isr: 'pequeno_contribuyente',
                    codigo_establecimiento: 1,
                }),
            201,
        )
        assert.lengthOf(llamadas, 1)
        assert.include(llamadas[0], {
            empresaId: creada.body().id,
            pais: 'GT',
            paisAnterior: null,
            enTransaccion: true,
            paisEnTrx: 'GT',
        })
        // la semilla del régimen se guardó antes de instalar
        assert.include(creada.body(), { regimen_isr: 'pequeno_contribuyente', codigo_establecimiento: 1 })

        // si el instalador falla, la empresa no se crea
        instaladorFalso({ falla: true })
        const nombre = unico('Fallida')
        await estado(
            client.post('/api/v1/empresas').bearerToken(token).json({
                nit: nitAleatorio(),
                razon_social: 'Fallida, S.A.',
                nombre_comercial: nombre,
            }),
            500,
        )
        assert.isNull(await db.from('core.empresas').where('nombre_comercial', nombre).first())
    })

    test('cambiar país: mismo país sin cambios, instalador en la transacción y auditoría', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['admin'])
        const id = await crearEmpresaFila()

        // sin instalador solo existe GT
        const sinPaquete = await estado(
            client
                .post(`/api/v1/empresas/${id}/cambiar-pais`)
                .bearerToken(token)
                .json({ pais: 'SV', version: 1 }),
            422,
        )
        assert.include(sinPaquete.body(), { type: 'urn:argosisp:problema:pais_no_soportado' })
        const igual = await estado(
            client
                .post(`/api/v1/empresas/${id}/cambiar-pais`)
                .bearerToken(token)
                .json({ pais: 'GT', version: 1 }),
            200,
        )
        assert.include(igual.body(), { pais: 'GT', version: 1 })

        const llamadas = instaladorFalso()
        const requestId = unico('req')
        const cambiada = await estado(
            client
                .post(`/api/v1/empresas/${id}/cambiar-pais`)
                .bearerToken(token)
                .header('X-Request-Id', requestId)
                .json({ pais: 'sv', version: 1 }),
            200,
        )
        assert.include(cambiada.body(), { pais: 'SV', version: 2 })
        assert.lengthOf(llamadas, 1)
        assert.include(llamadas[0], {
            empresaId: id,
            pais: 'SV',
            paisAnterior: 'GT',
            enTransaccion: true,
            paisEnTrx: 'SV',
        })
        const accion = await db.from('audit.acciones').where('request_id', requestId).firstOrFail()
        assert.include(accion, {
            accion: 'empresas.cambiar_pais',
            resultado: 'ok',
            actor_id: usuario.id,
            entidad_tipo: 'empresa',
            entidad_id: id,
        })
        const cambio = await db
            .from('audit.cambios')
            .where('request_id', requestId)
            .where('campo', 'pais')
            .firstOrFail()
        assert.deepEqual([cambio.antes, cambio.despues], ['GT', 'SV'])

        // versión vieja: 409
        await estado(
            client
                .post(`/api/v1/empresas/${id}/cambiar-pais`)
                .bearerToken(token)
                .json({ pais: 'GT', version: 1 }),
            409,
        )

        // el instalador falla: el país no cambia
        instaladorFalso({ falla: true })
        await estado(
            client
                .post(`/api/v1/empresas/${id}/cambiar-pais`)
                .bearerToken(token)
                .json({ pais: 'GT', version: 2 }),
            500,
        )
        const fila = await db.from('core.empresas').where('id', id).select('pais', 'version').firstOrFail()
        assert.deepEqual({ ...fila }, { pais: 'SV', version: 2 })
    })

    test('409 empresa_con_documentos: facturas del núcleo o documentos de fiscal', async ({
        client,
        assert,
    }) => {
        const llamadas = instaladorFalso()
        const { token } = await usuarioConRoles(['admin'])
        const conFactura = await crearEmpresaFila()
        const { servicioId } = await escenario({ servicio: { empresa_id: conFactura } })
        await generar(servicioId, '2026-10-01')
        const facturas = await db.from('billing.facturas').where('empresa_id', conFactura).count('* as total')
        assert.isAbove(Number(facturas[0].total), 0)

        const r = await estado(
            client
                .post(`/api/v1/empresas/${conFactura}/cambiar-pais`)
                .bearerToken(token)
                .json({ pais: 'SV', version: 1 }),
            409,
        )
        assert.include(r.body(), { type: 'urn:argosisp:problema:empresa_con_documentos' })
        assert.lengthOf(llamadas, 0)

        // sin documentos del núcleo, pero `fiscal` dice que tiene (DTE, compras…)
        instaladorFalso({ documentos: true })
        const conDte = await crearEmpresaFila()
        await estado(
            client
                .post(`/api/v1/empresas/${conDte}/cambiar-pais`)
                .bearerToken(token)
                .json({ pais: 'SV', version: 1 }),
            409,
        )
        const fila = await db.from('core.empresas').where('id', conDte).select('pais').firstOrFail()
        assert.equal(fila.pais, 'GT')
    })

    test('régimen y establecimiento: solo lectura al editar; la lectura sale de fiscal si la tiene', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const id = await crearEmpresaFila({
            regimen_isr: 'sujeto_pagos_trimestrales',
            codigo_establecimiento: 1,
        })

        const r = await estado(
            client.put(`/api/v1/empresas/${id}`).bearerToken(token).json({
                version: 1,
                regimen_isr: 'pequeno_contribuyente',
                codigo_establecimiento: 2,
            }),
            422,
        )
        assert.include(r.body(), { type: 'urn:argosisp:problema:campo_solo_lectura' })
        assert.sameMembers(
            r.body().errors.map((e: { field: string }) => e.field),
            ['regimen_isr', 'codigo_establecimiento'],
        )
        // el formulario manda todo: el valor vigente se acepta y lo demás se guarda
        const editada = await estado(
            client.put(`/api/v1/empresas/${id}`).bearerToken(token).json({
                version: 1,
                regimen_isr: 'sujeto_pagos_trimestrales',
                codigo_establecimiento: 1,
                municipio: 'Mixco',
            }),
            200,
        )
        assert.include(editada.body(), {
            municipio: 'Mixco',
            regimen_isr: 'sujeto_pagos_trimestrales',
            version: 2,
        })

        // con los parámetros de fiscal, la API muestra el régimen vigente (punto de cambio)
        registrarInstaladorLocalizacion({
            paises: () => ['GT'],
            async instalar() {},
            async datosFiscales(ids) {
                return new Map(
                    ids.map((e) => [
                        e,
                        { regimen_isr: 'pequeno_contribuyente' as const, codigo_establecimiento: 7 },
                    ]),
                )
            },
        })
        const vista = await estado(client.get(`/api/v1/empresas/${id}`).bearerToken(token), 200)
        assert.include(vista.body(), { regimen_isr: 'pequeno_contribuyente', codigo_establecimiento: 7 })
        const lista = await estado(client.get('/api/v1/empresas').bearerToken(token), 200)
        assert.include(
            lista.body().find((e: { id: number }) => e.id === id),
            { regimen_isr: 'pequeno_contribuyente' },
        )
    })
})

test.group('Localización fiscal: permisos y roles (§10.2)', () => {
    const NUEVOS: Permiso[] = [
        'empresas.cambiar_pais',
        'fiscal.ver',
        'fiscal.configurar',
        'fiscal.instalar',
        'fiscal.editar_parametros',
        'fiscal.cambiar_regimen',
        'fel.ver',
        'fel.configurar',
        'fel.certificar',
        'fel.anular',
        'fel.contingencia',
        'proveedores.ver',
        'proveedores.editar',
        'compras.ver',
        'compras.registrar',
        'compras.anular',
        'compras.pagar',
        'libros.ver',
        'libros.emitir',
        'libros.habilitar',
        'libro.cerrar_ejercicio',
        'libro.reabrir_ejercicio',
        'libro.bloquear',
        'libro.bloquear_duro',
        'libro.desbloquear',
        'declaraciones.ver',
        'declaraciones.calcular',
        'declaraciones.revisar',
        'declaraciones.presentar',
        'declaraciones.pagar',
    ]
    const SOLO_ADMIN: Permiso[] = [
        'fiscal.instalar',
        'fel.configurar',
        'libro.bloquear_duro',
        'libro.reabrir_ejercicio',
        'empresas.cambiar_pais',
    ]

    test('existen y se reparten como dice el contrato', async ({ assert }) => {
        assert.includeMembers(NOMBRES_PERMISOS, NUEVOS)
        assert.includeMembers([...ROLES_BASE.admin!.permisos], NUEVOS)
        const contabilidad = [...ROLES_BASE.contabilidad!.permisos]
        assert.includeMembers(
            contabilidad,
            NUEVOS.filter((p) => !SOLO_ADMIN.includes(p)),
        )
        for (const p of SOLO_ADMIN) assert.notInclude(contabilidad, p)
        assert.include([...ROLES_BASE.cajero!.permisos], 'fel.ver')
        assert.includeMembers(
            [...ROLES_BASE.lectura!.permisos],
            NUEVOS.filter((p) => p.endsWith('.ver')),
        )
        // el seed los dejó en la base con sus roles
        const filas = await db
            .from('core.roles_permisos as rp')
            .join('core.roles as r', 'r.id', 'rp.role_id')
            .join('core.permisos as p', 'p.id', 'rp.permiso_id')
            .where('r.nombre', 'contabilidad')
            .whereIn('p.nombre', NUEVOS)
            .select('p.nombre')
        assert.sameMembers(
            filas.map((f) => f.nombre),
            NUEVOS.filter((p) => !SOLO_ADMIN.includes(p)),
        )
    })

    test('cambiar-pais: 403 a cajero y contabilidad, admin sí', async ({ client }) => {
        const id = await crearEmpresaFila()
        for (const rol of ['cajero', 'contabilidad']) {
            const { token } = await usuarioConRoles([rol])
            await estado(
                client
                    .post(`/api/v1/empresas/${id}/cambiar-pais`)
                    .bearerToken(token)
                    .json({ pais: 'GT', version: 1 }),
                403,
            )
        }
        const { token } = await usuarioConRoles(['admin'])
        await estado(
            client
                .post(`/api/v1/empresas/${id}/cambiar-pais`)
                .bearerToken(token)
                .json({ pais: 'GT', version: 1 }),
            200,
        )
        await soloEmpresaPrincipal()
    })
})
