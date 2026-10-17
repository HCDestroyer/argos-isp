import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { contextoPrueba, unico } from '#tests/ayudas'

/** Crea una zona, registra cambios (con un campo sensible) y emite un evento. */
class CrearZonaPrueba extends DomainAction<{ nombre: string; pass_ppp: string; fallar?: boolean }, number> {
    readonly nombre = 'zonas.crear'

    protected async handle(input: { nombre: string; pass_ppp: string; fallar?: boolean }, t: Transaccion) {
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.zonas')
            .insert({ nombre: input.nombre })
            .returning('id')) as Array<{ id: number }>
        const id = fila!.id
        t.fijarEntidad('zona', id)
        await t.registrarCambios({ tipo: 'zona', id }, null, {
            nombre: input.nombre,
            passPpp: input.pass_ppp,
            version: 1,
        })
        await t.emit('servicio.estado_cambiado', {
            servicio_id: id,
            empresa_id: 1,
            de: 'activo',
            a: 'suspendido',
            motivo: 'prueba',
        })
        if (input.fallar) throw new Error('falla provocada después de escribir')
        return id
    }
}

/** Inserta un asiento descuadrado: el error aparece al hacer COMMIT. */
class AsientoDescuadrado extends DomainAction<{ descripcion: string }, void> {
    readonly nombre = 'libro.ajuste'

    protected async handle(input: { descripcion: string }, t: Transaccion) {
        const [cuenta] = (await t.trx
            .insertQuery()
            .table('ledger.cuentas')
            .insert({ codigo: unico('9.9'), nombre: 'Cuenta prueba', tipo: 'activo' })
            .returning('id')) as Array<{ id: number }>
        const [asiento] = (await t.trx
            .insertQuery()
            .table('ledger.asientos')
            .insert({ fecha: '2026-10-19', descripcion: input.descripcion, origen_tipo: 'ajuste' })
            .returning('id')) as Array<{ id: number }>
        await t.trx
            .insertQuery()
            .table('ledger.movimientos')
            .multiInsert([
                { asiento_id: asiento!.id, cuenta_id: cuenta!.id, debe: '100.00', haber: 0 },
                { asiento_id: asiento!.id, cuenta_id: cuenta!.id, debe: 0, haber: '90.00' },
            ])
        t.fijarEntidad('asiento', asiento!.id)
    }
}

test.group('DomainAction', () => {
    test('escribe la acción, la auditoría, los cambios y el outbox en la misma transacción', async ({
        assert,
    }) => {
        const ctx = contextoPrueba(1)
        const nombre = unico('Zona')
        const id = await new CrearZonaPrueba().execute({ nombre, pass_ppp: 'secreta' }, ctx)

        const zona = await db.from('core.zonas').where('id', id).first()
        assert.equal(zona.nombre, nombre)

        const acciones = await db.from('audit.acciones').where('request_id', ctx.requestId)
        assert.lengthOf(acciones, 1)
        assert.containsSubset(acciones[0], {
            actor_tipo: 'usuario',
            actor_id: 1,
            canal: 'consola',
            accion: 'zonas.crear',
            entidad_tipo: 'zona',
            entidad_id: id,
            resultado: 'ok',
            error: null,
        })
        assert.deepEqual(acciones[0].entrada, { nombre, pass_ppp: '***' })

        const cambios = await db.from('audit.cambios').where('request_id', ctx.requestId).orderBy('campo')
        assert.deepEqual(
            cambios.map((c) => [c.campo, c.antes, c.despues]),
            [
                ['nombre', null, nombre],
                ['pass_ppp', null, '***'],
            ],
        )

        const eventos = await db.from('audit.outbox').where('request_id', ctx.requestId)
        assert.lengthOf(eventos, 1)
        assert.equal(eventos[0].evento, 'servicio.estado_cambiado')
        assert.deepEqual(eventos[0].payload, {
            servicio_id: id,
            empresa_id: 1,
            de: 'activo',
            a: 'suspendido',
            motivo: 'prueba',
        })
        assert.isNull(eventos[0].publicado_en)
    })

    test('si falla revierte el cambio y el evento, pero deja la auditoría del error', async ({ assert }) => {
        const ctx = contextoPrueba(1)
        const nombre = unico('Zona')

        await assert.rejects(
            () => new CrearZonaPrueba().execute({ nombre, pass_ppp: 'x', fallar: true }, ctx),
            /falla provocada/,
        )

        assert.isNull(await db.from('core.zonas').where('nombre', nombre).first())
        assert.lengthOf(await db.from('audit.outbox').where('request_id', ctx.requestId), 0)
        assert.lengthOf(await db.from('audit.cambios').where('request_id', ctx.requestId), 0)

        const acciones = await db.from('audit.acciones').where('request_id', ctx.requestId)
        assert.lengthOf(acciones, 1)
        assert.equal(acciones[0].resultado, 'error')
        assert.equal(acciones[0].accion, 'zonas.crear')
        assert.include(acciones[0].error, 'falla provocada')
        assert.equal(acciones[0].entidad_tipo, 'zona')
    })

    test('un error al hacer COMMIT (asiento descuadrado) también queda auditado', async ({ assert }) => {
        const ctx = contextoPrueba()
        const descripcion = unico('descuadre')

        await assert.rejects(() => new AsientoDescuadrado().execute({ descripcion }, ctx), /descuadrado/)

        assert.isNull(await db.from('ledger.asientos').where('descripcion', descripcion).first())
        const acciones = await db.from('audit.acciones').where('request_id', ctx.requestId)
        assert.lengthOf(acciones, 1)
        assert.equal(acciones[0].resultado, 'error')
        assert.include(acciones[0].error, 'descuadrado')
    })

    test('anidada con { trx } usa un savepoint dentro de la transacción externa', async ({ assert }) => {
        const ctx = contextoPrueba()
        const ok = unico('Zona')
        const mal = unico('Zona')

        await db.transaction(async (trx) => {
            await new CrearZonaPrueba().execute({ nombre: ok, pass_ppp: 'x' }, ctx, { trx })
            await assert.rejects(() =>
                new CrearZonaPrueba().execute({ nombre: mal, pass_ppp: 'x', fallar: true }, ctx, { trx }),
            )
        })

        assert.isNotNull(await db.from('core.zonas').where('nombre', ok).first())
        assert.isNull(await db.from('core.zonas').where('nombre', mal).first())
        const resultados = await db
            .from('audit.acciones')
            .where('request_id', ctx.requestId)
            .orderBy('id')
            .select('resultado')
        assert.deepEqual(
            resultados.map((r) => r.resultado),
            ['ok', 'error'],
        )
    })
})
