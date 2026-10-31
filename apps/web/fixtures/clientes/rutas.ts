import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { errorValorCampo, type ValorCampoFormulario } from '~/utils/camposPersonalizados'
import { deducirTipoDocumento, errorDocumentoFiscal, limpiarDocumento, type TipoDocumentoFiscal } from '~/utils/documentoFiscal'
import { errorTelefono, telefonoGuardado } from '../telefonos'
import { bd, siguienteId } from '../bd'
import {
    ahora,
    conIdempotencia,
    conPermiso,
    cuerpoObjeto,
    datosInvalidos,
    empresasDeLista,
    idDe,
    noEncontrado,
    normalizar,
    numeroQuery,
    paginar,
    registrarAccion,
    versionCambiada,
} from '../comun'
import { estadoCuentaDe } from './estado-cuenta'
import { codigoCliente } from './datos'

type Cliente = Schema<'Cliente'>
type CamposCliente = Omit<Cliente, 'id' | 'codigo' | 'version' | 'created_at' | 'updated_at' | 'telegram_chat_id'>

const TIPOS_DOCUMENTO: readonly TipoDocumentoFiscal[] = ['nit', 'cui', 'pasaporte', 'cf']
const CAMPOS_TEXTO = ['nit_cui', 'nombre_fiscal', 'direccion_fiscal', 'email', 'direccion', 'referencia', 'coordenadas'] as const
/** Teléfonos (pedido A14 de Iris): se validan y normalizan solo si cambian, como `telefonoParaGuardar`. */
const CAMPOS_TELEFONO = ['telefono', 'movil'] as const

/** Validación mínima, en el espíritu de `crearClienteValidator`, para probar el 422 en pantalla. */
function validar(cuerpo: Record<string, unknown>, anterior?: Cliente): NonNullable<Problem['errors']> {
    const parcial = anterior !== undefined
    const errores: NonNullable<Problem['errors']> = []
    for (const campo of CAMPOS_TELEFONO) {
        const error = errorTelefono(campo, cuerpo[campo], anterior?.[campo])
        if (error) {
            errores.push(error)
        }
    }
    if (typeof cuerpo.referencia === 'string' && cuerpo.referencia.trim().length > 300) {
        errores.push({ field: 'referencia', message: 'Máximo 300 caracteres', rule: 'maxLength' })
    }
    const { nombre, nit_cui: nit, email } = cuerpo
    if (!parcial || nombre !== undefined) {
        if (typeof nombre !== 'string' || nombre.trim().length < 2) {
            errores.push({ field: 'nombre', message: 'El nombre debe tener al menos 2 caracteres', rule: 'minLength' })
        }
    }
    // `validarDocumentoFiscal` de A1: el tipo indicado o, sin él, el que se deduce del número.
    const tipoPedido = cuerpo.tipo_documento_fiscal
    if (tipoPedido !== undefined && !TIPOS_DOCUMENTO.includes(tipoPedido as TipoDocumentoFiscal)) {
        errores.push({ field: 'tipo_documento_fiscal', message: 'Uno de: nit, cui, pasaporte, cf', rule: 'enum' })
    }
    else if (tipoPedido !== undefined || (typeof nit === 'string' && nit.trim())) {
        const tipo = (tipoPedido as TipoDocumentoFiscal | undefined) ?? deducirTipoDocumento(typeof nit === 'string' ? nit : null)
        const pais = typeof cuerpo.pais_fiscal === 'string' ? cuerpo.pais_fiscal : 'GT'
        const error = tipo
            ? errorDocumentoFiscal(tipo, typeof nit === 'string' ? nit : '', pais)
            : { campo: 'nit_cui', mensaje: 'El NIT no es válido (dígito verificador)' }
        if (error) {
            errores.push({ field: error.campo, message: error.mensaje, rule: tipo ?? 'nit' })
        }
    }
    if (typeof email === 'string' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        errores.push({ field: 'email', message: 'Correo inválido', rule: 'email' })
    }
    // `validarCamposPersonalizados` (A1): en el alta siempre; al editar, si llegan (se reemplazan).
    if (!parcial || cuerpo.campos_personalizados !== undefined) {
        const valores = typeof cuerpo.campos_personalizados === 'object' && cuerpo.campos_personalizados !== null ? cuerpo.campos_personalizados as Record<string, unknown> : {}
        for (const campo of bd.camposPersonalizados.filter(c => c.activo)) {
            const mensaje = errorValorCampo(campo, comoValor(valores[campo.clave]))
            if (mensaje) {
                errores.push({ field: `campos_personalizados.${campo.clave}`, message: mensaje, rule: mensaje.endsWith('es obligatorio') ? 'required' : campo.tipo })
            }
        }
    }
    if (typeof nombre === 'string' && nombre.trim().toLowerCase() === 'duplicado') {
        errores.push({ field: 'nombre', message: 'Ya existe un cliente con ese nombre (prueba del 422 desde la API)', rule: 'unique' })
    }
    return errores
}

