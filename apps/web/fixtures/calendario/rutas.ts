import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { hoyGuatemala } from '~/utils/cobro'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'
import { CATALOGO_OBLIGACIONES, reglaDe, type ObligacionFila } from './datos'

/**
 * Rutas del calendario fiscal y los feriados (A3, fase 7 PR A; `start/routes/calendario.ts`). Igual que
 * la API: lista por `vence_en` ascendente (y id) con filtros repetibles y `vencida`; `dias_restantes` y `vencida`
 * contra hoy en Guatemala; feriados globales de solo inserción (la vigente de cada fecha es la última
 * fila) y el alta recalcula los vencimientos sin presentar de todas las empresas.
 */

type Obligacion = Schema<'ObligacionFiscal'>
type Feriado = Schema<'FeriadoFiscal'>
type Errores = NonNullable<Problem['errors']>

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const IMPUESTOS = Object.keys(CATALOGO_OBLIGACIONES)
const ESTADOS: readonly Obligacion['estado'][] = ['pendiente', 'borrador', 'presentada', 'no_aplica']
const ABIERTOS: readonly Obligacion['estado'][] = ['pendiente', 'borrador']

function dias(hoy: string, vence: string): number {
    return Math.round((Date.parse(`${vence}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000)
}

/** `vistaObligacion`: nombre y periodicidad del catálogo, días a hoy y si venció sin presentarse. */
export function vistaObligacion(fila: ObligacionFila, hoy = hoyGuatemala()): Obligacion {
    const restantes = dias(hoy, fila.vence_en)
    return {
        ...fila,
        nombre: CATALOGO_OBLIGACIONES[fila.impuesto].nombre,
        periodicidad: CATALOGO_OBLIGACIONES[fila.impuesto].periodicidad,
        dias_restantes: restantes,
        vencida: restantes < 0 && ABIERTOS.includes(fila.estado),
    }
}

/** Fila vigente de cada fecha (la última insertada) entre `desde` y `hasta`. */
function vigentesPorFecha(desde = '0000-01-01', hasta = '9999-12-31'): Feriado[] {
    const porFecha = new Map<string, Feriado>()
    for (const fila of [...bd.feriadosFiscales].sort((a, b) => a.id - b.id)) {
        if (fila.fecha >= desde && fila.fecha <= hasta) {
            porFecha.set(fila.fecha, fila)
        }
    }
    return [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/** `generar_calendario` sobre lo ya generado: los vencimientos sin presentar toman los feriados vigentes. */
function recalcular(): Schema<'ResultadoCalendarioFiscal'> {
    const feriados = new Set(vigentesPorFecha().filter(f => f.activo).map(f => f.fecha))
    let actualizadas = 0
    for (const fila of bd.obligacionesFiscales) {
        if (!ABIERTOS.includes(fila.estado)) {
            continue
        }
        const nueva = reglaDe(fila.impuesto, fila.periodo_hasta, feriados)
        if (nueva.vence_en !== fila.vence_en || JSON.stringify(nueva.regla) !== JSON.stringify(fila.regla)) {
            Object.assign(fila, nueva, { version: fila.version + 1, updated_at: ahora() })
            actualizadas += 1
        }
    }
    return { hoy: hoyGuatemala(), empresas: bd.empresas.length, creadas: 0, actualizadas, sin_aplicar: 0, errores: [] }
}

function filtroLista(solicitud: SolicitudFixture, nombre: string, validos: readonly string[], errores: Errores): string[] {
    const valores = solicitud.query.getAll(nombre).filter(v => v !== '')
    for (const valor of valores) {
        if (!validos.includes(valor)) {
            errores.push({ field: nombre, message: `Valor no permitido: ${valor}`, rule: 'enum' })
        }
    }
    return valores
}

function alcanceGlobal(solicitud: SolicitudFixture): boolean {
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    return usuario?.alcance_global === true
}

export const rutasCalendario: RutasFixture = {
    'GET /api/v1/fiscal/obligaciones': conPermiso('declaraciones.ver', (solicitud) => {
        const errores: Errores = []
        const impuestos = filtroLista(solicitud, 'impuesto', IMPUESTOS, errores)
        const estados = filtroLista(solicitud, 'estado', ESTADOS, errores)
        const desde = solicitud.query.get('desde') || null
        const hasta = solicitud.query.get('hasta') || null
        for (const [campo, valor] of [['desde', desde], ['hasta', hasta]] as const) {
            if (valor !== null && !FECHA.test(valor)) {
                errores.push({ field: campo, message: 'Fecha YYYY-MM-DD', rule: 'date' })
            }
        }
        const vencidaTexto = solicitud.query.get('vencida')
        if (vencidaTexto !== null && vencidaTexto !== '' && vencidaTexto !== 'true' && vencidaTexto !== 'false') {
            errores.push({ field: 'vencida', message: 'true o false', rule: 'boolean' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const vencida = vencidaTexto === 'true' ? true : vencidaTexto === 'false' ? false : null
        const hoy = hoyGuatemala()
        const filas = deLaEmpresa(bd.obligacionesFiscales, solicitud)
            .filter(o => (!impuestos.length || impuestos.includes(o.impuesto))
                && (!estados.length || estados.includes(o.estado))
                && (desde === null || o.vence_en >= desde)
                && (hasta === null || o.vence_en <= hasta))
            .sort((a, b) => a.vence_en.localeCompare(b.vence_en) || a.id - b.id)
            .map(o => vistaObligacion(o, hoy))
            .filter(o => vencida === null || o.vencida === vencida)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/fiscal/obligaciones/:id': conPermiso('declaraciones.ver', (solicitud) => {
        const id = idDe(solicitud)
        const fila = bd.obligacionesFiscales.find(o => o.id === id)
        if (!fila) {
            return noEncontrado('la obligación')
        }
        // `exigirEmpresaPeticion`: con una empresa activa, solo las suyas.
        if (!deLaEmpresa([fila], solicitud).length) {
            return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', `La obligación ${fila.id} es de otra empresa`)
        }
        return { status: 200, cuerpo: vistaObligacion(fila) }
    }),

    'GET /api/v1/fiscal/feriados': conPermiso('fiscal.ver', (solicitud) => {
        const pedido = solicitud.query.get('anio')
        const anio = pedido === null || pedido === '' ? Number(hoyGuatemala().slice(0, 4)) : Number(pedido)
        if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
            return datosInvalidos([{ field: 'anio', message: 'Año entre 2000 y 2100', rule: 'range' }])
        }
        const desde = `${anio}-01-01`
        const hasta = `${anio}-12-31`
        const cuerpo: Schema<'FeriadosFiscales'> = {
            anio,
            vigentes: vigentesPorFecha(desde, hasta).filter(f => f.activo),
            historial: bd.feriadosFiscales
                .filter(f => f.fecha >= desde && f.fecha <= hasta)
                .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id),
        }
        return { status: 200, cuerpo }
    }),

    'POST /api/v1/fiscal/feriados': conPermiso('fiscal.configurar', conIdempotencia((solicitud): RespuestaFixture => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: Errores = []
        const fecha = typeof cuerpo.fecha === 'string' && FECHA.test(cuerpo.fecha) ? cuerpo.fecha : null
        if (fecha === null) {
            errores.push({ field: 'fecha', message: 'Fecha YYYY-MM-DD', rule: 'date' })
        }
        const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo.trim() : ''
        if (motivo.length < 3 || motivo.length > 500) {
            errores.push({ field: 'motivo', message: 'Motivo de 3 a 500 caracteres', rule: 'minLength' })
        }
        if (cuerpo.activo !== undefined && typeof cuerpo.activo !== 'boolean') {
            errores.push({ field: 'activo', message: 'Sí o no', rule: 'boolean' })
        }
        if (cuerpo.nombre !== undefined && cuerpo.nombre !== null && (typeof cuerpo.nombre !== 'string' || cuerpo.nombre.trim().length > 120)) {
            errores.push({ field: 'nombre', message: 'Hasta 120 caracteres', rule: 'maxLength' })
        }
        if (errores.length || fecha === null) {
            return datosInvalidos(errores)
        }
        if (!alcanceGlobal(solicitud)) {
            return problemaTipado(403, 'alcance_global_requerido', 'Alcance global requerido', 'Los feriados son de toda la instalación: hace falta alcance global')
        }
        const activo = cuerpo.activo !== false
        const previa = vigentesPorFecha(fecha, fecha)[0]
        let nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        if (activo) {
            if (nombre.length < 3) {
                return datosInvalidos([{ field: 'nombre', message: 'Nombre del feriado (mínimo 3 caracteres)', rule: 'required' }])
            }
            if (previa?.activo && previa.nombre === nombre) {
                return problemaTipado(409, 'feriado_duplicado', 'Feriado duplicado', `El ${fecha} ya es feriado (${nombre})`)
            }
        }
        else {
            if (!previa?.activo) {
                return problemaTipado(422, 'feriado_inexistente', 'Regla de negocio', `El ${fecha} no es feriado: no hay nada que retirar`)
            }
            nombre = previa.nombre
        }
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const feriado: Feriado = {
            id: siguienteId(bd.feriadosFiscales),
            fecha,
            nombre,
            activo,
            origen: 'usuario',
            motivo,
            creado_por: usuario?.id ?? null,
            created_at: ahora(),
        }
        bd.feriadosFiscales.push(feriado)
        registrarAccion(solicitud, 'fiscal.agregar_feriado', { tipo: 'feriado', id: feriado.id }, { fecha, nombre: cuerpo.nombre ?? null, activo, motivo })
        // Acción global (`t.fijarEmpresa(null)`): no es de ninguna empresa.
        const accion = bd.acciones.at(-1)
        if (accion) {
            Object.assign(accion, { empresa_id: null, empresa_nombre: null })
        }
        const respuesta: Schema<'FeriadoAgregado'> = { ...feriado, calendario: recalcular() }
        return { status: 201, cuerpo: respuesta }
    })),
}
