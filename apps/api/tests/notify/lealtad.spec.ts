import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { contextoSistema } from '#shared/contexto'
import type { EventoEntrante } from '#shared/eventos_bus'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import { generar } from '#tests/billing/ayudas_billing'
import { facturasDelServicio, prepararEmpresas, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { entregar, entregarEvento, eventosOutbox, programaConReglas } from '#tests/lealtad/ayudas_lealtad'
import { CanalFalso, ColaFalsa } from '#tests/notify/ayudas_notify'
import { hoyGuatemala } from '#ledger/fechas'
import { sumarMeses } from '#lealtad/condiciones'
import { codigoReferidoDe } from '#core/referidos'
import AjustarPuntos from '#lealtad/actions/ajustar_puntos'
import VencerPuntos from '#lealtad/actions/vencer_puntos'
import RegistrarPago from '#billing/actions/registrar_pago'
import RegistrarCorrida from '#billing/actions/registrar_corrida'
import { ConsumidorNotify } from '#notify/consumidor'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { fijarChatEquipo } from '#notify/alertas'
import { ejecutarVigilancia } from '#notify/vigilancia'
import { textoPuntos } from '#notify/lealtad'
import { TOLERANCIA_POR_DEFECTO_MIN } from '#notify/actions/vigilar_crons'

/**
 * notify · avisos de lealtad (fase 1): puntos ganados, por vencer y referido calificado, con la
 * marca de la empresa del programa; el mismo evento dos veces deja un solo envío. Los demás
 * `lealtad.*` no avisan. Y la vigilancia de los crons diarios `lealtad.*`.
 */

interface Envio {
    id: number
    origen: string
    evento: string
    canal: string
    empresa_id: number | null
    asunto: string | null
    cuerpo: string
    estado: string
}

async function enviosDe(clienteId: number, evento?: string): Promise<Envio[]> {
    return (await db
        .from('notify.envios')
        .where('cliente_id', clienteId)
        .if(evento, (q) => q.where('evento', evento!))
        .orderBy('id', 'asc')
        .select('id', 'origen', 'evento', 'canal', 'empresa_id', 'asunto', 'cuerpo', 'estado')) as Envio[]
}

async function conCorreo(clienteId: number) {
    await db
        .from('core.clientes')
        .where('id', clienteId)
        .update({ email: `${unico('lealtad')}@prueba.local`, canal_preferido: 'correo' })
}

async function nombreEmpresa(empresaId: number): Promise<string> {
    const fila = (await db
        .from('core.empresas')
        .where('id', empresaId)
        .select('nombre_comercial')
        .firstOrFail()) as { nombre_comercial: string }
    return fila.nombre_comercial
}

async function entregarANotify(consumidor: ConsumidorNotify, eventos: EventoEntrante[], veces = 2) {
    for (let i = 0; i < veces; i++) {
        for (const evento of eventos) {
            if (consumidor.acepta(evento.evento)) await consumidor.procesar(evento)
        }
    }
}

test.group('notify · avisos de lealtad', (group) => {
    let consumidor: ConsumidorNotify
    let cola: ColaFalsa

    group.each.setup(() => {
        registrarCanal('correo', new CanalFalso('correo'))
        cola = new ColaFalsa()
        consumidor = new ConsumidorNotify(cola)
        return () => reiniciarCanales()
    })
    group.each.teardown(() => soloEmpresaPrincipal())

    test('qué eventos avisan al cliente', ({ assert }) => {
        const c = new ConsumidorNotify(new ColaFalsa())
        for (const evento of [
            'lealtad.puntos_acumulados',
            'lealtad.puntos_por_vencer',
            'lealtad.referido_calificado',
        ]) {
            assert.isTrue(c.acepta(evento), evento)
        }
        for (const evento of [
            'lealtad.programa_cambiado',
            'lealtad.puntos_revertidos',
            'lealtad.puntos_vencidos',
        ]) {
            assert.isFalse(c.acepta(evento), evento)
        }
        assert.equal(textoPuntos(1), '1 punto')
        assert.equal(textoPuntos(1250), '1,250 puntos')
    })

    test('puntos ganados y por vencer: un envío por evento aunque llegue dos veces, con la marca de la empresa', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx, {
            nombre: 'Puntos Fibra',
            vencimiento_meses: 12,
            aviso_vencimiento_dias: 30,
        })
        const s = await servicioEn(e.B)
        await conCorreo(s.clienteId)
        const marca = await nombreEmpresa(e.B)

        const ajuste = await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: 100, motivo: 'bienvenida' },
            e.ctx,
        )
        const acumulados = await eventosOutbox(
            'lealtad.puntos_acumulados',
            'movimiento_id',
            ajuste.movimiento.id,
        )
        assert.lengthOf(acumulados, 1)
        await entregarANotify(consumidor, acumulados)

        const ganados = await enviosDe(s.clienteId, 'lealtad.puntos_acumulados')
        assert.lengthOf(ganados, 1, 'el mismo evento dos veces: un solo envío')
        const vence = sumarMeses(hoyGuatemala(), 12)
        const venceCorto = DateTime.fromISO(vence).toFormat('dd/MM/yyyy')
        assert.include(ganados[0]!, {
            canal: 'correo',
            estado: 'encolado',
            empresa_id: e.B,
            asunto: 'Ganaste 100 puntos',
            origen: `outbox:${acumulados[0]!.id}`,
        })
        assert.include(ganados[0]!.cuerpo, 'Sumaste 100 puntos en Puntos Fibra. Tu saldo es de 100 puntos.')
        assert.include(ganados[0]!.cuerpo, `Estos puntos vencen el ${venceCorto}.`)
        assert.include(ganados[0]!.cuerpo, marca)
        // la cola recibió el envío (las dos entregas lo vuelven a encolar; la cola deduplica por id)
        assert.includeMembers(cola.ids, [ganados[0]!.id])

        // 20 días antes del vencimiento: A3 emite lealtad.puntos_por_vencer una vez por lote
        const aviso = DateTime.fromISO(vence).minus({ days: 20 }).toISODate()!
        await new VencerPuntos().execute({ empresa_id: e.B, hoy: aviso }, contextoSistema('cron'))
        const porVencer = await eventosOutbox('lealtad.puntos_por_vencer', 'lote_id', ajuste.movimiento.id)
        assert.lengthOf(porVencer, 1)
        await entregarANotify(consumidor, porVencer)

        const avisos = await enviosDe(s.clienteId, 'lealtad.puntos_por_vencer')
        assert.lengthOf(avisos, 1, 'el mismo evento dos veces: un solo envío')
        assert.include(avisos[0]!, { empresa_id: e.B, asunto: 'Tienes 100 puntos por vencer' })
        assert.include(
            avisos[0]!.cuerpo,
            `Tu lote de 100 puntos de Puntos Fibra vence el ${venceCorto}. Úsalo antes de esa fecha para no perderlo.`,
        )

        // La auditoría de la programación queda en la empresa del programa
        const auditoria = (await db
            .from('audit.acciones')
            .where({ accion: 'notificaciones.programar', entidad_tipo: 'cliente', entidad_id: s.clienteId })
            .distinct('empresa_id')) as Array<{ empresa_id: number }>
        assert.deepEqual(
            auditoria.map((f) => Number(f.empresa_id)),
            [e.B],
        )
    })

    test('referido calificado: un aviso al referidor con sus puntos; el bono del referido se avisa aparte', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx, {}, [
            {
                tipo: 'referido',
                puntos: 150,
                condiciones: { facturas_pagadas_minimas: 1, puntos_referido: 50 },
            },
        ])
        const referidor = await servicioEn(e.B)
        await conCorreo(referidor.clienteId)
        await codigoReferidoDe(referidor.clienteId, e.B)
        const nombreReferido = unico('Referida')
        const clienteNuevo = await crearClienteFila({
            nombre: nombreReferido,
            referido_por_id: referidor.clienteId,
            referido_empresa_id: e.B,
        })
        await conCorreo(clienteNuevo)
        const nuevo = await servicioEn(e.B, {
            precio: '100.00',
            instalacion: '2026-11-01',
            clienteId: clienteNuevo,
        })
        // A1 resolvió el código en el alta (fixture directo, como en las pruebas de A3)
        await entregar([
            {
                id: `creado-${nuevo.servicioId}`,
                evento: 'servicio.creado',
                payload: { servicio_id: nuevo.servicioId, empresa_id: e.B, cliente_id: clienteNuevo },
            },
        ])
        const [referido] = await db.from('lealtad.referidos').where('referido_id', clienteNuevo).select('id')
        assert.exists(referido)

        await generar(nuevo.servicioId, '2026-11-01')
        const [primera] = await facturasDelServicio(nuevo.servicioId)
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: clienteNuevo,
                metodo: 'caja',
                monto: primera!.total,
                facturas: [primera!.id],
                empresa_id: e.B,
            },
            e.ctx,
        )
        await entregarEvento('pago.registrado', 'pago_id', pago.id)

        const calificado = await eventosOutbox(
            'lealtad.referido_calificado',
            'referido_id',
            Number(referido!.id),
        )
        assert.lengthOf(calificado, 1)
        assert.equal(calificado[0]!.payload.cliente_id, clienteNuevo)
        const delReferidor = await eventosOutbox(
            'lealtad.puntos_acumulados',
            'cliente_id',
            referidor.clienteId,
        )
        const delReferido = await eventosOutbox('lealtad.puntos_acumulados', 'cliente_id', clienteNuevo)
        assert.lengthOf(delReferidor, 1)
        assert.lengthOf(delReferido, 1)
        // El bus entrega cada evento dos veces y en el orden del outbox
        await entregarANotify(
            consumidor,
            [...calificado, ...delReferidor, ...delReferido].sort((a, b) => Number(a.id) - Number(b.id)),
        )

        const alReferidor = await enviosDe(referidor.clienteId)
        assert.deepEqual(
            alReferidor.map((x) => x.evento),
            ['lealtad.referido_calificado'],
            'un solo aviso al referidor: el de sus puntos ganados lo cubre el del referido',
        )
        assert.include(alReferidor[0]!, { empresa_id: e.B, canal: 'correo' })
        assert.include(alReferidor[0]!.asunto!, await nombreEmpresa(e.B))
        assert.include(
            alReferidor[0]!.cuerpo,
            `${nombreReferido}, a quien recomendaste, cumplió los requisitos del programa de referidos. Ganaste 150 puntos; tu saldo es de 150 puntos.`,
        )

        const alReferido = await enviosDe(clienteNuevo)
        const deLealtad = alReferido.filter((x) => x.evento.startsWith('lealtad.'))
        assert.deepEqual(
            deLealtad.map((x) => [x.evento, x.asunto]),
            [['lealtad.puntos_acumulados', 'Ganaste 50 puntos']],
        )
    })
})

