import type { Schema } from '@argosisp/contracts'

type Accion = Schema<'AccionAuditoria'>

/**
 * Texto legible de cada acción de dominio (`DomainAction.nombre`). Las que no estén aquí se
 * muestran con su nombre técnico, para no esconder nada que la API registre.
 */
const ETIQUETAS_ACCION: Record<string, string> = {
    'auth.login': 'Inicio de sesión',
    'auth.logout': 'Cierre de sesión',
    'clientes.crear': 'Cliente creado',
    'clientes.editar': 'Datos del cliente editados',
    'zonas.crear': 'Zona creada',
    'zonas.editar': 'Zona editada',
    'servicios.crear': 'Servicio creado',
    'servicios.editar': 'Servicio editado',
    'servicios.cambiar_estado': 'Estado del servicio cambiado',
    'servicios.suspender': 'Servicio suspendido',
    'servicios.reactivar': 'Servicio reactivado',
    'servicios.limitar': 'Velocidad limitada',
    'servicios.quitar_limite': 'Límite de velocidad quitado',
    'servicios.retirar': 'Servicio retirado',
    'servicios.desconectar': 'Sesión PPPoE desconectada',
    'servicios.ver_credenciales': 'Credenciales PPPoE consultadas',
    'servicios.cambiar_empresa': 'Servicio pasado a otra empresa',
    'servicios.evaluar_estado': 'Estado del servicio evaluado',
    'servicios.corte': 'Corte automático ejecutado',
    'sesiones.iniciar': 'Sesión PPPoE iniciada',
    'sesiones.actualizar': 'Sesión PPPoE actualizada',
    'sesiones.terminar': 'Sesión PPPoE terminada',
    'sesiones.cerrar_nas': 'Sesiones del router cerradas',
    'sesiones.cerrar_colgadas': 'Sesiones sin accounting cerradas',
    'facturas.emitir': 'Aviso de cobro emitido',
    'facturas.vencer': 'Aviso de cobro vencido',
    'facturas.vencer_pendientes': 'Avisos de cobro vencidos',
    'libro.registrar_asiento': 'Asiento contable registrado',
    'libro.revertir_asiento': 'Asiento contable revertido',
    'usuarios.crear': 'Usuario creado',
    'usuarios.editar': 'Usuario editado',
    'usuarios.asignar_empresas': 'Empresas del usuario asignadas',
    'roles.crear': 'Rol creado',
    'roles.editar': 'Rol editado',
    'tokens.crear': 'Token de API creado',
    'tokens.revocar': 'Token de API revocado',
    'routers.crear': 'Router creado',
    'routers.editar': 'Router editado',
    'routers.exportar_secrets_emergencia': 'Secrets PPPoE de emergencia exportados',
    'redes.crear': 'Red IPv4 creada',
    'planes.crear': 'Plan creado',
    'planes.editar': 'Plan editado',
    'plantillas.crear': 'Plantilla de facturación creada',
    'plantillas.editar': 'Plantilla de facturación editada',
    'facturas.generar': 'Avisos de cobro generados',
    'facturas.anular': 'Aviso de cobro anulado',
    'facturas.nota_credito': 'Nota de crédito emitida',
    'pagos.registrar': 'Pago registrado',
    'pagos.registrar_historico': 'Pago histórico importado',
    'facturas.anular_saldo_inicial': 'Saldo inicial anulado',
    'pagos.anular': 'Pago anulado',
    'promesas.crear': 'Promesa de pago creada',
    'promesas.aprobar': 'Promesa de pago aprobada',
    'promesas.importar': 'Promesa de pago importada',
    'cajas.crear': 'Caja creada',
    'cajas.abrir': 'Turno de caja abierto',
    'cajas.cerrar': 'Turno de caja cerrado',
    'notificaciones.enviar': 'Notificación enviada',
    'notificaciones.programar': 'Notificación programada',
    'notificaciones.recordatorios': 'Recordatorios de pago programados',
    'notificaciones.editar': 'Plantilla de notificación editada',
    'portal.quien_soy': 'Consulta desde la página de corte',
    'portal.estado': 'Consulta del estado desde el portal',
    // Semana 3: el resto de acciones que declara la API (`apps/api/app/**/actions`). La prueba
    // `tests/nuxt/fallosCapturas.test.ts` falla si aparece una acción nueva sin texto.
    'aaa.registrar_caida': 'Servidor RADIUS caído',
    'aaa.registrar_recuperacion': 'Servidor RADIUS recuperado',
    'auditoria.crear_particiones': 'Particiones de auditoría creadas',
    'billing.resumenes': 'Resúmenes de facturación calculados',
    'clientes.asignar_responsable_pago': 'Responsable de pago asignado',
    'clientes.quitar_responsable_pago': 'Responsable de pago quitado',
    'clientes.vincular_telegram': 'Telegram vinculado',
    'clientes.desvincular_telegram': 'Telegram desvinculado',
    'comprobantes.registrar': 'Comprobante de depósito recibido',
    'comprobantes.aprobar': 'Comprobante de depósito aprobado',
    'comprobantes.rechazar': 'Comprobante de depósito rechazado',
    'cuentas_bancarias.crear': 'Cuenta bancaria creada',
    'cuentas_bancarias.editar': 'Cuenta bancaria editada',
    'documentos.editar': 'Plantilla de documento editada',
    'egresos.registrar': 'Egreso registrado',
    'egresos.anular': 'Egreso anulado',
    'empresa.editar': 'Datos de la empresa editados',
    'empresas.crear': 'Empresa creada',
    'empresas.editar': 'Empresa editada',
    'empresas.desactivar': 'Empresa desactivada',
    'empresas.cambiar_logo': 'Logo de la empresa cambiado',
    'empresas.cambiar_pais': 'País de la empresa cambiado',
    'fiscal.instalar': 'Localización fiscal instalada',
    'fiscal.editar_parametros': 'Parámetros fiscales editados',
    'fiscal.editar_impuesto': 'Impuesto editado',
    'fiscal.cambiar_regimen': 'Régimen fiscal cambiado',
    'fiscal.agregar_frase': 'Frase fiscal agregada',
    'fel.configurar': 'Configuración FEL cambiada',
    'fel.guardar_credenciales': 'Credenciales FEL guardadas',
    'fel.probar_credenciales': 'Credenciales FEL probadas',
    'fel.contingencia': 'Contingencia FEL cambiada',
    'fel.certificar': 'Certificación FEL pedida',
    'fel.certificar_lote': 'Certificación FEL pedida en lote',
    'fel.certificar_dte': 'DTE enviado al certificador',
    'fel.anular_dte': 'Anulación de DTE enviada al certificador',
    'fel.reintentar': 'DTE reintentado',
    'facturas.confirmar_emision': 'Factura emitida al certificarse',
    'facturas.sustituir': 'Factura sustituida',
    'fiscal.crear_establecimiento': 'Establecimiento creado',
    'fiscal.editar_establecimiento': 'Establecimiento editado',
    'facturas.importar_pendiente': 'Aviso de cobro importado',
    'importacion.archivar': 'Filas del sistema anterior archivadas',
    'facturas.registrar_saldo_inicial': 'Saldo inicial registrado',
    'ipv6.crear': 'Bloque IPv6 creado',
    'libro.cerrar_periodo': 'Periodo contable cerrado',
    'libro.reabrir_periodo': 'Periodo contable reabierto',
    'libro.sellar': 'Asientos sellados en la cadena de hash',
    'libro.verificar_integridad': 'Integridad del libro verificada',
    'notificaciones.alertar': 'Alerta al equipo enviada',
    'notificaciones.telegram_codigo': 'Código de Telegram generado',
    'notificaciones.telegram_vincular': 'Telegram vinculado por el bot',
    'notificaciones.telegram_anular_codigos': 'Códigos de Telegram anulados',
    'notificaciones.enviar_directo': 'Mensaje directo enviado',
    'notificaciones.vigilar_crons': 'Revisión de tareas automáticas',
    'notificaciones.configurar': 'Configuración de notificaciones (correo y Telegram) guardada',
    'notificaciones.probar': 'Prueba de envío de notificaciones',
    'notificaciones.telegram_desvincular': 'Telegram desvinculado de un bot',
    'auth.sso_canjear': 'Entrada desde Horus (autologin)',
    'auth.sso_vincular': 'Cuenta vinculada con Horus',
    'integraciones.generar_token': 'Token de integración Horus generado',
    'integraciones.revocar_token': 'Token de integración Horus revocado',
    'ip.resolver': 'IPs consultadas por Horus',
    'sso.emitir': 'Ticket de autologin emitido para Horus',
    'vinculaciones.quitar': 'Vinculación con otro sistema quitada',
    'vinculaciones.revocar': 'Vinculaciones con otro sistema revocadas',
    'notificaciones.sembrar_configuracion': 'Configuración de notificaciones tomada del entorno',
    'pasarela.crear_cobro': 'Cobro en línea creado',
    'pasarela.procesar_webhook': 'Aviso de la pasarela de pago procesado',
    'pasarela.conciliar': 'Pasarela de pago conciliada',
    'portal.solicitar_codigo': 'Código de acceso al portal solicitado',
    'portal.verificar_codigo': 'Acceso al portal verificado',
    'portal.cerrar_sesion': 'Sesión del portal cerrada',
    'portal.editar_contacto': 'Contacto editado desde el portal',
    'portal.desvincular_telegram': 'Telegram desvinculado desde el portal',
    'promesas.rechazar': 'Promesa de pago rechazada',
    'promesas.cancelar': 'Promesa de pago cancelada',
    'promesas.cumplir': 'Promesa de pago cumplida',
    'promesas.incumplir': 'Promesa de pago incumplida',
    'promesas.incumplir_vencidas': 'Promesas vencidas marcadas incumplidas',
    'promesas.revisar_cliente': 'Promesas del cliente revisadas',
    'routeros.aplicar_servicio': 'Servicio aplicado en el router',
    'routeros.cambiar_control': 'Modo de colas aplicado en el router',
    'routeros.reconciliar': 'Router reconciliado',
    'routers.cambiar_control_velocidad': 'Modo de colas del router cambiado',
    'routers.marcar_migrado': 'Fecha de migración al nuevo RADIUS marcada',
    'sesiones.completar_prefijo': 'Prefijo IPv6 de la sesión completado',
    'sesiones.desconectar': 'Desconexión de sesión solicitada',
}

