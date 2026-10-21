import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, numeroQuery, paginar, registrarAccion, usuariosPorToken } from '../comun'
import { bancosLibro } from '../libro/datos'
import { categoriasEgreso } from './datos'
import { ncreSinCertificar, rupturaDe } from '../fel/rutas'

type Egreso = Schema<'Egreso'>
type Errores = NonNullable<Problem['errors']>

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const METODOS = ['caja', 'banco', 'cuenta_bancaria'] as const
const ORIGEN_POR_METODO = { caja: 'caja_id', banco: 'banco_id', cuenta_bancaria: 'cuenta_bancaria_id' } as const
/** El "hoy" de los fixtures (Guatemala). */
const HOY = '2026-10-16'
const MES_EN_CURSO = HOY.slice(0, 7)

function problemaCodigo(status: number, codigo: string, titulo: string, detalle: string): RespuestaFixture {
    const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title: titulo, status, detail: detalle }
    return { status, cuerpo }
}

function usuario(solicitud: SolicitudFixture) {
    return solicitud.token ? usuariosPorToken[solicitud.token] : undefined
}

function motivoDe(solicitud: SolicitudFixture): string | Errores {
    const { motivo } = cuerpoObjeto(solicitud)
    const texto = typeof motivo === 'string' ? motivo.trim() : ''
    return texto.length < 3 || texto.length > 500
        ? [{ field: 'motivo', message: 'El motivo debe tener entre 3 y 500 caracteres', rule: 'minLength' }]
        : texto
}

function mesCerrado(fecha: string): boolean {
    return bd.cierres.some(c => c.estado === 'cerrado' && c.periodo === fecha.slice(0, 7))
}

function esMetodo(valor: unknown): valor is Egreso['metodo'] {
    return typeof valor === 'string' && (METODOS as readonly string[]).includes(valor)
}

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

function periodoValido(anio: unknown, mes: unknown): string | Errores {
    const errores: Errores = []
    if (typeof anio !== 'number' || !Number.isInteger(anio) || anio < 2000 || anio > 2100) {
        errores.push({ field: 'anio', message: 'Año inválido', rule: 'range' })
    }
    if (typeof mes !== 'number' || !Number.isInteger(mes) || mes < 1 || mes > 12) {
        errores.push({ field: 'mes', message: 'Mes inválido', rule: 'range' })
    }
    return errores.length ? errores : `${String(anio)}-${String(mes).padStart(2, '0')}`
}

