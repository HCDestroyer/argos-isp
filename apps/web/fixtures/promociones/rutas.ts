import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, normalizar, paginar, problemaTipado, registrarAccion, versionCambiada } from '../comun'

/**
 * Rutas de las promociones de velocidad (`apps/api/start/routes/operacion_pm.ts`, A1). Como la API:
 * `vigencia`, `tramo_actual` y `proximo_tramo` se calculan con la hora de Guatemala; asignar es
 * todo o nada y responde 422 con la regla y el servicio (`errors[].message = "Servicio N"` o el
 * servicio en el `detail`). En los fixtures, el router 2 (CCR-Mixco, árbol con PCQ) controla la
 * velocidad por plan: un multiplicador ahí pide plan destino; con x3 o más, un servicio del
 * router 1 supera su capacidad.
 */

type Promocion = Schema<'PromocionVelocidad'>
type Asignacion = Schema<'PromocionServicio'>
type Errores = NonNullable<Problem['errors']>

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const SEIS_HORAS = 6 * 3_600_000

/** Día de la semana (1 = lunes) y minutos del día de un instante en hora de Guatemala. */
function enGuatemala(instante: number): { dia: number, minutos: number, medianoche: number } {
    const local = new Date(instante - SEIS_HORAS)
    const dia = ((local.getUTCDay() + 6) % 7) + 1
    const minutos = local.getUTCHours() * 60 + local.getUTCMinutes()
    const medianoche = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + SEIS_HORAS
    return { dia, minutos, medianoche }
}

function minutosDe(hora: string): number {
    const [h, m] = hora.split(':').map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
}

/** Tramos de la promoción que tocan [desde, desde + 8 días), recortados a su periodo. */
function tramos(p: Promocion, desde: number): { inicio: number, fin: number }[] {
    const inicio = new Date(p.inicio).getTime()
    const fin = new Date(p.fin).getTime()
    if (p.modo === 'dias' || !p.franja_inicio || !p.franja_fin) {
        return [{ inicio, fin }]
    }
    const lista: { inicio: number, fin: number }[] = []
    const base = enGuatemala(Math.max(desde, inicio) - 86_400_000).medianoche
    for (let d = 0; d < 9; d++) {
        const dia = base + d * 86_400_000
        const semana = enGuatemala(dia + 3_600_000).dia
        if (p.dias_semana?.length && !p.dias_semana.includes(semana)) {
            continue
        }
        const a = dia + minutosDe(p.franja_inicio) * 60_000
        let b = dia + minutosDe(p.franja_fin) * 60_000
        if (b <= a) {
            b += 86_400_000
        }
        const t = { inicio: Math.max(a, inicio), fin: Math.min(b, fin) }
        if (t.fin > t.inicio) {
            lista.push(t)
        }
    }
    return lista
}

function tramoActual(p: Promocion, momento: number) {
    return tramos(p, momento).find(t => t.inicio <= momento && momento < t.fin) ?? null
}

function vigenciaDe(p: Promocion, momento: number): Promocion['vigencia'] {
    if (p.estado === 'cancelada') {
        return 'cancelada'
    }
    if (new Date(p.inicio).getTime() > momento) {
        return 'programada'
    }
    return new Date(p.fin).getTime() <= momento ? 'terminada' : 'vigente'
}

const iso = (t: { inicio: number, fin: number } | null) => (t ? { inicio: new Date(t.inicio).toISOString(), fin: new Date(t.fin).toISOString() } : null)

/** La promoción como la devuelve la API (con lo calculado a esta hora). */
function vista(p: Promocion): Promocion {
    const momento = Date.now()
    const vigencia = vigenciaDe(p, momento)
    const activa = vigencia === 'vigente'
    const actual = activa ? tramoActual(p, momento) : null
    const proximo = vigencia === 'vigente' || vigencia === 'programada' ? tramos(p, momento).find(t => t.inicio > momento) ?? null : null
    return {
        ...p,
        vigencia,
        tramo_actual: iso(actual),
        proximo_tramo: iso(proximo),
        servicios: bd.promociones.asignaciones.filter(a => a.promocion_id === p.id && a.estado === 'vigente').length,
    }
}

