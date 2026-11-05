import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import { huellaTablas, verificarLibro } from '#tests/contabilidad/verificar_libro'
import {
    cuentaBancariaPrueba,
    estadoServicio,
    eventosDe,
    generar,
    servicioCortado,
    unicoBd,
} from '#tests/billing/ayudas_billing'
import { crearServicioFila } from '#tests/core/fabricas'
import { normalizarReglasPromesa } from '#billing/reglas_promesa'
import { datosEvaluacion } from '#billing/promesas'
import { configuracionDeServicio, leerServicio } from '#billing/configuracion'
import RegistrarComprobante from '#billing/actions/registrar_comprobante'
import AprobarComprobante from '#billing/actions/aprobar_comprobante'
import RechazarComprobante from '#billing/actions/rechazar_comprobante'
import RegistrarReconexionTemporal from '#billing/actions/registrar_reconexion_temporal'
import IncumplirPromesas from '#billing/actions/incumplir_promesas'
import VencerFacturas from '#billing/actions/vencer_facturas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import { dec } from '#ledger/dinero'

/**
 * Auditor contable · contrato Iris 0.6.0 §7.1–§7.4, §9.2 (rama `a3/iris-060`, 0d4dcb1): comprobantes
 * registrados por Iris y reconexión temporal como promesa `reconexion_temporal` ligada al comprobante.
 *
 * Lo que se verifica:
 * - un comprobante pendiente o rechazado no toca `ledger.*` ni el auxiliar del cliente; al aprobarlo,
 *   un solo pago por su monto (`RegistrarPago` anidada: pago, asiento, evento y reactivación juntos);
 * - la reconexión no mueve el libro, y el estado del servicio solo lo cambia `evaluarEstadoServicio`
 *   (toda fila `servicios.cambiar_estado` tiene su `servicios.evaluar_estado` en el mismo request);
 * - los finales (cumplida, cancelada por rechazo, vencida sin revisar, incumplida) dejan libro,
 *   historial y estado coherentes; abuso (comprobante reusado, cupo, Q0.01 de menos) y concurrencia
 *   (dos reconexiones, aprobar contra vencer, aprobar contra rechazar);
 * - idempotencia de `POST /comprobantes/:id/reconexion-temporal`;
 * - los invariantes 26.* de `verificar_libro.ts` (comprobante ↔ pago, reconexión ↔ comprobante).
 *
 * Hallazgos abiertos (`.fails`):
 * - **H79 · media**: un comprobante **sin `servicio_id`** respalda la reconexión del servicio que
 *   pide Iris (`servicio_id` en el cuerpo), pero al aprobarlo `AprobarComprobante` no lo sabe y el
 *   pago se aplica a lo más antiguo del cliente (otro servicio). La reconexión no se cumple aunque el
 *   comprobante cubría todo lo vencido del servicio: al llegar `hasta` se **incumple**, el servicio se
 *   vuelve a cortar y la incumplida cuenta en el historial y en `bloqueo_tras_incumplida_dias`.
 *   Arreglo: al crear la reconexión, fijar `comprobantes.servicio_id` (o, al aprobar, tomar el
 *   servicio de la reconexión ligada y aplicar primero a sus `promesas_facturas`).
 */

const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR-boleta-auditor'),
])
const HORA = 3_600_000

async function habilitarReconexion(plantillaId: number, reconexion: Record<string, unknown> = {}) {
    await db
        .from('billing.plantillas_facturacion')
        .where('id', plantillaId)
        .update({
            reglas_promesa: JSON.stringify(
                normalizarReglasPromesa({
                    no_exceder_siguiente_facturacion: false,
                    reconexion_temporal: { permitida: true, ...reconexion },
                }),
            ),
        })
}

async function boleta(
    clienteId: number,
    servicioId: number | null,
    cuentaId: number,
    monto = '300.00',
    referencia?: string,
) {
    return new RegistrarComprobante().execute(
        {
            cliente_id: clienteId,
            servicio_id: servicioId,
            metodo: 'deposito',
            cuenta_bancaria_id: cuentaId,
            referencia: referencia ?? (await unicoBd('boleta-auditor')),
            monto,
            fecha_deposito: '2026-10-08',
            canal: 'panel',
            archivo: { contenido: PNG, nombre: 'boleta.png' },
        },
        contextoPrueba(),
    )
}