/** Todas las acciones con texto propio (para comprobar que ninguna de la API queda sin traducir). */
export const ACCIONES_TRADUCIDAS: ReadonlySet<string> = new Set(Object.keys(ETIQUETAS_ACCION))

/**
 * Lecturas que la API audita pero que no cuentan la historia del cliente: cada visita a la
 * página de corte (`/corte`) registra un `portal.quien_soy`. La línea de tiempo las oculta;
 * la bitácora completa las sigue mostrando.
 */
const LECTURAS_OCULTAS = new Set(['portal.quien_soy', 'portal.estado'])

/**
 * Acciones manuales que ejecutan `servicios.cambiar_estado` anidada (misma transacción, mismo
 * `request_id`): la bitácora guarda las dos y la línea de tiempo mostraba el cambio dos veces.
 */
const TRANSICIONES_MANUALES = new Set([
    'servicios.suspender',
    'servicios.reactivar',
    'servicios.limitar',
    'servicios.quitar_limite',
    'servicios.retirar',
])

/** Canales de `ContextoAccion` (`apps/api/app/shared/contexto.ts`). */
const CANALES: Record<string, string> = {
    panel: 'Panel',
    portal: 'Portal',
    api: 'API',
    ia: 'Agente de IA',
    cron: 'Automático',
    worker: 'Automático',
    webhook: 'Webhook',
    interno: 'Interno',
    consola: 'Consola',
}

