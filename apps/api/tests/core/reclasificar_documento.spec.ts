import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import { cuiValido, nitValido, verificadorNit } from '#core/nit_cui'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'

/**
 * Reclasificación del documento fiscal al editar (pedido de A3 para FEL, fase 3): `clientes.editar`
 * recalcula `tipo_documento_fiscal` y `nit_cui_invalido` con la regla del alta, deja el diff en
 * `audit.cambios`, emite `cliente.actualizado` con los campos que cambiaron y respeta un tipo
 * explícito. El trigger `clientes_tipo_documento` cubre los `UPDATE` fuera de la acción.
 */

const CUI = '1234567890101'
const NIT = '12521337'

/** Número de 13 dígitos válido a la vez como CUI y como NIT (el tipo elegido decide). */
function cuiQueTambienEsNit(): string {
    for (let i = 1000; i < 9999; i++) {
        const cuerpo = `12345678${i}`.slice(0, 12)
        const numero = `${cuerpo}${verificadorNit(cuerpo)}`
        if (cuiValido(numero) && nitValido(numero)) return numero
    }
    throw new Error('sin número de prueba')
}

async function crear(client: ApiClient, token: string, datos: Record<string, unknown> = {}) {
    const r = await estado(
        client
            .post('/api/v1/clientes')
            .bearerToken(token)
            .json({ nombre: unico('Receptor'), ...datos }),
        201,
    )
    return r.body() as { id: number; version: number; tipo_documento_fiscal: string }
}

async function cambiosDe(id: number, desdeId: number) {
    const filas = await db
        .from('audit.cambios')
        .where('entidad_tipo', 'cliente')
        .where('entidad_id', id)
        .where('id', '>', desdeId)
        .select('campo', 'antes', 'despues')
    return Object.fromEntries(filas.map((f) => [f.campo, [f.antes, f.despues]]))
}

async function ultimoCambio(): Promise<number> {
    const fila = await db.from('audit.cambios').max('id as id').first()
    return Number(fila?.id ?? 0)
}

async function camposDelEvento(id: number, desdeId: number): Promise<string[] | null> {
    const fila = await db
        .from('audit.outbox')
        .where('evento', 'cliente.actualizado')
        .whereRaw(`(payload->>'cliente_id')::bigint = ?`, [id])
        .where('id', '>', desdeId)
        .orderBy('id', 'desc')
        .first()
    return fila ? fila.payload.campos : null
}

async function ultimoEvento(): Promise<number> {
    const fila = await db.from('audit.outbox').max('id as id').first()
    return Number(fila?.id ?? 0)
}