/** Un valor del cuerpo como lo compara `errorValorCampo` (un objeto o lista nunca es de un tipo válido). */
function comoValor(valor: unknown): ValorCampoFormulario {
    if (valor === null || valor === undefined || typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') {
        return valor
    }
    // NaN no es texto, ni número finito, ni fecha, ni booleano, ni opción: falla en todos los tipos
    return Number.NaN
}

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

/** Aplica al cliente los campos presentes en el cuerpo, como hace la acción `editarCliente`. */
function aplicar(base: CamposCliente, cuerpo: Record<string, unknown>): CamposCliente {
    const resultado: CamposCliente = { ...base }
    if (typeof cuerpo.nombre === 'string') {
        resultado.nombre = cuerpo.nombre.trim()
    }
    if (cuerpo.tipo === 'persona' || cuerpo.tipo === 'empresa') {
        resultado.tipo = cuerpo.tipo
    }
    if (cuerpo.canal_preferido === 'correo' || cuerpo.canal_preferido === 'telegram' || cuerpo.canal_preferido === 'whatsapp') {
        resultado.canal_preferido = cuerpo.canal_preferido
    }
    for (const campo of CAMPOS_TEXTO) {
        if (campo in cuerpo) {
            resultado[campo] = texto(cuerpo[campo])
        }
    }
    for (const campo of CAMPOS_TELEFONO) {
        resultado[campo] = telefonoGuardado(cuerpo[campo], base[campo])
    }
    if (resultado.nit_cui) {
        resultado.nit_cui = resultado.nit_cui.toUpperCase()
    }
    if ('nit_cui' in cuerpo || 'tipo_documento_fiscal' in cuerpo) {
        // Como la API: se guarda sin guiones ni espacios y la marca de inválido se apaga al corregirlo.
        const tipo = TIPOS_DOCUMENTO.find(t => t === cuerpo.tipo_documento_fiscal) ?? deducirTipoDocumento(resultado.nit_cui) ?? 'nit'
        resultado.tipo_documento_fiscal = tipo
        resultado.nit_cui = tipo === 'cf' ? (resultado.nit_cui === 'CF' ? 'CF' : null) : (resultado.nit_cui ? limpiarDocumento(resultado.nit_cui) : null)
        resultado.nit_cui_invalido = false
    }
    if (typeof cuerpo.pais_fiscal === 'string') {
        resultado.pais_fiscal = cuerpo.pais_fiscal.toUpperCase()
    }
    for (const campo of ['agente_retencion_iva', 'sector_publico'] as const) {
        const valor = cuerpo[campo]
        if (typeof valor === 'boolean') {
            resultado[campo] = valor
        }
    }
    if ('zona_id' in cuerpo) {
        resultado.zona_id = typeof cuerpo.zona_id === 'number' ? cuerpo.zona_id : null
    }
    // Como la API: el objeto llega completo y reemplaza al guardado.
    if (typeof cuerpo.campos_personalizados === 'object' && cuerpo.campos_personalizados !== null && !Array.isArray(cuerpo.campos_personalizados)) {
        resultado.campos_personalizados = { ...cuerpo.campos_personalizados }
    }
    return resultado
}

