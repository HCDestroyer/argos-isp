import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { ConsumidorNotify } from '#notify/consumidor'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { PLANTILLAS_BASE } from '#notify/plantillas_base'
import { CanalFalso, ColaFalsa, crearCliente, crearServicio, eventoOutbox } from '#tests/notify/ayudas_notify'
import { unico } from '#tests/ayudas'
import MigracionTextos, {
    TEXTOS,
} from '#database/migrations/1794820974314_alter_notify_textos_suspension_aaas_table'

/**
 * `servicio.estado_cambiado` por correo y Telegram: el texto «por saldo pendiente… se reactiva al
 * registrar tu pago» solo sale cuando el motivo es el de `evaluarEstadoServicio` (facturas
 * vencidas); una suspensión o un límite manual (`core/transicion_manual.ts`, motivo libre del
 * operador) no promete reactivación por pago. Y la migración que corrige las plantillas ya
 * sembradas, sin pisar las personalizadas.
 */

const SUSPENSION_POR_SALDO = '2 facturas vencidas (se corta con 2)'
const LIMITE_POR_SALDO = '1 factura vencida (se limita con 1)'
const MANUAL = 'pidió suspender por viaje'

async function avisos(de: string, a: string, motivo: string) {
    const clienteId = await crearCliente({
        email: 'cliente@prueba.local',
        canal_preferido: 'telegram',
        telegram_chat_id: '424242',
    })
    const plan = unico('Plan Hogar')
    const servicioId = await crearServicio(clienteId, plan)
    const payload = { servicio_id: servicioId, de, a, motivo }
    const outboxId = await eventoOutbox('servicio.estado_cambiado', payload)
    await new ConsumidorNotify(new ColaFalsa()).procesar({
        id: outboxId,
        evento: 'servicio.estado_cambiado',
        payload,
    })
    const envios = await db.from('notify.envios').where('origen', `outbox:${outboxId}`).orderBy('id')
    const porCanal = Object.fromEntries(envios.map((e) => [e.canal, e])) as Record<
        string,
        { asunto: string | null; cuerpo: string }
    >
    return { plan, correo: porCanal.correo!, telegram: porCanal.telegram! }
}

test.group('notify · texto de servicio.estado_cambiado según el motivo', (group) => {
    group.each.setup(() => {
        registrarCanal('correo', new CanalFalso('correo'))
        registrarCanal('telegram', new CanalFalso('telegram'))
        return () => reiniciarCanales()
    })

    test('suspensión por facturas vencidas: saldo pendiente y reactivación al pagar', async ({ assert }) => {
        const { plan, correo, telegram } = await avisos('activo', 'suspendido', SUSPENSION_POR_SALDO)
        assert.equal(correo.asunto, 'Servicio suspendido')
        for (const envio of [correo, telegram]) {
            assert.include(
                envio.cuerpo,
                `Tu servicio ${plan} fue suspendido por saldo pendiente. Se reactiva automáticamente al registrar tu pago.`,
            )
            assert.notInclude(envio.cuerpo, 'comunícate con nosotros')
        }
    })

    test('suspensión manual: no habla de saldo ni de reactivar con el pago', async ({ assert }) => {
        const { plan, correo, telegram } = await avisos('activo', 'suspendido', MANUAL)
        assert.equal(correo.asunto, 'Servicio suspendido')
        for (const envio of [correo, telegram]) {
            assert.include(
                envio.cuerpo,
                `Tu servicio ${plan} fue suspendido. Para reactivarlo, comunícate con nosotros.`,
            )
            assert.notInclude(envio.cuerpo, 'saldo pendiente')
            assert.notInclude(envio.cuerpo, 'registrar tu pago')
            assert.notInclude(envio.cuerpo, MANUAL, 'el motivo del operador es interno')
        }
    })

    test('límite por facturas vencidas y límite manual', async ({ assert }) => {
        const porSaldo = await avisos('activo', 'limitado', LIMITE_POR_SALDO)
        for (const envio of [porSaldo.correo, porSaldo.telegram]) {
            assert.include(
                envio.cuerpo,
                `La velocidad de tu servicio ${porSaldo.plan} fue limitada por saldo pendiente.`,
            )
        }

        const manual = await avisos('activo', 'limitado', MANUAL)
        for (const envio of [manual.correo, manual.telegram]) {
            assert.include(
                envio.cuerpo,
                `La velocidad de tu servicio ${manual.plan} fue limitada. Si tienes dudas, comunícate con nosotros.`,
            )
            assert.notInclude(envio.cuerpo, 'saldo pendiente')
        }
    })

    test('retirado y reactivado no dependen del motivo', async ({ assert }) => {
        const retiro = await avisos('activo', 'retirado', 'cliente se muda')
        assert.include(retiro.correo.cuerpo, `Tu servicio ${retiro.plan} fue dado de baja.`)
        assert.notInclude(retiro.correo.cuerpo, 'saldo pendiente')

        const vuelta = await avisos('suspendido', 'activo', 'reactivación manual')
        assert.include(vuelta.telegram.cuerpo, `Tu servicio ${vuelta.plan} está activo de nuevo.`)
    })
})

