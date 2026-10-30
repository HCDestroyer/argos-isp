import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { TokenApiVista } from '#core/consultas/acl'
import {
    permisosExistentes,
    tokensUsuarioTecnico,
    usuarioTecnico,
    type DefinicionUsuarioTecnico,
} from '#core/usuario_tecnico'

/**
 * Usuario técnico «Iris» (contrato `contratos/iris.md` §1.1): Iris lee y escribe en Argos con un
 * token `atk_` de este usuario. Rol propio `integracion_iris`; el token recorta además sus
 * permisos a `PERMISOS_IRIS`. Sin token generado (o sin canje), Iris no puede nada.
 */

import { EMAIL_USUARIO_IRIS } from '#core/alcance_usuario_tecnico'

export { EMAIL_USUARIO_IRIS }
export const NOMBRE_USUARIO_IRIS = 'Iris'
export const ROL_IRIS = 'integracion_iris'

/**
 * Permisos de §1.1. Solo los que existen en `permisos.ts`: si el contrato nombra uno que Argos aún
 * no tiene, se omite (y se agrega solo cuando exista, al generar el siguiente token).
 */
export const PERMISOS_IRIS_CONTRATO = [
    // lectura
    'clientes.ver',
    'clientes.estado_cuenta',
    'servicios.ver',
    'planes.ver',
    'routers.ver',
    'zonas.ver',
    'ip.resolver',
    'inventario.ver',
    // instalación y retiro
    'servicios.activar_instalacion',
    'servicios.retirar',
    'inventario.asignar_comodato',
    'inventario.devolver_comodato',
    'inventario.declarar_perdida_comodato',
    'inventario.consumir',
    'facturas.emitir_cargo_unico',
    // comercial
    'clientes.crear',
    'servicios.crear',
    // autologin
    'sso.emitir',
] as const

export const PERMISOS_IRIS = permisosExistentes(PERMISOS_IRIS_CONTRATO)

export const USUARIO_TECNICO_IRIS: DefinicionUsuarioTecnico = {
    sistema: 'iris',
    nombre: NOMBRE_USUARIO_IRIS,
    email: EMAIL_USUARIO_IRIS,
    rol: ROL_IRIS,
    descripcionRol:
        'Integración Iris: leer clientes, servicios y red; activar instalaciones, retiros, comodatos, consumos y cargos únicos',
    permisos: PERMISOS_IRIS,
}

/** Id del usuario técnico Iris, o null si nunca se generó un token. */
export function usuarioIris(cliente: QueryClientContract = db.connection()): Promise<number | null> {
    return usuarioTecnico(EMAIL_USUARIO_IRIS, cliente)
}

/** Tokens del usuario Iris (vigentes y revocados), los más nuevos primero; nunca su valor. */
export function listarTokensIris(cliente: QueryClientContract = db.connection()): Promise<TokenApiVista[]> {
    return tokensUsuarioTecnico(EMAIL_USUARIO_IRIS, cliente)
}
