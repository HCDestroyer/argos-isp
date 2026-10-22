import type { Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'
import { fechaGuatemala } from './datos'
import { registrarCorrida, verificarYExigir, type ContadoresCorrida, type EntradaCorrida } from './checks'

/**
 * Bloqueos del libro (A3, fase 6 PR A, contrato fiscal §11). Historial de solo inserción: el vigente de
 * cada tipo es su última fila. ArgosNet tiene global, ventas, impuestos y el duro; compras sin bloqueo;
 * Fibra del Sur, nada. Tres excepciones: una vigente (ventas, de Carlos), una revocada y una vencida.
 * Las rutas validan como la API: 422 `bloqueo_regresivo`, `bloqueo_futuro`, `bloqueo_bajo_duro`,
 * `confirmacion_invalida`, `bloqueo_duro_requisitos`, `excepcion_sin_fin`; 409 `bloqueo_duro`,
 * `sin_bloqueo`, `excepcion_revocada`.
 */

type Bloqueo = Schema<'BloqueoLibro'>
type Tipo = Bloqueo['tipo']
type Excepcion = Schema<'ExcepcionBloqueo'>

const TIPOS: readonly Tipo[] = ['global', 'ventas', 'compras', 'impuestos', 'duro']
const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

function fila(id: number, tipo: Tipo, hasta: string | null, anterior: string | null, motivo: string, creado: string): Bloqueo {
    return { id, empresa_id: 1, tipo, hasta, anterior, motivo, creado_por: 1, creado_por_nombre: 'Ana Administradora', created_at: creado }
}

export const bloqueosLibro: Bloqueo[] = [
    fila(1, 'duro', '2026-06-30', null, 'Cierre del primer semestre auditado', '2026-07-20T16:00:00.000Z'),
    fila(2, 'global', '2026-07-31', null, 'Cierre de julio', '2026-08-10T16:00:00.000Z'),
    fila(3, 'impuestos', '2026-08-31', null, 'Declaración de IVA de agosto presentada', '2026-09-12T16:00:00.000Z'),
    fila(4, 'global', '2026-08-31', '2026-07-31', 'Cierre de agosto', '2026-09-10T16:00:00.000Z'),
    fila(5, 'ventas', '2026-09-30', null, 'Ventas de septiembre revisadas', '2026-10-05T16:00:00.000Z'),
]

function excepcion(id: number, datos: Partial<Excepcion> & Pick<Excepcion, 'tipo' | 'motivo' | 'hasta_en' | 'estado'>): Excepcion {
    return {
        id,
        empresa_id: 1,
        usuario_id: null,
        usuario_nombre: null,
        creada_por: 1,
        creada_por_nombre: 'Ana Administradora',
        created_at: '2026-10-01T15:00:00.000Z',
        revocada_en: null,
        revocada_por: null,
        motivo_revocacion: null,
        asientos: 0,
        ...datos,
    }
}

export const excepcionesBloqueo: Excepcion[] = [
    excepcion(1, { tipo: 'ventas', usuario_id: 2, usuario_nombre: 'Carlos Cajero', motivo: 'Nota de crédito de septiembre pendiente', hasta_en: '2026-10-26T05:59:00.000Z', estado: 'vigente', created_at: '2026-10-15T15:00:00.000Z', asientos: 1 }),
    excepcion(2, { tipo: 'global', motivo: 'Reclasificación de agosto', hasta_en: '2026-10-10T05:59:00.000Z', estado: 'revocada', revocada_en: '2026-10-08T15:00:00.000Z', revocada_por: 1, motivo_revocacion: 'Ya se registró la reclasificación', asientos: 2 }),
    excepcion(3, { tipo: 'impuestos', usuario_id: 1, usuario_nombre: 'Ana Administradora', motivo: 'Ajuste de retenciones de agosto', hasta_en: '2026-09-20T05:59:00.000Z', estado: 'vencida', created_at: '2026-09-15T15:00:00.000Z' }),
]

/* Rutas. */

function empresaDe(solicitud: SolicitudFixture, cuerpo: Record<string, unknown>): number {
    return typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (empresaActivaDe(solicitud) ?? 1)
}

function vigente(empresaId: number, tipo: Tipo): string | null {
    return bd.bloqueosLibro.filter(b => b.empresa_id === empresaId && b.tipo === tipo).sort((a, b) => b.id - a.id)[0]?.hasta ?? null
}

function vigentesDe(empresaId: number): Schema<'BloqueosEmpresa'> {
    const vigentes = { global: vigente(empresaId, 'global'), ventas: vigente(empresaId, 'ventas'), compras: vigente(empresaId, 'compras'), impuestos: vigente(empresaId, 'impuestos'), duro: vigente(empresaId, 'duro') }
    const ultimos = TIPOS.flatMap(t => bd.bloqueosLibro.filter(b => b.empresa_id === empresaId && b.tipo === t).sort((a, b) => b.id - a.id).slice(0, 1))
    return { empresa_id: empresaId, vigentes, ultimos }
}

function regla(codigo: string, detalle: string, campo = 'hasta'): RespuestaFixture {
    return problemaTipado(422, codigo, 'Regla de negocio', detalle, [{ field: campo, message: detalle, rule: codigo }])
}

function motivoDe(cuerpo: Record<string, unknown>): string | null {
    const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo.trim() : ''
    return motivo.length >= 3 && motivo.length <= 500 ? motivo : null
}

function registrar(solicitud: SolicitudFixture, empresaId: number, tipo: Tipo, hasta: string | null, motivo: string): Bloqueo {
    const quien = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    const bloqueo: Bloqueo = { id: siguienteId(bd.bloqueosLibro), empresa_id: empresaId, tipo, hasta, anterior: vigente(empresaId, tipo), motivo, creado_por: quien?.id ?? null, creado_por_nombre: quien?.nombre ?? null, created_at: ahora() }
    bd.bloqueosLibro.push(bloqueo)
    return bloqueo
}

/** Meses sin cerrar desde el mes siguiente al duro vigente hasta el de `hasta` (como `exigirMesesCerrados`). */
function mesesAbiertos(empresaId: number, desde: string | null, hasta: string): string[] {
    const abiertos: string[] = []
    const fin = hasta.slice(0, 7)
    let mes = desde ? siguienteMes(desde.slice(0, 7)) : fin
    while (mes <= fin) {
        if (!bd.cierres.some(c => (c.empresa_id ?? 1) === empresaId && c.periodo === mes && c.estado === 'cerrado')) {
            abiertos.push(mes)
        }
        mes = siguienteMes(mes)
    }
    return abiertos
}

function siguienteMes(mes: string): string {
    const [anio, m] = mes.split('-').map(Number)
    const siguiente = new Date(Date.UTC(anio ?? 2026, m ?? 1, 1))
    return siguiente.toISOString().slice(0, 7)
}

export const rutasBloqueosLibro: RutasFixture = {
    'GET /api/v1/libro/bloqueos': conPermiso('libro.ver', (solicitud) => {
        const empresas = deLaEmpresa(bd.empresas.map(e => ({ empresa_id: e.id })), solicitud).map(e => e.empresa_id)
        return { status: 200, cuerpo: empresas.map(vigentesDe) }
    }),

    'GET /api/v1/libro/bloqueos/historial': conPermiso('libro.ver', (solicitud) => {
        const tipo = solicitud.query.get('tipo')
        const filas = deLaEmpresa(bd.bloqueosLibro, solicitud).filter(b => !tipo || b.tipo === tipo).sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    /** Solo avanza; no futuro; nunca antes del duro. */
    'POST /api/v1/libro/bloqueos': conPermiso('libro.bloquear', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const tipo = cuerpo.tipo
        const hasta = typeof cuerpo.hasta === 'string' ? cuerpo.hasta : ''
        const motivo = motivoDe(cuerpo)
        if ((tipo !== 'global' && tipo !== 'ventas' && tipo !== 'compras' && tipo !== 'impuestos') || !FECHA.test(hasta) || !motivo) {
            return datosInvalidos([
                ...(tipo === 'global' || tipo === 'ventas' || tipo === 'compras' || tipo === 'impuestos' ? [] : [{ field: 'tipo', message: 'global, ventas, compras o impuestos', rule: 'enum' }]),
                ...(FECHA.test(hasta) ? [] : [{ field: 'hasta', message: 'Fecha inválida', rule: 'date' }]),
                ...(motivo ? [] : [{ field: 'motivo', message: 'El motivo es obligatorio (mínimo 3 caracteres)', rule: 'minLength' }]),
            ])
        }
        const empresaId = empresaDe(solicitud, cuerpo)
        const actual = vigente(empresaId, tipo)
        const duro = vigente(empresaId, 'duro')
        if (hasta > fechaGuatemala(ahora())) {
            return regla('bloqueo_futuro', `No se bloquea el futuro: ${hasta} es después de hoy`)
        }
        if (actual && hasta <= actual) {
            return regla('bloqueo_regresivo', `El bloqueo ${tipo} vigente es ${actual}: solo avanza (para retroceder, /libro/bloqueos/desbloquear)`)
        }
        if (duro && hasta < duro) {
            return regla('bloqueo_bajo_duro', `El bloqueo duro llega hasta ${duro}`)
        }
        const bloqueo = registrar(solicitud, empresaId, tipo, hasta, motivo)
        registrarAccion(solicitud, 'libro.bloquear', { tipo: 'bloqueo_libro', id: bloqueo.id }, cuerpo)
        return { status: 201, cuerpo: bloqueo }
    })),

    /** Confirmación exacta; solo avanza; meses cerrados, DTE certificados y extractos conciliados hasta esa fecha. */
    'POST /api/v1/libro/bloqueos/duro': conPermiso('libro.bloquear_duro', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const hasta = typeof cuerpo.hasta === 'string' ? cuerpo.hasta : ''
        const motivo = motivoDe(cuerpo)
        if (!FECHA.test(hasta) || !motivo) {
            return datosInvalidos([
                ...(FECHA.test(hasta) ? [] : [{ field: 'hasta', message: 'Fecha inválida', rule: 'date' }]),
                ...(motivo ? [] : [{ field: 'motivo', message: 'El motivo es obligatorio (mínimo 3 caracteres)', rule: 'minLength' }]),
            ])
        }
        if (cuerpo.confirmacion !== `BLOQUEO DURO hasta ${hasta}`) {
            return regla('confirmacion_invalida', `Escriba exactamente «BLOQUEO DURO hasta ${hasta}»`, 'confirmacion')
        }
        const empresaId = empresaDe(solicitud, cuerpo)
        const duro = vigente(empresaId, 'duro')
        if (hasta > fechaGuatemala(ahora())) {
            return regla('bloqueo_futuro', `No se bloquea el futuro: ${hasta} es después de hoy`)
        }
        if (duro && hasta <= duro) {
            return regla('bloqueo_regresivo', `El bloqueo duro vigente es ${duro}: solo avanza`)
        }
        const meses = mesesAbiertos(empresaId, duro, hasta)
        const dte = bd.fel.dte.filter(d => (d.empresa_id ?? 1) === empresaId && !['certificado', 'anulado'].includes(d.estado) && fechaGuatemala(d.fecha_emision) <= hasta)
        const conciliadas = new Set(bd.conciliaciones.map(c => c.linea_id))
        const lineas = bd.lineasExtracto.filter(l => l.empresa_id === empresaId && l.fecha <= hasta && !conciliadas.has(l.id))
        const faltan = [
            ...(meses.length ? [{ field: 'hasta', message: `Meses sin cerrar: ${meses.join(', ')}`, rule: 'meses_abiertos' }] : []),
            ...(dte.length ? [{ field: 'hasta', message: `${dte.length} DTE sin certificar (${dte.slice(0, 5).map(d => d.id).join(', ')})`, rule: 'dte_pendientes' }] : []),
            ...(lineas.length ? [{ field: 'hasta', message: `${lineas.length} líneas de extracto sin conciliar`, rule: 'extractos_sin_conciliar' }] : []),
        ]
        if (faltan.length) {
            return problemaTipado(422, 'bloqueo_duro_requisitos', 'Regla de negocio', `Antes del bloqueo duro hasta ${hasta}: ${faltan.map(f => f.message).join('; ')}`, faltan)
        }
        // Fase 6 PR B: los checks mensuales del mes de `hasta` y los anuales del último año que cubre entero.
        const anio = hasta.endsWith('-12-31') ? Number(hasta.slice(0, 4)) : Number(hasta.slice(0, 4)) - 1
        const checks = verificarYExigir(solicitud, empresaId, [
            ['mensual', `${hasta.slice(0, 7)}-01`],
            ...(duro === null || duro < `${anio}-12-31` ? [['anual', `${anio}-01-01`] as ['anual', string]] : []),
        ])
        if (checks) {
            return checks
        }
        const bloqueo = registrar(solicitud, empresaId, 'duro', hasta, motivo)
        registrarAccion(solicitud, 'libro.bloquear_duro', { tipo: 'bloqueo_libro', id: bloqueo.id }, cuerpo)
        return { status: 201, cuerpo: bloqueo }
    })),

    /** Global, ventas o compras retroceden (impuestos no: 422; el duro nunca: 409). */
    'POST /api/v1/libro/bloqueos/desbloquear': conPermiso('libro.desbloquear', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const motivo = motivoDe(cuerpo)
        const tipo = cuerpo.tipo ?? 'global'
        if (tipo === 'duro') {
            return problemaTipado(409, 'bloqueo_duro', 'Bloqueo duro', 'El bloqueo duro nunca retrocede')
        }
        if (tipo === 'impuestos') {
            return regla('bloqueo_regresivo', 'El bloqueo de impuestos no retrocede: use una excepción', 'tipo')
        }
        const hasta = cuerpo.hasta === null || cuerpo.hasta === undefined ? null : typeof cuerpo.hasta === 'string' ? cuerpo.hasta : ''
        if ((tipo !== 'global' && tipo !== 'ventas' && tipo !== 'compras') || (hasta !== null && !FECHA.test(hasta)) || !motivo) {
            return datosInvalidos([
                ...(tipo === 'global' || tipo === 'ventas' || tipo === 'compras' ? [] : [{ field: 'tipo', message: 'global, ventas o compras', rule: 'enum' }]),
                ...(hasta === null || FECHA.test(hasta) ? [] : [{ field: 'hasta', message: 'Fecha inválida', rule: 'date' }]),
                ...(motivo ? [] : [{ field: 'motivo', message: 'El motivo es obligatorio (mínimo 3 caracteres)', rule: 'minLength' }]),
            ])
        }
        const empresaId = empresaDe(solicitud, cuerpo)
        const actual = vigente(empresaId, tipo)
        if (!actual) {
            return problemaTipado(409, 'sin_bloqueo', 'Sin bloqueo', `El tipo ${tipo} no tiene bloqueo`)
        }
        if (hasta !== null && hasta >= actual) {
            return regla('bloqueo_regresivo', `Debe ser anterior al vigente (${actual})`)
        }
        const duro = vigente(empresaId, 'duro')
        if (duro && hasta !== null && hasta < duro) {
            return regla('bloqueo_bajo_duro', `El bloqueo duro llega hasta ${duro}`)
        }
        const bloqueo = registrar(solicitud, empresaId, tipo, hasta, motivo)
        registrarAccion(solicitud, 'libro.desbloquear', { tipo: 'bloqueo_libro', id: bloqueo.id }, cuerpo)
        return { status: 201, cuerpo: bloqueo }
    })),

    'GET /api/v1/libro/bloqueos/excepciones': conPermiso('libro.ver', (solicitud) => {
        const tipo = solicitud.query.get('tipo')
        const estado = solicitud.query.get('estado')
        const momento = Date.parse(ahora())
        // Una vigente cuyo fin ya pasó se lee como vencida (la API lo calcula al leer).
        const filas = deLaEmpresa(bd.excepcionesBloqueo, solicitud)
            .map(e => (e.estado === 'vigente' && Date.parse(e.hasta_en) <= momento ? { ...e, estado: 'vencida' as const } : e))
            .filter(e => !tipo || e.tipo === tipo)
            .filter(e => !estado || e.estado === estado)
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    /** Siempre con fin futuro; nunca para el duro (422 `excepcion_sin_fin`). Solo admin. */
    'POST /api/v1/libro/bloqueos/excepciones': conPermiso('libro.excepcion_bloqueo', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const motivo = motivoDe(cuerpo)
        const tipo = cuerpo.tipo
        const hastaEn = typeof cuerpo.hasta_en === 'string' ? cuerpo.hasta_en : null
        if (tipo === 'duro' || !hastaEn) {
            return regla('excepcion_sin_fin', tipo === 'duro' ? 'El bloqueo duro no admite excepciones' : 'La excepción necesita una fecha de fin', tipo === 'duro' ? 'tipo' : 'hasta_en')
        }
        if ((tipo !== 'global' && tipo !== 'ventas' && tipo !== 'compras' && tipo !== 'impuestos') || !motivo || Number.isNaN(Date.parse(hastaEn)) || Date.parse(hastaEn) <= Date.parse(ahora())) {
            return datosInvalidos([
                ...(tipo === 'global' || tipo === 'ventas' || tipo === 'compras' || tipo === 'impuestos' ? [] : [{ field: 'tipo', message: 'Tipo inválido', rule: 'enum' }]),
                ...(motivo ? [] : [{ field: 'motivo', message: 'El motivo es obligatorio (mínimo 3 caracteres)', rule: 'minLength' }]),
                ...(Date.parse(hastaEn) > Date.parse(ahora()) ? [] : [{ field: 'hasta_en', message: 'El fin debe ser futuro', rule: 'after' }]),
            ])
        }
        const usuarioId = typeof cuerpo.usuario_id === 'number' ? cuerpo.usuario_id : null
        const usuarioExcepcion = usuarioId === null ? null : bd.usuarios.find(u => u.id === usuarioId)
        if (usuarioId !== null && !usuarioExcepcion) {
            return datosInvalidos([{ field: 'usuario_id', message: 'El usuario no existe', rule: 'exists' }])
        }
        const quien = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const nueva: Excepcion = {
            id: siguienteId(bd.excepcionesBloqueo),
            empresa_id: empresaDe(solicitud, cuerpo),
            tipo,
            usuario_id: usuarioId,
            usuario_nombre: usuarioExcepcion?.nombre ?? null,
            motivo,
            hasta_en: new Date(hastaEn).toISOString(),
            estado: 'vigente',
            creada_por: quien?.id ?? null,
            creada_por_nombre: quien?.nombre ?? null,
            created_at: ahora(),
            revocada_en: null,
            revocada_por: null,
            motivo_revocacion: null,
            asientos: 0,
        }
        bd.excepcionesBloqueo.push(nueva)
        registrarAccion(solicitud, 'libro.excepcion_bloqueo', { tipo: 'excepcion_bloqueo', id: nueva.id }, cuerpo)
        return { status: 201, cuerpo: nueva }
    })),

    'POST /api/v1/libro/bloqueos/excepciones/:id/revocar': conPermiso('libro.excepcion_bloqueo', conIdempotencia((solicitud) => {
        const motivo = motivoDe(cuerpoObjeto(solicitud))
        if (!motivo) {
            return datosInvalidos([{ field: 'motivo', message: 'El motivo es obligatorio (mínimo 3 caracteres)', rule: 'minLength' }])
        }
        const excepcionActual = bd.excepcionesBloqueo.find(e => e.id === idDe(solicitud))
        if (!excepcionActual) {
            return noEncontrado('la excepción')
        }
        if (excepcionActual.estado === 'revocada') {
            return problemaTipado(409, 'excepcion_revocada', 'Excepción revocada', `La excepción ${excepcionActual.id} ya estaba revocada`)
        }
        const quien = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        Object.assign(excepcionActual, { estado: 'revocada', revocada_en: ahora(), revocada_por: quien?.id ?? null, motivo_revocacion: motivo })
        registrarAccion(solicitud, 'libro.excepcion_bloqueo', { tipo: 'excepcion_bloqueo', id: excepcionActual.id }, { revocar: true, motivo })
        return { status: 200, cuerpo: excepcionActual }
    })),
}