test.group('Clientes: reclasificar el documento fiscal al editar', (group) => {
    let token: string
    group.setup(async () => {
        const soporte = await usuarioConRoles(['soporte'])
        token = soporte.token
    })
    const editador = (client: ApiClient) => (id: number, json: Record<string, unknown>, status: number) =>
        estado(client.put(`/api/v1/clientes/${id}`).bearerToken(token).json(json), status)

    test('CF → NIT: tipo reclasificado, diff en audit.cambios y en cliente.actualizado', async ({
        client,
        assert,
    }) => {
        const editar = editador(client)
        const c = await crear(client, token)
        assert.equal(c.tipo_documento_fiscal, 'cf')
        const [cambio, evento] = [await ultimoCambio(), await ultimoEvento()]

        const r = await editar(c.id, { version: c.version, nit_cui: '1252133-7' }, 200)
        assert.include(r.body(), { tipo_documento_fiscal: 'nit', nit_cui: NIT, nit_cui_invalido: false })

        const cambios = await cambiosDe(c.id, cambio)
        assert.deepEqual(cambios.tipo_documento_fiscal, ['cf', 'nit'])
        assert.deepEqual(cambios.nit_cui, [null, NIT])
        assert.sameMembers((await camposDelEvento(c.id, evento))!, ['nit_cui', 'tipo_documento_fiscal'])
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'clientes.editar')
            .where('entidad_id', c.id)
            .orderBy('id', 'desc')
            .first()
        assert.equal(accion.resultado, 'ok')
    })

    test('NIT → CUI y NIT → CF (vacío o CF)', async ({ client, assert }) => {
        const editar = editador(client)
        const c = await crear(client, token, { nit_cui: NIT })
        assert.equal(c.tipo_documento_fiscal, 'nit')

        let evento = await ultimoEvento()
        const cui = await editar(c.id, { version: 1, nit_cui: CUI }, 200)
        assert.include(cui.body(), { tipo_documento_fiscal: 'cui', nit_cui: CUI })
        assert.sameMembers((await camposDelEvento(c.id, evento))!, ['nit_cui', 'tipo_documento_fiscal'])

        const nit = await editar(c.id, { version: 2, nit_cui: NIT }, 200)
        assert.include(nit.body(), { tipo_documento_fiscal: 'nit' })

        evento = await ultimoEvento()
        const cf = await editar(c.id, { version: 3, nit_cui: null }, 200)
        assert.include(cf.body(), { tipo_documento_fiscal: 'cf', nit_cui: null })
        assert.sameMembers((await camposDelEvento(c.id, evento))!, ['nit_cui', 'tipo_documento_fiscal'])

        const conCf = await editar(c.id, { version: 4, nit_cui: NIT }, 200)
        assert.include(conCf.body(), { tipo_documento_fiscal: 'nit' })
        const otraVez = await editar(c.id, { version: 5, nit_cui: 'cf' }, 200)
        assert.include(otraVez.body(), { tipo_documento_fiscal: 'cf', nit_cui: 'CF' })

        // un NIT por otro: el tipo no cambia, el evento solo lleva nit_cui
        const otro = await crear(client, token, { nit_cui: NIT })
        evento = await ultimoEvento()
        await editar(otro.id, { version: 1, nit_cui: '16693949' }, 200)
        assert.deepEqual(await camposDelEvento(otro.id, evento), ['nit_cui'])
    })

    test('NIT inválido: 422 sin tocar lo guardado; un migrado marcado se corrige y se reclasifica', async ({
        client,
        assert,
    }) => {
        const editar = editador(client)
        const c = await crear(client, token, { nit_cui: NIT })
        const evento = await ultimoEvento()
        const r = await editar(c.id, { version: 1, nit_cui: '1234567-0' }, 422)
        assert.equal(r.body().errors[0].field, 'nit_cui')
        const fila = await db.from('core.clientes').where('id', c.id).first()
        assert.include(fila, {
            tipo_documento_fiscal: 'nit',
            nit_cui: NIT,
            nit_cui_invalido: false,
            version: 1,
        })
        assert.isNull(await camposDelEvento(c.id, evento))

        // migrado con un NIT inválido (tipo nit, marcado): corregido con un CUI pasa a cui
        const [migrado] = (await db
            .table('core.clientes')
            .insert({ nombre: unico('Migrado'), nit_cui: '1234567-0' })
            .returning(['id', 'tipo_documento_fiscal', 'nit_cui_invalido'])) as Array<{
            id: number
            tipo_documento_fiscal: string
            nit_cui_invalido: boolean
        }>
        assert.include(migrado, { tipo_documento_fiscal: 'nit', nit_cui_invalido: true })
        const cambio = await ultimoCambio()
        const corregido = await editar(migrado!.id, { version: 1, nit_cui: CUI }, 200)
        assert.include(corregido.body(), { tipo_documento_fiscal: 'cui', nit_cui_invalido: false })
        const cambios = await cambiosDe(migrado!.id, cambio)
        assert.deepEqual(cambios.tipo_documento_fiscal, ['nit', 'cui'])
        assert.deepEqual(cambios.nit_cui_invalido, [true, false])
    })

    test('el tipo explícito se respeta y se valida', async ({ client, assert }) => {
        const editar = editador(client)
        const ambos = cuiQueTambienEsNit()
        const c = await crear(client, token, { nit_cui: NIT })

        // sin tipo, el número ambiguo se clasifica como CUI; con tipo nit queda nit
        const nit = await editar(c.id, { version: 1, tipo_documento_fiscal: 'nit', nit_cui: ambos }, 200)
        assert.include(nit.body(), { tipo_documento_fiscal: 'nit', nit_cui: ambos })
        const fila = await db.from('core.clientes').where('id', c.id).first()
        assert.equal(fila.tipo_documento_fiscal, 'nit', 'el trigger no pisa el tipo elegido')

        const deducido = await crear(client, token, { nit_cui: ambos })
        assert.equal(deducido.tipo_documento_fiscal, 'cui')

        // un tipo que no corresponde al número: 422
        const malo = await editar(c.id, { version: 2, tipo_documento_fiscal: 'cui', nit_cui: NIT }, 422)
        assert.equal(malo.body().errors[0].field, 'nit_cui')
        await editar(c.id, { version: 2, tipo_documento_fiscal: 'cf', nit_cui: NIT }, 422)

        // pasaporte: conserva su tipo al cambiar el número aunque parezca NIT; vacío → cf
        const pasaporte = await editar(
            c.id,
            { version: 2, tipo_documento_fiscal: 'pasaporte', nit_cui: 'AB123456', pais_fiscal: 'MX' },
            200,
        )
        assert.include(pasaporte.body(), { tipo_documento_fiscal: 'pasaporte' })
        const numerico = await editar(c.id, { version: 3, nit_cui: '12345678' }, 200)
        assert.include(numerico.body(), { tipo_documento_fiscal: 'pasaporte', nit_cui: '12345678' })
        const vacio = await editar(c.id, { version: 4, nit_cui: null }, 200)
        assert.include(vacio.body(), { tipo_documento_fiscal: 'cf', nit_cui: null, pais_fiscal: 'MX' })
    })

    test('UPDATE fuera de la acción: el trigger reclasifica con la misma regla', async ({ assert }) => {
        const [fila] = (await db
            .table('core.clientes')
            .insert({ nombre: unico('Directo') })
            .returning('id')) as Array<{ id: number }>
        const id = fila!.id
        const leer = () =>
            db
                .from('core.clientes')
                .where('id', id)
                .select('tipo_documento_fiscal', 'nit_cui_invalido')
                .first()
        const poner = (cambios: Record<string, unknown>) =>
            db.from('core.clientes').where('id', id).update(cambios)

        await poner({ nit_cui: NIT })
        assert.deepEqual(await leer(), { tipo_documento_fiscal: 'nit', nit_cui_invalido: false })
        await poner({ nit_cui: CUI })
        assert.deepEqual(await leer(), { tipo_documento_fiscal: 'cui', nit_cui_invalido: false })
        await poner({ nit_cui: '1234567-0' })
        assert.deepEqual(await leer(), { tipo_documento_fiscal: 'nit', nit_cui_invalido: true })
        await poner({ nit_cui: '1234567-9' })
        assert.deepEqual(await leer(), { tipo_documento_fiscal: 'nit', nit_cui_invalido: false })
        await poner({ nit_cui: null })
        assert.deepEqual(await leer(), { tipo_documento_fiscal: 'cf', nit_cui_invalido: false })

        // tipo puesto en la misma sentencia: se respeta; otras columnas no reclasifican
        const ambos = cuiQueTambienEsNit()
        await poner({ nit_cui: ambos, tipo_documento_fiscal: 'nit' })
        assert.deepEqual(await leer(), { tipo_documento_fiscal: 'nit', nit_cui_invalido: false })
        await poner({ nombre: unico('Directo') })
        assert.deepEqual(await leer(), { tipo_documento_fiscal: 'nit', nit_cui_invalido: false })
        await poner({ nit_cui: ambos, tipo_documento_fiscal: null })
        assert.deepEqual(await leer(), { tipo_documento_fiscal: 'cui', nit_cui_invalido: false })
    })
})
