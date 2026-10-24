import type { Schema, paths } from '@argosisp/contracts'
import * as z from 'zod'

type Usuario = Schema<'Usuario'>
type Rol = Schema<'Rol'>
type DatosUsuario = paths['/api/v1/usuarios']['post']['requestBody']['content']['application/json']
type CambiosUsuario = paths['/api/v1/usuarios/{id}']['put']['requestBody']['content']['application/json']
type DatosRol = paths['/api/v1/roles']['post']['requestBody']['content']['application/json']
type DatosToken = paths['/api/v1/tokens']['post']['requestBody']['content']['application/json']
type Permiso = DatosRol['permisos'][number]
export type TipoAlcanceRol = NonNullable<Schema<'AsignacionRol'>['alcance_tipo']>

/**
 * Roles base: sus permisos se definen en código (`ROLES_BASE` de `apps/api/app/core/permisos.ts`)
 * y `PUT /roles/:id` los rechaza (422 `rol_base`); solo se edita su descripción.
 */
export const ROLES_BASE = ['admin', 'cajero', 'soporte', 'tecnico', 'contabilidad', 'lectura'] as const

export function esRolBase(nombre: string): boolean {
    return (ROLES_BASE as readonly string[]).includes(nombre)
}

export const ALCANCES_ROL: Record<TipoAlcanceRol, { etiqueta: string, opcion: string, icono: string }> = {
    router: { etiqueta: 'Router', opcion: 'Un router', icono: 'i-lucide-router' },
    zona: { etiqueta: 'Zona', opcion: 'Una zona', icono: 'i-lucide-map-pin' },
    caja: { etiqueta: 'Caja', opcion: 'Una caja', icono: 'i-lucide-wallet' },
}

/** Reka UI no admite `''` como valor de un ítem: «sin alcance» va como `todo`. */
export const SIN_ALCANCE = 'todo'

/*
 * Usuarios
 */

const asignacion = z.object({
    role_id: z.number({ message: 'Elige el rol' }).int().min(1, 'Elige el rol').nullable().refine(v => v !== null, 'Elige el rol'),
    alcance_tipo: z.enum([SIN_ALCANCE, 'router', 'zona', 'caja']),
    alcance_id: z.number().int().min(1, 'Elige a qué aplica').nullable(),
}).superRefine((a, ctx) => {
    // Como `asignaciones_rol.ts`: alcance_tipo y alcance_id van juntos.
    if (a.alcance_tipo !== SIN_ALCANCE && a.alcance_id === null) {
        ctx.addIssue({ code: 'custom', path: ['alcance_id'], message: 'Elige a qué aplica el alcance' })
    }
})

/**
 * Espejo de `crearUsuarioValidator` / `editarUsuarioValidator` (A1): nombre 2–200, correo válido,
 * contraseña de 8 a 200 (al editar, vacía = no se cambia) y roles con su alcance.
 */
export function esquemaUsuario(edicion: boolean) {
    const password = z.string().max(200, 'Máximo 200 caracteres')
    return z.object({
        nombre: z.string().trim().min(2, 'Al menos 2 caracteres').max(200, 'Máximo 200 caracteres'),
        email: z.email('Escribe un correo válido').trim().toLowerCase(),
        password: edicion
            ? password.refine(v => v === '' || v.length >= 8, 'Al menos 8 caracteres (vacía para no cambiarla)')
            : password.min(8, 'Al menos 8 caracteres'),
        activo: z.boolean(),
        roles: z.array(asignacion),
    })
}

export type EntradaUsuario = z.input<ReturnType<typeof esquemaUsuario>>
export type SalidaUsuario = z.output<ReturnType<typeof esquemaUsuario>>

export function entradaUsuarioVacia(): EntradaUsuario {
    return { nombre: '', email: '', password: '', activo: true, roles: [] }
}