const VACIO: CamposCliente = {
    nombre: '',
    tipo: 'persona',
    nit_cui: null,
    nombre_fiscal: null,
    direccion_fiscal: null,
    email: null,
    telefono: null,
    movil: null,
    direccion: null,
    referencia: null,
    coordenadas: null,
    zona_id: null,
    campos_personalizados: {},
    canal_preferido: 'correo',
    responsable_pago_id: null,
    responsable_pago_nombre: null,
    tipo_documento_fiscal: 'cf',
    nit_cui_invalido: false,
    pais_fiscal: 'GT',
    agente_retencion_iva: false,
    sector_publico: false,
    codigo_externo: null,
    referido_por_id: null,
    referido_empresa_id: null,
    codigos_referido: [],
    externo: null,
}

/** Como `RESUMEN_SERVICIOS` de la API: suspendido > limitado > activo > pendiente de instalación. */
const GRAVEDAD: Record<Schema<'Servicio'>['estado'], number> = { suspendido: 4, limitado: 3, activo: 2, pendiente_instalacion: 1, retirado: 0 }

/** Fila de `GET /clientes/:id/dependientes`: el estado más grave de sus servicios no retirados. */
function dependiente(cliente: Cliente): Schema<'DependientePago'> {
    const servicios = bd.servicios.filter(s => s.cliente_id === cliente.id)
    const vivos = servicios.filter(s => s.estado !== 'retirado')
    const peor = vivos.reduce<Schema<'Servicio'>['estado'] | null>((estado, s) => (estado === null || GRAVEDAD[s.estado] > GRAVEDAD[estado] ? s.estado : estado), null)
    return {
        id: cliente.id,
        nombre: cliente.nombre,
        nit_cui: cliente.nit_cui,
        servicios: vivos.length,
        estado_servicio: peor ?? (servicios.length ? 'retirado' : null),
    }
}

/** Motivo opcional de 3 a 500 caracteres, como el validador de responsable de pago. */
function errorMotivo(cuerpo: Record<string, unknown>): NonNullable<Problem['errors']> {
    const { motivo } = cuerpo
    if (motivo === undefined) {
        return []
    }
    const texto = typeof motivo === 'string' ? motivo.trim() : ''
    return texto.length < 3 || texto.length > 500 ? [{ field: 'motivo', message: 'El motivo debe tener entre 3 y 500 caracteres', rule: 'minLength' }] : []
}

function responsableInvalido(message: string) {
    return datosInvalidos([{ field: 'responsable_id', message, rule: 'responsable_pago' }])
}

/** Igual que la API: nombre, NIT/CUI, teléfono, móvil, user_ppp o IP de alguno de sus servicios. */
function coincide(cliente: Cliente, q: string): boolean {
    const texto = normalizar(q.trim())
    if (!texto) {
        return true
    }
    const campos = [cliente.nombre, cliente.nit_cui, cliente.telefono, cliente.movil]
    if (campos.some(campo => normalizar(campo).includes(texto))) {
        return true
    }
    return bd.servicios.some(servicio => servicio.cliente_id === cliente.id
        && (normalizar(servicio.user_ppp).includes(texto) || servicio.ipv4 === q.trim()))
}

/** `true`/`false` de un query param booleano, o `undefined` si no viene. */
function banderaQuery(solicitud: SolicitudFixture, nombre: string): boolean | undefined {
    const valor = solicitud.query.get(nombre)
    if (valor === 'true' || valor === '1') {
        return true
    }
    return valor === 'false' || valor === '0' ? false : undefined
}

/**
 * Igual que `aplicarFiltrosAvanzados` de la API: estado, router y plan sobre el MISMO servicio;
 * deuda = alguna factura `vencida`; promesa = algún servicio con promesa activa.
 */
function cumpleFiltrosAvanzados(cliente: Cliente, solicitud: SolicitudFixture): boolean {
    const estado = solicitud.query.get('estado_servicio')
    const router = numeroQuery(solicitud, 'router_id')
    const plan = numeroQuery(solicitud, 'plan_id')
    const servicios = bd.servicios.filter(s => s.cliente_id === cliente.id)
    if (estado || router !== undefined || plan !== undefined) {
        const alguno = servicios.some(s => (!estado || s.estado === estado)
            && (router === undefined || s.router_id === router)
            && (plan === undefined || s.plan_id === plan))
        if (!alguno) {
            return false
        }
    }
    const deuda = banderaQuery(solicitud, 'con_deuda_vencida')
    if (deuda !== undefined && bd.facturas.some(f => f.cliente_id === cliente.id && f.estado === 'vencida') !== deuda) {
        return false
    }
    const promesa = banderaQuery(solicitud, 'con_promesa_activa')
    if (promesa !== undefined && servicios.some(s => s.promesa_activa) !== promesa) {
        return false
    }
    // Localización fiscal (A1): NIT/CUI que no pasó la validación al migrar.
    const invalido = banderaQuery(solicitud, 'nit_cui_invalido')
    return invalido === undefined || (cliente.nit_cui_invalido === true) === invalido
}

