import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { hoyGuatemala } from '~/utils/cobro'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'
import { desactualizada } from '../declaraciones/rutas'
import { RESULTADOS } from '../declaraciones/renta'

/**
 * Cierre anual del ejercicio (A3, fase 6 PR C y fase 7 PR C; `libro.cerrar_ejercicio` y
 * `libro.reabrir_ejercicio`). Como la API: requisitos (422 `ejercicio_requisitos`), el ISR del cierre
 * sale de la declaración ISR anual del año si la hay (revisada o presentada y al día; con `isr` en el
 * cuerpo 422 `isr_de_declaracion`, sin revisar 422 `declaracion_sin_revisar`, desactualizada 409
 * `declaracion_desactualizada`) y si no lo escribe el usuario (obligatorio, 0.00 si no hay; lo acreditado
 * no pasa del ISR: 422 `isr_acreditable`); reserva legal del 5 % del resultado después del ISR. Los
 * asientos no se guardan: solo su número.
 *
 * Semilla: ArgosNet cerró 2024 con ISR escrito a mano; 2025 sigue abierto (su ISR anual está presentado,
 * así que el cierre lo toma de la declaración). Fibra del Sur no cerró ningún año (pequeño
 * contribuyente: sin ISR anual en su calendario).
 */

type Cierre = Schema<'CierreAnual'>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const RESERVA_LEGAL_PCT = '5.00'

export function ejerciciosIniciales(): Cierre[] {
    return [
        {
            id: 1,
            empresa_id: 1,
            anio: 2024,
            estado: 'cerrado',
            isr: '9800.00',
            isr_acreditado_trimestral: '0.00',
            isr_acreditado_iso: '0.00',
            isr_nota: 'SAT-1411 de 2024 presentado en el sistema anterior',
            resultado_antes_isr: '39200.00',
            resultado: '29400.00',
            reserva_legal: '1470.00',
            resumen: { desde: '2024-01-01', hasta: '2024-12-31', cuentas: [], isr_por_pagar: '9800.00', reserva_legal_pct: RESERVA_LEGAL_PCT, reserva_legal_base: 'resultado_despues_isr', base_reserva: '29400.00', iso_vencido: '0.00' },
            asientos: [701, 702, 703, 704, 705],
            cerrado_en: '2025-03-28T16:00:00.000Z',
            cerrado_por: 1,
            cerrado_por_nombre: 'Ana Administradora',
            reabierto_en: null,
            reabierto_por: null,
            reabierto_por_nombre: null,
            motivo_reapertura: null,
        },
    ]
}

function vigente(empresaId: number, anio: number): Cierre | undefined {
    return bd.ejercicios.filter(e => e.empresa_id === empresaId && e.anio === anio).sort((a, b) => b.id - a.id)[0]
}

function cerrado(empresaId: number, anio: number): boolean {
    return vigente(empresaId, anio)?.estado === 'cerrado'
}

function empresaDe(solicitud: SolicitudFixture, cuerpo: Record<string, unknown>): number | RespuestaFixture {
    const id = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : empresaActivaDe(solicitud)
    return id ?? problemaTipado(422, 'empresa_requerida', 'Empresa requerida', 'Elige la empresa con la que trabajas (cabecera X-Empresa-Id) o indica empresa_id')
}

function anioDe(cuerpo: Record<string, unknown>): number | null {
    return typeof cuerpo.anio === 'number' && Number.isInteger(cuerpo.anio) && cuerpo.anio >= 2000 && cuerpo.anio <= 2100 ? cuerpo.anio : null
}