/*
 * Corridas de facturar y vencer (`POST /facturas/generar`, `POST /facturas/vencer`), solo en lo que la
 * pantalla de bloqueos usa: lo que cae bajo un bloqueo queda pendiente (`bloqueados`, `bloqueos[]`) y
 * entra en la corrida en que ya no lo está. La semilla trae tres servicios con su factura de septiembre
 * bajo el bloqueo de ventas y dos moras de agosto bajo el global.
 */
export interface PendientePorBloqueo {
    proceso: 'facturar' | 'vencer'
    empresa_id: number
    /** Fecha contable del documento. */
    fecha: string
    /** Servicio (facturar) o factura (vencer). */
    documento_id: number
    /** Diario que lo bloquea además del global y el duro. */
    diario: 'ventas' | 'impuestos'
}

export const pendientesPorBloqueo: PendientePorBloqueo[] = [
    { proceso: 'facturar', empresa_id: 1, fecha: '2026-09-01', documento_id: 2, diario: 'ventas' },
    { proceso: 'facturar', empresa_id: 1, fecha: '2026-09-01', documento_id: 4, diario: 'ventas' },
    { proceso: 'facturar', empresa_id: 1, fecha: '2026-09-01', documento_id: 6, diario: 'ventas' },
    { proceso: 'vencer', empresa_id: 1, fecha: '2026-08-25', documento_id: 3, diario: 'impuestos' },
    { proceso: 'vencer', empresa_id: 1, fecha: '2026-08-25', documento_id: 5, diario: 'impuestos' },
]

