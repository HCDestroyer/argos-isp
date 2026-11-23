import type { Schema } from '@argosisp/contracts'

/**
 * Datos de los ajustes y pantallas «Pendientes del backend» (A1, A3 y A6; rutas de
 * `apps/api/start/routes/operacion_pm.ts` y vecinas): ajustes de operación, de cobro y del panel
 * financiero, correos externos de reportes, bancos de origen por empresa, SmartOLT/GenieACS por
 * empresa, recuperación de contraseña, verificación de intentos de recuperación y vínculos de los
 * técnicos de Iris. Valores de fábrica iguales a los de la API.
 */

export type ValorAjuste = boolean | number | string
export type Verificacion = NonNullable<Schema<'IntentoRecuperacionVerificado'>['verificacion']>

export interface VerificacionIntento {
    verificacion: Verificacion
    motivo: string | null
    verificado_en: string | null
    consultas: number
    decidido_por: number | null
    decidido_en: string | null
    motivo_decision: string | null
}

/** Secretos guardados (la API los cifra y nunca los devuelve). */
export interface SecretosEquipos {
    smartolt_token: string | null
    genieacs_clave: string | null
    genieacs_ca: string | null
}

export interface OperacionPmFixtures {
    ajustesGlobal: Record<string, ValorAjuste>
    ajustesEmpresa: Record<number, Record<string, ValorAjuste>>
    ajustesCobro: Record<number, Schema<'AjustesCobro'>>
    /** Fila de `billing.panel_ajustes` por empresa (sin fila = valores de fábrica, `version` 1). */
    panelFinanciero: Record<number, { dias_baja: number, aviso_pc_activo: boolean, version: number }>
    correosExternos: Schema<'CorreoExternoReportes'>[]
    /** Envíos programados de reportes (`billing.reportes_envios` con sus destinatarios). */
    envios: Schema<'EnvioReporte'>[]
    corridasEnvios: Schema<'CorridaEnvioReporte'>[]
    /** Orden y versión de cada banco del catálogo (el `Banco` de `GET /bancos` no las trae). */
    bancosMeta: Record<number, { orden: number, version: number }>
    /** Bancos ocultos por empresa (decisión 23). */
    bancosOcultos: Record<number, number[]>
    equipos: Record<number, Schema<'ConfigEquipos'>>
    secretosEquipos: Record<number, SecretosEquipos>
    /** Enlaces de recuperación vigentes (token → usuario) y los ya usados. */
    enlaces: Record<string, number>
    /** Solicitudes de enlace por correo (límite de la API: 429 `demasiadas_solicitudes`). */
    solicitudes: Record<string, number>
    verificaciones: Record<number, VerificacionIntento>
    vinculos: Schema<'VinculoTecnicoIris'>[]
}

/** Definiciones de `AJUSTES_OPERACION` (`apps/api/app/core/ajustes_operacion.ts`). */
export const DEFINICIONES_AJUSTES: Schema<'AjustesOperacion'>['definiciones'] = [
    { clave: 'retiro.orden_iris', tipo: 'booleano', por_empresa: false, descripcion: 'Al retirar un servicio, pedir a Iris la orden de retiro y dejar sus equipos en comodato «por recuperar»', min: null, max: null, opciones: null },
    { clave: 'codigo_corte.vigencia_min', tipo: 'entero', por_empresa: true, descripcion: 'Minutos que vale el código para identificarse en el portal que da el personal', min: 5, max: 60, opciones: null },
    { clave: 'auth.recuperar_contrasena', tipo: 'booleano', por_empresa: false, descripcion: 'Permitir recuperar la contraseña del panel por correo (enlace de un solo uso)', min: null, max: null, opciones: null },
    { clave: 'ip_historial.retencion_dias', tipo: 'entero', por_empresa: false, descripcion: 'Días hacia atrás en que se puede buscar quién tenía una IP', min: 30, max: 3650, opciones: null },
    { clave: 'caidas.activo', tipo: 'booleano', por_empresa: true, descripcion: 'Avisar cuando un servicio se cae varias veces en poco tiempo', min: null, max: null, opciones: null },
    { clave: 'caidas.umbral', tipo: 'entero', por_empresa: true, descripcion: 'Caídas dentro de la ventana que disparan el aviso', min: 2, max: 50, opciones: null },
    { clave: 'caidas.ventana_min', tipo: 'entero', por_empresa: true, descripcion: 'Ventana en minutos para contar las caídas', min: 5, max: 1440, opciones: null },
    { clave: 'falla_general.activo', tipo: 'booleano', por_empresa: false, descripcion: 'Detectar fallas generales (muchos servicios del mismo router, OLT, PON o zona a la vez)', min: null, max: null, opciones: null },
    { clave: 'falla_general.modo', tipo: 'opcion', por_empresa: false, descripcion: 'Si el umbral de la falla general es un porcentaje de los servicios del alcance o una cantidad', min: null, max: null, opciones: ['porcentaje', 'cantidad'] },
    { clave: 'falla_general.umbral', tipo: 'entero', por_empresa: false, descripcion: 'Porcentaje (1 a 100) o cantidad de servicios caídos que abren el incidente', min: 1, max: 10000, opciones: null },
    { clave: 'falla_general.minimo_servicios', tipo: 'entero', por_empresa: false, descripcion: 'Servicios caídos mínimos para abrir un incidente (también en modo porcentaje)', min: 2, max: 10000, opciones: null },
    { clave: 'falla_general.ventana_min', tipo: 'entero', por_empresa: false, descripcion: 'Ventana en minutos en que deben caer los servicios', min: 1, max: 60, opciones: null },
]

