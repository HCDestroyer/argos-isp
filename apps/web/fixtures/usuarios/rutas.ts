import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, usuariosPorToken, versionCambiada } from '../comun'
import { catalogoPermisos } from './datos'

export { usuarios } from './datos'

type AsignacionRol = Schema<'AsignacionRol'>
type Errores = NonNullable<Problem['errors']>

const ALCANCES = ['router', 'zona', 'caja']
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function texto(valor: unknown): string | null {
    return typeof valor === 'string' ? valor.trim() : null
}

/** Como `asignaciones_rol.ts` (A1): el rol existe y `alcance_tipo`/`alcance_id` van juntos. */
function asignaciones(valor: unknown): { roles: AsignacionRol[] } | { errores: Errores } {
    const lista = Array.isArray(valor) ? valor : []
    const roles: AsignacionRol[] = []
    const errores: Errores = []
    lista.forEach((a: unknown, i) => {
        const fila = typeof a === 'object' && a !== null ? a as Record<string, unknown> : {}
        const rol = bd.roles.find(r => r.id === fila.role_id)
        const tipo = typeof fila.alcance_tipo === 'string' && ALCANCES.includes(fila.alcance_tipo) ? fila.alcance_tipo as AsignacionRol['alcance_tipo'] : null
        const alcance = typeof fila.alcance_id === 'number' ? fila.alcance_id : null
        if (!rol) {
            errores.push({ field: `roles.${i}.role_id`, message: 'El rol no existe', rule: 'exists' })
            return
        }
        if ((tipo === null) !== (alcance === null)) {
            errores.push({ field: `roles.${i}.alcance_id`, message: 'alcance_tipo y alcance_id van juntos', rule: 'alcance' })
            return
        }
        roles.push({ role_id: rol.id, rol: rol.nombre, alcance_tipo: tipo, alcance_id: alcance })
    })
    return errores.length ? { errores } : { roles }
}

function erroresUsuario(cuerpo: Record<string, unknown>, creando: boolean): Errores {
    const errores: Errores = []
    const nombre = texto(cuerpo.nombre)
    const email = texto(cuerpo.email)
    if ((creando || cuerpo.nombre !== undefined) && (!nombre || nombre.length < 2 || nombre.length > 200)) {
        errores.push({ field: 'nombre', message: 'El nombre debe tener entre 2 y 200 caracteres', rule: 'minLength' })
    }
    if ((creando || cuerpo.email !== undefined) && (!email || !CORREO.test(email))) {
        errores.push({ field: 'email', message: 'El correo no es válido', rule: 'email' })
    }
    if ((creando || cuerpo.password !== undefined) && (typeof cuerpo.password !== 'string' || cuerpo.password.length < 8)) {
        errores.push({ field: 'password', message: 'La contraseña debe tener al menos 8 caracteres', rule: 'minLength' })
    }
    return errores
}

function correoRepetido(email: string, excepto: number | null): RespuestaFixture | null {
    const repetido = bd.usuarios.some(u => u.email.toLowerCase() === email.toLowerCase() && u.id !== excepto)
    return repetido ? problemaTipado(409, 'email_duplicado', 'Conflicto', `Ya existe un usuario con el correo ${email}`) : null
}

type NombrePermiso = Schema<'Permiso'>['nombre']

function permisosValidos(valor: unknown, campo: string): { permisos: NombrePermiso[] } | { errores: Errores } {
    const lista = Array.isArray(valor) ? valor.filter((p): p is string => typeof p === 'string') : []
    const desconocidos = lista.filter(p => !catalogoPermisos.some(c => c.nombre === p))
    if (desconocidos.length) {
        return { errores: desconocidos.map(p => ({ field: campo, message: `Permiso desconocido: ${p}`, rule: 'exists' })) }
    }
    // Sin desconocidos: cada uno es un nombre del catálogo del contrato.
    return { permisos: ([...new Set(lista)] as NombrePermiso[]).sort() }
}