/** El bloqueo más alto que alcanza a ese documento, o `null` si ya puede entrar (excepción vigente incluida). */
function bloqueoQueAplica(p: PendientePorBloqueo, usuarioId: number | null): { tipo: Tipo, hasta: string } | null {
    const momento = Date.parse(ahora())
    const tipos: Tipo[] = ['duro', 'global', p.diario]
    const candidatos = tipos
        .flatMap((tipo) => {
            const hasta = vigente(p.empresa_id, tipo)
            return hasta && p.fecha <= hasta ? [{ tipo, hasta }] : []
        })
        .filter(c => c.tipo === 'duro' || !bd.excepcionesBloqueo.some(e => e.empresa_id === p.empresa_id && e.tipo === c.tipo && e.estado === 'vigente' && Date.parse(e.hasta_en) > momento && (e.usuario_id === null || e.usuario_id === usuarioId)))
    return candidatos.find(c => c.tipo === 'duro') ?? candidatos[0] ?? null
}

type DetalleBloqueo = Schema<'ResultadoVencimiento'>['bloqueos'][number]

interface Corrida {
    entraron: number
    bloqueados: number
    bloqueos: DetalleBloqueo[]
    /** Empresas que recorrió y lo que entró en cada una. */
    empresas: number[]
    entraronPorEmpresa: Map<number, number>
}

