import db from '@adonisjs/lucid/services/db'
import { contextoPrueba } from '#tests/ayudas'
import type { ContextoAccion } from '#shared/contexto'
import type { EventoEntrante } from '#shared/eventos_bus'
import { ConsumidorLealtad } from '#lealtad/consumidor'
import CrearPrograma, { type EntradaCrearPrograma } from '#lealtad/actions/crear_programa'
import ActivarPrograma from '#lealtad/actions/activar_programa'
import CrearRegla, { type EntradaRegla } from '#lealtad/actions/crear_regla'
import { reporteLealtad } from '#lealtad/reporte'

/**
 * Ayudas de las pruebas de lealtad. Cada prueba arma su empresa (NIT nuevo, `prepararEmpresas`
 * del auditor) para que los invariantes se revisen solo sobre lo que hizo con las acciones.
 */

/** Programa activo con sus reglas en la empresa. */
export async function programaConReglas(
    empresaId: number,
    ctx: ContextoAccion,
    programa: Partial<EntradaCrearPrograma> = {},
    reglas: Array<Omit<EntradaRegla, 'programa_id'>> = [],
) {
    const creado = await new CrearPrograma().execute(
        {
            empresa_id: empresaId,
            nombre: 'Puntos Argos',
            valor_punto: '0.10',
            vigente_desde: '2026-01-01',
            ...programa,
        },
        ctx,
    )
    const activo = await new ActivarPrograma().execute({ id: creado.id }, ctx)
    const ids: number[] = []
    for (const regla of reglas) {
        const nueva = await new CrearRegla().execute({ ...regla, programa_id: creado.id }, ctx)
        ids.push(nueva.id)
    }
    return { programa: activo, reglas: ids }
}

/** Eventos del outbox con `payload.<clave> = valor`, como los entrega el bus. */
export async function eventosOutbox(evento: string, clave: string, valor: number): Promise<EventoEntrante[]> {
    const filas = (await db
        .from('audit.outbox')
        .where('evento', evento)
        .whereRaw(`(payload->>?)::bigint = ?`, [clave, valor])
        .orderBy('id', 'asc')
        .select('id', 'evento', 'payload', 'request_id')) as Array<{
        id: number
        evento: string
        payload: Record<string, unknown>
        request_id: string | null
    }>
    return filas.map((f) => ({
        id: Number(f.id),
        evento: f.evento,
        payload: f.payload,
        requestId: f.request_id,
    }))
}

/** Entrega al consumidor `lealtad` los eventos (tantas veces como se pida: el bus entrega al menos una vez). */
export async function entregar(eventos: EventoEntrante[], veces = 1) {
    const consumidor = new ConsumidorLealtad()
    for (let i = 0; i < veces; i++) {
        for (const evento of eventos) {
            if (consumidor.acepta(evento.evento)) await consumidor.procesar(evento)
        }
    }
}

/** Entrega los eventos de un tipo cuyo payload tiene `clave = valor`. */
export async function entregarEvento(evento: string, clave: string, valor: number, veces = 1) {
    const eventos = await eventosOutbox(evento, clave, valor)
    if (eventos.length === 0) throw new Error(`No hay ${evento} con ${clave} = ${valor} en el outbox`)
    await entregar(eventos, veces)
    return eventos
}

export async function movimientosDe(empresaId: number, clienteId?: number) {
    return db
        .from('lealtad.movimientos')
        .where('empresa_id', empresaId)
        .if(clienteId !== undefined, (q) => q.where('cliente_id', clienteId!))
        .orderBy('id', 'asc')
        .select(
            'id',
            'tipo',
            'puntos',
            'clave_unica',
            'valor',
            'asiento_id',
            'reversa_de',
            'regla_id',
            'origen_tipo',
            'origen_id',
            db.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
        )
}

/** Movimientos del asiento de un movimiento de puntos: [codigo, debe, haber]. */
export async function asientoLealtad(movimientoId: number) {
    const filas = await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('a.origen_tipo', 'lealtad')
        .where('a.origen_id', movimientoId)
        .orderBy('m.id', 'asc')
        .select('c.codigo', 'm.debe', 'm.haber')
    return filas.map((f) => [f.codigo as string, f.debe as string, f.haber as string] as const)
}

export async function asientosLealtad(empresaId: number): Promise<number> {
    const fila = await db
        .from('ledger.asientos')
        .where('empresa_id', empresaId)
        .where('origen_tipo', 'lealtad')
        .count('* as n')
        .firstOrFail()
    return Number(fila.n)
}

/**
 * Invariante propio de lealtad (§6), además de `afirmarLibro` del auditor: por empresa, saldo de
 * `2.1.10` = Σ valor vivo de los lotes (`cuadra` del reporte) y saldo de puntos = puntos vivos.
 */
export async function afirmarPasivoLealtad(
    assert: {
        deepEqual: (a: unknown, b: unknown, m?: string) => void
        isTrue: (v: unknown, m?: string) => void
    },
    empresas: number[],
) {
    const reporte = await reporteLealtad(empresas, null, null)
    for (const fila of reporte.empresas) {
        assert.isTrue(
            fila.cuadra,
            `2.1.10 (${fila.pasivo_libro}) ≠ Σ valor vivo de los lotes (${fila.pasivo_lotes}) en la empresa ${fila.empresa_id}`,
        )
        assert.deepEqual(
            fila.saldo_puntos,
            fila.puntos_vivos,
            `saldo de puntos ≠ puntos vivos (empresa ${fila.empresa_id})`,
        )
    }
}

export { contextoPrueba }