export const rutasEgresos: RutasFixture = {
    'GET /api/v1/egresos/categorias': conPermiso('egresos.ver', () => ({ status: 200, cuerpo: categoriasEgreso })),

    'GET /api/v1/egresos': conPermiso('egresos.ver', (solicitud) => {
        const { query } = solicitud
        const desde = query.get('desde')
        const hasta = query.get('hasta')
        const errores = [['desde', desde], ['hasta', hasta]].filter(([, v]) => v && !FECHA.test(v)).map(([field]) => ({ field: field ?? '', message: 'Fecha inválida', rule: 'regex' }))
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const caja = numeroQuery(solicitud, 'caja_id')
        const cuenta = numeroQuery(solicitud, 'cuenta_bancaria_id')
        const filas = deLaEmpresa(bd.egresos, solicitud)
            .filter(e => !desde || e.fecha >= desde)
            .filter(e => !hasta || e.fecha <= hasta)
            .filter(e => !query.get('categoria') || e.categoria === query.get('categoria'))
            .filter(e => !query.get('metodo') || e.metodo === query.get('metodo'))
            .filter(e => !query.get('estado') || e.estado === query.get('estado'))
            .filter(e => caja === undefined || e.caja_id === caja)
            .filter(e => cuenta === undefined || e.cuenta_bancaria_id === cuenta)
            .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/egresos/:id': conPermiso('egresos.ver', (solicitud) => {
        const egreso = bd.egresos.find(e => e.id === idDe(solicitud))
        return egreso ? { status: 200, cuerpo: egreso } : noEncontrado('el egreso')
    }),

    /** Como `RegistrarEgreso` de A3: validación por campo y 422 `periodo_cerrado` en un mes cerrado. */
    'POST /api/v1/egresos': conPermiso('egresos.registrar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: Errores = []
        const categoria = categoriasEgreso.find(c => c.clave === cuerpo.categoria)
        if (!categoria) {
            errores.push({ field: 'categoria', message: 'Categoría inválida', rule: 'enum' })
        }
        const monto = typeof cuerpo.monto === 'string' ? cuerpo.monto.trim() : ''
        if (!MONTO.test(monto) || new Decimal(monto || 0).lte(0)) {
            errores.push({ field: 'monto', message: 'El monto debe ser mayor que 0 con hasta 2 decimales', rule: 'monto' })
        }
        const metodo = esMetodo(cuerpo.metodo) ? cuerpo.metodo : null
        if (!metodo) {
            errores.push({ field: 'metodo', message: 'Método inválido', rule: 'enum' })
        }
        const fecha = typeof cuerpo.fecha === 'string' && cuerpo.fecha ? cuerpo.fecha : HOY
        if (!FECHA.test(fecha)) {
            errores.push({ field: 'fecha', message: 'Fecha inválida', rule: 'regex' })
        }
        else if (fecha > HOY) {
            errores.push({ field: 'fecha', message: 'La fecha del egreso no puede ser futura', rule: 'futuro' })
        }
        if (metodo) {
            for (const [otro, campo] of Object.entries(ORIGEN_POR_METODO)) {
                if (otro !== metodo && cuerpo[campo] !== undefined && cuerpo[campo] !== null) {
                    errores.push({ field: campo, message: `${campo} no aplica al método ${metodo}`, rule: 'no_aplica' })
                }
            }
        }
        const caja = metodo === 'caja' ? bd.cajas.find(c => c.id === cuerpo.caja_id) : undefined
        if (metodo === 'caja' && !caja) {
            errores.push({ field: 'caja_id', message: 'La caja es obligatoria', rule: 'required' })
        }
        // Con `banco`: el de `ledger.bancos` pedido o, sin `banco_id`, el principal (id 1).
        const banco = metodo === 'banco' ? bancosLibro.find(b => b.id === (cuerpo.banco_id ?? 1)) : undefined
        if (metodo === 'banco' && !banco) {
            errores.push({ field: 'banco_id', message: 'El banco no existe en el libro', rule: 'exists' })
        }
        const cuenta = metodo === 'cuenta_bancaria' ? bd.cuentasBancarias.find(c => c.id === cuerpo.cuenta_bancaria_id) : undefined
        if (metodo === 'cuenta_bancaria' && !cuenta) {
            errores.push({ field: 'cuenta_bancaria_id', message: 'La cuenta bancaria es obligatoria', rule: 'required' })
        }
        if (errores.length || !categoria || !metodo) {
            return datosInvalidos(errores)
        }
        if (mesCerrado(fecha)) {
            return problemaCodigo(422, 'periodo_cerrado', 'Regla de negocio', `Periodo ${fecha.slice(0, 7)} cerrado: no se registran asientos con fecha ${fecha}`)
        }
        const momento = ahora()
        const quien = usuario(solicitud)
        const egreso: Egreso = {
            id: siguienteId(bd.egresos),
            // Multiempresa (A3): la de su caja o cuenta bancaria; si no, la activa.
            empresa_id: caja?.empresa_id ?? cuenta?.empresa_id ?? banco?.empresa_id ?? empresaActivaDe(solicitud) ?? 1,
            fecha,
            categoria: categoria.clave,
            categoria_nombre: categoria.nombre,
            cuenta_codigo: categoria.cuenta_codigo,
            proveedor: texto(cuerpo.proveedor),
            descripcion: texto(cuerpo.descripcion),
            comprobante: texto(cuerpo.comprobante),
            monto: new Decimal(monto).toFixed(2),
            metodo,
            caja_id: caja?.id ?? null,
            caja_nombre: caja?.nombre ?? null,
            turno_id: caja?.turno_abierto_id ?? null,
            banco_id: banco?.id ?? null,
            banco_nombre: banco?.nombre ?? null,
            cuenta_bancaria_id: cuenta?.id ?? null,
            cuenta_bancaria_nombre: cuenta ? `${cuenta.banco_nombre} · ${cuenta.alias}` : null,
            asiento_id: siguienteId(bd.asientos),
            estado: 'registrado',
            registrado_por: quien?.id ?? null,
            registrado_por_nombre: quien?.nombre ?? null,
            anulado_en: null,
            anulado_por: null,
            motivo_anulacion: null,
            asiento_reverso_id: null,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.egresos.push(egreso)
        registrarAccion(solicitud, 'egresos.registrar', { tipo: 'egreso', id: egreso.id }, cuerpo)
        return { status: 201, cuerpo: egreso }
    })),

    'POST /api/v1/egresos/:id/anular': conPermiso('egresos.anular', conIdempotencia((solicitud) => {
        const egreso = bd.egresos.find(e => e.id === idDe(solicitud))
        if (!egreso) {
            return noEncontrado('el egreso')
        }
        const motivo = motivoDe(solicitud)
        if (Array.isArray(motivo)) {
            return datosInvalidos(motivo)
        }
        if (egreso.estado === 'anulado') {
            return problemaCodigo(409, 'egreso_anulado', 'Egreso anulado', `El egreso ${egreso.id} ya está anulado`)
        }
        const momento = ahora()
        Object.assign(egreso, {
            estado: 'anulado',
            anulado_en: momento,
            anulado_por: usuario(solicitud)?.id ?? null,
            motivo_anulacion: motivo,
            asiento_reverso_id: siguienteId(bd.asientos),
            version: egreso.version + 1,
            updated_at: momento,
        })
        registrarAccion(solicitud, 'egresos.anular', { tipo: 'egreso', id: egreso.id }, { motivo })
        return { status: 200, cuerpo: egreso }
    })),

    'GET /api/v1/libro/periodos': conPermiso('libro.ver', (solicitud) => {
        const estado = solicitud.query.get('estado')
        const filas = bd.cierres.filter(c => !estado || c.estado === estado).sort((a, b) => b.periodo.localeCompare(a.periodo) || b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    /** Como `CerrarPeriodo`: 422 `periodo_en_curso` para el mes actual o futuro; 409 si ya está cerrado. */
    'POST /api/v1/libro/periodos/cerrar': conPermiso('libro.cerrar_periodo', conIdempotencia((solicitud) => {
        const { anio, mes } = cuerpoObjeto(solicitud)
        const periodo = periodoValido(anio, mes)
        if (Array.isArray(periodo)) {
            return datosInvalidos(periodo)
        }
        if (periodo >= MES_EN_CURSO) {
            return problemaCodigo(422, 'periodo_en_curso', 'Regla de negocio', `El periodo ${periodo} no ha terminado: solo se cierran meses pasados`)
        }
        if (mesCerrado(`${periodo}-01`)) {
            return problemaCodigo(409, 'periodo_cerrado', 'Periodo cerrado', `El periodo ${periodo} ya está cerrado`)
        }
        // FEL (§17) e integridad (§10.10), en el orden de `CerrarPeriodo`.
        const empresaCierre = typeof cuerpoObjeto(solicitud).empresa_id === 'number' ? Number(cuerpoObjeto(solicitud).empresa_id) : (empresaActivaDe(solicitud) ?? 1)
        const ncre = ncreSinCertificar(empresaCierre, periodo)
        if (ncre.length) {
            const respuesta = problemaCodigo(409, 'ncre_sin_certificar', 'NCRE sin certificar', `Hay ${ncre.length} notas de crédito con su NCRE sin certificar (${ncre.slice(0, 20).map(x => `nota ${x.nota_id}: ${x.estado}`).join(', ')}): certifícalas o anula las rechazadas antes de cerrar el mes`)
            // Como `CerrarPeriodo` (A3): una fila por nota; `nota_id`, `factura_id`, `dte_id` y `estado` van además del esquema.
            return { ...respuesta, cuerpo: { ...(respuesta.cuerpo as Problem), errors: ncre.map(x => ({ field: 'nota_id', message: x.estado, rule: String(x.dte_id), ...x })) } }
        }
        const ruptura = rupturaDe(empresaCierre)
        if (ruptura) {
            return problemaCodigo(409, 'integridad_rota', 'Integridad del libro', `La cadena de hash del libro está rota en el sello ${ruptura.sello} (${ruptura.motivo}): no se puede cerrar el mes`)
        }
        const quien = usuario(solicitud)
        const cierre: Schema<'CierrePeriodo'> = {
            id: siguienteId(bd.cierres),
            empresa_id: typeof cuerpoObjeto(solicitud).empresa_id === 'number' ? Number(cuerpoObjeto(solicitud).empresa_id) : (empresaActivaDe(solicitud) ?? 1),
            periodo,
            estado: 'cerrado',
            cerrado_en: ahora(),
            cerrado_por: quien?.id ?? null,
            cerrado_por_nombre: quien?.nombre ?? null,
            resumen: { desde: `${periodo}-01`, asientos: 0, debe: '0.00', haber: '0.00', cuentas: [] },
            reabierto_en: null,
            reabierto_por: null,
            reabierto_por_nombre: null,
            motivo_reapertura: null,
        }
        bd.cierres.push(cierre)
        registrarAccion(solicitud, 'libro.cerrar_periodo', { tipo: 'cierre_mensual', id: cierre.id }, { anio, mes })
        return { status: 201, cuerpo: cierre }
    })),

    'POST /api/v1/libro/periodos/reabrir': conPermiso('libro.reabrir_periodo', conIdempotencia((solicitud) => {
        const { anio, mes } = cuerpoObjeto(solicitud)
        const periodo = periodoValido(anio, mes)
        const motivo = motivoDe(solicitud)
        if (Array.isArray(periodo) || Array.isArray(motivo)) {
            return datosInvalidos([...(Array.isArray(periodo) ? periodo : []), ...(Array.isArray(motivo) ? motivo : [])])
        }
        const cierre = bd.cierres.find(c => c.periodo === periodo && c.estado === 'cerrado')
        if (!cierre) {
            return problemaCodigo(409, 'periodo_abierto', 'Periodo abierto', `El periodo ${periodo} no está cerrado`)
        }
        // Fase 6 (A3): bajo el bloqueo duro ningún mes se reabre.
        const duro = bd.bloqueosLibro.filter(b => b.empresa_id === (cierre.empresa_id ?? 1) && b.tipo === 'duro').sort((x, y) => y.id - x.id)[0]?.hasta ?? null
        if (duro && `${periodo}-01` <= duro) {
            return problemaCodigo(409, 'bloqueo_duro', 'Bloqueo duro', `El libro tiene bloqueo duro hasta ${duro}: el periodo ${periodo} no se reabre`)
        }
        const quien = usuario(solicitud)
        Object.assign(cierre, { estado: 'reabierto', reabierto_en: ahora(), reabierto_por: quien?.id ?? null, reabierto_por_nombre: quien?.nombre ?? null, motivo_reapertura: motivo })
        registrarAccion(solicitud, 'libro.reabrir_periodo', { tipo: 'cierre_mensual', id: cierre.id }, { anio, mes, motivo })
        return { status: 200, cuerpo: cierre }
    })),
}