const ICONOS_ACCION: Record<string, string> = {
    crear: 'i-lucide-plus',
    editar: 'i-lucide-pencil',
    suspender: 'i-lucide-circle-x',
    reactivar: 'i-lucide-circle-check',
    limitar: 'i-lucide-gauge',
    quitar_limite: 'i-lucide-gauge',
    retirar: 'i-lucide-archive',
    desconectar: 'i-lucide-unplug',
    registrar: 'i-lucide-banknote',
    anular: 'i-lucide-ban',
    aprobar: 'i-lucide-check',
    ver_credenciales: 'i-lucide-key-round',
    evaluar_estado: 'i-lucide-scale',
    emitir: 'i-lucide-receipt',
    vencer: 'i-lucide-calendar-x',
    vencer_pendientes: 'i-lucide-calendar-x',
    abrir: 'i-lucide-lock-open',
    cerrar: 'i-lucide-lock',
    rechazar: 'i-lucide-x',
    cancelar: 'i-lucide-ban',
    cumplir: 'i-lucide-circle-check',
    incumplir: 'i-lucide-circle-x',
    asignar_responsable_pago: 'i-lucide-user-plus',
    quitar_responsable_pago: 'i-lucide-user-minus',
    vincular_telegram: 'i-lucide-send',
    desvincular_telegram: 'i-lucide-send',
    editar_contacto: 'i-lucide-pencil',
    cerrar_periodo: 'i-lucide-lock',
    reabrir_periodo: 'i-lucide-lock-open',
    cambiar_control_velocidad: 'i-lucide-gauge',
    cambiar_control: 'i-lucide-gauge',
}