test.group('notify · vigilancia de los crons de lealtad', (group) => {
    group.each.setup(() => {
        registrarCanal('telegram', new CanalFalso('telegram'))
        fijarChatEquipo('-1009990002')
        return () => {
            reiniciarCanales()
            fijarChatEquipo(undefined)
        }
    })

    test('diarios a las 03:05 y 03:20 (Guatemala): gracia, alerta una vez y resuelto al correr', async ({
        assert,
    }) => {
        const tolerancia = env.get('NOTIFY_CRON_TOLERANCIA_MIN') ?? TOLERANCIA_POR_DEFECTO_MIN
        const cola = new ColaFalsa()
        const claves = ['cron:lealtad.otorgar_antiguedad', 'cron:lealtad.vencer']
        // Punto de partida: los dos corrieron ahora (cierra lo que otra prueba haya dejado abierto)
        for (const accion of ['lealtad.otorgar_antiguedad', 'lealtad.vencer']) {
            await new RegistrarCorrida(accion).execute(
                { parametros: { hoy: 'prueba' }, resultado: { fallidas: [] } },
                contextoSistema('cron'),
            )
        }
        const r0 = await ejecutarVigilancia(cola, DateTime.utc().plus({ minutes: 1 }).toISO()!)
        for (const clave of claves) assert.notInclude(r0.atrasados, clave)

        // Mañana: dentro de la tolerancia desde su hora aún no es atraso; pasada, sí (una vez)
        const manana = DateTime.now().setZone('America/Guatemala').plus({ days: 1 })
        const a = (hora: number, minuto: number, despues: number) =>
            manana.set({ hour: hora, minute: minuto, second: 0, millisecond: 0 }).plus({ minutes: despues })
        const r1 = await ejecutarVigilancia(
            cola,
            a(3, 5, tolerancia - 1)
                .toUTC()
                .toISO()!,
        )
        assert.notInclude(r1.atrasados, 'cron:lealtad.otorgar_antiguedad')
        const r1b = await ejecutarVigilancia(
            cola,
            a(3, 20, tolerancia - 1)
                .toUTC()
                .toISO()!,
        )
        assert.notInclude(r1b.atrasados, 'cron:lealtad.vencer')
        assert.include(r1b.atrasados, 'cron:lealtad.otorgar_antiguedad')

        const tarde = a(3, 20, tolerancia + 5)
        const r2 = await ejecutarVigilancia(cola, tarde.toUTC().toISO()!)
        assert.includeMembers(r2.atrasados, claves)
        await ejecutarVigilancia(cola, tarde.plus({ minutes: 5 }).toUTC().toISO()!)
        const abierto = (await db
            .from('notify.incidentes')
            .where({ clave: 'cron:lealtad.vencer', estado: 'abierto' })
            .first()) as { id: number }
        const alertas = (await db
            .from('notify.envios')
            .whereLike('origen', `alerta:${abierto.id}:%`)
            .select('cuerpo')) as Array<{ cuerpo: string }>
        assert.lengthOf(alertas, 1, 'no se repite mientras sigue atrasado')
        assert.include(alertas[0]!.cuerpo, 'El vencimiento de puntos de lealtad no se ejecutó a su hora')
        assert.include(alertas[0]!.cuerpo, `Debía correr: ${manana.toFormat('dd/MM/yyyy')} 03:20`)

        // Vuelve a correr: resuelto
        await new RegistrarCorrida('lealtad.vencer').execute(
            { parametros: { hoy: 'prueba' }, resultado: { fallidas: [] } },
            contextoSistema('cron'),
        )
        const r3 = await ejecutarVigilancia(cola, DateTime.utc().plus({ minutes: 2 }).toISO()!)
        assert.include(r3.recuperados, 'cron:lealtad.vencer')
        const cerrado = (await db
            .from('notify.incidentes')
            .where('id', abierto.id)
            .select('estado')
            .first()) as { estado: string }
        assert.equal(cerrado.estado, 'cerrado')
    })
})
