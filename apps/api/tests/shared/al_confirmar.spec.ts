import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { insertarEvento } from '#shared/outbox'
import { contextoPrueba, unico } from '#tests/ayudas'

interface Entrada {
    nombre: string
    registro: string[]
    fallar?: boolean
    anidada?: Entrada
}

/** Crea una zona y anota en `registro` cuando corre su gancho posterior al COMMIT. */
class ZonaConGancho extends DomainAction<Entrada, number> {
    readonly nombre = 'zonas.crear'

    protected async handle(input: Entrada, t: Transaccion) {
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.zonas')
            .insert({ nombre: input.nombre })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('zona', fila!.id)
        t.alConfirmar(async () => {
            // Ya confirmado: la fila es visible desde otra conexión.
            const visible = await db.from('core.zonas').where('id', fila!.id).first()
            input.registro.push(`${input.nombre}:${visible ? 'visible' : 'invisible'}`)
        })
        if (input.anidada) {
            await new ZonaConGancho().execute(input.anidada, t.ctx, { trx: t.trx }).catch(() => undefined)
        }
        if (input.fallar) throw new Error('falla provocada')
        return fila!.id
    }
}

test.group('DomainAction · alConfirmar y outbox', () => {
    test('el gancho corre después del COMMIT', async ({ assert }) => {
        const registro: string[] = []
        const nombre = unico('Zona')
        await new ZonaConGancho().execute({ nombre, registro }, contextoPrueba())
        assert.deepEqual(registro, [`${nombre}:visible`])
    })

    test('si la acción falla el gancho no corre', async ({ assert }) => {
        const registro: string[] = []
        await assert.rejects(() =>
            new ZonaConGancho().execute({ nombre: unico('Zona'), registro, fallar: true }, contextoPrueba()),
        )
        assert.deepEqual(registro, [])
    })

    test('anidada: sus ganchos esperan a la externa y se descartan si el savepoint falla', async ({
        assert,
    }) => {
        const registro: string[] = []
        const externa = unico('Zona')
        const buena = unico('Zona')
        const mala = unico('Zona')

        await new ZonaConGancho().execute(
            {
                nombre: externa,
                registro,
                anidada: { nombre: buena, registro, anidada: { nombre: mala, registro, fallar: true } },
            },
            contextoPrueba(),
        )
        assert.sameMembers(registro, [`${externa}:visible`, `${buena}:visible`])

        const registro2: string[] = []
        await assert.rejects(() =>
            new ZonaConGancho().execute(
                {
                    nombre: unico('Zona'),
                    registro: registro2,
                    fallar: true,
                    anidada: { nombre: unico('Zona'), registro: registro2 },
                },
                contextoPrueba(),
            ),
        )
        assert.deepEqual(registro2, [], 'la externa falló: nadie corre')
    })

    test('anidada en una transacción externa ajena corre al COMMIT de esa transacción', async ({
        assert,
    }) => {
        const registro: string[] = []
        const nombre = unico('Zona')
        await db.transaction(async (trx) => {
            await new ZonaConGancho().execute({ nombre, registro }, contextoPrueba(), { trx })
            assert.deepEqual(registro, [], 'todavía no se confirma')
        })
        assert.deepEqual(registro, [`${nombre}:visible`])
    })

    test('insertarEvento rechaza eventos fuera del catálogo', async ({ assert }) => {
        await assert.rejects(
            () => insertarEvento(db.connection(), 'no.existe' as never, {} as never, null),
            /fuera del catálogo/,
        )
    })
})