/** El ISR del cierre: de la declaración ISR anual (si la hay) o el escrito a mano. */
function isrDelEjercicio(empresaId: number, anio: number, manual: unknown): { isr: Decimal, trimestral: Decimal, iso: Decimal, nota: string | null, declaracion: number | null } | RespuestaFixture {
    const anual = bd.declaraciones.filter(d => d.empresa_id === empresaId && d.impuesto === 'isr_anual' && d.periodo_desde === `${anio}-01-01`).sort((a, b) => b.version - a.version)[0]
    if (anual) {
        if (manual !== undefined && manual !== null) {
            return problemaTipado(422, 'isr_de_declaracion', 'ISR de la declaración', `El ejercicio ${anio} tiene declaración ISR anual: el ISR del cierre sale de ella, no se escribe a mano`, [{ field: 'isr.monto', message: 'El ISR sale de la declaración anual', rule: 'isr_de_declaracion' }])
        }
        if (anual.estado !== 'revisada' && anual.estado !== 'presentada') {
            return problemaTipado(422, 'declaracion_sin_revisar', 'Declaración sin revisar', `La declaración ISR anual ${anio} (versión ${anual.version}) está en ${anual.estado}: revísela antes de cerrar el ejercicio`, [{ field: 'anio', message: `Declaración ${anual.id} en ${anual.estado}`, rule: 'declaracion_sin_revisar' }])
        }
        if (desactualizada(anual)) {
            return problemaTipado(409, 'declaracion_desactualizada', 'Declaración desactualizada', `Los datos de ${anio} cambiaron desde que se calculó la declaración ISR anual (versión ${anual.version}): calcule una sustitutiva y revísela`)
        }
        const t = anual.totales
        return { isr: new Decimal(t.isr ?? '0'), trimestral: new Decimal(t.trimestral_acreditado ?? '0'), iso: new Decimal(t.iso_acreditado ?? '0'), nota: `Declaración ISR anual ${anio}, versión ${anual.version}`, declaracion: anual.id }
    }
    const datos = typeof manual === 'object' && manual !== null ? manual as Record<string, unknown> : null
    const monto = typeof datos?.monto === 'string' && MONTO.test(datos.monto) ? new Decimal(datos.monto) : null
    if (monto === null) {
        return datosInvalidos([{ field: 'isr.monto', message: 'El ISR del ejercicio es obligatorio (0.00 si no hay)', rule: 'required' }])
    }
    const parte = (valor: unknown) => (typeof valor === 'string' && MONTO.test(valor) ? new Decimal(valor) : new Decimal(0))
    const trimestral = parte(datos?.acreditado_trimestral)
    const iso = parte(datos?.acreditado_iso)
    if (trimestral.plus(iso).gt(monto)) {
        return problemaTipado(422, 'isr_acreditable', 'ISR acreditable', 'Lo acreditado (pagos trimestrales e ISO) no puede pasar del ISR del ejercicio', [{ field: 'isr.acreditado_trimestral', message: 'Lo acreditado pasa del ISR', rule: 'isr_acreditable' }])
    }
    return { isr: monto, trimestral, iso, nota: typeof datos?.nota === 'string' && datos.nota.trim() ? datos.nota.trim() : null, declaracion: null }
}

