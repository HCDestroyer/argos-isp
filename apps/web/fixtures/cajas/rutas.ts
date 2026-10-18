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