export function entradaDesdeUsuario(usuario: Usuario): EntradaUsuario {
    return {
        nombre: usuario.nombre,
        email: usuario.email,
        password: '',
        activo: usuario.activo,
        roles: usuario.roles.map(r => ({ role_id: r.role_id, alcance_tipo: r.alcance_tipo ?? SIN_ALCANCE, alcance_id: r.alcance_id })),
    }
}

function rolesDe(datos: SalidaUsuario): NonNullable<DatosUsuario['roles']> {
    return datos.roles.map(r => (r.alcance_tipo === SIN_ALCANCE
        ? { role_id: r.role_id as number, alcance_tipo: null, alcance_id: null }
        : { role_id: r.role_id as number, alcance_tipo: r.alcance_tipo, alcance_id: r.alcance_id }))
}

export function cuerpoUsuario(datos: SalidaUsuario): DatosUsuario {
    return { nombre: datos.nombre, email: datos.email, password: datos.password, activo: datos.activo, roles: rolesDe(datos) }
}

/** Todos los campos con la `version`; la contraseña solo si se escribió una nueva. */
export function cambiosUsuario(datos: SalidaUsuario, version: number): CambiosUsuario {
    return {
        version,
        nombre: datos.nombre,
        email: datos.email,
        activo: datos.activo,
        roles: rolesDe(datos),
        ...(datos.password ? { password: datos.password } : {}),
    }
}

/*
 * Roles
 */

/** Espejo de `crearRolValidator`: `^[a-z0-9_]{2,50}$`, descripción ≤ 300. */
export const esquemaRol = z.object({
    nombre: z.string().trim().regex(/^[a-z0-9_]{2,50}$/, 'De 2 a 50 letras minúsculas, números o _ (ej. cobrador_zona)'),
    descripcion: z.string().trim().max(300, 'Máximo 300 caracteres'),
    permisos: z.array(z.string()),
})

export type EntradaRol = z.input<typeof esquemaRol>
export type SalidaRol = z.output<typeof esquemaRol>

export function entradaDesdeRol(rol: Rol | null): EntradaRol {
    return rol ? { nombre: rol.nombre, descripcion: rol.descripcion ?? '', permisos: [...rol.permisos] } : { nombre: '', descripcion: '', permisos: [] }
}

/**
 * Los permisos vienen del catálogo de la API (`GET /permisos`), así que son nombres válidos del
 * enum del contrato; la API los vuelve a validar (422 «Permiso desconocido»).
 */
export function comoPermisos(nombres: readonly string[]): Permiso[] {
    return [...new Set(nombres)].sort() as Permiso[]
}

/*
 * Tokens de API
 */

/** Espejo de `crearTokenApiValidator`: usuario, nombre 2–100 y alcances opcionales. */
export const esquemaToken = z.object({
    usuario_id: z.number({ message: 'Elige el usuario' }).int().min(1, 'Elige el usuario').nullable().refine(v => v !== null, 'Elige el usuario'),
    nombre: z.string().trim().min(2, 'Al menos 2 caracteres').max(100, 'Máximo 100 caracteres'),
    recortar: z.boolean(),
    permisos: z.array(z.string()),
    routers: z.array(z.number().int().min(1)),
    zonas: z.array(z.number().int().min(1)),
    cajas: z.array(z.number().int().min(1)),
}).superRefine((datos, ctx) => {
    if (datos.recortar && !datos.permisos.length) {
        ctx.addIssue({ code: 'custom', path: ['permisos'], message: 'Elige al menos un permiso o no recortes los permisos' })
    }
})

export type EntradaToken = z.input<typeof esquemaToken>
export type SalidaToken = z.output<typeof esquemaToken>

export function entradaTokenVacia(): EntradaToken {
    return { usuario_id: null, nombre: '', recortar: false, permisos: [], routers: [], zonas: [], cajas: [] }
}