export const rutasEjercicios: RutasFixture = {
    'GET /api/v1/libro/ejercicios': conPermiso('libro.ver', (solicitud) => {
        const estado = solicitud.query.get('estado')
        const anio = Number(solicitud.query.get('anio') || 0)
        const filas = deLaEmpresa(bd.ejercicios, solicitud)
            .filter(e => (!estado || e.estado === estado) && (!anio || e.anio === anio))
            .sort((a, b) => b.anio - a.anio || b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/libro/ejercicios/:id': conPermiso('libro.ver', (solicitud) => {
        const cierre = bd.ejercicios.find(e => e.id === idDe(solicitud))
        return cierre && deLaEmpresa([cierre], solicitud).length ? { status: 200, cuerpo: cierre } : noEncontrado('el cierre anual')
    }),

    'POST /api/v1/libro/ejercicios/cerrar': conPermiso('libro.cerrar_ejercicio', conIdempotencia((solicitud): RespuestaFixture => {
        const cuerpo = cuerpoObjeto(solicitud)
        const anio = anioDe(cuerpo)
        if (anio === null) {
            return datosInvalidos([{ field: 'anio', message: 'Año entre 2000 y 2100', rule: 'range' }])
        }
        const empresaId = empresaDe(solicitud, cuerpo)
        if (typeof empresaId !== 'number') {
            return empresaId
        }
        if (cerrado(empresaId, anio)) {
            return problemaTipado(409, 'ejercicio_cerrado', 'Ejercicio cerrado', `El ejercicio ${anio} ya está cerrado`)
        }
        const requisitos: NonNullable<Problem['errors']> = []
        if (anio >= Number(hoyGuatemala().slice(0, 4))) {
            requisitos.push({ field: 'anio', message: `Diciembre de ${anio} todavía no termina: los meses de enero a noviembre deben estar cerrados y diciembre por cerrar`, rule: 'meses_abiertos' })
        }
        const anterior = bd.ejercicios.some(e => e.empresa_id === empresaId) && !cerrado(empresaId, anio - 1) && anio - 1 >= 2024
        if (anterior) {
            requisitos.push({ field: 'anio', message: `El ejercicio ${anio - 1} sigue abierto`, rule: 'ejercicio_anterior_abierto' })
        }
        if (requisitos.length) {
            return problemaTipado(422, 'ejercicio_requisitos', 'Requisitos del cierre anual', `El ejercicio ${anio} no se puede cerrar todavía: ${requisitos.map(r => r.rule).join(', ')}`, requisitos)
        }
        const isr = isrDelEjercicio(empresaId, anio, cuerpo.isr)
        if ('status' in isr) {
            return isr
        }
        const cuentas = RESULTADOS[`${empresaId}-${anio}`] ?? []
        const total = (tipo: string) => cuentas.filter(c => c.tipo === tipo).reduce((s, c) => s.plus(c.monto), new Decimal(0))
        const antes = total('ingreso').minus(total('gasto')).minus(total('no_deducible'))
        const resultado = antes.minus(isr.isr)
        const reserva = resultado.gt(0) ? resultado.times(RESERVA_LEGAL_PCT).dividedBy(100).toDecimalPlaces(2) : new Decimal(0)
        const quien = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const id = siguienteId(bd.ejercicios)
        const cierre: Cierre = {
            id,
            empresa_id: empresaId,
            anio,
            estado: 'cerrado',
            isr: isr.isr.toFixed(2),
            isr_acreditado_trimestral: isr.trimestral.toFixed(2),
            isr_acreditado_iso: isr.iso.toFixed(2),
            isr_nota: isr.nota,
            resultado_antes_isr: antes.toFixed(2),
            resultado: resultado.toFixed(2),
            reserva_legal: reserva.toFixed(2),
            resumen: {
                desde: `${anio}-01-01`,
                hasta: `${anio}-12-31`,
                cuentas: cuentas.map(c => ({ codigo: c.codigo, nombre: c.nombre, tipo: c.tipo === 'ingreso' ? 'ingreso' : 'gasto', neto: c.tipo === 'ingreso' ? `-${c.monto}` : c.monto })),
                isr_por_pagar: isr.isr.minus(isr.trimestral).minus(isr.iso).toFixed(2),
                reserva_legal_pct: RESERVA_LEGAL_PCT,
                reserva_legal_base: 'resultado_despues_isr',
                base_reserva: resultado.toFixed(2),
                iso_vencido: '0.00',
                ...(isr.declaracion ? { declaracion_id: isr.declaracion } : {}),
            },
            asientos: [1000 + id * 10 + 1, 1000 + id * 10 + 2, 1000 + id * 10 + 3, 1000 + id * 10 + 4, ...(reserva.gt(0) ? [1000 + id * 10 + 5] : [])],
            cerrado_en: ahora(),
            cerrado_por: quien?.id ?? null,
            cerrado_por_nombre: quien?.nombre ?? null,
            reabierto_en: null,
            reabierto_por: null,
            reabierto_por_nombre: null,
            motivo_reapertura: null,
        }
        bd.ejercicios.push(cierre)
        registrarAccion(solicitud, 'libro.cerrar_ejercicio', { tipo: 'cierre_anual', id }, cuerpo)
        return { status: 201, cuerpo: cierre }
    })),

    'POST /api/v1/libro/ejercicios/reabrir': conPermiso('libro.reabrir_ejercicio', conIdempotencia((solicitud): RespuestaFixture => {
        const cuerpo = cuerpoObjeto(solicitud)
        const anio = anioDe(cuerpo)
        const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo.trim() : ''
        if (anio === null || motivo.length < 3) {
            return datosInvalidos([...(anio === null ? [{ field: 'anio', message: 'Año entre 2000 y 2100', rule: 'range' }] : []), ...(motivo.length < 3 ? [{ field: 'motivo', message: 'Motivo de 3 a 500 caracteres', rule: 'minLength' }] : [])])
        }
        const empresaId = empresaDe(solicitud, cuerpo)
        if (typeof empresaId !== 'number') {
            return empresaId
        }
        const cierre = vigente(empresaId, anio)
        if (!cierre || cierre.estado !== 'cerrado') {
            return problemaTipado(409, 'ejercicio_abierto', 'Ejercicio abierto', `El ejercicio ${anio} no está cerrado`)
        }
        if (cerrado(empresaId, anio + 1)) {
            return problemaTipado(409, 'reapertura_fuera_de_orden', 'Reapertura fuera de orden', `El ejercicio ${anio + 1} está cerrado: reábralo primero`)
        }
        const quien = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        Object.assign(cierre, {
            estado: 'reabierto',
            reabierto_en: ahora(),
            reabierto_por: quien?.id ?? null,
            reabierto_por_nombre: quien?.nombre ?? null,
            motivo_reapertura: motivo,
            asientos: [...cierre.asientos, ...cierre.asientos.map(a => a + 500)],
        })
        registrarAccion(solicitud, 'libro.reabrir_ejercicio', { tipo: 'cierre_anual', id: cierre.id }, cuerpo)
        return { status: 200, cuerpo: cierre }
    })),
}