const ACTORES: Record<Accion['actor_tipo'], string> = {
    usuario: 'Usuario',
    token: 'Token de API',
    agente: 'Agente de IA',
    sistema: 'Sistema',
    cliente: 'Cliente (portal)',
}

/** Acciones conocidas para el filtro de la bitácora, ordenadas por nombre técnico. */
export const ACCIONES_CONOCIDAS: { accion: string, etiqueta: string }[] = Object.entries(ETIQUETAS_ACCION)
    .map(([accion, etiqueta]) => ({ accion, etiqueta }))
    .sort((a, b) => a.accion.localeCompare(b.accion))

/** Canales del filtro (`canal` del contrato) con su etiqueta. */
export const CANALES_ACCION = ['panel', 'portal', 'api', 'ia', 'cron', 'worker', 'webhook', 'interno', 'consola'] as const

/** Tipos de entidad que registran las acciones (`t.fijarEntidad`) y dónde se ven en el panel. */
export const ENTIDADES_BITACORA: Record<string, { etiqueta: string, ruta?: (id: number) => string }> = {
    cliente: { etiqueta: 'Cliente', ruta: id => `/clientes/${id}` },
    servicio: { etiqueta: 'Servicio', ruta: id => `/servicios/${id}` },
    factura: { etiqueta: 'Factura', ruta: id => `/facturas/${id}` },
    pago: { etiqueta: 'Pago', ruta: id => `/pagos/${id}` },
    promesa: { etiqueta: 'Promesa' },
    caja: { etiqueta: 'Caja', ruta: id => `/caja?caja=${id}` },
    asiento: { etiqueta: 'Asiento' },
    sesion: { etiqueta: 'Sesión PPPoE' },
    plan: { etiqueta: 'Plan' },
    plan_router: { etiqueta: 'Plan en router' },
    plantilla_facturacion: { etiqueta: 'Plantilla de facturación' },
    plantilla_notificacion: { etiqueta: 'Plantilla de notificación' },
    recordatorio: { etiqueta: 'Recordatorio' },
    envio: { etiqueta: 'Envío de notificación' },
    router: { etiqueta: 'Router' },
    zona: { etiqueta: 'Zona' },
    usuario: { etiqueta: 'Usuario' },
    rol: { etiqueta: 'Rol' },
    token_api: { etiqueta: 'Token de API' },
}

/** Enlace del panel a una entidad de la bitácora, o `null`. */
export function rutaEntidad(tipo: string | null, id: number | null): string | null {
    if (!tipo || id === null) {
        return null
    }
    return ENTIDADES_BITACORA[tipo]?.ruta?.(id) ?? null
}

/**
 * Nombre actual de un campo de `audit.cambios`. Antes del 2026-10-16 la API separaba los dígitos
 * (`string.snakeCase`) y las filas viejas no se reescriben (regla 4): `ipv_4` es `ipv4`,
 * `prefijo_enlace_v_6` es `prefijo_enlace_v6`, `red_ipv_4_id` es `red_ipv4_id`, `pool_ipv_6_enlace`
 * es `pool_ipv6_enlace`… Regla de `apps/api/app/core/README.md`: quitar el `_` antes de un dígito.
 */
export function nombreCampoCambio(campo: string): string {
    return campo.replace(/_(?=\d)/g, '')
}

/**
 * Valor de un campo en el historial de cambios: `***` (dato sensible) tal cual, `null` como
 * "vacío", textos sin comillas y lo demás en JSON.
 */
export function valorCambio(valor: unknown): string {
    if (valor === null || valor === undefined || valor === '') {
        return 'vacío'
    }
    if (typeof valor === 'string') {
        return valor
    }
    return JSON.stringify(valor)
}