function corrida(solicitud: SolicitudFixture, proceso: 'facturar' | 'vencer'): Corrida {
    const usuarioId = solicitud.token ? usuariosPorToken[solicitud.token]?.id ?? null : null
    const empresas = deLaEmpresa(bd.empresas.map(e => ({ empresa_id: e.id })), solicitud).map(e => e.empresa_id)
    const propios = bd.pendientesPorBloqueo.filter(p => p.proceso === proceso && empresas.includes(p.empresa_id))
    const grupos = new Map<string, DetalleBloqueo>()
    const entran: PendientePorBloqueo[] = []
    for (const p of propios) {
        const bloqueo = bloqueoQueAplica(p, usuarioId)
        if (!bloqueo) {
            entran.push(p)
            continue
        }
        const clave = `${p.empresa_id}|${bloqueo.tipo}|${p.fecha}`
        const grupo = grupos.get(clave) ?? { empresa_id: p.empresa_id, tipo: bloqueo.tipo, hasta: bloqueo.hasta, fecha: p.fecha, documentos: 0, ejemplos: [] }
        grupo.documentos += 1
        if (grupo.ejemplos.length < 20) {
            grupo.ejemplos.push(p.documento_id)
        }
        grupos.set(clave, grupo)
    }
    bd.pendientesPorBloqueo = bd.pendientesPorBloqueo.filter(p => !entran.includes(p))
    const bloqueos = [...grupos.values()]
    const entraronPorEmpresa = new Map(empresas.map(id => [id, entran.filter(p => p.empresa_id === id).length]))
    return { entraron: entran.length, bloqueados: bloqueos.reduce((s, b) => s + b.documentos, 0), bloqueos, empresas, entraronPorEmpresa }
}

