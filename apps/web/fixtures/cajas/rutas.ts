import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, empresaActivaDe, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'

type Turno = Schema<'CajaTurno'>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/

/** Como `Conflicto` de la API (`abrirCaja`/`cerrarCaja`): 409 con `type` `urn:argosisp:problema:<codigo>`. */
function conflicto(codigo: string, titulo: string, detalle: string): RespuestaFixture {
    const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title: titulo, status: 409, detail: detalle }
    return { status: 409, cuerpo }
}

/**
 * Lo que la caja debería tener al cerrar, como `CerrarCaja` (A3): fondo inicial + cobros en
 * efectivo del turno (método `caja`, no anulados) − egresos en efectivo vigentes del turno −
 * depósitos al banco del turno (fase 4, `cajas.depositar`).
 */
export function esperadoDelTurno(turno: Turno): Decimal {
    const cobrado = bd.pagos
        .filter(p => p.caja_id === turno.caja_id && p.metodo === 'caja' && p.estado !== 'anulado')
        .filter(p => p.created_at >= turno.abierto_en && (turno.cerrado_en === null || p.created_at <= turno.cerrado_en))
        .reduce((suma, p) => suma.plus(p.monto), new Decimal(turno.fondo_inicial))
    const sinEgresos = bd.egresos
        .filter(e => e.turno_id === turno.id && e.metodo === 'caja' && e.estado === 'registrado')
        .reduce((suma, e) => suma.minus(e.monto), cobrado)
    return bd.depositos
        .filter(d => d.turno_id === turno.id)
        .reduce((suma, d) => suma.minus(d.monto), sinEgresos)
}

type Monto = { cantidad: number, monto: string }

function sumar(filas: readonly { monto: string }[]): Monto {
    return { cantidad: filas.length, monto: filas.reduce((suma, f) => suma.plus(f.monto), new Decimal(0)).toFixed(2) }
}

/** `ResumenTurnoCaja` del turno abierto: la misma regla que `esperadoDelTurno`. */
export function resumenDelTurno(caja: Schema<'Caja'>, turno: Turno): Schema<'ResumenTurnoCaja'> {
    const delTurno = (p: Schema<'Pago'>) => p.estado !== 'anulado' && p.created_at >= turno.abierto_en
    const efectivo = bd.pagos.filter(p => delTurno(p) && p.caja_id === caja.id && p.metodo === 'caja')
    const otros = bd.pagos.filter(p => delTurno(p) && p.metodo !== 'caja' && p.metodo !== 'pasarela' && turno.abierto_por !== null && p.registrado_por === turno.abierto_por)
    const egresos = bd.egresos.filter(e => e.turno_id === turno.id && e.metodo === 'caja' && e.estado === 'registrado')
    const depositos = bd.depositos.filter(d => d.turno_id === turno.id)
    const metodos = new Map<string, Schema<'Pago'>[]>()
    for (const pago of [...efectivo, ...otros]) {
        metodos.set(pago.metodo, [...(metodos.get(pago.metodo) ?? []), pago])
    }
    const salidas = [...egresos, ...depositos]
    return {
        caja_id: caja.id,
        caja_nombre: caja.nombre,
        empresa_id: caja.empresa_id ?? 1,
        turno_id: turno.id,
        abierto_en: turno.abierto_en,
        abierto_por: turno.abierto_por ?? null,
        abierto_por_nombre: turno.abierto_por_nombre ?? bd.usuarios.find(u => u.id === turno.abierto_por)?.nombre ?? null,
        cerrado_en: null,
        fondo_inicial: turno.fondo_inicial,
        cobros: {
            ...sumar([...efectivo, ...otros]),
            por_metodo: [...metodos.entries()].map(([metodo, filas]) => ({ metodo, ...sumar(filas) })),
        },
        efectivo_cobrado: sumar(efectivo),
        otros_medios: sumar(otros),
        ingresos: { ...sumar(efectivo), cobros_efectivo: sumar(efectivo) },
        retiros: { ...sumar(salidas), egresos: sumar(egresos), depositos: sumar(depositos), pagos_proveedores: { cantidad: 0, monto: '0.00' } },
        esperado: esperadoDelTurno(turno).toFixed(2),
    }
}