/** La asignación con su tramo abierto (la velocidad de la promoción está aplicada). */
function vistaAsignacion(a: Asignacion): Asignacion {
    const p = bd.promociones.promociones.find(x => x.id === a.promocion_id)
    const momento = Date.now()
    const abierto = p && a.estado === 'vigente' && vigenciaDe(p, momento) === 'vigente' ? tramoActual(p, momento) : null
    return { ...a, tramo_abierto: abierto ? { id: a.id * 1000 + Math.floor(abierto.inicio / 3_600_000) % 1000, ...iso(abierto)! } : null }
}

function promocionDe(solicitud: SolicitudFixture): Promocion | null {
    const id = idDe(solicitud)
    const p = bd.promociones.promociones.find(x => x.id === id) ?? null
    return p && deLaEmpresa([p], solicitud).length ? p : null
}

const campoServicio = (id: number): Errores => [{ field: 'servicio_ids', message: `Servicio ${id}`, rule: 'servicio' }]

/**
 * Reglas de `asignar_promocion_velocidad` (A1) para cada servicio, en orden de id. `null` si todos
 * pueden recibirla.
 */
function reglaAsignar(p: Promocion, ids: number[]): RespuestaFixture | null {
    for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
        const servicio = bd.servicios.find(s => s.id === id)
        if (!servicio) {
            return problemaTipado(422, 'servicio_inexistente', 'Regla de negocio', `El servicio ${id} no existe`, campoServicio(id))
        }
        if (servicio.empresa_id !== p.empresa_id) {
            return problemaTipado(422, 'servicio_de_otra_empresa', 'Regla de negocio', `El servicio ${id} es de otra empresa que la promoción`, campoServicio(id))
        }
        if (bd.promociones.asignaciones.some(a => a.promocion_id === p.id && a.servicio_id === id && a.estado === 'vigente')) {
            continue
        }
        const solapada = bd.promociones.asignaciones
            .filter(a => a.servicio_id === id && a.estado === 'vigente' && a.promocion_id !== p.id)
            .map(a => bd.promociones.promociones.find(x => x.id === a.promocion_id))
            .find(o => o && o.estado === 'activa' && o.inicio < p.fin && o.fin > p.inicio)
        if (solapada) {
            return problemaTipado(422, 'promocion_solapada', 'Regla de negocio', `El servicio ${id} ya tiene la promoción «${solapada.nombre}» en esas fechas`, campoServicio(id))
        }
        if (servicio.estado === 'retirado') {
            return problemaTipado(422, 'servicio_retirado', 'Regla de negocio', `El servicio ${id} está retirado`)
        }
        const aplicacion = bd.routers.find(r => r.id === servicio.router_id)?.estrategia_velocidad?.[servicio.tipo_conexion]?.aplicacion
        const porPlan = aplicacion === 'arbol_pcq' || aplicacion === 'pcq_plan'
        if (porPlan && p.plan_destino_id === null) {
            return problemaTipado(422, 'promocion_requiere_plan_destino', 'Regla de negocio', `El router del servicio ${id} controla la velocidad por plan (arbol_pcq): un multiplicador no se puede aplicar. Usa una promoción con «plan destino»: el servicio pasa a ese plan mientras dura la promoción`, [{ field: 'plan_destino_id', message: 'Indica el plan destino: el router controla la velocidad por plan (PCQ)', rule: 'requerido' }])
        }
        if (!porPlan && Number(p.multiplicador ?? 0) >= 3) {
            return problemaTipado(422, 'promocion_supera_capacidad', 'Regla de negocio', `Con la promoción, el servicio ${id} tendría más que la capacidad del router`, [{ field: 'servicio_ids', message: 'Supera la capacidad del router', rule: 'capacidad' }])
        }
    }
    return null
}