const reconectar = (comprobanteId: number, servicioId?: number) =>
    new RegistrarReconexionTemporal().execute(
        {
            comprobante_id: comprobanteId,
            servicio_id: servicioId ?? null,
            motivo: 'fuera_de_horario',
            canal: 'ia',
        },
        contextoPrueba(),
    )

const aprobar = (comprobanteId: number) =>
    new AprobarComprobante().execute({ comprobante_id: comprobanteId }, contextoPrueba())

const rechazar = (comprobanteId: number) =>
    new RechazarComprobante().execute(
        { comprobante_id: comprobanteId, motivo: 'no aparece en el banco', causa: 'no_aparece' },
        contextoPrueba(),
    )

/** El cron de promesas después de `hasta` (24 h por defecto). */
const vencer = (servicioId: number, horas = 25) =>
    new IncumplirPromesas().execute(
        { servicio_id: servicioId, ahora: new Date(Date.now() + horas * HORA) },
        contextoPrueba(),
    )

async function huellaLibro() {
    const todas = await huellaTablas()
    return Object.fromEntries(Object.entries(todas).filter(([t]) => t.startsWith('ledger.')))
}

async function auxiliar(clienteId: number): Promise<string> {
    const { rows } = (await db.rawQuery(
        `SELECT coalesce(sum(m.debe - m.haber), 0)::numeric(14,2)::text AS saldo
           FROM ledger.movimientos m JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE c.codigo = '1.1.03' AND m.cliente_id = ?`,
        [clienteId],
    )) as { rows: Array<{ saldo: string }> }
    return rows[0]!.saldo
}

async function promesa(id: number) {
    return (await db.from('billing.promesas').where('id', id).firstOrFail()) as {
        estado: string
        tipo: string
        monto: string
        comprobante_id: number
        resultado_evaluacion: { cierre?: Record<string, string> }
    }
}

async function estadoPromesa(id: number): Promise<string> {
    const fila = await promesa(id)
    return fila.estado
}

async function pagosDe(clienteId: number) {
    return db.from('billing.pagos').where('cliente_id', clienteId).select('id', 'monto', 'estado')
}

/** Toda fila `servicios.cambiar_estado` del servicio nació dentro de una `servicios.evaluar_estado`. */
async function cambiosFueraDeEvaluar(servicioId: number) {
    const { rows } = (await db.rawQuery(
        `SELECT c.id, c.request_id FROM audit.acciones c
          WHERE c.accion = 'servicios.cambiar_estado' AND c.entidad_id = ? AND c.resultado = 'ok'
            AND NOT EXISTS (SELECT 1 FROM audit.acciones e
                             WHERE e.accion = 'servicios.evaluar_estado' AND e.request_id = c.request_id
                               AND e.entidad_id = c.entidad_id)`,
        [servicioId],
    )) as { rows: unknown[] }
    return rows
}

async function invariantes(clientes: number[]) {
    return verificarLibro(null, { clientes, sinFuncionesProducto: true })
}

async function cortadoConBoleta(monto = '300.00') {
    const datos = await servicioCortado()
    await habilitarReconexion(datos.plantillaId)
    const cuenta = await cuentaBancariaPrueba()
    const k = await boleta(datos.clienteId, datos.servicioId, cuenta.id, monto)
    return { ...datos, cuenta, comprobanteId: k.id }
}

