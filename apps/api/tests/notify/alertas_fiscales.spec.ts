import { randomInt } from 'node:crypto'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { fijarChatEquipo } from '#notify/alertas'
import { recargarConfiguracion } from '#notify/configuracion'
import { ConsumidorAlertas } from '#notify/consumidor_alertas'
import ConfigurarNotificaciones, { type EntradaConfigurar } from '#notify/actions/configurar_notificaciones'
import EnviarNotificacion from '#notify/actions/enviar_notificacion'
import { CanalFalso, ColaFalsa, crearCliente } from '#tests/notify/ayudas_notify'

/**
 * Avisos fiscales (contrato de localización fiscal §14): `libro.integridad_rota`, `dte.rechazado`,
 * `fel.contingencia_cambiada` y `nota_credito.anulada` van al chat del equipo (Telegram) y por correo
 * a contabilidad, con la configuración de canales de la empresa del evento.
 */

const TOKEN = `7770101:${'C'.repeat(35)}`
const CHAT_GLOBAL = '-1007770001'
const CONTA_GLOBAL = 'contabilidad@argos.gt, auditor@argos.gt'

let siguienteId = 9_500_000_000 + randomInt(0, 1_000_000) * 1000
function evento(nombre: string, payload: Record<string, unknown>, id = ++siguienteId) {
    return { id, evento: nombre, payload, requestId: `prueba-${id}` }
}

async function configurar(entrada: Partial<EntradaConfigurar> & { empresa_id?: number | null }) {
    const empresaId = entrada.empresa_id ?? null
    const actual = (await db
        .from('notify.configuracion_canales')
        .if(empresaId === null, (q) => q.whereNull('empresa_id'))
        .if(empresaId !== null, (q) => q.where('empresa_id', empresaId!))
        .select('version')
        .first()) as { version: number } | null
    const vista = await new ConfigurarNotificaciones().execute(
        { version: actual?.version ?? 0, ...entrada, empresa_id: empresaId },
        contextoPrueba(),
    )
    await recargarConfiguracion()
    return vista
}

interface Envio {
    id: number
    evento: string
    cliente_id: number | null
    canal: string
    destino: string
    asunto: string | null
    cuerpo: string
    estado: string
    error: string | null
    motivo: string | null
    empresa_id: number | null
}

async function enviosDe(incidenteId: number): Promise<Envio[]> {
    return (await db
        .from('notify.envios')
        .whereLike('origen', `alerta:${incidenteId}:%`)
        .orderBy('id')
        .select(
            'id',
            'evento',
            'cliente_id',
            'canal',
            'destino',
            'asunto',
            'cuerpo',
            'estado',
            'error',
            'motivo',
            'empresa_id',
        )) as Envio[]
}

async function incidente(clave: string) {
    return (await db.from('notify.incidentes').where('clave', clave).orderBy('id', 'desc').first()) as {
        id: number
        estado: string
        eventos: number
    } | null
}

function porCanal(envios: Envio[], canal: string): Envio {
    const envio = envios.find((e) => e.canal === canal)
    if (!envio) throw new Error(`sin envío por ${canal}`)
    return envio
}