function asignarTodos(solicitud: SolicitudFixture, p: Promocion, ids: number[]): void {
    for (const id of [...new Set(ids)]) {
        if (bd.promociones.asignaciones.some(a => a.promocion_id === p.id && a.servicio_id === id && a.estado === 'vigente')) {
            continue
        }
        bd.promociones.asignaciones.push({
            id: siguienteId(bd.promociones.asignaciones),
            promocion_id: p.id,
            promocion_nombre: p.nombre,
            servicio_id: id,
            empresa_id: p.empresa_id,
            estado: 'vigente',
            agregada_por: solicitud.token ? 1 : null,
            quitada_en: null,
            motivo: null,
            created_at: ahora(),
            tramo_abierto: null,
        })
    }
}

function idsDe(valor: unknown): number[] | null {
    return Array.isArray(valor) && valor.every(v => typeof v === 'number' && Number.isInteger(v) && v > 0) ? valor as number[] : null
}

/** Como `crearPromocionVelocidadValidator` y las reglas de la acción (A1). */
function validar(c: Record<string, unknown>): Errores {
    const e: Errores = []
    if (typeof c.nombre !== 'string' || c.nombre.trim().length < 3 || c.nombre.length > 120) {
        e.push({ field: 'nombre', message: 'El nombre debe tener entre 3 y 120 caracteres', rule: 'minLength' })
    }
    if (c.tipo_velocidad === 'multiplicador') {
        const m = c.multiplicador
        if (typeof m !== 'number' || m < 1.01 || m > 10) {
            e.push({ field: 'multiplicador', message: 'El multiplicador va de 1.01 a 10', rule: 'range' })
        }
    }
    else if (c.tipo_velocidad === 'plan_destino') {
        if (!bd.planes.some(p => p.id === c.plan_destino_id)) {
            e.push({ field: 'plan_destino_id', message: 'Indica el plan destino', rule: 'requerido' })
        }
    }
    else {
        e.push({ field: 'tipo_velocidad', message: 'Tipo de velocidad inválido', rule: 'enum' })
    }
    const inicio = typeof c.inicio === 'string' ? Date.parse(c.inicio) : Number.NaN
    const fin = typeof c.fin === 'string' ? Date.parse(c.fin) : Number.NaN
    if (Number.isNaN(inicio)) {
        e.push({ field: 'inicio', message: 'Fecha inválida', rule: 'date' })
    }
    if (Number.isNaN(fin) || fin <= inicio) {
        e.push({ field: 'fin', message: 'Debe terminar después de empezar', rule: 'after' })
    }
    if (c.modo === 'franja') {
        if (typeof c.franja_inicio !== 'string' || !HORA.test(c.franja_inicio)) {
            e.push({ field: 'franja_inicio', message: 'Hora HH:MM', rule: 'regex' })
        }
        if (typeof c.franja_fin !== 'string' || !HORA.test(c.franja_fin)) {
            e.push({ field: 'franja_fin', message: 'Hora HH:MM', rule: 'regex' })
        }
    }
    else if (c.modo !== 'dias') {
        e.push({ field: 'modo', message: 'Modo inválido', rule: 'enum' })
    }
    if (c.precio !== null && c.precio !== undefined && (typeof c.precio !== 'string' || !MONTO.test(c.precio))) {
        e.push({ field: 'precio', message: 'Monto inválido', rule: 'dinero' })
    }
    return e
}