/** `resultado.por_empresa` de la corrida, como `ContadoresPorEmpresa.json` de la API. */
function porEmpresa(r: Corrida, contadores: (empresaId: number, entraron: number, bloqueados: number) => ContadoresCorrida): Record<string, ContadoresCorrida> {
    return Object.fromEntries(r.empresas.map((id) => {
        const bloqueados = r.bloqueos.filter(b => b.empresa_id === id).reduce((s, b) => s + b.documentos, 0)
        return [String(id), { ...contadores(id, r.entraronPorEmpresa.get(id) ?? 0, bloqueados), bloqueados }]
    }))
}

/** Como `RegistrarCorrida`: `empresas` null cuando recorrió todas (sin empresa activa), o la activa. */
function parametrosCorrida(solicitud: SolicitudFixture): EntradaCorrida['parametros'] {
    const activa = empresaActivaDe(solicitud)
    return { hasta: fechaGuatemala(ahora()), servicio_id: null, empresas: solicitud.headers.get('X-Empresa-Id') && activa ? [activa] : null }
}

export const rutasCorridasConBloqueo: RutasFixture = {
    'POST /api/v1/facturas/generar': conPermiso('facturas.generar', conIdempotencia((solicitud) => {
        const r = corrida(solicitud, 'facturar')
        const activos = (empresaId: number) => bd.servicios.filter(s => s.estado !== 'retirado' && (s.empresa_id ?? 1) === empresaId).length
        const contadores = porEmpresa(r, (id, entraron, bloqueados) => ({ generadas: entraron, omitidas: Math.max(0, activos(id) - entraron - bloqueados), bonificadas: 0, errores: 0 }))
        const omitidas = Object.values(contadores).reduce((s, c) => s + (c.omitidas ?? 0), 0)
        const resultado: Schema<'ResultadoGeneracion'> = { generadas: r.entraron, omitidas, facturas: [], bonificadas: 0, bonificaciones: [], errores: 0, bloqueados: r.bloqueados, bloqueos: r.bloqueos }
        registrarCorrida(solicitud, 'facturas.generar', { parametros: parametrosCorrida(solicitud), resultado: { ...resultado, por_empresa: contadores }, bloqueos: r.bloqueos })
        return { status: 200, cuerpo: resultado }
    })),
    'POST /api/v1/facturas/vencer': conPermiso('facturas.generar', conIdempotencia((solicitud) => {
        const r = corrida(solicitud, 'vencer')
        const resultado: Schema<'ResultadoVencimiento'> = { vencidas: 0, moras: r.entraron, errores: 0, bloqueados: r.bloqueados, bloqueos: r.bloqueos }
        const contadores = porEmpresa(r, (_id, entraron) => ({ vencidas: 0, moras: entraron, errores: 0 }))
        registrarCorrida(solicitud, 'facturas.vencer_pendientes', { parametros: parametrosCorrida(solicitud), resultado: { ...resultado, por_empresa: contadores }, bloqueos: r.bloqueos })
        return { status: 200, cuerpo: resultado }
    })),
}