/** Entrada o resultado de una acción, en JSON legible. */
export function jsonLegible(valor: unknown): string {
    if (valor === null || valor === undefined) {
        return '—'
    }
    return JSON.stringify(valor, null, 2)
}

/** `servicios.suspender` → `Servicio suspendido`; nombres desconocidos, tal cual. */
export function etiquetaAccion(accion: string): string {
    return ETIQUETAS_ACCION[accion] ?? accion
}

/** Estado destino de `servicios.cambiar_estado` (`entrada.nuevo`), o `null`. */
function estadoDestino(entrada: unknown): EstadoServicio | null {
    if (typeof entrada !== 'object' || entrada === null || !('nuevo' in entrada)) {
        return null
    }
    const { nuevo } = entrada
    return typeof nuevo === 'string' && esEstadoServicio(nuevo) ? nuevo : null
}

/**
 * Título de una entrada. `servicios.cambiar_estado` (corte automático, reactivación por pago)
 * dice a qué estado pasó: "Servicio suspendido", "Servicio activo".
 */
export function tituloAccion(accion: Accion): string {
    if (accion.accion === 'servicios.cambiar_estado') {
        const estado = estadoDestino(accion.entrada)
        if (estado) {
            return `Servicio ${ESTADOS_SERVICIO[estado].etiqueta.toLowerCase()}`
        }
    }
    return etiquetaAccion(accion.accion)
}

/** `false` para las lecturas del portal, que la línea de tiempo del cliente no muestra. */
export function visibleEnLineaTiempo(accion: Accion): boolean {
    return !LECTURAS_OCULTAS.has(accion.accion)
}

/**
 * Quita el `servicios.cambiar_estado` anidado de una acción manual del mismo `request_id` y
 * entidad: "Servicio suspendido" (con su motivo) ya lo cuenta.
 */
export function sinCambiosAnidados(acciones: Accion[]): Accion[] {
    const manuales = new Set(acciones
        .filter(a => a.request_id && TRANSICIONES_MANUALES.has(a.accion))
        .map(a => `${a.request_id}|${a.entidad_tipo}|${a.entidad_id}`))
    return acciones.filter(a => a.accion !== 'servicios.cambiar_estado'
        || !manuales.has(`${a.request_id}|${a.entidad_tipo}|${a.entidad_id}`))
}

/** `cron` → `Automático`; canales desconocidos, tal cual. */
export function etiquetaCanal(canal: string): string {
    return CANALES[canal] ?? canal
}

export function iconoAccion(accion: Accion): string {
    if (accion.resultado === 'error') {
        return 'i-lucide-triangle-alert'
    }
    if (accion.accion === 'servicios.cambiar_estado') {
        const estado = estadoDestino(accion.entrada)
        return estado ? ESTADOS_SERVICIO[estado].icono : 'i-lucide-refresh-cw'
    }
    const verbo = accion.accion.split('.').at(-1) ?? ''
    return ICONOS_ACCION[verbo] ?? 'i-lucide-dot'
}

/**
 * Quién hizo la acción: el nombre (`actor_nombre`) para usuarios, tokens y agentes; "Sistema"
 * para el corte automático y los consumidores de eventos. Sin nombre, el tipo y el id.
 */
export function etiquetaActor(accion: Accion): string {
    if (accion.actor_nombre) {
        return accion.actor_tipo === 'usuario' ? accion.actor_nombre : `${accion.actor_nombre} (${ACTORES[accion.actor_tipo]})`
    }
    const base = ACTORES[accion.actor_tipo]
    return accion.actor_id === null ? base : `${base} #${accion.actor_id}`
}

/** `entrada.motivo` de las acciones que lo piden (suspender, anular…), o `null`. */
export function motivoAccion(accion: Accion): string | null {
    const { entrada } = accion
    if (typeof entrada !== 'object' || entrada === null || !('motivo' in entrada)) {
        return null
    }
    return typeof entrada.motivo === 'string' && entrada.motivo.trim() ? entrada.motivo.trim() : null
}

/** `servicio 12`, o `null` si la acción no tiene entidad. */
export function etiquetaEntidad(accion: Accion): string | null {
    if (!accion.entidad_tipo) {
        return null
    }
    return accion.entidad_id === null ? accion.entidad_tipo : `${accion.entidad_tipo} ${accion.entidad_id}`
}
