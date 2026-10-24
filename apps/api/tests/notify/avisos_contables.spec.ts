import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, soloEmpresaPrincipal } from '#tests/ayudas'
import { prepararEmpresas } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { contextoSistema } from '#shared/contexto'
import { relojFiscal } from '#fiscal/comun'
import RegistrarCorrida from '#billing/actions/registrar_corrida'
import CalcularDeclaracion from '#fiscal/actions/calcular_declaracion'
import RevisarDeclaracion from '#fiscal/actions/revisar_declaracion'
import MarcarDeclaracionPresentada from '#fiscal/actions/marcar_declaracion_presentada'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { fijarChatEquipo } from '#notify/alertas'
import { recargarConfiguracion } from '#notify/configuracion'
import { ConsumidorAlertas } from '#notify/consumidor_alertas'
import { ConsumidorNotify } from '#notify/consumidor'
import ConfigurarNotificaciones from '#notify/actions/configurar_notificaciones'
import VigilarCrons from '#notify/actions/vigilar_crons'
import { PLANTILLAS_ALERTA } from '#notify/plantillas_base'
import { CanalFalso, ColaFalsa, eventoOutbox } from '#tests/notify/ayudas_notify'

/**
 * Alertas internas que faltaban (pedidos de A3, `a3.md`): `libro.proceso_bloqueado` (al equipo y a
 * contabilidad, un incidente por empresa y proceso que cierra la primera corrida sin bloqueos),
 * `libro.checks_verificados` con anomalías, `libro.bloqueo_cambiado`, `libro.emitido`,
 * `ejercicio.cerrado` / `ejercicio.reabierto`, `declaracion.calculada` / `declaracion.presentada` y
 * los `sorteo.*` internos. Cada evento entregado dos veces deja un solo envío por canal.
 */

const TOKEN = `7770404:${'F'.repeat(35)}`
const CHAT = '-1007770404'
const CONTA = 'conta@argos.gt'

interface Envio {
    canal: string
    destino: string
    asunto: string | null
    cuerpo: string
    estado: string
    empresa_id: number | null
    origen: string
}

async function incidente(clave: string) {
    return (await db.from('notify.incidentes').where('clave', clave).orderBy('id', 'desc').first()) as {
        id: number
        estado: string
        eventos: number
    } | null
}

async function envios(clave: string): Promise<Envio[]> {
    const inc = await incidente(clave)
    if (!inc) return []
    return (await db
        .from('notify.envios')
        .whereLike('origen', `alerta:${inc.id}:%`)
        .orderBy('id')
        .select('canal', 'destino', 'asunto', 'cuerpo', 'estado', 'empresa_id', 'origen')) as Envio[]
}

function porCanal(lista: Envio[], canal: string): Envio {
    const envio = lista.find((e) => e.canal === canal)
    if (!envio) throw new Error(`sin envío por ${canal}`)
    return envio
}

/** Escribe el evento en el outbox y lo entrega `veces` veces a los dos consumidores del grupo notify. */
async function entregar(evento: string, payload: Record<string, unknown>, veces = 2) {
    const id = await eventoOutbox(evento, payload)
    const alertas = new ConsumidorAlertas(new ColaFalsa())
    const notify = new ConsumidorNotify(new ColaFalsa())
    for (let i = 0; i < veces; i++) {
        for (const consumidor of [alertas, notify]) {
            if (consumidor.acepta(evento)) {
                await consumidor.procesar({ id, evento, payload, requestId: `prueba-${id}` })
            }
        }
    }
    return id
}

async function nombreEmpresa(empresaId: number): Promise<string> {
    const fila = (await db
        .from('core.empresas')
        .where('id', empresaId)
        .select('nombre_comercial')
        .firstOrFail()) as { nombre_comercial: string }
    return fila.nombre_comercial
}