test.group('Auditor · Iris 0.6.0 · comprobantes y el libro', () => {
    test('pendiente y rechazado no tocan ledger ni el auxiliar; aprobado = un pago por su monto con su asiento', async ({
        assert,
    }) => {
        const datos = await servicioCortado()
        const cuenta = await cuentaBancariaPrueba()
        const saldo = await auxiliar(datos.clienteId)
        assert.equal(saldo, '300.00')

        const antes = await huellaLibro()
        const rechazado = await boleta(datos.clienteId, datos.servicioId, cuenta.id, '300.00')
        await rechazar(rechazado.id)
        const pendiente = await boleta(datos.clienteId, datos.servicioId, cuenta.id, '300.00')
        assert.deepEqual(await huellaLibro(), antes, 'registrar o rechazar no escribe en ledger')
        assert.equal(await auxiliar(datos.clienteId), saldo)
        assert.equal(await estadoServicio(datos.servicioId), 'suspendido')
        assert.lengthOf(await pagosDe(datos.clienteId), 0)

        const r = await aprobar(pendiente.id)
        const pagos = await pagosDe(datos.clienteId)
        assert.lengthOf(pagos, 1)
        assert.equal(pagos[0].id, r.pago.id)
        assert.isTrue(dec(pagos[0].monto).eq('300.00'))
        assert.equal(await auxiliar(datos.clienteId), '0.00')
        assert.equal(await estadoServicio(datos.servicioId), 'activo')
        const asientos = await db
            .from('ledger.asientos')
            .where('origen_tipo', 'pago')
            .where('origen_id', r.pago.id)
            .count('* as n')
        assert.equal(Number(asientos[0].n), 1)
        // evento, pago y reactivación en la misma petición
        const [evento] = await eventosDe('comprobante.aprobado', 'comprobante_id', pendiente.id)
        const [pagoEv] = await eventosDe('pago.registrado', 'pago_id', r.pago.id)
        assert.equal(evento.request_id, pagoEv.request_id)
        assert.deepEqual(await cambiosFueraDeEvaluar(datos.servicioId), [])
        assert.deepEqual(await invariantes([datos.clienteId]), [])
        await afirmarLibroCuadrado(assert)
    })

    test('aprobar contra rechazar a la vez: uno solo gana, a lo más un pago', async ({ assert }) => {
        const datos = await servicioCortado()
        const cuenta = await cuentaBancariaPrueba()
        const k = await boleta(datos.clienteId, datos.servicioId, cuenta.id)
        const r = await Promise.allSettled([aprobar(k.id), rechazar(k.id), aprobar(k.id)])
        assert.lengthOf(
            r.filter((x) => x.status === 'fulfilled'),
            1,
        )
        const fila = await db.from('billing.comprobantes').where('id', k.id).firstOrFail()
        const pagos = await pagosDe(datos.clienteId)
        assert.lengthOf(pagos, fila.estado === 'aprobado' ? 1 : 0)
        assert.deepEqual(await invariantes([datos.clienteId]), [])
        await afirmarLibroCuadrado(assert)
    })
})