export function cuerpoToken(datos: SalidaToken): DatosToken {
    const alcances: NonNullable<DatosToken['alcances']> = {}
    if (datos.recortar) {
        alcances.permisos = comoPermisos(datos.permisos)
    }
    if (datos.routers.length) {
        alcances.routers = datos.routers
    }
    if (datos.zonas.length) {
        alcances.zonas = datos.zonas
    }
    if (datos.cajas.length) {
        alcances.cajas = datos.cajas
    }
    return { usuario_id: datos.usuario_id as number, nombre: datos.nombre, alcances }
}

/** `alcances` de un token (objeto libre en el contrato) leído con cuidado. */
export function alcancesDeToken(alcances: Record<string, unknown>): { permisos: string[] | null, routers: number[], zonas: number[], cajas: number[] } {
    const numeros = (valor: unknown): number[] => (Array.isArray(valor) ? valor.filter((n): n is number => typeof n === 'number') : [])
    return {
        permisos: Array.isArray(alcances.permisos) ? alcances.permisos.filter((p): p is string => typeof p === 'string') : null,
        routers: numeros(alcances.routers),
        zonas: numeros(alcances.zonas),
        cajas: numeros(alcances.cajas),
    }
}

/*
 * Catálogo de permisos agrupado por módulo (lo que va antes del punto).
 */

const ETIQUETAS_MODULO: Record<string, string> = {
    activos: 'Activos fijos', adicionales: 'Adicionales', anuncios: 'Anuncios', bancos: 'Bancos', bitacora: 'Bitácora', cajas: 'Cajas',
    cartera: 'Cartera', cierres: 'Cierres', clientes: 'Clientes', cobros: 'Cobros', compras: 'Compras', comprobantes: 'Comprobantes',
    cuentas_bancarias: 'Cuentas bancarias', declaraciones: 'Declaraciones', documentos: 'Documentos', egresos: 'Egresos',
    empresa: 'Empresa (contacto)', empresas: 'Empresas', facturas: 'Facturas', fel: 'FEL', fiscal: 'Fiscal', horus: 'Horus',
    ip: 'IP', ipv6: 'IPv6', lealtad: 'Lealtad', libro: 'Libro contable', libros: 'Libros legales', nodos_portal: 'Nodos del portal',
    notificaciones: 'Notificaciones', pagos: 'Pagos', planes: 'Planes', plantillas: 'Plantillas', promesas: 'Promesas',
    proveedores: 'Proveedores', red: 'Red', redes: 'Redes IPv4', reportes: 'Reportes', roles: 'Roles', routers: 'Routers',
    servicios: 'Servicios', sesiones: 'Sesiones', sorteos: 'Sorteos', sso: 'Autologin', tokens: 'Tokens de API', usuarios: 'Usuarios',
    vinculaciones: 'Vinculaciones', zonas: 'Zonas',
}

export function etiquetaModulo(modulo: string): string {
    return ETIQUETAS_MODULO[modulo] ?? modulo.replaceAll('_', ' ')
}

export interface GrupoPermisos {
    modulo: string
    etiqueta: string
    permisos: { nombre: string, descripcion: string | null }[]
}

export function agruparPermisos(catalogo: readonly { nombre: string, descripcion: string | null }[], filtro = ''): GrupoPermisos[] {
    const texto = filtro.trim().toLowerCase()
    const grupos = new Map<string, GrupoPermisos>()
    for (const permiso of [...catalogo].sort((a, b) => a.nombre.localeCompare(b.nombre))) {
        const modulo = permiso.nombre.split('.')[0] ?? permiso.nombre
        const etiqueta = etiquetaModulo(modulo)
        if (texto && !`${permiso.nombre} ${permiso.descripcion ?? ''} ${etiqueta}`.toLowerCase().includes(texto)) {
            continue
        }
        const grupo = grupos.get(modulo) ?? { modulo, etiqueta, permisos: [] }
        grupo.permisos.push({ nombre: permiso.nombre, descripcion: permiso.descripcion })
        grupos.set(modulo, grupo)
    }
    return [...grupos.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta))
}
