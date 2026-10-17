import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, paginar, registrarAccion, usuariosPorToken } from '../comun'

type Turno = Schema<'CajaTurno'>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/

/** Como `Conflicto` de la API (`abrirCaja`/`cerrarCaja`): 409 con `type` `urn:argosisp:problema:<codigo>`. */
function conflicto(codigo: string, titulo: string, detalle: string): RespuestaFixture {
    const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title: titulo, status: 409, detail: detalle }
    return { status: 409, cuerpo }
}

/**
 * Lo que la caja debería tener al cerrar, como `CerrarCaja` (A3): fondo inicial + cobros en
 * efectivo del turno (método `caja`, no anulados) − egresos en efectivo vigentes del turno.
 */
export function esperadoDelTurno(turno: Turno): Decimal {
    const cobrado = bd.pagos
        .filter(p => p.caja_id === turno.caja_id && p.metodo === 'caja' && p.estado !== 'anulado')
        .filter(p => p.created_at >= turno.abierto_en && (turno.cerrado_en === null || p.created_at <= turno.cerrado_en))
        .reduce((suma, p) => suma.plus(p.monto), new Decimal(turno.fondo_inicial))
    return bd.egresos
        .filter(e => e.turno_id === turno.id && e.metodo === 'caja' && e.estado === 'registrado')
        .reduce((suma, e) => suma.minus(e.monto), cobrado)
}

/** Cajas y turnos (hoy 501 en la API: A3 los implementa el día 4). */
export const rutasCajas: RutasFixture = {
    'GET /api/v1/cajas/:id/turnos': conPermiso('cajas.ver', (solicitud) => {
        const caja = bd.cajas.find(c => c.id === idDe(solicitud))
        if (!caja) {
            return noEncontrado('la caja')
        }
        const filas = bd.turnos.filter(t => t.caja_id === caja.id).sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'POST /api/v1/cajas/:id/abrir': conPermiso('cajas.abrir', conIdempotencia((solicitud) => {
        const caja = bd.cajas.find(c => c.id === idDe(solicitud))
        if (!caja) {
            return noEncontrado('la caja')
        }
        const { fondo_inicial: fondo } = cuerpoObjeto(solicitud)
        if (typeof fondo !== 'string' || !MONTO.test(fondo)) {
            return datosInvalidos([{ field: 'fondo_inicial', message: 'Monto con hasta 2 decimales, sin comas', rule: 'regex' }])
        }
        if (caja.turno_abierto_id !== null) {
            return conflicto('turno_abierto', 'Turno abierto', `La caja ${caja.id} ya tiene el turno ${caja.turno_abierto_id} abierto`)
        }
        const momento = ahora()
        const turno: Turno = {
            id: siguienteId(bd.turnos),
            caja_id: caja.id,
            abierto_en: momento,
            fondo_inicial: new Decimal(fondo).toFixed(2),
            cerrado_en: null,
            esperado: null,
            contado: null,
            diferencia: null,
            motivo: null,
            abierto_por: usuariosPorToken[solicitud.token ?? '']?.id ?? null,
            cerrado_por: null,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.turnos.push(turno)
        Object.assign(caja, { turno_abierto_id: turno.id, version: caja.version + 1, updated_at: momento })
        registrarAccion(solicitud, 'cajas.abrir', { tipo: 'caja', id: caja.id }, { fondo_inicial: turno.fondo_inicial })
        return { status: 201, cuerpo: turno }
    })),

    'POST /api/v1/cajas/:id/cerrar': conPermiso('cajas.cerrar', conIdempotencia((solicitud) => {
        const caja = bd.cajas.find(c => c.id === idDe(solicitud))
        if (!caja) {
            return noEncontrado('la caja')
        }
        const { contado, motivo } = cuerpoObjeto(solicitud)
        if (typeof contado !== 'string' || !MONTO.test(contado)) {
            return datosInvalidos([{ field: 'contado', message: 'Monto con hasta 2 decimales, sin comas', rule: 'regex' }])
        }
        const turno = bd.turnos.find(t => t.id === caja.turno_abierto_id)
        if (!turno) {
            return conflicto('sin_turno_abierto', 'Sin turno abierto', `La caja ${caja.id} no tiene un turno abierto`)
        }
        const esperado = esperadoDelTurno(turno)
        const diferencia = new Decimal(contado).minus(esperado)
        const textoMotivo = typeof motivo === 'string' ? motivo.trim() : ''
        if (!diferencia.isZero() && textoMotivo.length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'El motivo es obligatorio si hay diferencia entre esperado y contado', rule: 'requiredWhen' }])
        }
        const momento = ahora()
        Object.assign(turno, {
            cerrado_en: momento,
            esperado: esperado.toFixed(2),
            contado: new Decimal(contado).toFixed(2),
            diferencia: diferencia.toFixed(2),
            motivo: textoMotivo || null,
            cerrado_por: usuariosPorToken[solicitud.token ?? '']?.id ?? null,
            version: turno.version + 1,
            updated_at: momento,
        })
        Object.assign(caja, { turno_abierto_id: null, version: caja.version + 1, updated_at: momento })
        registrarAccion(solicitud, 'cajas.cerrar', { tipo: 'caja', id: caja.id }, { contado: turno.contado, motivo: turno.motivo })
        return { status: 200, cuerpo: turno }
    })),
}