export const rutasPromocionesVelocidad: RutasFixture = {
    'GET /api/v1/promociones-velocidad': conPermiso('promociones_velocidad.ver', (solicitud) => {
        const q = normalizar(solicitud.query.get('q'))
        const vigencia = solicitud.query.get('vigencia')
        const estado = solicitud.query.get('estado')
        const base = deLaEmpresa(bd.promociones.promociones, solicitud)
            .map(vista)
            .filter(p => !q || normalizar(`${p.nombre} ${p.descripcion ?? ''}`).includes(q))
            .sort((a, b) => b.id - a.id)
        const conteos = { vigente: 0, programada: 0, terminada: 0, cancelada: 0 }
        for (const p of base) {
            conteos[p.vigencia]++
        }
        const filas = base.filter(p => (!vigencia || p.vigencia === vigencia) && (!estado || p.estado === estado))
        const pagina: Schema<'PaginaPromocionesVelocidad'> = { ...paginar(filas, solicitud), conteos }
        return { status: 200, cuerpo: pagina }
    }),

    'POST /api/v1/promociones-velocidad': conPermiso('promociones_velocidad.crear', conIdempotencia((solicitud) => {
        const c = cuerpoObjeto(solicitud)
        const errores = validar(c)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const servicioIds = c.servicio_ids === undefined ? [] : idsDe(c.servicio_ids)
        if (servicioIds === null) {
            return datosInvalidos([{ field: 'servicio_ids', message: 'Servicios inválidos', rule: 'array' }])
        }
        const destino = bd.planes.find(p => p.id === c.plan_destino_id) ?? null
        const momento = ahora()
        const nueva: Promocion = {
            id: siguienteId(bd.promociones.promociones),
            empresa_id: typeof c.empresa_id === 'number' ? c.empresa_id : empresaActivaDe(solicitud) ?? 1,
            nombre: String(c.nombre).trim(),
            descripcion: typeof c.descripcion === 'string' && c.descripcion.trim() ? c.descripcion.trim() : null,
            tipo_velocidad: c.tipo_velocidad === 'plan_destino' ? 'plan_destino' : 'multiplicador',
            multiplicador: c.tipo_velocidad === 'multiplicador' ? Number(c.multiplicador).toFixed(2) : null,
            plan_destino_id: c.tipo_velocidad === 'plan_destino' ? destino?.id ?? null : null,
            plan_destino_nombre: c.tipo_velocidad === 'plan_destino' ? destino?.nombre ?? null : null,
            modo: c.modo === 'franja' ? 'franja' : 'dias',
            inicio: new Date(String(c.inicio)).toISOString(),
            fin: new Date(String(c.fin)).toISOString(),
            franja_inicio: c.modo === 'franja' ? String(c.franja_inicio) : null,
            franja_fin: c.modo === 'franja' ? String(c.franja_fin) : null,
            dias_semana: c.modo === 'franja' && Array.isArray(c.dias_semana) && c.dias_semana.length ? (c.dias_semana as number[]) : null,
            precio: typeof c.precio === 'string' ? c.precio : null,
            estado: 'activa',
            vigencia: 'vigente',
            tramo_actual: null,
            proximo_tramo: null,
            motivo_cancelacion: null,
            cancelada_en: null,
            creado_por: 1,
            servicios: 0,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        // Todo o nada: si un servicio no puede recibirla, no se guarda nada.
        const regla = reglaAsignar(nueva, servicioIds)
        if (regla) {
            return regla
        }
        bd.promociones.promociones.push(nueva)
        asignarTodos(solicitud, nueva, servicioIds)
        registrarAccion(solicitud, 'promociones_velocidad.crear', { tipo: 'promocion_velocidad', id: nueva.id }, c)
        return { status: 201, cuerpo: vista(nueva) }
    })),

    'GET /api/v1/promociones-velocidad/:id': conPermiso('promociones_velocidad.ver', (solicitud) => {
        const p = promocionDe(solicitud)
        return p ? { status: 200, cuerpo: vista(p) } : noEncontrado('la promoción')
    }),

    'GET /api/v1/promociones-velocidad/:id/servicios': conPermiso('promociones_velocidad.ver', (solicitud) => {
        const p = promocionDe(solicitud)
        if (!p) {
            return noEncontrado('la promoción')
        }
        const filas = bd.promociones.asignaciones
            .filter(a => a.promocion_id === p.id)
            .sort((a, b) => (a.estado === b.estado ? b.id - a.id : a.estado === 'vigente' ? -1 : 1))
            .map(vistaAsignacion)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'POST /api/v1/promociones-velocidad/:id/servicios': conPermiso('promociones_velocidad.asignar', conIdempotencia((solicitud) => {
        const p = promocionDe(solicitud)
        if (!p) {
            return noEncontrado('la promoción')
        }
        const ids = idsDe(cuerpoObjeto(solicitud).servicio_ids)
        if (!ids?.length) {
            return datosInvalidos([{ field: 'servicio_ids', message: 'Elige al menos un servicio', rule: 'minLength' }])
        }
        if (p.estado !== 'activa' || new Date(p.fin).getTime() <= Date.now()) {
            return problemaTipado(422, 'promocion_cerrada', 'Regla de negocio', 'La promoción está cancelada o ya terminó: no se puede asignar')
        }
        const regla = reglaAsignar(p, ids)
        if (regla) {
            return regla
        }
        asignarTodos(solicitud, p, ids)
        registrarAccion(solicitud, 'promociones_velocidad.asignar', { tipo: 'promocion_velocidad', id: p.id }, { servicio_ids: ids })
        return { status: 200, cuerpo: vista(p) }
    })),

    'POST /api/v1/promociones-velocidad/:id/servicios/:servicioId/quitar': conPermiso('promociones_velocidad.quitar', conIdempotencia((solicitud) => {
        const p = promocionDe(solicitud)
        const servicioId = idDe(solicitud, 'servicioId')
        if (!p || !servicioId) {
            return noEncontrado('la promoción')
        }
        const motivo = cuerpoObjeto(solicitud).motivo
        const fila = bd.promociones.asignaciones.find(a => a.promocion_id === p.id && a.servicio_id === servicioId && a.estado === 'vigente')
        if (fila) {
            fila.estado = 'quitada'
            fila.quitada_en = ahora()
            fila.motivo = typeof motivo === 'string' && motivo.trim() ? motivo.trim() : null
            registrarAccion(solicitud, 'promociones_velocidad.quitar', { tipo: 'promocion_velocidad', id: p.id }, { servicio_id: servicioId, motivo: fila.motivo })
        }
        return { status: 200, cuerpo: vista(p) }
    })),

    'POST /api/v1/promociones-velocidad/:id/cancelar': conPermiso('promociones_velocidad.cancelar', conIdempotencia((solicitud) => {
        const p = promocionDe(solicitud)
        if (!p) {
            return noEncontrado('la promoción')
        }
        const c = cuerpoObjeto(solicitud)
        if (typeof c.motivo !== 'string' || c.motivo.trim().length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'El motivo debe tener al menos 3 caracteres', rule: 'minLength' }])
        }
        if (c.version !== p.version) {
            return versionCambiada()
        }
        if (p.estado === 'cancelada') {
            return problemaTipado(422, 'promocion_cerrada', 'Regla de negocio', 'La promoción ya está cancelada')
        }
        p.estado = 'cancelada'
        p.motivo_cancelacion = c.motivo.trim()
        p.cancelada_en = ahora()
        p.version++
        p.updated_at = p.cancelada_en
        registrarAccion(solicitud, 'promociones_velocidad.cancelar', { tipo: 'promocion_velocidad', id: p.id }, { motivo: p.motivo_cancelacion })
        return { status: 200, cuerpo: vista(p) }
    })),

    'GET /api/v1/servicios/:id/promociones-velocidad': conPermiso('servicios.ver', (solicitud) => {
        const id = idDe(solicitud)
        if (!bd.servicios.some(s => s.id === id)) {
            return noEncontrado('el servicio')
        }
        const filas = bd.promociones.asignaciones
            .filter(a => a.servicio_id === id)
            .sort((a, b) => b.id - a.id)
            .map(vistaAsignacion)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
}