test.group('notify · avisos fiscales al equipo y a contabilidad', (group) => {
    let telegram: CanalFalso
    let correo: CanalFalso
    group.each.setup(async () => {
        await db.from('notify.configuracion_canales').delete()
        telegram = new CanalFalso('telegram')
        correo = new CanalFalso('correo')
        registrarCanal('telegram', telegram)
        registrarCanal('correo', correo)
        fijarChatEquipo(undefined) // el chat sale de la configuración
        await configurar({
            correo: { host: 'smtp.argos.gt', remitente: 'no-responder@argos.gt', contabilidad: CONTA_GLOBAL },
            telegram: { token: TOKEN, chat_equipo: CHAT_GLOBAL },
        })
        return async () => {
            reiniciarCanales()
            await db.from('notify.configuracion_canales').delete()
            await recargarConfiguracion()
            await soloEmpresaPrincipal()
        }
    })

    test('libro.integridad_rota: urgente, por Telegram y correo a contabilidad, una vez por sello', async ({
        assert,
    }) => {
        const cola = new ColaFalsa()
        const consumidor = new ConsumidorAlertas(cola)
        const sello = randomInt(1_000_000, 9_000_000)
        const payload = {
            empresa_id: 1,
            sello,
            asiento_id: 77,
            esperado: 'a1b2c3',
            obtenido: 'ffff00',
        }
        const primero = evento('libro.integridad_rota', payload)
        await consumidor.procesar(primero)
        await consumidor.procesar(primero) // reentrega
        await consumidor.procesar(evento('libro.integridad_rota', payload)) // reemisión del mismo sello

        const inc = await incidente(`libro:1:${sello}`)
        assert.equal(inc!.estado, 'cerrado', 'hecho puntual')
        assert.equal(inc!.eventos, 2, 'la reentrega no suma; la reemisión sí, sin avisar')
        const envios = await enviosDe(inc!.id)
        assert.lengthOf(envios, 2)
        const tg = porCanal(envios, 'telegram')
        const mail = porCanal(envios, 'correo')
        assert.include(tg, {
            evento: 'alerta.libro.integridad_rota',
            destino: CHAT_GLOBAL,
            estado: 'encolado',
        })
        assert.include(mail, { destino: CONTA_GLOBAL, estado: 'encolado', empresa_id: 1, cliente_id: null })
        assert.match(tg.cuerpo, /^URGENTE · Integridad del libro contable rota/)
        assert.match(mail.asunto!, /^URGENTE · Integridad del libro contable rota/)
        for (const texto of [
            String(sello),
            'Asiento: 77',
            'a1b2c3',
            'ffff00',
            'cierre del mes queda bloqueado',
        ]) {
            assert.include(mail.cuerpo, texto)
        }
        assert.sameMembers([...new Set(cola.ids)], [tg.id, mail.id])

        // Se entregan con su canal; no emiten notificacion.enviada (no hay cliente)
        for (const envio of envios) {
            const r = await new EnviarNotificacion().execute(
                { envioId: envio.id, intento: 1, maxIntentos: 3 },
                contextoPrueba(),
            )
            assert.equal(r.estado, 'enviado')
        }
        assert.deepEqual(
            correo.enviados.map((m) => m.destino),
            [CONTA_GLOBAL],
        )
        assert.deepEqual(
            telegram.enviados.map((m) => m.destino),
            [CHAT_GLOBAL],
        )
    })

    test('dte.rechazado con la configuración propia de la empresa; agrupa por ventana y separa definitivo de agotado', async ({
        assert,
    }) => {
        const empresa = await crearEmpresaFila({ nombre_comercial: unico('Fibra Sur') })
        await configurar({
            empresa_id: empresa,
            hereda: false,
            correo: { host: 'smtp.sur.gt', remitente: 'no-responder@sur.gt', contabilidad: 'conta@sur.gt' },
            telegram: { token: TOKEN, chat_equipo: '-1008880002' },
        })
        const consumidor = new ConsumidorAlertas(new ColaFalsa())
        const base = { empresa_id: empresa, documento_tipo: 'factura', documento_id: 501 }
        await consumidor.procesar(
            evento('dte.rechazado', {
                ...base,
                dte_id: 9001,
                error: 'NIT del receptor inválido',
                definitivo: true,
            }),
        )
        await consumidor.procesar(
            evento('dte.rechazado', {
                ...base,
                dte_id: 9002,
                documento_id: 502,
                error: 'otro',
                definitivo: true,
            }),
        )

        const definitivo = await incidente(`dte:${empresa}:definitivo`)
        assert.equal(definitivo!.estado, 'abierto')
        assert.equal(definitivo!.eventos, 2)
        let envios = await enviosDe(definitivo!.id)
        assert.lengthOf(envios, 2, 'el segundo rechazo en la ventana no repite el aviso')
        assert.include(porCanal(envios, 'telegram'), { destino: '-1008880002', empresa_id: empresa })
        const mail = porCanal(envios, 'correo')
        assert.include(mail, { destino: 'conta@sur.gt' })
        assert.match(mail.asunto!, /^DTE rechazado · Factura 501/)
        assert.include(mail.cuerpo, 'NIT del receptor inválido')
        assert.include(mail.cuerpo, 'reintenta el DTE desde el panel')

        // Reintentos agotados (definitivo: false): incidente aparte, con su texto
        await consumidor.procesar(
            evento('dte.rechazado', {
                ...base,
                documento_tipo: 'nota_credito',
                documento_id: 31,
                dte_id: 9003,
                error: 'ETIMEDOUT',
                definitivo: false,
            }),
        )
        const agotado = await incidente(`dte:${empresa}:agotado`)
        envios = await enviosDe(agotado!.id)
        assert.lengthOf(envios, 2)
        assert.match(
            porCanal(envios, 'telegram').cuerpo,
            /^DTE sin certificar tras agotar los reintentos · Nota de crédito 31/,
        )
        assert.include(porCanal(envios, 'correo').cuerpo, 'valora activar la contingencia')

        // Pasada la ventana sin rechazos, uno nuevo vuelve a avisar
        await db
            .from('notify.incidentes')
            .where('id', definitivo!.id)
            .update({ ultimo_en: DateTime.utc().minus({ minutes: 61 }).toJSDate() })
        await consumidor.procesar(
            evento('dte.rechazado', { ...base, dte_id: 9004, error: 'x', definitivo: true }),
        )
        const nuevo = await incidente(`dte:${empresa}:definitivo`)
        assert.notEqual(nuevo!.id, definitivo!.id)
        assert.lengthOf(await enviosDe(nuevo!.id), 2)
    })

    test('fel.contingencia_cambiada: avisa al activar y al desactivar (con duración), sin repetir', async ({
        assert,
    }) => {
        const empresa = await crearEmpresaFila()
        const consumidor = new ConsumidorAlertas(new ColaFalsa())
        const ahora = DateTime.utc()
        await consumidor.procesar(
            evento('fel.contingencia_cambiada', {
                empresa_id: empresa,
                activa: true,
                motivo: 'INFILE caído',
            }),
        )
        await consumidor.procesar(
            evento('fel.contingencia_cambiada', { empresa_id: empresa, activa: true, motivo: 'otra vez' }),
        )
        const abierto = await incidente(`fel-contingencia:${empresa}`)
        assert.equal(abierto!.estado, 'abierto')
        const alActivar = await enviosDe(abierto!.id)
        assert.lengthOf(alActivar, 2, 'activar dos veces avisa una')
        assert.include(porCanal(alActivar, 'correo'), { destino: CONTA_GLOBAL, empresa_id: empresa })
        assert.match(porCanal(alActivar, 'telegram').cuerpo, /^Contingencia FEL activada/)
        assert.include(porCanal(alActivar, 'correo').cuerpo, 'Motivo: INFILE caído')

        await db
            .from('notify.incidentes')
            .where('id', abierto!.id)
            .update({ abierto_en: ahora.minus({ minutes: 95 }).toJSDate() })
        await consumidor.procesar(
            evento('fel.contingencia_cambiada', {
                empresa_id: empresa,
                activa: false,
                motivo: 'volvió el servicio',
            }),
        )
        const cerrado = await incidente(`fel-contingencia:${empresa}`)
        assert.equal(cerrado!.id, abierto!.id)
        assert.equal(cerrado!.estado, 'cerrado')
        const todos = await enviosDe(abierto!.id)
        assert.lengthOf(todos, 4)
        const desactivada = todos.filter((e) => e.evento === 'alerta.fel.contingencia_desactivada')
        assert.lengthOf(desactivada, 2)
        assert.match(porCanal(desactivada, 'correo').cuerpo, /estuvo activa desde el .*1 h 35 min/)

        // Desactivada sin incidente abierto (se activó antes de este aviso): igual avisa
        const otra = await crearEmpresaFila()
        await consumidor.procesar(
            evento('fel.contingencia_cambiada', { empresa_id: otra, activa: false, motivo: 'fin' }),
        )
        const suelto = await incidente(`fel-contingencia:${otra}`)
        const avisos = await enviosDe(suelto!.id)
        assert.lengthOf(avisos, 2)
        assert.notInclude(porCanal(avisos, 'correo').cuerpo, 'estuvo activa desde')
    })

    test('nota_credito.anulada: una vez por nota; correo sin contabilidad queda fallido y alertas apagadas quedan omitidas', async ({
        assert,
    }) => {
        const clienteId = await crearCliente({ nombre: 'María López' })
        await configurar({ correo: { contabilidad: null } })
        const consumidor = new ConsumidorAlertas(new ColaFalsa())
        const notaId = randomInt(1_000_000, 9_000_000)
        const payload = {
            nota_credito_id: notaId,
            empresa_id: 1,
            factura_id: 999_999_001,
            cliente_id: clienteId,
            monto: '45.50',
            motivo: 'NCRE rechazada por la SAT',
        }
        await consumidor.procesar(evento('nota_credito.anulada', payload))
        await consumidor.procesar(evento('nota_credito.anulada', payload))
        const inc = await incidente(`nota-credito:${notaId}`)
        const envios = await enviosDe(inc!.id)
        assert.lengthOf(envios, 2)
        const tg = porCanal(envios, 'telegram')
        assert.equal(tg.estado, 'encolado')
        assert.include(tg.cuerpo, `nota de crédito ${notaId} de la factura 999999001 por Q 45.50`)
        assert.include(tg.cuerpo, `María López (#${clienteId})`)
        assert.include(porCanal(envios, 'correo'), {
            estado: 'fallido',
            destino: '-',
            error: 'Correo de contabilidad no configurado en la configuración global',
        })

        // Alertas por Telegram apagadas: queda omitido con el motivo (el correo sigue su suerte)
        await configurar({ telegram: { alertas_activo: false } })
        await consumidor.procesar(evento('nota_credito.anulada', { ...payload, nota_credito_id: notaId + 1 }))
        const otra = await enviosDe((await incidente(`nota-credito:${notaId + 1}`))!.id)
        assert.include(porCanal(otra, 'telegram'), {
            estado: 'omitido',
            motivo: 'Alertas por Telegram apagadas en la configuración global',
        })
    })

    test('plantilla desactivada silencia solo ese canal', async ({ assert }) => {
        await db
            .from('notify.plantillas')
            .where({ evento: 'alerta.nota_credito.anulada', canal: 'correo' })
            .update({ activa: false })
        try {
            const notaId = randomInt(1_000_000, 9_000_000)
            await new ConsumidorAlertas(new ColaFalsa()).procesar(
                evento('nota_credito.anulada', {
                    nota_credito_id: notaId,
                    empresa_id: 1,
                    factura_id: 1,
                    cliente_id: null,
                    monto: '1.00',
                    motivo: 'x',
                }),
            )
            const envios = await enviosDe((await incidente(`nota-credito:${notaId}`))!.id)
            assert.deepEqual(
                envios.map((e) => e.canal),
                ['telegram'],
            )
        } finally {
            await db
                .from('notify.plantillas')
                .where({ evento: 'alerta.nota_credito.anulada', canal: 'correo' })
                .update({ activa: true })
        }
    })
})
