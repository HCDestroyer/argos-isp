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
    // 0.12.0 §3.10 (A48): Iris ya no declara pérdidas (las decide una persona en Argos); cambia equipos,
    // registra intentos de recuperación y lee una unidad sin costos
    'servicios.cambiar_equipo',
    'inventario.ver_unidad',
    'inventario.consumir',
    // recepción de órdenes de traslado en la app de campo (contrato 0.5.0 §3.3)
    'inventario.recibir_traslado',
    'facturas.emitir_cargo_unico',
    // comercial
    'clientes.crear',
    'servicios.crear',
    // autologin
    'sso.emitir',
    // pagos y atención (contrato 0.6.0 §7, con los nombres de Argos de §9.1: `pagos.reportar` →
    // `comprobantes.registrar`, `servicios.reconexion_temporal` → `comprobantes.reconexion_temporal`;
    // `clientes.buscar_por_telefono` no existe: es el filtro `telefono` de `GET /clientes`, con
    // `clientes.ver`)
    'cuentas_bancarias.ver',
    'comprobantes.registrar',
    'comprobantes.ver',
    'comprobantes.reconexion_temporal',
    'promesas.ver',
    'promesas.crear',
    'clientes.verificar_identidad',
    // actuación vinculada (contrato 0.7.0, A23): solo como el usuario de Argos vinculado al
    // operador de Iris (`X-Iris-Actor: usuario:<id>`), que también necesita el permiso
    'comprobantes.aprobar',
    'comprobantes.rechazar',
    // contactos del cliente (contrato 0.10.0 §3.5, A42)
    'contactos.buscar',
    'contactos.gestionar',
    // de la venta a la instalación (contrato 0.10.0 §3.4)
    'servicios.reservar_ip',
    'servicios.cambiar_plan_pendiente',
    'clientes.registrar_identidad',
    'servicios.completar_datos',
    'servicios.cambiar_titular',
    // gestiones de cobro (contrato 0.13.0, decisión del PM 8; A3): llamadas y visitas de Iris
    'gestiones_cobro.registrar',
    // falla general de red (contrato 0.13.0): servicios afectados por páginas
    'incidentes_red.leer',
    // equipos del cliente y bienvenida (contrato 0.9.0 §12, A32, A33, A35 y A37)
    'servicios.aprovisionar',
    'servicios.ver_equipo',
    'servicios.cambiar_wifi',
    'servicios.reenviar_bienvenida',
] as const

/** Permiso que el contrato 0.13.0 suma al usuario técnico Iris (migración de los tokens vigentes). */
export const PERMISOS_IRIS_0130 = ['gestiones_cobro.registrar'] as const satisfies ReadonlyArray<
    (typeof PERMISOS_IRIS_CONTRATO)[number]
>

/** Permisos que el contrato 0.9.0 sumó al usuario técnico Iris (migración de los tokens vigentes). */
export const PERMISOS_IRIS_090 = [
    'servicios.aprovisionar',
    'servicios.ver_equipo',
    'servicios.cambiar_wifi',
    'servicios.reenviar_bienvenida',
] as const satisfies ReadonlyArray<(typeof PERMISOS_IRIS_CONTRATO)[number]>

/** Permisos que el contrato 0.12.0 sumó al usuario técnico Iris (migración de los tokens vigentes). */
export const PERMISOS_IRIS_0120 = [
    'servicios.cambiar_equipo',
    'inventario.ver_unidad',
] as const satisfies ReadonlyArray<(typeof PERMISOS_IRIS_CONTRATO)[number]>

/** Permiso que el contrato 0.12.0 le quitó al usuario técnico Iris (la pérdida la declara una persona). */
export const PERMISO_RETIRADO_IRIS_0120 = 'inventario.declarar_perdida_comodato'

/**
 * Permisos que el contrato 0.10.0 sumó al usuario técnico Iris (§3.4 y §3.5; migración de los
 * tokens vigentes `1795255982193_alter_permisos_iris_0100_s_table`).
 */
export const PERMISOS_IRIS_0100 = [
    'contactos.buscar',
    'contactos.gestionar',
    'servicios.reservar_ip',
    'servicios.cambiar_plan_pendiente',
    'clientes.registrar_identidad',
    'servicios.completar_datos',
    'servicios.cambiar_titular',
] as const satisfies ReadonlyArray<(typeof PERMISOS_IRIS_CONTRATO)[number]>

/** Permisos que el contrato 0.7.0 sumó al usuario técnico Iris (migración de los tokens vigentes). */
export const PERMISOS_IRIS_070 = [
    'comprobantes.aprobar',
    'comprobantes.rechazar',
] as const satisfies ReadonlyArray<(typeof PERMISOS_IRIS_CONTRATO)[number]>

/** Permisos que el contrato 0.6.0 sumó al usuario técnico Iris (migración de los tokens vigentes). */
export const PERMISOS_IRIS_060 = [
    'cuentas_bancarias.ver',
    'comprobantes.registrar',
    'comprobantes.ver',
    'comprobantes.reconexion_temporal',
    'promesas.ver',
    'promesas.crear',
    'clientes.verificar_identidad',
] as const satisfies ReadonlyArray<(typeof PERMISOS_IRIS_CONTRATO)[number]>

export const PERMISOS_IRIS = permisosExistentes(PERMISOS_IRIS_CONTRATO)

export const USUARIO_TECNICO_IRIS: DefinicionUsuarioTecnico = {
    sistema: 'iris',
    nombre: NOMBRE_USUARIO_IRIS,
    email: EMAIL_USUARIO_IRIS,
    rol: ROL_IRIS,
    descripcionRol:
        'Integración Iris: leer clientes, servicios y red; activar instalaciones, retiros, comodatos, consumos y cargos únicos; comprobantes (aprobar y rechazar solo como el usuario vinculado), promesas y verificación de identidad',
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
