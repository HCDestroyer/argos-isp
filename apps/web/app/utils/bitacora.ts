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
    'servicios.activar_instalacion': 'Instalación activada',
    'servicios.desconectar': 'Sesión PPPoE desconectada',
    'servicios.ver_credenciales': 'Credenciales PPPoE consultadas',
    'servicios.cambiar_empresa': 'Servicio pasado a otra empresa',
    'servicios.evaluar_estado': 'Estado del servicio evaluado',
    'servicios.corte': 'Corte automático ejecutado',
    'servicios.programar_plan_temporal': 'Plan temporal programado',
    'servicios.iniciar_plan_temporal': 'Plan temporal iniciado',
    'servicios.terminar_plan_temporal': 'Plan temporal terminado',
    'servicios.cancelar_plan_temporal': 'Plan temporal cancelado',
    // Anuncios del portal (A5, `contratos/anuncios.md`).
    'anuncios.crear': 'Anuncio creado',
    'anuncios.editar': 'Anuncio editado',
    'anuncios.cambiar_imagen': 'Imagen del anuncio cambiada',
    'anuncios.publicar': 'Anuncio publicado',
    'anuncios.archivar': 'Anuncio archivado',
    'anuncios.registrar_evento': 'Vista o clic de un anuncio en el portal (solo si falló)',
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
    'plantillas.retirar': 'Plantilla de facturación retirada',
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
    // Localización fiscal, fase 4 (A3): cobros, bancos y cartera
    'cobros.crear_proveedor': 'Proveedor de cobro creado',
    'cobros.editar_proveedor': 'Proveedor de cobro editado',
    'cobros.liquidar': 'Liquidación de cobros registrada',
    'cajas.depositar': 'Depósito de caja al banco',
    'bancos.trasladar': 'Traslado entre cuentas bancarias',
    'bancos.importar_extracto': 'Extracto bancario importado',
    'bancos.conciliar': 'Línea del extracto conciliada',
    'bancos.anular_conciliacion': 'Conciliación bancaria deshecha',
    'bancos.reatribuir_llegada': 'Llegada al banco reatribuida',
    'bancos.registrar_desde_extracto': 'Partida del extracto registrada',
    'bancos.crear_regla': 'Regla de conciliación creada',
    'bancos.editar_regla': 'Regla de conciliación editada',
    'bancos.aplicar_reglas': 'Reglas de conciliación aplicadas',
    'pagos.cerrar_diferencia': 'Diferencia de cobro cerrada',
    'cartera.provisionar': 'Estimación de incobrables registrada',
    'cartera.castigar': 'Cartera castigada',
    // Localización fiscal, fase 5 (A3): proveedores, compras, retenciones, activos y diferidos
    'proveedores.crear': 'Proveedor creado',
    'proveedores.editar': 'Proveedor editado',
    'compras.registrar': 'Compra registrada',
    'compras.registrar_desde_egreso': 'Compra registrada desde un egreso',
    'compras.anular': 'Compra anulada',
    'compras.registrar_constancia': 'Constancia de retención emitida registrada',
    'compras.pagar': 'Pago a proveedor registrado',
    'compras.anular_pago': 'Pago a proveedor anulado',
    'activos.registrar': 'Activo fijo dado de alta',
    'activos.depreciar': 'Depreciación registrada',
    'activos.dar_de_baja': 'Activo fijo dado de baja',
    'libro.registrar_diferimiento': 'Diferimiento registrado',
    'libro.amortizar_diferidos': 'Cuotas de diferidos registradas',
    'empresa.editar': 'Datos de la empresa editados',
    'campos_personalizados.crear': 'Campo personalizado creado',
    'campos_personalizados.editar': 'Campo personalizado editado',
    'campos_personalizados.desactivar': 'Campo personalizado desactivado',
    'campos_personalizados.activar': 'Campo personalizado activado',
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
    'fiscal.agregar_feriado': 'Feriado agregado o retirado',
    'declaraciones.calcular': 'Declaración calculada',
    'declaraciones.revisar': 'Declaración revisada y liquidada',
    'declaraciones.presentar': 'Declaración marcada como presentada',
    'declaraciones.pagar': 'Pago de la declaración registrado',
    'declaraciones.anular_pago': 'Pago de la declaración anulado',
    'declaraciones.ajustar': 'Ajuste fiscal del ISR registrado o anulado',
    'fiscal.generar_calendario': 'Calendario fiscal generado',
    'fiscal.emitir_alertas': 'Alertas de vencimientos fiscales revisadas',
    'fiscal.ocultar_consejo': 'Consejo fiscal ocultado o mostrado',
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
    'facturas.emitir_cargo_unico': 'Cargo único emitido',
    'conceptos_cargo.crear': 'Concepto de cargo creado',
    'conceptos_cargo.editar': 'Concepto de cargo editado',
    'motivos_sin_costo.crear': 'Motivo sin costo creado',
    'motivos_sin_costo.editar': 'Motivo sin costo editado',
    'facturas.anular_nota_credito': 'Nota de crédito anulada (NCRE rechazada)',
    'fiscal.crear_establecimiento': 'Establecimiento creado',
    'fiscal.editar_establecimiento': 'Establecimiento editado',
    'facturas.importar_pendiente': 'Aviso de cobro importado',
    'importacion.archivar': 'Filas del sistema anterior archivadas',
    'facturas.registrar_saldo_inicial': 'Saldo inicial registrado',
    'ipv6.crear': 'Bloque IPv6 creado',
    'lealtad.crear_programa': 'Programa de lealtad creado',
    'lealtad.editar_programa': 'Programa de lealtad editado',
    'lealtad.activar_programa': 'Programa de lealtad activado',
    'lealtad.desactivar_programa': 'Programa de lealtad desactivado',
    'lealtad.crear_regla': 'Regla de lealtad creada',
    'lealtad.editar_regla': 'Regla de lealtad editada',
    'lealtad.ajustar': 'Puntos ajustados a mano',
    'lealtad.evaluar_evento': 'Puntos de lealtad evaluados',
    'lealtad.otorgar_antiguedad': 'Puntos por antigüedad otorgados',
    'lealtad.vencer': 'Puntos vencidos y avisos de vencimiento',
    'sorteos.crear': 'Sorteo creado',
    'sorteos.editar': 'Sorteo editado',
    'sorteos.publicar_bases': 'Bases del sorteo publicadas',
    'sorteos.abrir': 'Participación del sorteo abierta',
    'sorteos.cerrar_corte': 'Corte del sorteo cerrado',
    'sorteos.cancelar': 'Sorteo cancelado',
    'sorteos.marcar_requisito': 'Requisito del sorteo marcado',
    'sorteos.ejecutar': 'Sorteo ejecutado',
    'sorteos.entregar': 'Premio de sorteo entregado',
    'sorteos.anular_entrega': 'Entrega de premio de sorteo anulada',
    'sorteos.cambiar_aviso_portal': 'Aviso del sorteo en el portal cambiado',
    'sorteos.subir_archivo': 'Archivo de sorteo subido',
    'sorteos.subir_imagen_premio': 'Imagen de premio de sorteo subida',
    'sorteos.notificar_ganadores': 'Ganadores del sorteo notificados',
    'sorteos.marcar_no_reclamado': 'Premio de sorteo no reclamado',
    'sorteos.cerrar_acta': 'Acta del sorteo cerrada',
    'lealtad.rechazar_referido': 'Referido rechazado',
    'lealtad.crear_premio': 'Premio de lealtad creado',
    'lealtad.editar_premio': 'Premio de lealtad editado',
    'lealtad.canjear': 'Puntos canjeados',
    'lealtad.revertir_canje': 'Canje de puntos revertido',
    'libro.bloquear': 'Libro bloqueado hasta una fecha',
    'libro.bloquear_duro': 'Bloqueo duro del libro',
    'libro.desbloquear': 'Bloqueo del libro movido hacia atrás',
    'libro.excepcion_bloqueo': 'Excepción de bloqueo creada o revocada',
    'libro.cerrar_periodo': 'Periodo contable cerrado',
    'libro.cerrar_ejercicio': 'Ejercicio anual cerrado',
    'libro.cerrar_apertura': 'Saldos de apertura cerrados',
    'libro.reabrir_ejercicio': 'Ejercicio anual reabierto',
    'cierres.verificar': 'Lista de verificación de cierre corrida',
    'cierres.revisar_check': 'Check de cierre supervisado o reabierto',
    'libro.reabrir_periodo': 'Periodo contable reabierto',
    'libro.sellar': 'Asientos sellados en la cadena de hash',
    'libro.verificar_integridad': 'Integridad del libro verificada',
    'libros.emitir': 'Libro legal emitido con folio',
    'libros.habilitar': 'Folios de un libro habilitados',
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
    'horus.generar_token': 'Token de integración Horus generado',
    'horus.revocar_token': 'Token de integración Horus revocado',
    'horus.configurar': 'Conector con Horus guardado',
    'horus.probar': 'Prueba de conexión con Horus',
    'horus.abrir': 'Abierto en Horus (autologin)',
    'horus.generar_enlace': 'Enlace de conexión con Horus generado',
    'horus.canjear_enlace': 'Horus se conectó con el enlace de Argos',
    'iris.generar_token': 'Token de integración Iris generado',
    'iris.revocar_token': 'Token de integración Iris revocado',
    'iris.configurar': 'Conector con Iris guardado',
    'iris.abrir': 'Abierto en Iris (autologin)',
    'iris.generar_enlace': 'Enlace de conexión con Iris generado',
    'iris.canjear_enlace': 'Iris se conectó con el enlace de Argos',
    'horus.conectar_enlace': 'Conectado con un enlace de Horus',
    'horus.recibir_webhook': 'Aviso de Horus recibido',
    'nodos_portal.crear': 'Nodo portal creado',
    'nodos_portal.revocar': 'Nodo portal revocado',
    'adicionales.crear': 'Servicio adicional creado',
    'adicionales.editar': 'Servicio adicional editado',
    'adicionales.desactivar': 'Servicio adicional desactivado',
    'adicionales.crear_motivo': 'Motivo de cortesía creado',
    'adicionales.desactivar_motivo': 'Motivo de cortesía desactivado',
    'servicios.agregar_adicional': 'Adicional agregado al servicio',
    'servicios.editar_adicional': 'Adicional del servicio editado',
    'servicios.quitar_adicional': 'Adicional quitado del servicio',
    'servicios.ver_credencial_adicional': 'Credencial de adicional consultada',
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
    'routeros.sondear': 'Sondeo de routers con fallas',
    'routers.cambiar_control_velocidad': 'Modo de colas del router cambiado',
    'routers.marcar_migrado': 'Fecha de migración al nuevo RADIUS marcada',
    'sesiones.completar_prefijo': 'Prefijo IPv6 de la sesión completado',
    'sesiones.desconectar': 'Desconexión de sesión solicitada',
    // Inventario (A3)
    'bodegas.crear': 'Bodega creada',
    'bodegas.editar': 'Bodega editada',
    'bodegas.desactivar': 'Bodega desactivada',
    'productos.crear': 'Producto creado',
    'productos.editar': 'Producto editado',
    'productos.desactivar': 'Producto desactivado',
    'inventario.cargar_saldo_inicial': 'Saldo inicial de inventario cargado',
    'inventario.ajustar': 'Inventario ajustado',
    'inventario.trasladar': 'Traslado entre bodegas',
    'inventario.consumir': 'Material consumido',
    'inventario.dar_de_baja': 'Equipo dado de baja',
    'inventario.marcar_reparada': 'Equipo marcado como reparado',
    'inventario.asignar_comodato': 'Equipo en comodato asignado',
    'inventario.devolver_comodato': 'Equipo en comodato devuelto',
    'inventario.declarar_perdida_comodato': 'Equipo en comodato declarado perdido',
    'inventario.revisar_comodatos': 'Comodatos revisados',
    'inventario.abrir_conteo': 'Conteo de inventario abierto',
    'inventario.contar': 'Conteo registrado',
    'inventario.cerrar_conteo': 'Conteo de inventario cerrado',
    'inventario.cancelar_conteo': 'Conteo de inventario cancelado',
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
    activar_instalacion: 'i-lucide-hard-hat',
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
    campo_personalizado: { etiqueta: 'Campo personalizado', ruta: id => `/campos-personalizados?campo=${id}` },
    cliente: { etiqueta: 'Cliente', ruta: id => `/clientes/${id}` },
    servicio: { etiqueta: 'Servicio', ruta: id => `/servicios/${id}` },
    factura: { etiqueta: 'Factura', ruta: id => `/facturas/${id}` },
    pago: { etiqueta: 'Pago', ruta: id => `/pagos/${id}` },
    promesa: { etiqueta: 'Promesa' },
    caja: { etiqueta: 'Caja', ruta: id => `/caja?caja=${id}` },
    asiento: { etiqueta: 'Asiento' },
    sesion: { etiqueta: 'Sesión PPPoE' },
    plan: { etiqueta: 'Plan', ruta: id => `/planes/${id}` },
    plan_router: { etiqueta: 'Plan en router' },
    plantilla_facturacion: { etiqueta: 'Plantilla de facturación' },
    concepto_cargo: { etiqueta: 'Concepto de cargo único' },
    bonificacion: { etiqueta: 'Bonificación', ruta: id => `/bonificaciones/${id}` },
    motivo_sin_costo: { etiqueta: 'Motivo de factura en Q0' },
    plantilla_notificacion: { etiqueta: 'Plantilla de notificación' },
    recordatorio: { etiqueta: 'Recordatorio' },
    envio: { etiqueta: 'Envío de notificación' },
    router: { etiqueta: 'Router' },
    zona: { etiqueta: 'Zona' },
    usuario: { etiqueta: 'Usuario' },
    rol: { etiqueta: 'Rol' },
    token_api: { etiqueta: 'Token de API' },
    programa_lealtad: { etiqueta: 'Programa de lealtad' },
    regla_lealtad: { etiqueta: 'Regla de lealtad' },
    referido_lealtad: { etiqueta: 'Referido' },
    premio_lealtad: { etiqueta: 'Premio de lealtad' },
    canje_lealtad: { etiqueta: 'Canje de puntos' },
    sorteo: { etiqueta: 'Sorteo' },
    sorteo_ganador: { etiqueta: 'Ganador de sorteo' },
    sorteo_archivo: { etiqueta: 'Archivo de sorteo' },
    // Mejora de plan temporal (A1, `core.servicios_planes_temporales`): se ve en la ficha del servicio.
    plan_temporal: { etiqueta: 'Plan temporal' },
    anuncio: { etiqueta: 'Anuncio', ruta: id => `/anuncios/${id}` },
    adicional: { etiqueta: 'Adicional', ruta: () => '/adicionales' },
    motivo_cortesia: { etiqueta: 'Motivo de cortesía', ruta: () => '/adicionales/motivos' },
    // Libros legales con folio (A3, fase 6 PR D).
    libro_emision: { etiqueta: 'Emisión de libro legal', ruta: id => `/libros/emisiones?emision=${id}` },
    libro_habilitacion: { etiqueta: 'Habilitación de folios', ruta: () => '/libros/habilitaciones' },
    // Calendario fiscal y feriados (A3, fase 7 PR A).
    obligacion_fiscal: { etiqueta: 'Obligación fiscal', ruta: id => `/fiscal/calendario?obligacion=${id}` },
    feriado: { etiqueta: 'Feriado', ruta: () => '/configuracion/fiscal?pestana=feriados' },
    // Declaraciones de IVA y pequeño contribuyente (A3, fase 7 PR B).
    declaracion: { etiqueta: 'Declaración', ruta: id => `/declaraciones/${id}` },
    ajuste_fiscal: { etiqueta: 'Ajuste fiscal', ruta: () => '/declaraciones/ajustes' },
    cierre_anual: { etiqueta: 'Cierre anual', ruta: () => '/libro?tab=ejercicios' },
    // Consejos fiscales (A3, fase 8 PR C): preferencia de ocultar, en el tablero fiscal.
    consejo_fiscal: { etiqueta: 'Consejo fiscal', ruta: () => '/fiscal/tablero' },
    // Fase 5 (A3): proveedores, compras, pagos a proveedores, activos fijos y diferimientos.
    proveedor: { etiqueta: 'Proveedor', ruta: id => `/proveedores/${id}` },
    compra: { etiqueta: 'Compra', ruta: id => `/compras/${id}` },
    pago_proveedor: { etiqueta: 'Pago a proveedor', ruta: () => '/pagos-proveedores' },
    activo: { etiqueta: 'Activo fijo', ruta: id => `/activos/${id}` },
    diferimiento: { etiqueta: 'Diferido', ruta: id => `/diferimientos/${id}` },
    // Inventario (A3)
    bodega: { etiqueta: 'Bodega', ruta: id => `/inventario?bodega=${id}` },
    producto: { etiqueta: 'Producto', ruta: id => `/inventario/kardex?producto=${id}` },
    movimiento_inventario: { etiqueta: 'Movimiento de inventario' },
    traslado_inventario: { etiqueta: 'Traslado de inventario' },
    conteo_inventario: { etiqueta: 'Conteo de inventario', ruta: id => `/inventario/conteos/${id}` },
    unidad: { etiqueta: 'Equipo (unidad)', ruta: id => `/inventario/unidades?unidad=${id}` },
    unidad_inventario: { etiqueta: 'Equipo (unidad)', ruta: id => `/inventario/unidades?unidad=${id}` },
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