function actorDe(solicitud: SolicitudFixture) {
    return solicitud.token ? usuariosPorToken[solicitud.token] : undefined
}

export const rutasUsuarios: RutasFixture = {
    'GET /api/v1/usuarios': conPermiso('usuarios.ver', solicitud => ({ status: 200, cuerpo: paginar(bd.usuarios, solicitud) })),

    'GET /api/v1/usuarios/:id': conPermiso('usuarios.ver', (solicitud) => {
        const usuario = bd.usuarios.find(u => u.id === idDe(solicitud))
        return usuario ? { status: 200, cuerpo: usuario } : noEncontrado('el usuario')
    }),

    /** Como `CrearUsuario` (A1): 409 `email_duplicado`; alcance global si quien crea lo tiene. */
    'POST /api/v1/usuarios': conPermiso('usuarios.crear', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = erroresUsuario(cuerpo, true)
        const asignadas = asignaciones(cuerpo.roles)
        if (errores.length || 'errores' in asignadas) {
            return datosInvalidos([...errores, ...('errores' in asignadas ? asignadas.errores : [])])
        }
        const email = (texto(cuerpo.email) ?? '').toLowerCase()
        const repetido = correoRepetido(email, null)
        if (repetido) {
            return repetido
        }
        const actor = actorDe(solicitud)
        const creado = ahora()
        const usuario: Schema<'Usuario'> = {
            id: siguienteId(bd.usuarios),
            nombre: texto(cuerpo.nombre) ?? '',
            email,
            activo: cuerpo.activo !== false,
            roles: asignadas.roles,
            alcance_global: actor?.alcance_global === true,
            empresas: actor?.alcance_global ? [] : (actor?.empresas ?? []).map(e => e.id),
            version: 1,
            created_at: creado,
            updated_at: creado,
        }
        bd.usuarios.push(usuario)
        registrarAccion(solicitud, 'usuarios.crear', { tipo: 'usuario', id: usuario.id }, { ...cuerpo, password: '***' })
        return { status: 201, cuerpo: usuario }
    }),

    /** Como `EditarUsuario` (A1): `version` (409), 422 `autodesactivacion`, roles reemplazan la lista. */
    'PUT /api/v1/usuarios/:id': conPermiso('usuarios.editar', (solicitud) => {
        const usuario = bd.usuarios.find(u => u.id === idDe(solicitud))
        if (!usuario) {
            return noEncontrado('el usuario')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== usuario.version) {
            return versionCambiada()
        }
        if (cuerpo.activo === false && actorDe(solicitud)?.id === usuario.id) {
            return problemaTipado(422, 'autodesactivacion', 'Regla de negocio', 'No puedes desactivar tu propio usuario')
        }
        const errores = erroresUsuario(cuerpo, false)
        const asignadas = cuerpo.roles === undefined ? { roles: usuario.roles } : asignaciones(cuerpo.roles)
        if (errores.length || 'errores' in asignadas) {
            return datosInvalidos([...errores, ...('errores' in asignadas ? asignadas.errores : [])])
        }
        const email = cuerpo.email === undefined ? usuario.email : (texto(cuerpo.email) ?? '').toLowerCase()
        const repetido = correoRepetido(email, usuario.id)
        if (repetido) {
            return repetido
        }
        Object.assign(usuario, {
            nombre: texto(cuerpo.nombre) ?? usuario.nombre,
            email,
            activo: typeof cuerpo.activo === 'boolean' ? cuerpo.activo : usuario.activo,
            roles: asignadas.roles,
            version: usuario.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'usuarios.editar', { tipo: 'usuario', id: usuario.id }, cuerpo.password === undefined ? cuerpo : { ...cuerpo, password: '***' })
        return { status: 200, cuerpo: usuario }
    }),

    'GET /api/v1/permisos': conPermiso('roles.ver', () => ({ status: 200, cuerpo: catalogoPermisos })),

    'GET /api/v1/roles': conPermiso('roles.ver', () => ({ status: 200, cuerpo: bd.roles })),

    /** Como `CrearRol` (A1): nombre `^[a-z0-9_]{2,50}$`, 409 `rol_duplicado`, permisos del catálogo. */
    'POST /api/v1/roles': conPermiso('roles.crear', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const nombre = texto(cuerpo.nombre) ?? ''
        if (!/^[a-z0-9_]{2,50}$/.test(nombre)) {
            return datosInvalidos([{ field: 'nombre', message: 'El formato de nombre no es válido', rule: 'regex' }])
        }
        if (bd.roles.some(r => r.nombre === nombre)) {
            return problemaTipado(409, 'rol_duplicado', 'Conflicto', `Ya existe el rol ${nombre}`)
        }
        const permisos = permisosValidos(cuerpo.permisos, 'permisos')
        if ('errores' in permisos) {
            return datosInvalidos(permisos.errores)
        }
        const creado = ahora()
        const rol: Schema<'Rol'> = { id: siguienteId(bd.roles), nombre, descripcion: texto(cuerpo.descripcion) || null, base: false, permisos: permisos.permisos, version: 1, created_at: creado, updated_at: creado }
        bd.roles.push(rol)
        registrarAccion(solicitud, 'roles.crear', { tipo: 'rol', id: rol.id }, cuerpo)
        return { status: 201, cuerpo: rol }
    }),

    /** Como `EditarRol` (A1): descripción y permisos con `version`; un rol base no cambia permisos (409 `rol_base`). */
    'PUT /api/v1/roles/:id': conPermiso('roles.editar', (solicitud) => {
        const rol = bd.roles.find(r => r.id === idDe(solicitud))
        if (!rol) {
            return noEncontrado('el rol')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.permisos !== undefined && rol.base) {
            return problemaTipado(409, 'rol_base', 'Conflicto', `Los permisos del rol base ${rol.nombre} se definen en código; crea un rol propio`)
        }
        if (cuerpo.version !== rol.version) {
            return versionCambiada()
        }
        const permisos = cuerpo.permisos === undefined ? { permisos: rol.permisos } : permisosValidos(cuerpo.permisos, 'permisos')
        if ('errores' in permisos) {
            return datosInvalidos(permisos.errores)
        }
        Object.assign(rol, {
            descripcion: cuerpo.descripcion === undefined ? rol.descripcion : (texto(cuerpo.descripcion) || null),
            permisos: permisos.permisos,
            version: rol.version + 1,
            updated_at: ahora(),
        })
        // Los usuarios guardan el nombre del rol: no cambia (el nombre no se edita).
        registrarAccion(solicitud, 'roles.editar', { tipo: 'rol', id: rol.id }, cuerpo)
        return { status: 200, cuerpo: rol }
    }),

    'GET /api/v1/tokens': conPermiso('tokens.ver', solicitud => ({ status: 200, cuerpo: paginar([...bd.tokensApi].sort((a, b) => b.id - a.id), solicitud) })),

    /** Como `CrearTokenApi` (A1): el valor en claro solo en esta respuesta; permisos del catálogo. */
    'POST /api/v1/tokens': conPermiso('tokens.crear', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const nombre = texto(cuerpo.nombre) ?? ''
        if (typeof cuerpo.usuario_id !== 'number' || nombre.length < 2 || nombre.length > 100) {
            return datosInvalidos([{ field: typeof cuerpo.usuario_id !== 'number' ? 'usuario_id' : 'nombre', message: 'El campo es obligatorio', rule: 'required' }])
        }
        if (!bd.usuarios.some(u => u.id === cuerpo.usuario_id)) {
            return noEncontrado(`el usuario ${cuerpo.usuario_id}`)
        }
        // `AlcancesToken`: solo las claves que llegan; una ausente no recorta esa dimensión
        const entrada = typeof cuerpo.alcances === 'object' && cuerpo.alcances !== null ? cuerpo.alcances as Record<string, unknown> : {}
        const ids = (valor: unknown): number[] => (Array.isArray(valor) ? valor.filter((n): n is number => Number.isInteger(n) && n > 0) : [])
        const alcances: Schema<'AlcancesToken'> = {}
        if (entrada.permisos !== undefined) {
            const permisos = permisosValidos(entrada.permisos, 'alcances.permisos')
            if ('errores' in permisos) {
                return datosInvalidos(permisos.errores)
            }
            alcances.permisos = permisos.permisos
        }
        for (const clave of ['routers', 'zonas', 'cajas'] as const) {
            if (entrada[clave] !== undefined) {
                alcances[clave] = ids(entrada[clave])
            }
        }
        const token: Schema<'TokenApi'> = { id: siguienteId(bd.tokensApi), usuario_id: cuerpo.usuario_id, nombre, alcances, ultimo_uso: null, revocado_en: null, created_at: ahora() }
        bd.tokensApi.push(token)
        registrarAccion(solicitud, 'tokens.crear', { tipo: 'token_api', id: token.id }, cuerpo)
        const valor = `atk_${crypto.randomUUID().replaceAll('-', '')}`
        return { status: 201, cuerpo: { token: valor, datos: token } }
    }),

    'POST /api/v1/tokens/:id/revocar': conPermiso('tokens.revocar', (solicitud) => {
        const token = bd.tokensApi.find(t => t.id === idDe(solicitud))
        if (!token) {
            return noEncontrado('el token')
        }
        if (!token.revocado_en) {
            token.revocado_en = ahora()
            registrarAccion(solicitud, 'tokens.revocar', { tipo: 'token_api', id: token.id }, {})
        }
        return { status: 200, cuerpo: token }
    }),

    /**
     * Como `AsignarEmpresasUsuario` (A1): `{ version, alcance_global, empresas? }`. Sin global hace
     * falta al menos una empresa activa (422); solo quien tiene alcance global lo da y nadie asigna
     * empresas fuera de su alcance (403 `empresa_no_permitida`).
     */
    'PUT /api/v1/usuarios/:id/empresas': conPermiso('usuarios.asignar_empresas', (solicitud) => {
        const usuario = bd.usuarios.find(u => u.id === idDe(solicitud))
        if (!usuario) {
            return noEncontrado('el usuario')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== usuario.version) {
            return versionCambiada()
        }
        const actor = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const global = cuerpo.alcance_global === true
        const pedidas = Array.isArray(cuerpo.empresas) ? cuerpo.empresas.filter((e): e is number => typeof e === 'number') : []
        if (global && !actor?.alcance_global) {
            return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', 'Solo quien tiene alcance global puede darlo')
        }
        if (!global) {
            if (!pedidas.length) {
                return datosInvalidos([{ field: 'empresas', message: 'Elige al menos una empresa', rule: 'required' }])
            }
            const invalida = pedidas.findIndex(id => !bd.empresas.some(e => e.id === id && e.activa))
            if (invalida >= 0) {
                return datosInvalidos([{ field: `empresas.${invalida}`, message: 'La empresa no existe o está inactiva', rule: 'exists' }])
            }
            const ajena = pedidas.find(id => !actor?.alcance_global && !(actor?.empresas ?? []).some(e => e.id === id))
            if (ajena !== undefined) {
                return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', `No tienes acceso a la empresa ${ajena}`)
            }
        }
        usuario.alcance_global = global
        usuario.empresas = global ? [] : [...new Set(pedidas)].sort((a, b) => a - b)
        usuario.version += 1
        usuario.updated_at = ahora()
        registrarAccion(solicitud, 'usuarios.asignar_empresas', { tipo: 'usuario', id: usuario.id }, cuerpo)
        return { status: 200, cuerpo: usuario }
    }),
}