export const rutasClientes: RutasFixture = {
    'GET /api/v1/clientes': conPermiso('clientes.ver', (solicitud) => {
        const q = solicitud.query.get('q') ?? ''
        const zona = numeroQuery(solicitud, 'zona_id')
        const responsable = numeroQuery(solicitud, 'responsable_pago_id')
        // Multiempresa (A1): clientes con algún servicio en la empresa, o sin servicios.
        const empresas = empresasDeLista(solicitud)
        const filas = bd.clientes
            .filter((cliente) => {
                const suyos = bd.servicios.filter(s => s.cliente_id === cliente.id)
                return empresas === null || !suyos.length || suyos.some(s => empresas.includes(s.empresa_id))
            })
            .filter(cliente => zona === undefined || cliente.zona_id === zona)
            .filter(cliente => responsable === undefined || cliente.responsable_pago_id === responsable)
            .filter(cliente => coincide(cliente, q))
            .filter(cliente => cumpleFiltrosAvanzados(cliente, solicitud))
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/clientes/:id': conPermiso('clientes.ver', (solicitud) => {
        const cliente = bd.clientes.find(c => c.id === idDe(solicitud))
        return cliente ? { status: 200, cuerpo: cliente } : noEncontrado('el cliente')
    }),

    /** Como `VincularTelegramCliente` (A1): chat id con signo y hasta 20 dígitos; repetir no cambia nada. */
    'POST /api/v1/clientes/:id/vincular-telegram': conPermiso('clientes.vincular_telegram', (solicitud) => {
        const cliente = bd.clientes.find(c => c.id === idDe(solicitud))
        if (!cliente) {
            return noEncontrado('el cliente')
        }
        const chat = String(cuerpoObjeto(solicitud).chat_id ?? '')
        if (!/^-?\d{1,20}$/.test(chat)) {
            return datosInvalidos([{ field: 'chat_id', message: 'El chat id no es válido', rule: 'regex' }])
        }
        cliente.telegram_chat_id = chat
        cliente.version += 1
        registrarAccion(solicitud, 'clientes.vincular_telegram', { tipo: 'cliente', id: cliente.id }, { chat_id: '***' })
        return { status: 200, cuerpo: cliente }
    }),

    'POST /api/v1/clientes/:id/desvincular-telegram': conPermiso('clientes.desvincular_telegram', (solicitud) => {
        const cliente = bd.clientes.find(c => c.id === idDe(solicitud))
        if (!cliente) {
            return noEncontrado('el cliente')
        }
        if (cliente.telegram_chat_id) {
            cliente.telegram_chat_id = null
            cliente.version += 1
            registrarAccion(solicitud, 'clientes.desvincular_telegram', { tipo: 'cliente', id: cliente.id }, {})
        }
        return { status: 200, cuerpo: cliente }
    }),

    'GET /api/v1/clientes/:id/dependientes': conPermiso('clientes.ver', (solicitud) => {
        const id = idDe(solicitud)
        if (!bd.clientes.some(c => c.id === id)) {
            return noEncontrado('el cliente')
        }
        const filas = bd.clientes
            .filter(c => c.responsable_pago_id === id)
            .sort((a, b) => a.nombre.localeCompare(b.nombre) || a.id - b.id)
            .map(dependiente)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    /** Como `AsignarResponsablePago` (A1): un solo nivel, sin ciclos; repetir el mismo no cambia nada. */
    'POST /api/v1/clientes/:id/responsable-pago': conPermiso('clientes.asignar_responsable_pago', conIdempotencia((solicitud) => {
        const id = idDe(solicitud)
        const cliente = bd.clientes.find(c => c.id === id)
        const cuerpo = cuerpoObjeto(solicitud)
        const responsableId = cuerpo.responsable_id
        if (typeof responsableId !== 'number' || !Number.isInteger(responsableId) || responsableId < 1) {
            return datosInvalidos([{ field: 'responsable_id', message: 'Elige el cliente responsable', rule: 'required' }])
        }
        const motivo = errorMotivo(cuerpo)
        if (motivo.length) {
            return datosInvalidos(motivo)
        }
        if (id === responsableId) {
            return responsableInvalido('Un cliente no puede ser su propio responsable de pago')
        }
        if (!cliente) {
            return noEncontrado('el cliente')
        }
        const responsable = bd.clientes.find(c => c.id === responsableId)
        if (!responsable) {
            return responsableInvalido(`El cliente ${responsableId} no existe`)
        }
        if (cliente.responsable_pago_id === responsableId) {
            return { status: 200, cuerpo: cliente }
        }
        if (responsable.responsable_pago_id !== null && responsable.responsable_pago_id !== undefined) {
            return responsableInvalido(`El cliente ${responsableId} tiene a su vez un responsable de pago; solo se admite un nivel`)
        }
        if (bd.clientes.some(c => c.responsable_pago_id === cliente.id)) {
            return responsableInvalido(`El cliente ${cliente.id} es responsable de pago de otros clientes y no puede tener responsable`)
        }
        Object.assign(cliente, { responsable_pago_id: responsable.id, responsable_pago_nombre: responsable.nombre, version: cliente.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'clientes.asignar_responsable_pago', { tipo: 'cliente', id: cliente.id }, cuerpo)
        return { status: 200, cuerpo: cliente }
    })),

    'POST /api/v1/clientes/:id/quitar-responsable-pago': conPermiso('clientes.quitar_responsable_pago', conIdempotencia((solicitud) => {
        const cliente = bd.clientes.find(c => c.id === idDe(solicitud))
        if (!cliente) {
            return noEncontrado('el cliente')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const motivo = errorMotivo(cuerpo)
        if (motivo.length) {
            return datosInvalidos(motivo)
        }
        if (cliente.responsable_pago_id === null || cliente.responsable_pago_id === undefined) {
            return { status: 200, cuerpo: cliente }
        }
        Object.assign(cliente, { responsable_pago_id: null, responsable_pago_nombre: null, version: cliente.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'clientes.quitar_responsable_pago', { tipo: 'cliente', id: cliente.id }, cuerpo)
        return { status: 200, cuerpo: cliente }
    })),

    'GET /api/v1/clientes/:id/estado-cuenta': conPermiso('clientes.estado_cuenta', (solicitud) => {
        const id = idDe(solicitud)
        const cliente = bd.clientes.find(c => c.id === id)
        return cliente ? { status: 200, cuerpo: estadoCuentaDe(cliente.id, numeroQuery(solicitud, 'empresa_id')) } : noEncontrado('el cliente')
    }),

    'POST /api/v1/clientes': conPermiso('clientes.crear', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = validar(cuerpo)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const momento = ahora()
        const id = siguienteId(bd.clientes)
        const cliente: Cliente = {
            ...aplicar(VACIO, cuerpo),
            id,
            codigo: codigoCliente(id),
            telegram_chat_id: null,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.clientes.push(cliente)
        registrarAccion(solicitud, 'clientes.crear', { tipo: 'cliente', id: cliente.id }, cuerpo)
        return { status: 201, cuerpo: cliente }
    })),

    'PUT /api/v1/clientes/:id': conPermiso('clientes.editar', (solicitud) => {
        const indice = bd.clientes.findIndex(c => c.id === idDe(solicitud))
        const actual = bd.clientes[indice]
        if (!actual) {
            return noEncontrado('el cliente')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== actual.version) {
            return versionCambiada()
        }
        const errores = validar(cuerpo, actual)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const editado: Cliente = {
            ...actual,
            ...aplicar(actual, cuerpo),
            version: actual.version + 1,
            updated_at: ahora(),
        }
        bd.clientes[indice] = editado
        registrarAccion(solicitud, 'clientes.editar', { tipo: 'cliente', id: editado.id }, cuerpo)
        return { status: 200, cuerpo: editado }
    }),
}
