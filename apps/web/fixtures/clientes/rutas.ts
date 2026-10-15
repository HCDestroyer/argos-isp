import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import {
    ahora,
    conIdempotencia,
    conPermiso,
    cuerpoObjeto,
    datosInvalidos,
    idDe,
    noEncontrado,
    normalizar,
    numeroQuery,
    paginar,
    registrarAccion,
    versionCambiada,
} from '../comun'
import { estadoCuentaDe } from './estado-cuenta'

type Cliente = Schema<'Cliente'>
type CamposCliente = Omit<Cliente, 'id' | 'version' | 'created_at' | 'updated_at' | 'telegram_chat_id'>

const NIT_CUI = /^(CF|\d{13}|\d{1,12}-?[0-9K])$/
const CAMPOS_TEXTO = ['nit_cui', 'nombre_fiscal', 'direccion_fiscal', 'email', 'telefono', 'movil', 'direccion', 'coordenadas'] as const

/** Validación mínima, en el espíritu de `crearClienteValidator`, para probar el 422 en pantalla. */
function validar(cuerpo: Record<string, unknown>, parcial: boolean): NonNullable<Problem['errors']> {
    const errores: NonNullable<Problem['errors']> = []
    const { nombre, nit_cui: nit, email } = cuerpo
    if (!parcial || nombre !== undefined) {
        if (typeof nombre !== 'string' || nombre.trim().length < 2) {
            errores.push({ field: 'nombre', message: 'El nombre debe tener al menos 2 caracteres', rule: 'minLength' })
        }
    }
    if (typeof nit === 'string' && !NIT_CUI.test(nit.trim().toUpperCase())) {
        errores.push({ field: 'nit_cui', message: 'NIT o CUI inválido', rule: 'regex' })
    }
    if (typeof email === 'string' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        errores.push({ field: 'email', message: 'Correo inválido', rule: 'email' })
    }
    if (typeof nombre === 'string' && nombre.trim().toLowerCase() === 'duplicado') {
        errores.push({ field: 'nombre', message: 'Ya existe un cliente con ese nombre (prueba del 422 desde la API)', rule: 'unique' })
    }
    return errores
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
    if (resultado.nit_cui) {
        resultado.nit_cui = resultado.nit_cui.toUpperCase()
    }
    if ('zona_id' in cuerpo) {
        resultado.zona_id = typeof cuerpo.zona_id === 'number' ? cuerpo.zona_id : null
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
    coordenadas: null,
    zona_id: null,
    campos_personalizados: {},
    canal_preferido: 'correo',
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

export const rutasClientes: RutasFixture = {
    'GET /api/v1/clientes': conPermiso('clientes.ver', (solicitud) => {
        const q = solicitud.query.get('q') ?? ''
        const zona = numeroQuery(solicitud, 'zona_id')
        const filas = bd.clientes
            .filter(cliente => zona === undefined || cliente.zona_id === zona)
            .filter(cliente => coincide(cliente, q))
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/clientes/:id': conPermiso('clientes.ver', (solicitud) => {
        const cliente = bd.clientes.find(c => c.id === idDe(solicitud))
        return cliente ? { status: 200, cuerpo: cliente } : noEncontrado('el cliente')
    }),

    'GET /api/v1/clientes/:id/estado-cuenta': conPermiso('clientes.estado_cuenta', (solicitud) => {
        const id = idDe(solicitud)
        const cliente = bd.clientes.find(c => c.id === id)
        return cliente ? { status: 200, cuerpo: estadoCuentaDe(cliente.id) } : noEncontrado('el cliente')
    }),

    'POST /api/v1/clientes': conPermiso('clientes.crear', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = validar(cuerpo, false)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const momento = ahora()
        const cliente: Cliente = {
            ...aplicar(VACIO, cuerpo),
            id: siguienteId(bd.clientes),
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
        const errores = validar(cuerpo, true)
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