/** Cajas y turnos (hoy 501 en la API: A3 los implementa el día 4). */
export const rutasCajas: RutasFixture = {
    /**
     * Alta de caja como `CrearCaja` (A3): de `empresa_id` o de la activa (422 empresa_requerida,
     * 403 empresa_no_permitida), nombre único por empresa (409 caja_duplicada) y su subcuenta
     * 1.1.01.NN marcada con la empresa.
     */
    'POST /api/v1/cajas': conPermiso('cajas.crear', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        if (nombre.length < 2 || nombre.length > 80) {
            return datosInvalidos([{ field: 'nombre', message: 'El nombre lleva de 2 a 80 caracteres', rule: nombre.length < 2 ? 'minLength' : 'maxLength' }])
        }
        const cajeroId = typeof cuerpo.cajero_id === 'number' ? cuerpo.cajero_id : null
        if (cajeroId !== null && !bd.usuarios.some(u => u.id === cajeroId)) {
            return datosInvalidos([{ field: 'cajero_id', message: `El usuario ${cajeroId} no existe`, rule: 'exists' }])
        }
        const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : empresaActivaDe(solicitud)
        if (empresaId === null) {
            return problemaTipado(422, 'empresa_requerida', 'Empresa requerida', 'Elige la empresa de la caja')
        }
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        if (!bd.empresas.some(e => e.id === empresaId && e.activa) || !(usuario?.alcance_global || (usuario?.empresas ?? []).some(e => e.id === empresaId))) {
            return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', `No tienes acceso a la empresa ${empresaId}`)
        }
        const repetida = bd.cajas.find(c => c.empresa_id === empresaId && c.nombre === nombre)
        if (repetida) {
            return conflicto('caja_duplicada', 'Caja duplicada', `La empresa ${empresaId} ya tiene una caja "${nombre}" (${repetida.id})`)
        }
        const momento = ahora()
        const hijas = bd.cuentas.filter(c => c.codigo.startsWith('1.1.01.'))
        const siguiente = Math.max(0, ...hijas.map(c => Number(c.codigo.split('.').at(-1)))) + 1
        const cuenta: Schema<'Cuenta'> = {
            id: siguienteId(bd.cuentas),
            codigo: `1.1.01.${String(siguiente).padStart(2, '0')}`,
            nombre: `Caja · ${nombre}`,
            tipo: 'activo',
            padre_id: bd.cuentas.find(c => c.codigo === '1.1.01')?.id ?? null,
            imputable: true,
            auxiliar_cliente: false,
            empresa_id: empresaId,
            activa: true,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.cuentas.push(cuenta)
        const caja: Schema<'Caja'> = {
            id: siguienteId(bd.cajas),
            empresa_id: empresaId,
            nombre,
            cajero_id: cajeroId,
            cajero_nombre: bd.usuarios.find(u => u.id === cajeroId)?.nombre ?? null,
            cuenta_id: cuenta.id,
            activa: true,
            turno_abierto_id: null,
            turno_abierto_por: null,
            turno_abierto_por_nombre: null,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.cajas.push(caja)
        registrarAccion(solicitud, 'cajas.crear', { tipo: 'caja', id: caja.id }, { nombre, cajero_id: cajeroId, empresa_id: empresaId })
        return { status: 201, cuerpo: caja }
    })),

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

    /**
     * Resumen del turno abierto como `ResumenTurnoCaja` (A3): con `caja_id`, el de esa caja; sin
     * ella, el de la caja del usuario (la que tiene asignada o en la que abrió el turno). 404
     * `sin_turno_abierto` si no hay. El esperado sigue la misma regla que el cierre.
     */
    'GET /api/v1/cajas/turno-actual/resumen': conPermiso('cajas.ver', (solicitud) => {
        const usuario = usuariosPorToken[solicitud.token ?? '']
        const pedida = Number(solicitud.query.get('caja_id'))
        const caja = pedida
            ? bd.cajas.find(c => c.id === pedida)
            : bd.cajas.find(c => c.activa && c.turno_abierto_id !== null && (c.cajero_id === usuario?.id || bd.turnos.find(t => t.id === c.turno_abierto_id)?.abierto_por === usuario?.id))
        const turno = caja ? bd.turnos.find(t => t.id === caja.turno_abierto_id) : undefined
        if (!caja || !turno) {
            return problemaTipado(404, 'sin_turno_abierto', 'Sin turno abierto', pedida ? `La caja ${pedida} no tiene un turno abierto` : 'No tienes una caja con turno abierto')
        }
        return { status: 200, cuerpo: resumenDelTurno(caja, turno) }
    }),

    'POST /api/v1/cajas/:id/cerrar': conPermiso('cajas.cerrar', conIdempotencia((solicitud) => {
        const caja = bd.cajas.find(c => c.id === idDe(solicitud))
        if (!caja) {
            return noEncontrado('la caja')
        }
        const { contado, motivo, denominaciones, fondo_siguiente: fondoSiguiente, entregado_a: entregadoA } = cuerpoObjeto(solicitud)
        if (contado !== undefined && contado !== null && (typeof contado !== 'string' || !MONTO.test(contado))) {
            return datosInvalidos([{ field: 'contado', message: 'Monto con hasta 2 decimales, sin comas', rule: 'regex' }])
        }
        const conteo = Array.isArray(denominaciones) ? denominaciones as { valor: string, cantidad: number }[] : null
        const sumaConteo = conteo ? conteo.reduce((suma, d) => suma.plus(new Decimal(d.valor).times(d.cantidad)), new Decimal(0)) : null
        if (typeof contado !== 'string' && !sumaConteo) {
            return datosInvalidos([{ field: 'contado', message: 'Envía el contado o las denominaciones', rule: 'required' }])
        }
        if (typeof contado === 'string' && sumaConteo && !sumaConteo.equals(contado)) {
            return datosInvalidos([{ field: 'denominaciones', message: 'La suma de las denominaciones no coincide con el contado', rule: 'denominaciones' }])
        }
        const total = typeof contado === 'string' ? new Decimal(contado) : (sumaConteo ?? new Decimal(0))
        const turno = bd.turnos.find(t => t.id === caja.turno_abierto_id)
        if (!turno) {
            return conflicto('sin_turno_abierto', 'Sin turno abierto', `La caja ${caja.id} no tiene un turno abierto`)
        }
        const fondo = typeof fondoSiguiente === 'string' && MONTO.test(fondoSiguiente) ? new Decimal(fondoSiguiente) : null
        if (fondo && fondo.gt(total)) {
            return datosInvalidos([{ field: 'fondo_siguiente', message: 'El fondo que queda no puede ser mayor que lo contado', rule: 'max' }])
        }
        const resto = fondo ? total.minus(fondo) : total
        const receptor = typeof entregadoA === 'number' ? bd.usuarios.find(u => u.id === entregadoA) : undefined
        if (fondo && resto.gt(0) && !receptor) {
            return datosInvalidos([{ field: 'entregado_a', message: 'Indica a quién se entrega el efectivo que no queda en la caja', rule: 'requiredWhen' }])
        }
        const esperado = esperadoDelTurno(turno)
        const diferencia = total.minus(esperado)
        const textoMotivo = typeof motivo === 'string' ? motivo.trim() : ''
        if (!diferencia.isZero() && textoMotivo.length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'El motivo es obligatorio si hay diferencia entre esperado y contado', rule: 'requiredWhen' }])
        }
        const momento = ahora()
        Object.assign(turno, {
            cerrado_en: momento,
            esperado: esperado.toFixed(2),
            contado: total.toFixed(2),
            diferencia: diferencia.toFixed(2),
            motivo: textoMotivo || null,
            cerrado_por: usuariosPorToken[solicitud.token ?? '']?.id ?? null,
            denominaciones: conteo,
            fondo_siguiente: fondo ? fondo.toFixed(2) : null,
            entregado_a: receptor && resto.gt(0) ? receptor.id : null,
            entregado_a_nombre: receptor && resto.gt(0) ? receptor.nombre : null,
            entregado_monto: fondo && resto.gt(0) ? resto.toFixed(2) : null,
            version: turno.version + 1,
            updated_at: momento,
        })
        Object.assign(caja, { turno_abierto_id: null, version: caja.version + 1, updated_at: momento })
        registrarAccion(solicitud, 'cajas.cerrar', { tipo: 'caja', id: caja.id }, { contado: turno.contado, motivo: turno.motivo })
        return { status: 200, cuerpo: turno }
    })),
}