test.group('Auditor · Iris 0.6.0 · reconexión temporal', () => {
    test('crear la reconexión no mueve el libro; el servicio sube solo por evaluarEstadoServicio', async ({
        assert,
    }) => {
        const d = await cortadoConBoleta()
        const antes = await huellaLibro()
        const r = await reconectar(d.comprobanteId)
        assert.deepEqual(await huellaLibro(), antes)
        assert.equal(r.servicio.estado, 'activo')
        const p = await promesa(r.promesa_id)
        assert.equal(p.tipo, 'reconexion_temporal')
        assert.equal(p.estado, 'activa')
        assert.equal(p.monto, '300.00')
        assert.equal(await auxiliar(d.clienteId), '300.00')
        assert.deepEqual(await cambiosFueraDeEvaluar(d.servicioId), [])
        assert.deepEqual(await invariantes([d.clienteId]), [])
    })

    test('final cumplida: aprobar salda, la promesa se cumple en la misma transacción y el servicio sigue activo', async ({
        assert,
    }) => {
        const d = await cortadoConBoleta()
        const r = await reconectar(d.comprobanteId)
        const a = await aprobar(d.comprobanteId)
        assert.equal(await estadoPromesa(r.promesa_id), 'cumplida')
        assert.equal(await estadoServicio(d.servicioId), 'activo')
        assert.equal(await auxiliar(d.clienteId), '0.00')
        const [cumplida] = await eventosDe('promesa.cumplida', 'promesa_id', r.promesa_id)
        const [pagoEv] = await eventosDe('pago.registrado', 'pago_id', a.pago.id)
        assert.equal(cumplida.request_id, pagoEv.request_id)
        // el cron después no la toca
        await vencer(d.servicioId)
        assert.equal(await estadoPromesa(r.promesa_id), 'cumplida')
        assert.equal(await estadoServicio(d.servicioId), 'activo')
        assert.deepEqual(await cambiosFueraDeEvaluar(d.servicioId), [])
        assert.deepEqual(await invariantes([d.clienteId]), [])
        await afirmarLibroCuadrado(assert)
    })

    test('final cancelada por rechazo: sin pago ni asiento, vuelve a cortarse, no cuenta en el historial', async ({
        assert,
    }) => {
        const d = await cortadoConBoleta()
        const r = await reconectar(d.comprobanteId)
        const antes = await huellaLibro()
        await rechazar(d.comprobanteId)
        assert.deepEqual(await huellaLibro(), antes)
        assert.equal(await estadoPromesa(r.promesa_id), 'cancelada')
        assert.equal(await estadoServicio(d.servicioId), 'suspendido')
        assert.lengthOf(await pagosDe(d.clienteId), 0)
        const servicio = await leerServicio(db.connection() as never, d.servicioId)
        const config = await configuracionDeServicio(db.connection() as never, servicio)
        const datos = await datosEvaluacion(db.connection() as never, servicio, config!, {
            canal: 'operador',
            vence_en: new Date(Date.now() + 48 * HORA),
            ahora: new Date(),
        })
        assert.lengthOf(datos.resueltas, 0, 'una cancelada no entra al historial')
        assert.isNull(datos.ultima_incumplida)
        assert.deepEqual(await cambiosFueraDeEvaluar(d.servicioId), [])
        assert.deepEqual(await invariantes([d.clienteId]), [])
    })

    test('final vencida sin revisar y aprobación tardía: cancelada, corta, y al aprobar después reactiva por el pago', async ({
        assert,
    }) => {
        const d = await cortadoConBoleta()
        const r = await reconectar(d.comprobanteId)
        await vencer(d.servicioId)
        const p = await promesa(r.promesa_id)
        assert.equal(p.estado, 'cancelada')
        assert.equal(await estadoServicio(d.servicioId), 'suspendido')
        assert.lengthOf(await pagosDe(d.clienteId), 0)
        await aprobar(d.comprobanteId)
        assert.equal(await estadoPromesa(r.promesa_id), 'cancelada', 'una cerrada no se reabre')
        assert.equal(await estadoServicio(d.servicioId), 'activo')
        assert.equal(await auxiliar(d.clienteId), '0.00')
        assert.deepEqual(await cambiosFueraDeEvaluar(d.servicioId), [])
        assert.deepEqual(await invariantes([d.clienteId]), [])
        await afirmarLibroCuadrado(assert)
    })

    test('abuso: Q0.01 de menos, comprobante ya usado o aprobado, referencia reusada tras el rechazo (cupo)', async ({
        assert,
    }) => {
        const d = await cortadoConBoleta('299.99')
        await assert.rejects(() => reconectar(d.comprobanteId), /suma Q300\.00/)
        const otra = await boleta(d.clienteId, d.servicioId, d.cuenta.id, '300.00')
        const r = await reconectar(otra.id)
        // el mismo comprobante otra vez (ya hay una abierta)
        await assert.rejects(() => reconectar(otra.id))
        await rechazar(otra.id)
        // la referencia queda libre: el cliente sube otra vez la misma boleta falsa
        const fila = await db.from('billing.comprobantes').where('id', otra.id).firstOrFail()
        const repetida = await boleta(d.clienteId, d.servicioId, d.cuenta.id, '300.00', fila.referencia)
        const error = await reconectar(repetida.id).catch((e) => e)
        assert.equal(error?.errores?.[0]?.rule, 'cupo_agotado')
        // un comprobante aprobado no respalda una reconexión
        await aprobar(repetida.id)
        const errorAprobado = await reconectar(repetida.id).catch((e) => e)
        assert.equal(errorAprobado?.errores?.[0]?.rule, 'comprobante_no_pendiente')
        assert.equal(await estadoPromesa(r.promesa_id), 'cancelada')
        const reconexiones = await db
            .from('billing.promesas')
            .where('servicio_id', d.servicioId)
            .where('tipo', 'reconexion_temporal')
        assert.lengthOf(reconexiones, 1)
        assert.deepEqual(await invariantes([d.clienteId]), [])
        await afirmarLibroCuadrado(assert)
    })

    test('concurrencia: dos reconexiones del mismo comprobante o de dos comprobantes → una sola activa', async ({
        assert,
    }) => {
        const d = await cortadoConBoleta()
        const otra = await boleta(d.clienteId, d.servicioId, d.cuenta.id, '300.00')
        const r = await Promise.allSettled([
            reconectar(d.comprobanteId),
            reconectar(d.comprobanteId),
            reconectar(otra.id),
        ])
        assert.lengthOf(
            r.filter((x) => x.status === 'fulfilled'),
            1,
        )
        const activas = await db
            .from('billing.promesas')
            .where('servicio_id', d.servicioId)
            .whereIn('estado', ['activa', 'pendiente_aprobacion'])
        assert.lengthOf(activas, 1)
        assert.deepEqual(await invariantes([d.clienteId]), [])
    })

    test('concurrencia: aprobar y vencer a la vez → un pago, promesa cerrada y servicio activo', async ({
        assert,
    }) => {
        const d = await cortadoConBoleta()
        const r = await reconectar(d.comprobanteId)
        await Promise.all([aprobar(d.comprobanteId), vencer(d.servicioId)])
        const p = await promesa(r.promesa_id)
        assert.include(['cumplida', 'cancelada'], p.estado)
        assert.lengthOf(await pagosDe(d.clienteId), 1)
        assert.equal(await auxiliar(d.clienteId), '0.00')
        assert.equal(await estadoServicio(d.servicioId), 'activo')
        assert.deepEqual(await cambiosFueraDeEvaluar(d.servicioId), [])
        assert.deepEqual(await invariantes([d.clienteId]), [])
        await afirmarLibroCuadrado(assert)
    })

    test('idempotencia HTTP: la misma Idempotency-Key repite la respuesta sin otra promesa', async ({
        client,
        assert,
    }) => {
        const d = await cortadoConBoleta()
        const { token } = await usuarioConRoles(['admin'])
        const clave = unico('auditor:reconexion')
        const pedir = () =>
            client
                .post(`/api/v1/comprobantes/${d.comprobanteId}/reconexion-temporal`)
                .bearerToken(token)
                .header('Idempotency-Key', clave)
                .json({ motivo: 'fuera_de_horario' })
        const a = await estado(pedir(), 201)
        const b = await estado(pedir(), 201)
        assert.equal(a.body().promesa_id, b.body().promesa_id)
        const filas = await db.from('billing.promesas').where('comprobante_id', d.comprobanteId)
        assert.lengthOf(filas, 1)
        assert.lengthOf(await eventosDe('promesa.creada', 'promesa_id', a.body().promesa_id), 1)
    })

    test('H79 · media: comprobante sin servicio; el pago va a otro servicio del cliente y la reconexión se incumple', async ({
        assert,
    }) => {
        const d = await servicioCortado()
        await habilitarReconexion(d.plantillaId)
        // otro servicio del mismo cliente, con deuda más antigua (agosto)
        const viejo = await crearServicioFila({
            cliente_id: d.clienteId,
            plan_id: d.planId,
            plantilla_facturacion_id: d.plantillaId,
            fecha_instalacion: '2026-08-01',
        })
        await generar(viejo, '2026-10-01')
        await new VencerFacturas().execute({ servicio_id: viejo, hasta: '2026-10-07' }, contextoPrueba())
        await new EvaluarEstadoServicio().execute({ servicio_id: viejo }, contextoPrueba())
        const cuenta = await cuentaBancariaPrueba()
        // Iris sabe que es para d.servicioId (lo manda en la reconexión), el comprobante no lo dice
        const k = await boleta(d.clienteId, null, cuenta.id, '300.00')
        const r = await reconectar(k.id, d.servicioId)
        assert.equal(r.servicio.estado, 'activo')
        await aprobar(k.id)
        await vencer(d.servicioId)
        assert.deepEqual(await invariantes([d.clienteId]), [])
        // el comprobante cubría todo lo vencido del servicio reconectado: debió cumplirse
        assert.equal(await estadoPromesa(r.promesa_id), 'cumplida')
        assert.equal(await estadoServicio(d.servicioId), 'activo')
    }).fails('H79: AprobarComprobante no aplica el pago al servicio de la reconexión ligada')
})