test.group('notify · migración de textos de fábrica engañosos', (group) => {
    const REQUEST_ID = 'migracion:1794820974314_alter_notify_textos_suspension_aaas_table'
    let guardadas: Array<{ id: number; cuerpo: string }> = []

    group.each.setup(async () => {
        guardadas = await db
            .from('notify.plantillas')
            .whereIn(
                ['evento', 'canal'],
                TEXTOS.map((t) => [t.evento, t.canal]),
            )
            .select('id', 'cuerpo')
        return async () => {
            for (const fila of guardadas) {
                await db.from('notify.plantillas').where('id', fila.id).update({ cuerpo: fila.cuerpo })
            }
        }
    })

    test('sus textos nuevos son los de la base', ({ assert }) => {
        assert.lengthOf(TEXTOS, 3)
        for (const texto of TEXTOS) {
            const base = PLANTILLAS_BASE.find((p) => p.evento === texto.evento && p.canal === texto.canal)
            assert.equal(base?.cuerpo, texto.nuevo, `${texto.evento}/${texto.canal}`)
            assert.notEqual(texto.original, texto.nuevo)
        }
    })

    test('solo cambia las plantillas con el texto original; las personalizadas quedan', async ({
        assert,
    }) => {
        const [correo, telegram, alerta] = ['correo', 'telegram', 'telegram'].map((canal, i) =>
            TEXTOS.find(
                (t) =>
                    t.canal === canal &&
                    t.evento === (i === 2 ? 'alerta.aaa.caido' : 'servicio.estado_cambiado'),
            )!,
        )
        const fila = (evento: string, canal: string) =>
            db.from('notify.plantillas').where({ evento, canal }).firstOrFail()
        const personalizado = `${telegram!.original}\nTexto propio del ISP`

        // correo y alerta sin editar (texto de fábrica viejo); telegram personalizado
        await db
            .from('notify.plantillas')
            .where({ evento: correo!.evento, canal: 'correo' })
            .update({ cuerpo: correo!.original })
        await db
            .from('notify.plantillas')
            .where({ evento: alerta!.evento, canal: 'telegram' })
            .update({ cuerpo: alerta!.original })
        await db
            .from('notify.plantillas')
            .where({ evento: telegram!.evento, canal: 'telegram' })
            .update({ cuerpo: personalizado })
        const antes = {
            correo: await fila(correo!.evento, 'correo'),
            telegram: await fila(telegram!.evento, 'telegram'),
            alerta: await fila(alerta!.evento, 'telegram'),
        }
        const migrar = () => db.transaction((trx) => new MigracionTextos(trx, 'textos', false).execUp())

        await migrar()
        await migrar() // idempotente

        const despues = {
            correo: await fila(correo!.evento, 'correo'),
            telegram: await fila(telegram!.evento, 'telegram'),
            alerta: await fila(alerta!.evento, 'telegram'),
        }
        assert.equal(despues.correo.cuerpo, correo!.nuevo)
        assert.equal(despues.correo.version, antes.correo.version + 1)
        assert.equal(despues.correo.activa, antes.correo.activa)
        assert.equal(despues.correo.asunto, antes.correo.asunto)
        assert.equal(despues.alerta.cuerpo, alerta!.nuevo)
        assert.equal(despues.alerta.version, antes.alerta.version + 1)
        assert.equal(despues.telegram.cuerpo, personalizado)
        assert.equal(despues.telegram.version, antes.telegram.version)

        const auditadas = await db
            .from('audit.cambios')
            .where('request_id', REQUEST_ID)
            .whereIn('entidad_id', [antes.correo.id, antes.alerta.id, antes.telegram.id])
            .where('created_at', '>=', antes.correo.updated_at)
            .select('entidad_tipo', 'entidad_id', 'campo', 'antes', 'despues', 'actor_tipo')
        assert.sameMembers(
            auditadas.map((a) => Number(a.entidad_id)),
            [Number(antes.correo.id), Number(antes.alerta.id)],
        )
        const delCorreo = auditadas.find((a) => Number(a.entidad_id) === Number(antes.correo.id))!
        assert.include(delCorreo, {
            entidad_tipo: 'plantilla_notificacion',
            campo: 'cuerpo',
            actor_tipo: 'sistema',
        })
        assert.equal(delCorreo.antes, correo!.original)
        assert.equal(delCorreo.despues, correo!.nuevo)
    })
})
