/**
 * Rutas de servicios adicionales (A1, `start/routes/adicionales.ts` y `contratos/adicionales.md`):
 * catálogo y motivos por empresa, asignaciones por servicio (incluido, cortesía, cobrado), la
 * credencial auditada y la lista de cada plan. Mismos errores que la API: `adicional_duplicado`,
 * `motivo_duplicado`, `adicional_de_otra_empresa`, `adicional_inactivo`, `servicio_retirado`,
 * `adicional_dado_de_baja`, `sin_credencial`, `servicio_con_adicionales`, 403 de la cortesía.
 */
import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, deLaEmpresa, empresaActivaDe, empresasDeLista, idDe, noEncontrado, normalizar, paginar, problemaTipado, registrarAccion, usuariosPorToken, versionCambiada } from '../comun'
import { asignacion } from './datos'

type Adicional = Schema<'Adicional'>
type MotivoCortesia = Schema<'MotivoCortesia'>
type AdicionalServicio = Schema<'AdicionalServicio'>
type Servicio = Schema<'Servicio'>
type Errores = NonNullable<Problem['errors']>
type Modalidad = AdicionalServicio['modalidad']

const CODIGO = /^[A-Z0-9][A-Z0-9_-]{0,39}$/
const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const MODALIDADES: readonly Modalidad[] = ['incluido', 'cortesia', 'cobrado']

const invalido = (errores: Errores): RespuestaFixture => problemaTipado(422, 'validacion', 'Datos inválidos', 'Los datos enviados no son válidos', errores)
const regla = (codigo: string, detalle: string): RespuestaFixture => problemaTipado(422, codigo, 'Regla de negocio', detalle)

function usuarioDe(solicitud: SolicitudFixture) {
    return solicitud.token ? usuariosPorToken[solicitud.token] : undefined
}

function tienePermiso(solicitud: SolicitudFixture, permiso: string): boolean {
    return usuarioDe(solicitud)?.permisos.includes(permiso) ?? false
}