export const FABRICA_AJUSTES: Record<string, ValorAjuste> = {
    'retiro.orden_iris': true,
    'codigo_corte.vigencia_min': 15,
    'auth.recuperar_contrasena': true,
    'ip_historial.retencion_dias': 730,
    'caidas.activo': true,
    'caidas.umbral': 3,
    'caidas.ventana_min': 60,
    'falla_general.activo': true,
    'falla_general.modo': 'porcentaje',
    'falla_general.umbral': 30,
    'falla_general.minimo_servicios': 5,
    'falla_general.ventana_min': 5,
}

/** Token del enlace de recuperación de los fixtures (vale una vez): `/restablecer-contrasena#token=…`. */
export const TOKEN_RECUPERACION_FIXTURE = 'enlace-de-prueba-0123456789abcdef'
/** Correo que los fixtures limitan de entrada (429 `demasiadas_solicitudes`). */
export const CORREO_LIMITADO_FIXTURE = 'limite@argos.test'

/** Unidad por recuperar con intentos (la 5 de `inventario/equipos.ts`). */
export const UNIDAD_CON_INTENTOS = 5

function configEquiposVacia(empresaId: number): Schema<'ConfigEquipos'> {
    return {
        empresa_id: empresaId,
        activo: false,
        smartolt: { url: null, token: null, probado_en: null, prueba_ok: null, prueba_error: null },
        genieacs: { url: null, usuario: null, clave: null, ca: false, probado_en: null, prueba_ok: null, prueba_error: null },
        pppoe_por_acs: false,
        perfiles: [],
        capacidades: { ftth: false, wireless: false, tr069: false },
        version: 0,
    }
}

export { configEquiposVacia }