test.group('notify · alertas del libro, cierres, declaraciones y sorteos', (group) => {
    group.each.setup(async () => {
        await db.from('notify.configuracion_canales').delete()
        registrarCanal('telegram', new CanalFalso('telegram'))
        registrarCanal('correo', new CanalFalso('correo'))
        fijarChatEquipo(undefined)
        await new ConfigurarNotificaciones().execute(
            {
                version: 0,
                empresa_id: null,
                correo: { host: 'smtp.argos.gt', remitente: 'no-responder@argos.gt', contabilidad: CONTA },
                telegram: { token: TOKEN, chat_equipo: CHAT },
            },
            contextoPrueba(),
        )
        await recargarConfiguracion()
        return async () => {
            reiniciarCanales()
            await db.from('notify.configuracion_canales').delete()
            await recargarConfiguracion()
            await soloEmpresaPrincipal()
        }
    })

    test('cada evento nuevo tiene su consumidor y sus plantillas sembradas', async ({ assert }) => {
        const alertas = new ConsumidorAlertas(new ColaFalsa())
        const notify = new ConsumidorNotify(new ColaFalsa())
        const internos = [
            'libro.proceso_bloqueado',
            'libro.checks_verificados',
            'libro.bloqueo_cambiado',
            'libro.emitido',
            'ejercicio.cerrado',
            'ejercicio.reabierto',
            'declaracion.calculada',
            'declaracion.presentada',
            'sorteo.bases_publicadas',
            'sorteo.corte_cerrado',
            'sorteo.ejecutado',
            'sorteo.cancelado',
            'sorteo.entrega_anulada',
            'sorteo.premio_no_reclamado',
            'sorteo.acta_cerrada',
        ]
        for (const evento of internos) {
            assert.isTrue(alertas.acepta(evento), evento)
            assert.isFalse(notify.acepta(evento), `${evento} no va al cliente`)
        }
        for (const evento of [
            'lealtad.canje_reservado',
            'lealtad.canje_aplicado',
            'lealtad.canje_revertido',
            'sorteo.ganador_notificado',
            'sorteo.premio_entregado',
            'bonificacion.registrada',
        ]) {
            assert.isTrue(notify.acepta(evento), evento)
            assert.isFalse(alertas.acepta(evento), `${evento} no es alerta interna`)
        }
        // las plantillas de alerta están en la base (editables desde el panel)
        const eventos = new Set(PLANTILLAS_ALERTA.map((p) => p.evento))
        const enBase = (await db
            .from('notify.plantillas')
            .whereIn('evento', [...eventos])
            .distinct('evento')) as Array<{ evento: string }>
        assert.equal(enBase.length, eventos.size)
    })

    test('libro.proceso_bloqueado: un incidente por empresa y proceso, al equipo y a contabilidad; lo cierra la primera corrida sin bloqueos', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const nombre = await nombreEmpresa(e.B)
        const clave = `libro-proceso:${e.B}:facturas.generar`
        const corrida = (bloqueos: Array<Record<string, unknown>>) =>
            new RegistrarCorrida('facturas.generar').execute(
                {
                    parametros: { hasta: DateTime.utc().toISODate(), empresas: null },
                    resultado: { generadas: 0, bloqueados: bloqueos.length },
                    bloqueos: bloqueos as never,
                },
                contextoSistema('cron'),
            )
        const bloqueo = {
            empresa_id: e.B,
            tipo: 'ventas',
            hasta: '2026-09-30',
            fecha: '2026-09-01',
            documentos: 23,
            ejemplos: [11, 12, 13],
        }
        await corrida([bloqueo])
        const salida = (await db
            .from('audit.outbox')
            .where('evento', 'libro.proceso_bloqueado')
            .whereRaw(`(payload->>'empresa_id')::bigint = ?`, [e.B])
            .orderBy('id', 'desc')
            .select('id', 'payload')
            .firstOrFail()) as { id: number; payload: Record<string, unknown> }
        const alertas = new ConsumidorAlertas(new ColaFalsa())
        for (let i = 0; i < 2; i++) {
            await alertas.procesar({
                id: Number(salida.id),
                evento: 'libro.proceso_bloqueado',
                payload: salida.payload,
                requestId: 'prueba',
            })
        }
        const abiertos = await envios(clave)
        assert.lengthOf(abiertos, 2, 'Telegram y correo, una sola vez')
        const telegram = porCanal(abiertos, 'telegram')
        const correo = porCanal(abiertos, 'correo')
        assert.equal(telegram.destino, CHAT)
        assert.equal(correo.destino, CONTA)
        assert.equal(correo.empresa_id, e.B)
        assert.include(correo.asunto!, 'La generación de facturas quedó detenida por un bloqueo del libro')
        assert.include(correo.asunto!, nombre)
        assert.include(correo.cuerpo, 'no contabilizó 23 servicios porque la fecha contable 01/09/2026')
        assert.include(correo.cuerpo, 'bloqueo de ventas (hasta el 30/09/2026)')
        assert.include(correo.cuerpo, 'Ejemplos (servicios): 11, 12, 13…')

        // otra corrida aún bloqueada: suma al mismo incidente, sin otro aviso
        await entregar('libro.proceso_bloqueado', { ...salida.payload }, 1)
        assert.equal((await incidente(clave))!.eventos, 2)
        assert.lengthOf(await envios(clave), 2)

        // la vigilancia no lo cierra mientras la última corrida tenga bloqueos de la empresa
        await corrida([bloqueo])
        await new VigilarCrons().execute({}, contextoSistema('cron'))
        assert.equal((await incidente(clave))!.estado, 'abierto')

        // una corrida con bloqueos solo de otra empresa sí lo cierra
        await corrida([{ ...bloqueo, empresa_id: e.C }])
        const vigilancia = await new VigilarCrons().execute({}, contextoSistema('cron'))
        assert.include(vigilancia.recuperados, clave)
        assert.equal((await incidente(clave))!.estado, 'cerrado')
        const todos = await envios(clave)
        assert.lengthOf(todos, 4)
        const resuelto = todos.filter((x) => x.origen.endsWith(':cerrado'))
        assert.lengthOf(resuelto, 2)
        assert.include(
            porCanal(resuelto, 'telegram').cuerpo,
            'RESUELTO · La generación de facturas ya no está bloqueada',
        )
        assert.include(porCanal(resuelto, 'correo').cuerpo, 'terminó sin documentos bloqueados por el libro')

        // una segunda vigilancia no repite el aviso
        await new VigilarCrons().execute({}, contextoSistema('cron'))
        assert.lengthOf(await envios(clave), 4)
    })

    test('libro.checks_verificados: solo con anomalías y una vez por conjunto de anomalías', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        await entregar('libro.checks_verificados', {
            empresa_id: e.B,
            tipo: 'mensual',
            periodo: '2026-09',
            anomalias: [],
        })
        assert.isNull(await incidente(`libro-checks:${e.B}:mensual:2026-09:`))

        const payload = {
            empresa_id: e.B,
            tipo: 'mensual',
            periodo: '2026-09',
            anomalias: ['ventas_vs_dte', 'cxc_vs_auxiliar'],
        }
        await entregar('libro.checks_verificados', payload)
        // la misma lista en otro orden y en otra verificación no repite
        await entregar('libro.checks_verificados', {
            ...payload,
            anomalias: ['cxc_vs_auxiliar', 'ventas_vs_dte'],
        })
        const clave = `libro-checks:${e.B}:mensual:2026-09:cxc_vs_auxiliar,ventas_vs_dte`
        const lista = await envios(clave)
        assert.lengthOf(lista, 2)
        const correo = porCanal(lista, 'correo')
        assert.include(correo.asunto!, 'Verificación del cierre mensual 2026-09 con 2 anomalías')
        assert.include(correo.cuerpo, 'controles en anomalía sin supervisar: cxc_vs_auxiliar, ventas_vs_dte')
    })

    test('bloqueo, libro emitido y ejercicio: aviso a contabilidad; reabrir avisa también al equipo', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const nombre = await nombreEmpresa(e.B)

        await entregar('libro.bloqueo_cambiado', {
            empresa_id: e.B,
            tipo: 'impuestos',
            hasta: '2026-09-30',
            anterior: null,
        })
        const bloqueo = await envios(`libro-bloqueo:${e.B}:impuestos`)
        assert.deepEqual(
            bloqueo.map((x) => x.canal),
            ['correo'],
        )
        assert.equal(bloqueo[0]!.asunto, `bloqueo de impuestos hasta el 30/09/2026 (${nombre})`)
        assert.include(bloqueo[0]!.cuerpo, 'quedó hasta el 30/09/2026 (antes no había)')

        await entregar('libro.bloqueo_cambiado', {
            empresa_id: e.B,
            tipo: 'duro',
            hasta: null,
            anterior: '2026-06-30',
        })
        const quitado = await envios(`libro-bloqueo:${e.B}:duro`)
        assert.include(quitado[0]!.asunto!, 'Se quitó el cierre definitivo (bloqueo duro)')
        assert.include(quitado[0]!.cuerpo, '(estaba hasta el 30/06/2026)')

        await entregar('libro.emitido', {
            emision_id: 9101,
            empresa_id: e.B,
            libro: 'ventas',
            desde: '2026-07-01',
            hasta: '2026-09-30',
            folio_inicial: 41,
            folio_final: 58,
            formato: 'pdf',
            sha256: 'ab'.repeat(32),
            reimpresion_de: 9001,
        })
        const libro = await envios('libro-emitido:9101')
        assert.deepEqual(
            libro.map((x) => x.canal),
            ['correo'],
        )
        assert.equal(libro[0]!.asunto, `Reimpresión: Libro de ventas 3.er trimestre 2026 (${nombre})`)
        assert.include(libro[0]!.cuerpo, 'en PDF, folios 41 a 58')
        assert.include(libro[0]!.cuerpo, 'reemplaza a la emisión 9001')

        await entregar('ejercicio.cerrado', {
            empresa_id: e.B,
            cierre_id: 7101,
            anio: 2025,
            resultado: '-1500.00',
            isr: '0.00',
            reserva_legal: '0.00',
        })
        const cierre = await envios('ejercicio-cerrado:7101')
        assert.deepEqual(
            cierre.map((x) => x.canal),
            ['correo'],
        )
        assert.include(cierre[0]!.cuerpo, 'Pérdida del ejercicio (después del ISR): -Q 1,500.00')

        await entregar('ejercicio.reabierto', {
            empresa_id: e.B,
            cierre_id: 7101,
            anio: 2025,
            motivo: 'falta la depreciación de diciembre',
        })
        const reabierto = await envios('ejercicio-reabierto:7101')
        assert.sameMembers(
            reabierto.map((x) => x.canal),
            ['telegram', 'correo'],
        )
        assert.include(porCanal(reabierto, 'telegram').cuerpo, 'Motivo: falta la depreciación de diciembre')
    })

    test('declaración calculada y presentada con el flujo real de A3: correo a contabilidad, una vez', async ({
        assert,
    }) => {
        const original = relojFiscal.ahora
        try {
            const e = await prepararEmpresasGt()
            const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
            const mes = hoy.slice(0, 7)
            const siguiente = DateTime.fromISO(`${mes}-01`).plus({ months: 1 }).toFormat('yyyy-MM')
            await servicioFacturado(e.B, `${mes}-01`, { precio: '112.00', instalacion: `${mes}-01` })
            relojFiscal.ahora = () => new Date(`${siguiente}-05T18:00:00Z`)
            const declaracion = await new CalcularDeclaracion().execute(
                { empresa_id: e.B, impuesto: 'iva_mensual', periodo: mes },
                e.ctx,
            )
            await new RevisarDeclaracion().execute({ declaracion_id: declaracion.id }, e.ctx)
            await new MarcarDeclaracionPresentada().execute(
                {
                    declaracion_id: declaracion.id,
                    numero_formulario: '2237-77',
                    fecha_presentacion: `${siguiente}-02`,
                },
                e.ctx,
            )
            const alertas = new ConsumidorAlertas(new ColaFalsa())
            for (const evento of ['declaracion.calculada', 'declaracion.presentada']) {
                const filas = (await db
                    .from('audit.outbox')
                    .where('evento', evento)
                    .whereRaw(`(payload->>'declaracion_id')::bigint = ?`, [declaracion.id])
                    .select('id', 'payload')) as Array<{ id: number; payload: Record<string, unknown> }>
                assert.lengthOf(filas, 1, evento)
                for (let i = 0; i < 2; i++) {
                    await alertas.procesar({
                        id: Number(filas[0]!.id),
                        evento,
                        payload: filas[0]!.payload,
                        requestId: 'prueba',
                    })
                }
                if (evento === 'declaracion.calculada') {
                    const lista = await envios(
                        `declaracion-calculada:${declaracion.id}:${String(filas[0]!.payload.monto)}`,
                    )
                    assert.deepEqual(
                        lista.map((x) => x.canal),
                        ['correo'],
                    )
                    assert.include(lista[0]!.asunto!, 'Declaración calculada: IVA')
                    assert.include(lista[0]!.cuerpo, 'Monto a pagar según el borrador: Q 12.00.')
                } else {
                    const lista = await envios(`declaracion-presentada:${declaracion.id}`)
                    assert.deepEqual(
                        lista.map((x) => x.canal),
                        ['correo'],
                    )
                    assert.include(lista[0]!.cuerpo, 'formulario 2237-77')
                    assert.include(
                        lista[0]!.cuerpo,
                        `el ${DateTime.fromISO(`${siguiente}-02`).toFormat('dd/MM/yyyy')}`,
                    )
                }
            }
        } finally {
            relojFiscal.ahora = original
        }
    })

    test('sorteos internos: al chat del equipo, una vez por hecho', async ({ assert }) => {
        const e = await prepararEmpresas()
        await entregar('sorteo.ejecutado', {
            sorteo_id: 880001,
            empresa_id: e.B,
            ganadores: [
                { cliente_id: 1, tipo: 'titular', posicion: 1 },
                { cliente_id: 2, tipo: 'titular', posicion: 2 },
                { cliente_id: 3, tipo: 'suplente', posicion: 3 },
            ],
        })
        const ejecutado = await envios('sorteo-ejecutado:880001')
        assert.deepEqual(
            ejecutado.map((x) => [x.canal, x.destino]),
            [['telegram', CHAT]],
        )
        assert.include(ejecutado[0]!.cuerpo, '2 ganadores titulares y 1 suplentes')

        await entregar('sorteo.premio_no_reclamado', {
            sorteo_id: 880001,
            empresa_id: e.B,
            ganador_id: 55,
            cliente_id: null,
            posicion: 1,
            premio_posicion: 1,
            suplente_id: null,
            motivo: 'venció el plazo',
        })
        const noReclamado = await envios('sorteo-premio_no_reclamado:880001:55')
        assert.include(noReclamado[0]!.cuerpo, 'No quedan suplentes')

        await entregar('sorteo.cancelado', {
            sorteo_id: 880002,
            empresa_id: e.B,
            motivo: 'sin participantes',
        })
        const [cancelado] = await envios('sorteo-cancelado:880002')
        assert.include(cancelado!.cuerpo, 'Motivo: sin participantes')
    })

    test('plantillas editables: una editada se usa y una desactivada silencia su canal', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const filtro = { evento: 'alerta.libro.emitido', canal: 'correo' }
        const original = (await db.from('notify.plantillas').where(filtro).firstOrFail()) as {
            cuerpo: string
            activa: boolean
        }
        try {
            await db
                .from('notify.plantillas')
                .where(filtro)
                .update({ cuerpo: 'Libro {{alerta.libro}} listo.' })
            await entregar('libro.emitido', {
                emision_id: 9201,
                empresa_id: e.B,
                libro: 'diario',
                desde: '2026-09-01',
                hasta: '2026-09-30',
            })
            const [editado] = await envios('libro-emitido:9201')
            assert.equal(editado!.cuerpo, 'Libro Libro diario listo.')

            await db.from('notify.plantillas').where(filtro).update({ activa: false })
            await entregar('libro.emitido', {
                emision_id: 9202,
                empresa_id: e.B,
                libro: 'mayor',
                desde: '2026-09-01',
                hasta: '2026-09-30',
            })
            assert.isNotNull(await incidente('libro-emitido:9202'), 'el incidente queda registrado')
            assert.lengthOf(await envios('libro-emitido:9202'), 0)
        } finally {
            await db
                .from('notify.plantillas')
                .where(filtro)
                .update({ cuerpo: original.cuerpo, activa: original.activa })
        }
    })
})