function textoOpcional(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

/* Catálogo. */

function validarAdicional(cuerpo: Record<string, unknown>, parcial: boolean): Errores {
    const errores: Errores = []
    if (!parcial || cuerpo.codigo !== undefined) {
        const codigo = typeof cuerpo.codigo === 'string' ? cuerpo.codigo.trim().toUpperCase() : ''
        if (!CODIGO.test(codigo)) {
            errores.push({ field: 'codigo', message: 'Solo letras, dígitos, guion y guion bajo (máx. 40)', rule: 'regex' })
        }
    }
    if (!parcial || cuerpo.nombre !== undefined) {
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        if (nombre.length < 2 || nombre.length > 100) {
            errores.push({ field: 'nombre', message: 'El nombre debe tener entre 2 y 100 caracteres', rule: 'minLength' })
        }
    }
    if (typeof cuerpo.descripcion === 'string' && cuerpo.descripcion.length > 500) {
        errores.push({ field: 'descripcion', message: 'Máximo 500 caracteres', rule: 'maxLength' })
    }
    if (cuerpo.precio_sugerido !== undefined && cuerpo.precio_sugerido !== null && (typeof cuerpo.precio_sugerido !== 'string' || !MONTO.test(cuerpo.precio_sugerido))) {
        errores.push({ field: 'precio_sugerido', message: 'Monto con hasta 2 decimales', rule: 'regex' })
    }
    return errores
}

function codigoRepetido(empresaId: number, codigo: string, salvo: number | null): boolean {
    return bd.adicionales.some(a => a.empresa_id === empresaId && a.codigo === codigo && a.id !== salvo)
}

function crearAdicional(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const errores = validarAdicional(cuerpo, false)
    if (errores.length) {
        return invalido(errores)
    }
    const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (empresaActivaDe(solicitud) ?? 1)
    const codigo = String(cuerpo.codigo).trim().toUpperCase()
    if (codigoRepetido(empresaId, codigo, null)) {
        return problemaTipado(409, 'adicional_duplicado', 'Conflicto', `Ya existe el adicional ${codigo} en la empresa`)
    }
    const momento = ahora()
    const nuevo: Adicional = {
        id: siguienteId(bd.adicionales),
        empresa_id: empresaId,
        codigo,
        nombre: String(cuerpo.nombre).trim(),
        descripcion: textoOpcional(cuerpo.descripcion),
        precio_sugerido: typeof cuerpo.precio_sugerido === 'string' ? new Decimal(cuerpo.precio_sugerido).toFixed(2) : null,
        activo: true,
        version: 1,
        created_at: momento,
        updated_at: momento,
    }
    bd.adicionales.push(nuevo)
    registrarAccion(solicitud, 'adicionales.crear', { tipo: 'adicional', id: nuevo.id }, cuerpo)
    return { status: 201, cuerpo: nuevo }
}

function editarAdicional(solicitud: SolicitudFixture): RespuestaFixture {
    const indice = bd.adicionales.findIndex(a => a.id === idDe(solicitud))
    const actual = bd.adicionales[indice]
    if (!actual) {
        return noEncontrado('el adicional')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    if (cuerpo.version !== actual.version) {
        return versionCambiada()
    }
    const errores = validarAdicional(cuerpo, true)
    if (errores.length) {
        return invalido(errores)
    }
    const codigo = typeof cuerpo.codigo === 'string' ? cuerpo.codigo.trim().toUpperCase() : actual.codigo
    if (codigoRepetido(actual.empresa_id, codigo, actual.id)) {
        return problemaTipado(409, 'adicional_duplicado', 'Conflicto', `Ya existe el adicional ${codigo} en la empresa`)
    }
    const despues: Adicional = {
        ...actual,
        codigo,
        nombre: typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : actual.nombre,
        descripcion: 'descripcion' in cuerpo ? textoOpcional(cuerpo.descripcion) : actual.descripcion,
        precio_sugerido: 'precio_sugerido' in cuerpo ? (typeof cuerpo.precio_sugerido === 'string' ? new Decimal(cuerpo.precio_sugerido).toFixed(2) : null) : actual.precio_sugerido,
        version: actual.version + 1,
        updated_at: ahora(),
    }
    bd.adicionales[indice] = despues
    // Las vistas de las asignaciones llevan el nombre y el código del adicional al día.
    bd.adicionalesServicio = bd.adicionalesServicio.map(a => (a.adicional_id === despues.id ? { ...a, adicional_codigo: despues.codigo, adicional_nombre: despues.nombre } : a))
    registrarAccion(solicitud, 'adicionales.editar', { tipo: 'adicional', id: actual.id }, cuerpo)
    return { status: 200, cuerpo: despues }
}

function desactivarAdicional(solicitud: SolicitudFixture): RespuestaFixture {
    const indice = bd.adicionales.findIndex(a => a.id === idDe(solicitud))
    const actual = bd.adicionales[indice]
    if (!actual) {
        return noEncontrado('el adicional')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    if (cuerpo.version !== actual.version) {
        return versionCambiada()
    }
    if (!actual.activo) {
        return { status: 200, cuerpo: actual }
    }
    const despues: Adicional = { ...actual, activo: false, version: actual.version + 1, updated_at: ahora() }
    bd.adicionales[indice] = despues
    registrarAccion(solicitud, 'adicionales.desactivar', { tipo: 'adicional', id: actual.id }, cuerpo)
    return { status: 200, cuerpo: despues }
}

/* Motivos. */

function motivosVisibles(solicitud: SolicitudFixture): MotivoCortesia[] {
    const empresas = empresasDeLista(solicitud)
    return bd.motivosCortesia.filter(m => m.empresa_id === null || empresas === null || empresas.includes(m.empresa_id))
}

function crearMotivo(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const errores = validarAdicional({ codigo: cuerpo.codigo, nombre: cuerpo.nombre }, false)
    if (errores.length) {
        return invalido(errores)
    }
    const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (empresaActivaDe(solicitud) ?? 1)
    const codigo = String(cuerpo.codigo).trim().toUpperCase()
    if (bd.motivosCortesia.some(m => (m.empresa_id === null || m.empresa_id === empresaId) && m.codigo === codigo)) {
        return problemaTipado(409, 'motivo_duplicado', 'Conflicto', `Ya existe el motivo ${codigo}`)
    }
    const momento = ahora()
    const motivo: MotivoCortesia = { id: siguienteId(bd.motivosCortesia), empresa_id: empresaId, codigo, nombre: String(cuerpo.nombre).trim(), activo: true, version: 1, created_at: momento, updated_at: momento }
    bd.motivosCortesia.push(motivo)
    registrarAccion(solicitud, 'adicionales.crear_motivo', { tipo: 'motivo_cortesia', id: motivo.id }, cuerpo)
    return { status: 201, cuerpo: motivo }
}

function desactivarMotivo(solicitud: SolicitudFixture): RespuestaFixture {
    const indice = bd.motivosCortesia.findIndex(m => m.id === idDe(solicitud))
    const actual = bd.motivosCortesia[indice]
    if (!actual) {
        return noEncontrado('el motivo')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    if (cuerpo.version !== actual.version) {
        return versionCambiada()
    }
    if (actual.empresa_id === null && !usuarioDe(solicitud)?.alcance_global) {
        return problemaTipado(403, 'prohibido', 'Permiso insuficiente', 'Un motivo común solo se desactiva con alcance global')
    }
    if (!actual.activo) {
        return { status: 200, cuerpo: actual }
    }
    const despues: MotivoCortesia = { ...actual, activo: false, version: actual.version + 1, updated_at: ahora() }
    bd.motivosCortesia[indice] = despues
    registrarAccion(solicitud, 'adicionales.desactivar_motivo', { tipo: 'motivo_cortesia', id: actual.id }, cuerpo)
    return { status: 200, cuerpo: despues }
}

/* Asignaciones. */

function servicioDe(solicitud: SolicitudFixture): Servicio | undefined {
    return bd.servicios.find(s => s.id === idDe(solicitud))
}

/**
 * Reglas de modalidad (`validarModalidad` de A1): precio > 0 solo y obligatorio con `cobrado`;
 * motivo activo solo y obligatorio con `cortesia`.
 */
function validarModalidad(modalidad: Modalidad, precio: unknown, motivoId: unknown, empresaId: number): Errores {
    const errores: Errores = []
    if (modalidad === 'cobrado') {
        if (typeof precio !== 'string' || !MONTO.test(precio) || !new Decimal(precio).gt(0)) {
            errores.push({ field: 'precio', message: 'Con cobrado el precio es obligatorio y mayor que cero', rule: 'required' })
        }
    }
    else if (precio !== undefined && precio !== null) {
        errores.push({ field: 'precio', message: 'El precio solo va con cobrado', rule: 'no_aplica' })
    }
    if (modalidad === 'cortesia') {
        const motivo = bd.motivosCortesia.find(m => m.id === motivoId)
        if (!motivo || !motivo.activo || (motivo.empresa_id !== null && motivo.empresa_id !== empresaId)) {
            errores.push({ field: 'motivo_id', message: 'Con cortesía el motivo es obligatorio (activo y de la empresa)', rule: 'required' })
        }
    }
    else if (motivoId !== undefined && motivoId !== null) {
        errores.push({ field: 'motivo_id', message: 'El motivo solo va con cortesía', rule: 'no_aplica' })
    }
    return errores
}

function longitudes(cuerpo: Record<string, unknown>): Errores {
    const errores: Errores = []
    if (typeof cuerpo.identificador === 'string' && cuerpo.identificador.length > 200) {
        errores.push({ field: 'identificador', message: 'Máximo 200 caracteres', rule: 'maxLength' })
    }
    if (typeof cuerpo.credencial === 'string' && (cuerpo.credencial.length < 1 || cuerpo.credencial.length > 500)) {
        errores.push({ field: 'credencial', message: 'De 1 a 500 caracteres', rule: 'maxLength' })
    }
    if (typeof cuerpo.motivo_detalle === 'string' && cuerpo.motivo_detalle.length > 500) {
        errores.push({ field: 'motivo_detalle', message: 'Máximo 500 caracteres', rule: 'maxLength' })
    }
    return errores
}

const PRIMEROS_PERIODOS = ['prorrateado', 'sin_costo'] as const
type PrimerPeriodo = typeof PRIMEROS_PERIODOS[number]

/** Como `exigirPrimerPeriodo` (A1): solo un `cobrado` lleva `primer_periodo` (422 si no). */
function primerPeriodoDe(modalidad: Modalidad, valor: unknown): PrimerPeriodo | null | undefined | Errores {
    if (valor === undefined || valor === null) {
        return valor
    }
    if (modalidad !== 'cobrado') {
        return [{ field: 'primer_periodo', message: 'Solo un adicional cobrado lleva primer periodo', rule: 'modalidad' }]
    }
    const elegido = PRIMEROS_PERIODOS.find(p => p === valor)
    return elegido ?? [{ field: 'primer_periodo', message: 'Debe ser prorrateado o sin_costo', rule: 'enum' }]
}

function sinCortesia(): RespuestaFixture {
    return problemaTipado(403, 'prohibido', 'Permiso insuficiente', 'Se requiere el permiso servicios.adicional_cortesia')
}

function agregar(solicitud: SolicitudFixture): RespuestaFixture {
    const servicio = servicioDe(solicitud)
    if (!servicio) {
        return noEncontrado('el servicio')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    const modalidad = MODALIDADES.find(m => m === cuerpo.modalidad)
    if (!modalidad) {
        return invalido([{ field: 'modalidad', message: 'Debe ser incluido, cortesia o cobrado', rule: 'enum' }])
    }
    if (modalidad === 'cortesia' && !tienePermiso(solicitud, 'servicios.adicional_cortesia')) {
        return sinCortesia()
    }
    if (servicio.estado === 'retirado') {
        return regla('servicio_retirado', 'El servicio está retirado: no admite adicionales')
    }
    const adicional = bd.adicionales.find(a => a.id === cuerpo.adicional_id)
    if (!adicional) {
        return invalido([{ field: 'adicional_id', message: 'El adicional no existe', rule: 'exists' }])
    }
    if (adicional.empresa_id !== servicio.empresa_id) {
        return regla('adicional_de_otra_empresa', `El adicional ${adicional.nombre} es de otra empresa`)
    }
    if (!adicional.activo) {
        return regla('adicional_inactivo', `El adicional ${adicional.nombre} está desactivado`)
    }
    const primerPeriodo = primerPeriodoDe(modalidad, cuerpo.primer_periodo)
    const errores = [...validarModalidad(modalidad, cuerpo.precio, cuerpo.motivo_id, servicio.empresa_id), ...longitudes(cuerpo), ...(Array.isArray(primerPeriodo) ? primerPeriodo : [])]
    if (errores.length || Array.isArray(primerPeriodo)) {
        return invalido(errores)
    }
    const motivo = modalidad === 'cortesia' ? bd.motivosCortesia.find(m => m.id === cuerpo.motivo_id) : undefined
    const credencial = textoOpcional(cuerpo.credencial)
    const momento = ahora()
    // En un servicio suspendido nace bloqueado, con su fila en el historial (A1).
    const bloqueado = servicio.estado === 'suspendido'
    const nueva = asignacion(siguienteId(bd.adicionalesServicio), servicio, adicional, {
        modalidad,
        identificador: textoOpcional(cuerpo.identificador),
        tiene_credencial: credencial !== null,
        precio: modalidad === 'cobrado' ? new Decimal(String(cuerpo.precio)).toFixed(2) : null,
        motivo_id: motivo?.id ?? null,
        motivo_nombre: motivo?.nombre ?? null,
        motivo_detalle: modalidad === 'cortesia' ? textoOpcional(cuerpo.motivo_detalle) : null,
        primer_periodo: modalidad === 'cobrado' ? (primerPeriodo ?? 'prorrateado') : null,
        cobrado_desde: modalidad === 'cobrado' ? momento : null,
        bloqueo: bloqueado ? 'bloqueado' : 'vigente',
        bloqueado_en: bloqueado ? momento : null,
    }, momento)
    bd.adicionalesServicio.push(nueva)
    if (bloqueado) {
        registrarBloqueo(nueva.id, 'bloqueado', 'suspendido', 'servicio suspendido al agregarlo', momento)
    }
    if (credencial) {
        bd.credencialesAdicionales[nueva.id] = credencial
    }
    registrarAccion(solicitud, 'servicios.agregar_adicional', { tipo: 'servicio', id: servicio.id }, { ...cuerpo, ...(credencial ? { credencial: '***' } : {}) })
    return { status: 201, cuerpo: nueva }
}

function editar(solicitud: SolicitudFixture): RespuestaFixture {
    const servicio = servicioDe(solicitud)
    const indice = bd.adicionalesServicio.findIndex(a => a.id === idDe(solicitud, 'asignacionId') && a.servicio_id === servicio?.id)
    const actual = bd.adicionalesServicio[indice]
    if (!servicio || !actual) {
        return noEncontrado('la asignación')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    if (cuerpo.version !== actual.version) {
        return versionCambiada()
    }
    if (actual.estado === 'baja') {
        return regla('adicional_dado_de_baja', 'El adicional ya está dado de baja: no se edita')
    }
    if (servicio.estado === 'retirado') {
        return regla('servicio_retirado', 'El servicio está retirado: no admite cambios')
    }
    const modalidad = cuerpo.modalidad === undefined ? actual.modalidad : MODALIDADES.find(m => m === cuerpo.modalidad)
    if (!modalidad) {
        return invalido([{ field: 'modalidad', message: 'Debe ser incluido, cortesia o cobrado', rule: 'enum' }])
    }
    const daCortesia = modalidad === 'cortesia' && (actual.modalidad !== 'cortesia' || (cuerpo.motivo_id !== undefined && cuerpo.motivo_id !== actual.motivo_id))
    if (daCortesia && !tienePermiso(solicitud, 'servicios.adicional_cortesia')) {
        return sinCortesia()
    }
    const precio = modalidad === 'cobrado' ? (cuerpo.precio ?? actual.precio) : cuerpo.precio
    const motivoId = modalidad === 'cortesia' ? (cuerpo.motivo_id ?? actual.motivo_id) : cuerpo.motivo_id
    const primerPeriodo = primerPeriodoDe(modalidad, cuerpo.primer_periodo)
    const errores = [...validarModalidad(modalidad, precio, motivoId, servicio.empresa_id), ...longitudes(cuerpo), ...(Array.isArray(primerPeriodo) ? primerPeriodo : [])]
    if (errores.length || Array.isArray(primerPeriodo)) {
        return invalido(errores)
    }
    const momento = ahora()
    // Pasar a cobrado lo cobra desde ahora (`prorrateado` si no viene); dejar de serlo lo borra.
    const pasaACobrado = modalidad === 'cobrado' && actual.modalidad !== 'cobrado'
    const motivo = modalidad === 'cortesia' ? bd.motivosCortesia.find(m => m.id === motivoId) : undefined
    const despues: AdicionalServicio = {
        ...actual,
        modalidad,
        identificador: 'identificador' in cuerpo ? textoOpcional(cuerpo.identificador) : actual.identificador,
        precio: modalidad === 'cobrado' ? new Decimal(String(precio)).toFixed(2) : null,
        motivo_id: motivo?.id ?? null,
        motivo_nombre: motivo?.nombre ?? null,
        motivo_detalle: modalidad === 'cortesia' ? ('motivo_detalle' in cuerpo ? textoOpcional(cuerpo.motivo_detalle) : actual.motivo_detalle) : null,
        // Al dejar de ser `incluido` deja de ser del plan (un cambio de plan ya no lo da de baja).
        plan_id: modalidad === 'incluido' ? actual.plan_id : null,
        primer_periodo: modalidad !== 'cobrado' ? null : (primerPeriodo ?? (pasaACobrado ? 'prorrateado' : actual.primer_periodo ?? 'prorrateado')),
        cobrado_desde: modalidad !== 'cobrado' ? null : (pasaACobrado ? momento : actual.cobrado_desde ?? null),
        version: actual.version + 1,
        updated_at: momento,
    }
    if ('credencial' in cuerpo) {
        const credencial = textoOpcional(cuerpo.credencial)
        if (credencial) {
            bd.credencialesAdicionales[actual.id] = credencial
        }
        else {
            bd.credencialesAdicionales = Object.fromEntries(Object.entries(bd.credencialesAdicionales).filter(([id]) => Number(id) !== actual.id))
        }
        despues.tiene_credencial = credencial !== null
    }
    bd.adicionalesServicio[indice] = despues
    registrarAccion(solicitud, 'servicios.editar_adicional', { tipo: 'servicio', id: servicio.id }, { ...cuerpo, ...('credencial' in cuerpo ? { credencial: '***' } : {}) })
    return { status: 200, cuerpo: despues }
}

function quitar(solicitud: SolicitudFixture): RespuestaFixture {
    const servicio = servicioDe(solicitud)
    const indice = bd.adicionalesServicio.findIndex(a => a.id === idDe(solicitud, 'asignacionId') && a.servicio_id === servicio?.id)
    const actual = bd.adicionalesServicio[indice]
    if (!servicio || !actual) {
        return noEncontrado('la asignación')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    if (cuerpo.version !== actual.version) {
        return versionCambiada()
    }
    if (actual.estado === 'baja') {
        return regla('adicional_dado_de_baja', 'El adicional ya está dado de baja')
    }
    const motivo = textoOpcional(cuerpo.motivo)
    if (motivo !== null && (motivo.length < 3 || motivo.length > 500)) {
        return invalido([{ field: 'motivo', message: 'De 3 a 500 caracteres', rule: 'minLength' }])
    }
    const momento = ahora()
    const despues: AdicionalServicio = { ...actual, estado: 'baja', baja_en: momento, motivo_baja: motivo, version: actual.version + 1, updated_at: momento }
    bd.adicionalesServicio[indice] = despues
    registrarAccion(solicitud, 'servicios.quitar_adicional', { tipo: 'servicio', id: servicio.id }, cuerpo)
    return { status: 200, cuerpo: despues }
}

function credencial(solicitud: SolicitudFixture): RespuestaFixture {
    const servicio = servicioDe(solicitud)
    const actual = bd.adicionalesServicio.find(a => a.id === idDe(solicitud, 'asignacionId') && a.servicio_id === servicio?.id)
    if (!servicio || !actual) {
        return noEncontrado('la asignación')
    }
    const clave = bd.credencialesAdicionales[actual.id]
    if (!actual.tiene_credencial || !clave) {
        return regla('sin_credencial', 'Este adicional no tiene credencial guardada')
    }
    registrarAccion(solicitud, 'servicios.ver_credencial_adicional', { tipo: 'servicio', id: servicio.id }, { asignacion_id: actual.id })
    const respuesta: Schema<'CredencialAdicional'> = { servicio_id: servicio.id, asignacion_id: actual.id, identificador: actual.identificador, credencial: clave }
    return { status: 200, cuerpo: respuesta }
}

/* Planes. */

function vistaPlan(planId: number): Schema<'AdicionalPlan'>[] {
    return bd.planesAdicionales
        .filter(p => p.plan_id === planId)
        .flatMap((fila) => {
            const adicional = bd.adicionales.find(a => a.id === fila.adicional_id)
            return adicional
                ? [{ plan_id: planId, adicional_id: adicional.id, empresa_id: adicional.empresa_id, adicional_codigo: adicional.codigo, adicional_nombre: adicional.nombre, adicional_activo: adicional.activo, cantidad: fila.cantidad }]
                : []
        })
        .sort((a, b) => a.adicional_nombre.localeCompare(b.adicional_nombre, 'es') || a.adicional_id - b.adicional_id)
}

function definirPlan(solicitud: SolicitudFixture): RespuestaFixture {
    const indice = bd.planes.findIndex(p => p.id === idDe(solicitud))
    const plan = bd.planes[indice]
    if (!plan) {
        return noEncontrado('el plan')
    }
    const cuerpo = cuerpoObjeto(solicitud)
    if (cuerpo.version !== plan.version) {
        return versionCambiada()
    }
    const lista = Array.isArray(cuerpo.adicionales) ? cuerpo.adicionales as { adicional_id?: unknown, cantidad?: unknown }[] : null
    if (!lista || lista.length > 100) {
        return invalido([{ field: 'adicionales', message: 'Lista de hasta 100 adicionales', rule: 'array' }])
    }
    const previos = new Set(bd.planesAdicionales.filter(p => p.plan_id === plan.id).map(p => p.adicional_id))
    const vistos = new Set<number>()
    const nuevas: { plan_id: number, adicional_id: number, cantidad: number }[] = []
    for (const [i, item] of lista.entries()) {
        const id = Number(item.adicional_id)
        const cantidad = Number(item.cantidad)
        if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) {
            return invalido([{ field: `adicionales.${i}.cantidad`, message: 'De 1 a 50', rule: 'range' }])
        }
        if (vistos.has(id)) {
            return invalido([{ field: `adicionales.${i}.adicional_id`, message: 'Adicional repetido: usa la cantidad', rule: 'distinct' }])
        }
        vistos.add(id)
        const adicional = bd.adicionales.find(a => a.id === id)
        if (!previos.has(id) && (!adicional || !adicional.activo)) {
            return invalido([{ field: `adicionales.${i}.adicional_id`, message: adicional ? 'El adicional está desactivado' : 'El adicional no existe', rule: adicional ? 'activo' : 'exists' }])
        }
        nuevas.push({ plan_id: plan.id, adicional_id: id, cantidad })
    }
    bd.planesAdicionales = [...bd.planesAdicionales.filter(p => p.plan_id !== plan.id), ...nuevas]
    bd.planes[indice] = { ...plan, version: plan.version + 1, updated_at: ahora() }
    registrarAccion(solicitud, 'planes.editar', { tipo: 'plan', id: plan.id }, cuerpo)
    return { status: 200, cuerpo: vistaPlan(plan.id) }
}

/* Reglas que usan otras rutas (alta, cambio de plan, retiro y cambio de empresa del servicio). */

function nuevosIncluidos(servicio: Servicio, planId: number, faltan: Map<number, number>, momento: string): AdicionalServicio[] {
    const nuevas: AdicionalServicio[] = []
    for (const [adicionalId, cantidad] of faltan) {
        const adicional = bd.adicionales.find(a => a.id === adicionalId)
        if (!adicional) {
            continue
        }
        for (let i = 0; i < cantidad; i++) {
            const id = siguienteId(bd.adicionalesServicio) + nuevas.length
            nuevas.push(asignacion(id, servicio, adicional, { plan_id: planId }, momento))
        }
    }
    return nuevas
}

/** Los incluidos que el plan da a un servicio de su empresa (solo activos), por adicional. */
function incluidosDelPlan(servicio: Servicio, planId: number): Map<number, number> {
    const mapa = new Map<number, number>()
    for (const fila of bd.planesAdicionales.filter(p => p.plan_id === planId)) {
        const adicional = bd.adicionales.find(a => a.id === fila.adicional_id)
        if (adicional?.activo && adicional.empresa_id === servicio.empresa_id) {
            mapa.set(adicional.id, fila.cantidad)
        }
    }
    return mapa
}

/** Al crear un servicio: los incluidos de su plan (`origen: plan`). */
export function asignarIncluidos(servicio: Servicio): void {
    bd.adicionalesServicio.push(...nuevosIncluidos(servicio, servicio.plan_id, incluidosDelPlan(servicio, servicio.plan_id), ahora()))
}

/**
 * Al cambiar de plan: un incluido vigente que el plan nuevo también trae se conserva (hasta su
 * cantidad) y pasa al plan nuevo; los demás incluidos se dan de baja (`cambio_plan`) y se agregan
 * los que faltan. Cortesía y cobrado se conservan siempre.
 */
export function reconciliarIncluidos(servicio: Servicio, motivoBaja = 'cambio_plan'): void {
    const momento = ahora()
    const faltan = incluidosDelPlan(servicio, servicio.plan_id)
    bd.adicionalesServicio = bd.adicionalesServicio.map((a) => {
        if (a.servicio_id !== servicio.id || a.estado !== 'activo' || a.modalidad !== 'incluido') {
            return a
        }
        const quedan = faltan.get(a.adicional_id) ?? 0
        if (quedan > 0 && a.empresa_id === servicio.empresa_id) {
            faltan.set(a.adicional_id, quedan - 1)
            return { ...a, plan_id: servicio.plan_id, version: a.version + 1, updated_at: momento }
        }
        return { ...a, estado: 'baja', baja_en: momento, motivo_baja: motivoBaja, version: a.version + 1, updated_at: momento }
    })
    bd.adicionalesServicio.push(...nuevosIncluidos(servicio, servicio.plan_id, faltan, momento))
}

function registrarBloqueo(asignacionId: number, accion: 'bloqueado' | 'desbloqueado', estadoServicio: Servicio['estado'], motivo: string | null, momento: string): void {
    bd.bloqueosAdicionales.push({ id: siguienteId(bd.bloqueosAdicionales), asignacion_id: asignacionId, accion, estado_servicio: estadoServicio, motivo, created_at: momento })
}

/**
 * Como `aplicarBloqueoPorEstado` (A1), dentro del cambio de estado del servicio: al entrar a
 * `suspendido` bloquea sus adicionales activos y al salir (salvo a `retirado`) los desbloquea, con su
 * fila en el historial. Entre `activo` y `limitado` no hace nada. No cambia la `version`.
 */
export function aplicarBloqueoPorEstado(servicioId: number, de: Servicio['estado'], a: Servicio['estado'], motivo: string | null): void {
    let accion: 'bloqueado' | 'desbloqueado'
    if (a === 'suspendido' && de !== 'suspendido') {
        accion = 'bloqueado'
    }
    else if (de === 'suspendido' && a !== 'suspendido' && a !== 'retirado') {
        accion = 'desbloqueado'
    }
    else {
        return
    }
    const momento = ahora()
    for (const fila of bd.adicionalesServicio) {
        if (fila.servicio_id !== servicioId || fila.estado !== 'activo' || fila.bloqueo === (accion === 'bloqueado' ? 'bloqueado' : 'vigente')) {
            continue
        }
        Object.assign(fila, { bloqueo: accion === 'bloqueado' ? 'bloqueado' : 'vigente', bloqueado_en: accion === 'bloqueado' ? momento : null, updated_at: momento })
        registrarBloqueo(fila.id, accion, a, motivo, momento)
    }
}

/** Al retirar el servicio: todos sus adicionales activos se dan de baja con el motivo del retiro. */
export function bajaPorRetiro(servicioId: number, motivo: string): void {
    const momento = ahora()
    bd.adicionalesServicio = bd.adicionalesServicio.map(a => (a.servicio_id === servicioId && a.estado === 'activo'
        ? { ...a, estado: 'baja', baja_en: momento, motivo_baja: motivo, version: a.version + 1, updated_at: momento }
        : a))
}

/** Cambio de empresa: con cortesía o cobrado vigentes, 422 `servicio_con_adicionales`. */
export function bloqueoCambioEmpresa(servicioId: number): RespuestaFixture | null {
    const vigentes = bd.adicionalesServicio.filter(a => a.servicio_id === servicioId && a.estado === 'activo' && a.modalidad !== 'incluido')
    return vigentes.length
        ? regla('servicio_con_adicionales', `El servicio tiene ${vigentes.length} adicionales de cortesía o cobrados: quítalos antes de cambiar de empresa`)
        : null
}

export const rutasAdicionales: RutasFixture = {
    // Motivos antes que `/adicionales/:id` (la primera ruta que coincide gana).
    'GET /api/v1/adicionales/motivos': conPermiso('adicionales.ver', (solicitud) => {
        const activo = solicitud.query.get('activo')
        const filas = motivosVisibles(solicitud)
            .filter(m => activo === null || String(m.activo) === activo)
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.id - b.id)
        return { status: 200, cuerpo: filas }
    }),
    'POST /api/v1/adicionales/motivos': conPermiso('adicionales.crear_motivo', conIdempotencia(crearMotivo)),
    'POST /api/v1/adicionales/motivos/:id/desactivar': conPermiso('adicionales.desactivar_motivo', desactivarMotivo),

    'GET /api/v1/adicionales': conPermiso('adicionales.ver', (solicitud) => {
        const q = normalizar(solicitud.query.get('q')?.trim())
        const activo = solicitud.query.get('activo')
        const filas = deLaEmpresa(bd.adicionales, solicitud)
            .filter(a => activo === null || String(a.activo) === activo)
            .filter(a => !q || normalizar(a.codigo).includes(q) || normalizar(a.nombre).includes(q))
            // Como `paginar` de la API: por id descendente.
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
    'POST /api/v1/adicionales': conPermiso('adicionales.crear', conIdempotencia(crearAdicional)),
    'GET /api/v1/adicionales/:id': conPermiso('adicionales.ver', (solicitud) => {
        const adicional = bd.adicionales.find(a => a.id === idDe(solicitud))
        return adicional ? { status: 200, cuerpo: adicional } : noEncontrado('el adicional')
    }),
    'PUT /api/v1/adicionales/:id': conPermiso('adicionales.editar', editarAdicional),
    'POST /api/v1/adicionales/:id/desactivar': conPermiso('adicionales.desactivar', desactivarAdicional),

    'GET /api/v1/servicios/:id/adicionales': conPermiso('servicios.ver', (solicitud) => {
        const servicio = servicioDe(solicitud)
        if (!servicio) {
            return noEncontrado('el servicio')
        }
        const estado = solicitud.query.get('estado')
        if (estado && estado !== 'activo' && estado !== 'baja') {
            return invalido([{ field: 'estado', message: 'Debe ser activo o baja', rule: 'enum' }])
        }
        const filas = bd.adicionalesServicio
            .filter(a => a.servicio_id === servicio.id && (!estado || a.estado === estado))
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud, 100) }
    }),
    'POST /api/v1/servicios/:id/adicionales': conPermiso('servicios.agregar_adicional', conIdempotencia(agregar)),
    /** Del más reciente al más viejo (la API pagina por `id` descendente). */
    'GET /api/v1/servicios/:id/adicionales/:asignacionId/bloqueos': conPermiso('servicios.ver', (solicitud) => {
        const servicio = servicioDe(solicitud)
        const fila = bd.adicionalesServicio.find(a => a.id === idDe(solicitud, 'asignacionId') && a.servicio_id === servicio?.id)
        if (!servicio || !fila) {
            return noEncontrado('la asignación')
        }
        const filas = bd.bloqueosAdicionales.filter(b => b.asignacion_id === fila.id).sort((x, y) => y.id - x.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
    'GET /api/v1/servicios/:id/adicionales/:asignacionId/credencial': conPermiso('servicios.ver_credencial_adicional', credencial),
    'POST /api/v1/servicios/:id/adicionales/:asignacionId/quitar': conPermiso('servicios.quitar_adicional', conIdempotencia(quitar)),
    'PUT /api/v1/servicios/:id/adicionales/:asignacionId': conPermiso('servicios.editar_adicional', editar),

    'GET /api/v1/planes/:id/adicionales': conPermiso('planes.ver', (solicitud) => {
        const plan = bd.planes.find(p => p.id === idDe(solicitud))
        return plan ? { status: 200, cuerpo: vistaPlan(plan.id) } : noEncontrado('el plan')
    }),
    'PUT /api/v1/planes/:id/adicionales': conPermiso('planes.editar', definirPlan),
}