export function operacionPmInicial(): OperacionPmFixtures {
    return {
        ajustesGlobal: {},
        ajustesEmpresa: {},
        ajustesCobro: {},
        panelFinanciero: {},
        correosExternos: [
            { id: 1, correo: 'contador@despachomm.gt', nombre: 'Despacho Morales & Asociados', activo: true, aprobado_por: 1, aprobado_en: '2026-10-03T15:00:00.000Z', retirado_por: null, retirado_en: null, version: 1 },
            { id: 2, correo: 'gerencia@argosnet.gt', nombre: 'Gerencia (cuenta compartida)', activo: false, aprobado_por: 1, aprobado_en: '2026-08-12T15:00:00.000Z', retirado_por: 1, retirado_en: '2026-11-14T15:00:00.000Z', version: 2 },
        ],
        envios: [
            {
                id: 1, empresa_id: 1, nombre: 'Cartera vencida por zona', reporte: 'cartera-vencida', filtros: { agrupar: 'zona' }, formato: 'xlsx', frecuencia: 'semanal', dia: 1, hora: 7, activo: true,
                proximo_en: '2026-11-30T13:00:00.000Z', ultimo_envio_en: '2026-11-23T13:00:00.000Z', creado_por: 1,
                destinatarios: [
                    { id: 1, tipo: 'usuario', usuario_id: 1, correo_externo_id: null, nombre: 'Ana Administradora', correo: 'admin@argos.test', retirado: false },
                    { id: 2, tipo: 'correo_externo', usuario_id: null, correo_externo_id: 2, nombre: 'Gerencia (cuenta compartida)', correo: 'gerencia@argosnet.gt', retirado: true },
                ],
                version: 1, created_at: '2026-10-01T15:00:00.000Z', updated_at: '2026-10-01T15:00:00.000Z',
            },
            {
                id: 2, empresa_id: 1, nombre: 'Cobranza diaria', reporte: 'cobranza-diaria', filtros: {}, formato: 'pdf', frecuencia: 'diaria', dia: null, hora: 19, activo: true,
                proximo_en: '2026-11-24T01:00:00.000Z', ultimo_envio_en: '2026-11-23T01:00:00.000Z', creado_por: 1,
                destinatarios: [{ id: 3, tipo: 'usuario', usuario_id: 1, correo_externo_id: null, nombre: 'Ana Administradora', correo: 'admin@argos.test', retirado: false }],
                version: 1, created_at: '2026-10-01T15:00:00.000Z', updated_at: '2026-10-01T15:00:00.000Z',
            },
            {
                id: 3, empresa_id: null, nombre: 'Ingresos del mes', reporte: 'ingresos', filtros: {}, formato: 'pdf', frecuencia: 'mensual', dia: 5, hora: 8, activo: true,
                proximo_en: '2026-12-05T14:00:00.000Z', ultimo_envio_en: '2026-11-05T14:00:00.000Z', creado_por: 1,
                destinatarios: [{ id: 4, tipo: 'correo_externo', usuario_id: null, correo_externo_id: 1, nombre: 'Despacho Morales & Asociados', correo: 'contador@despachomm.gt', retirado: false }],
                version: 1, created_at: '2026-10-01T15:00:00.000Z', updated_at: '2026-10-01T15:00:00.000Z',
            },
            {
                id: 4, empresa_id: 1, nombre: 'Bajas del mes', reporte: 'altas-bajas', filtros: {}, formato: 'csv', frecuencia: 'mensual', dia: 1, hora: 7, activo: false,
                proximo_en: '2026-12-01T13:00:00.000Z', ultimo_envio_en: null, creado_por: 1,
                destinatarios: [{ id: 5, tipo: 'usuario', usuario_id: 1, correo_externo_id: null, nombre: 'Ana Administradora', correo: 'admin@argos.test', retirado: false }],
                version: 2, created_at: '2026-10-01T15:00:00.000Z', updated_at: '2026-11-02T15:00:00.000Z',
            },
        ],
        corridasEnvios: [
            {
                id: 3, envio_id: 1, programado_para: '2026-11-16T13:00:00.000Z', enviados: 1, omitidos: 1, fallidos: 0, created_at: '2026-11-16T13:00:04.000Z',
                resultados: [
                    { destinatario_id: 1, tipo: 'usuario', usuario_id: 1, correo_externo_id: null, estado: 'enviado', motivo: null, detalle: null },
                    { destinatario_id: 2, tipo: 'correo_externo', usuario_id: null, correo_externo_id: 2, estado: 'omitido', motivo: 'correo_retirado', detalle: null },
                ],
            },
            {
                id: 2, envio_id: 1, programado_para: '2026-11-09T13:00:00.000Z', enviados: 2, omitidos: 0, fallidos: 0, created_at: '2026-11-09T13:00:03.000Z',
                resultados: [
                    { destinatario_id: 1, tipo: 'usuario', usuario_id: 1, correo_externo_id: null, estado: 'enviado', motivo: null, detalle: null },
                    { destinatario_id: 2, tipo: 'correo_externo', usuario_id: null, correo_externo_id: 2, estado: 'enviado', motivo: null, detalle: null },
                ],
            },
            {
                id: 1, envio_id: 1, programado_para: '2026-11-02T13:00:00.000Z', enviados: 1, omitidos: 0, fallidos: 1, created_at: '2026-11-02T13:00:05.000Z',
                resultados: [
                    { destinatario_id: 1, tipo: 'usuario', usuario_id: 1, correo_externo_id: null, estado: 'enviado', motivo: null, detalle: null },
                    { destinatario_id: 2, tipo: 'correo_externo', usuario_id: null, correo_externo_id: 2, estado: 'fallido', motivo: 'error_envio', detalle: 'El servidor de correo no respondió' },
                ],
            },
        ],
        bancosMeta: {},
        bancosOcultos: { 1: [] },
        equipos: {},
        secretosEquipos: {},
        enlaces: { [TOKEN_RECUPERACION_FIXTURE]: 1 },
        solicitudes: { [CORREO_LIMITADO_FIXTURE]: 99 },
        verificaciones: {
            1: { verificacion: 'verificado', motivo: null, verificado_en: '2026-11-08T16:40:00.000Z', consultas: 1, decidido_por: null, decidido_en: null, motivo_decision: null },
            2: { verificacion: 'anterior', motivo: null, verificado_en: null, consultas: 0, decidido_por: null, decidido_en: null, motivo_decision: null },
        },
        vinculos: [
            { id: 1, empresa_id: 1, iris_usuario_id: 'iris-u-118', iris_tecnico_id: 'tec-118', id_externo: 'TEC-018', usuario_id: null, usuario_nombre: null, estado: 'rechazado', motivo: 'id_externo_en_uso', version: 1, origen: 'webhook', reevaluar_en: null, updated_at: '2026-11-23T14:12:00.000Z' },
            { id: 2, empresa_id: 1, iris_usuario_id: 'iris-u-131', iris_tecnico_id: 'tec-131', id_externo: 'TEC-031', usuario_id: 2, usuario_nombre: 'Carlos Cajero', estado: 'rechazado', motivo: 'no_es_tecnico', version: 1, origen: 'webhook', reevaluar_en: null, updated_at: '2026-11-22T23:40:00.000Z' },
            { id: 3, empresa_id: 1, iris_usuario_id: 'iris-15', iris_tecnico_id: 'tec-15', id_externo: '4', usuario_id: 4, usuario_nombre: 'Pedro Técnico', estado: 'vinculado', motivo: null, version: 2, origen: 'webhook', reevaluar_en: null, updated_at: '2026-11-01T15:00:00.000Z' },
            { id: 4, empresa_id: 1, iris_usuario_id: 'iris-u-090', iris_tecnico_id: 'tec-090', id_externo: 'TEC-009', usuario_id: null, usuario_nombre: null, estado: 'desvinculado', motivo: 'desactivado', version: 3, origen: 'conciliacion', reevaluar_en: null, updated_at: '2026-10-20T15:00:00.000Z' },
        ],
    }
}
