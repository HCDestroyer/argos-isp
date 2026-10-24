/**
 * Catálogo de permisos del ACL. Permiso = nombre de la acción (`modulo.verbo`).
 *
 * Cada ruta de `start/routes/*.ts` declara su permiso; el generador de OpenAPI falla si una
 * ruta usa un permiso que no está aquí. El seed (`database/seeders/acl_seeder.ts`) los crea y
 * arma los roles base. El ACL completo (CRUD de roles, alcances, tokens) es de A1.
 */
export const PERMISOS = {
    'clientes.ver': 'Ver y buscar clientes',
    'clientes.crear': 'Crear clientes',
    'clientes.editar': 'Editar datos de clientes',
    'clientes.estado_cuenta': 'Ver el estado de cuenta de un cliente',
    'clientes.vincular_telegram': 'Vincular el chat de Telegram de un cliente',
    'clientes.desvincular_telegram': 'Quitar el chat de Telegram de un cliente',
    'clientes.asignar_responsable_pago': 'Asignar el cliente que paga por otro (responsable de pago)',
    'clientes.quitar_responsable_pago': 'Quitar el responsable de pago de un cliente',
    'zonas.ver': 'Ver zonas',
    'zonas.crear': 'Crear zonas',
    'zonas.editar': 'Editar zonas',
    'campos_personalizados.crear': 'Agregar campos al catálogo de campos personalizados del cliente',
    'campos_personalizados.editar':
        'Editar etiqueta, opciones, orden u obligatoriedad de un campo personalizado',
    'campos_personalizados.desactivar':
        'Desactivar un campo personalizado (no se borra; los valores se conservan)',
    'campos_personalizados.activar': 'Volver a activar un campo personalizado',

    'servicios.ver': 'Ver servicios',
    'servicios.crear': 'Crear servicios',
    'servicios.editar': 'Editar servicios (plan, router, IPs, datos)',
    'servicios.suspender': 'Suspender servicios manualmente',
    'servicios.reactivar': 'Reactivar servicios manualmente',
    'servicios.limitar': 'Limitar la velocidad de servicios',
    'servicios.quitar_limite': 'Quitar el límite de velocidad',
    'servicios.retirar': 'Retirar servicios',
    'servicios.desconectar': 'Desconectar la sesión PPPoE de un servicio',
    'servicios.ver_credenciales': 'Ver la contraseña PPPoE de un servicio (queda auditado)',
    'servicios.cambiar_empresa': 'Pasar un servicio sin saldo pendiente a otra empresa (NIT)',
    'servicios.programar_plan_temporal':
        'Programar un plan temporal (mejora de plan con fecha de fin; lo usa el canje de lealtad)',
    'servicios.cancelar_plan_temporal':
        'Cancelar un plan temporal programado o activo (el servicio vuelve a su plan base)',
    'servicios.agregar_adicional':
        'Agregar un servicio adicional (streaming, IPTV…) a un servicio: incluido o cobrado',
    'servicios.editar_adicional':
        'Editar un adicional de un servicio (modalidad, identificador, credencial, precio)',
    'servicios.quitar_adicional': 'Dar de baja un adicional de un servicio (con fecha; no se borra)',
    'servicios.adicional_cortesia':
        'Dar un adicional de cortesía (sin cobro, con motivo); se exige además de agregar o editar',
    'servicios.ver_credencial_adicional': 'Ver la credencial de un adicional de un servicio (queda auditado)',
    'adicionales.ver': 'Ver el catálogo de servicios adicionales y los motivos de cortesía',
    'adicionales.crear': 'Crear servicios adicionales en el catálogo de la empresa',
    'adicionales.editar': 'Editar servicios adicionales del catálogo',
    'adicionales.desactivar': 'Desactivar un servicio adicional del catálogo (no se borra)',
    'adicionales.crear_motivo': 'Crear motivos de cortesía de la empresa',
    'adicionales.desactivar_motivo': 'Desactivar un motivo de cortesía (no se borra)',

    'routers.ver': 'Ver routers',
    'routers.crear': 'Crear routers',
    'routers.editar': 'Editar routers y sus credenciales',
    'routers.marcar_migrado': 'Marcar cuándo un router pasó al nuevo RADIUS (aaa)',
    'routers.cambiar_control_velocidad':
        'Cambiar el control de velocidad de un router (simple o árbol PCQ); solo admin',
    'redes.ver': 'Ver redes IPv4',
    'redes.crear': 'Crear redes IPv4',
    'ipv6.ver': 'Ver bloques y pools IPv6',
    'ipv6.crear': 'Crear bloques y pools IPv6',
    'planes.ver': 'Ver planes',
    'planes.crear': 'Crear planes',
    'planes.editar': 'Editar planes e implementaciones por router',
    'sesiones.ver': 'Ver sesiones PPPoE',
    'sesiones.desconectar': 'Desconectar sesiones PPPoE',
    'red.ver': 'Ver eventos de red (CoA, Disconnect y comandos a RouterOS con la respuesta del equipo)',
    'ip.resolver': 'Resolver una IP a su servicio',

    'plantillas.ver': 'Ver plantillas de facturación',
    'plantillas.crear': 'Crear plantillas de facturación',
    'plantillas.editar': 'Editar plantillas de facturación',
    'facturas.ver': 'Ver facturas',
    'facturas.generar': 'Generar facturas',
    'facturas.anular': 'Anular facturas',
    'facturas.nota_credito': 'Emitir notas de crédito (parcial o total) sobre el saldo de una factura',
    'facturas.anular_nota_credito':
        'Anular una nota de crédito cuya NCRE rechazó la SAT en definitivo (con el reverso de su asiento)',
    'facturas.sustituir':
        'Sustituir una factura mal emitida (anula o acredita la original y emite otra del mismo periodo)',
    'facturas.emitir_cargo_unico':
        'Emitir una factura manual de cargo único (instalación, equipo, visita técnica…) desde el catálogo de conceptos',
    'facturas.cargo_sin_costo':
        'Emitir un cargo único en Q0 (todo descontado) con su motivo del catálogo (junto con facturas.emitir_cargo_unico)',
    'facturas.configurar_motivos': 'Administrar el catálogo de motivos de facturas en Q0 por empresa',
    'facturas.configurar_conceptos':
        'Administrar el catálogo de conceptos de cargo único por empresa (cuenta de ingreso e IVA)',
    'pagos.ver': 'Ver pagos',
    'pagos.registrar': 'Registrar pagos',
    'pagos.anular': 'Anular pagos',
    'cajas.ver': 'Ver cajas y turnos',
    'cajas.crear': 'Crear cajas de una empresa (multiempresa: cada NIT tiene sus cajas)',
    'cajas.abrir': 'Abrir turno de caja',
    'cajas.cerrar': 'Cerrar turno de caja',
    'cuentas_bancarias.ver': 'Ver las cuentas bancarias propias (destino de depósitos y transferencias)',
    'cuentas_bancarias.editar': 'Crear y editar cuentas bancarias propias',
    'promesas.ver': 'Ver promesas de pago',
    'promesas.crear': 'Crear promesas de pago',
    'promesas.aprobar': 'Aprobar promesas pendientes',
    'promesas.rechazar': 'Rechazar promesas pendientes de aprobación',
    'promesas.cancelar': 'Cancelar promesas activas o pendientes (el servicio se re-evalúa)',
    'comprobantes.ver': 'Ver comprobantes de depósito y su archivo',
    'comprobantes.aprobar': 'Aprobar comprobantes de depósito (registra el pago)',
    'comprobantes.rechazar': 'Rechazar comprobantes de depósito con motivo',
    'libro.ver': 'Ver libro diario, mayor y plan de cuentas',
    'libro.registrar_asiento': 'Registrar asientos manuales de ajuste',
    'libro.revertir_asiento': 'Revertir asientos con un asiento de reverso',
    'libro.cerrar_periodo': 'Cerrar un mes del libro (no admite más asientos con fecha en él)',
    'libro.reabrir_periodo': 'Reabrir un mes cerrado del libro (con motivo)',
    'cierres.verificar': 'Correr la lista de verificación de cierre (checks del mes o del año)',
    'cierres.revisar_check': 'Supervisar con nota un check de cierre en anomalía, o retirar la supervisión',
    'egresos.ver': 'Ver egresos y sus categorías',
    'egresos.registrar': 'Registrar egresos (gastos pagados por caja, banco o cuenta bancaria)',
    'egresos.anular': 'Anular egresos con asiento de reverso',
    'reportes.ver': 'Ver reportes (cartera, ingresos, IVA, cobranza…), exportarlos y el dashboard',
    // Cobros y bancos (localización fiscal §10.3 y §10.9, fase 4; los endpoints son de A3)
    'cobros.configurar':
        'Dar de alta y editar proveedores de cobro (pasarela, agente, débito) con su cuenta puente 1.1.10.NN',
    'cobros.liquidar': 'Registrar la liquidación de un proveedor de cobro (banco neto y comisión)',
    'cajas.depositar': 'Depositar en el banco el efectivo de un turno de caja (queda en fondos en tránsito)',
    'bancos.ver': 'Ver proveedores de cobro, liquidaciones, depósitos, traslados, extractos y conciliaciones',
    'bancos.trasladar': 'Trasladar fondos entre cuentas bancarias propias de la empresa',
    'bancos.importar_extracto': 'Importar extractos bancarios (solo inserción, con detección de duplicados)',
    'bancos.conciliar':
        'Conciliar líneas del extracto con el libro, registrar comisiones del extracto, deshacer conciliaciones y editar reglas',
    'bancos.reatribuir_llegada':
        'Corregir la llegada al banco atribuida al depósito o traslado equivocado (reverso y llegada nueva)',
    'cartera.provisionar': 'Registrar la estimación para cuentas incobrables (hasta el tope legal)',
    'cartera.castigar': 'Castigar facturas incobrables con motivo y evidencia de gestión de cobro',
    'pagos.cerrar_diferencia': 'Cerrar el saldo pequeño que deja un pago (hasta diferencia_cobro_tope)',

    'notificaciones.ver': 'Ver plantillas y envíos de notificaciones',
    'notificaciones.editar': 'Editar plantillas de notificaciones',
    'notificaciones.configurar':
        'Configurar los canales de notificación (correo SMTP, bot de Telegram, interruptores); solo admin',
    'notificaciones.probar':
        'Enviar un mensaje de prueba por correo o Telegram con la configuración guardada',

    'horus.ver':
        'Ver el conector con Horus Flow, sus tokens (sin el valor) y sus datos (consumo, salud y seguridad de los servicios)',
    'horus.configurar':
        'Configurar el conector con Horus Flow (URL, código de conexión, webhooks, enlace de conexión); solo admin',
    'horus.probar': 'Probar la conexión con Horus Flow con la configuración guardada',
    'horus.abrir': 'Abrir un cliente, servicio o router en Horus Flow sin volver a iniciar sesión',

    'empresas.ver': 'Ver las empresas (NIT) de la instalación',
    'empresas.crear': 'Crear empresas (NIT)',
    'empresas.editar': 'Editar los datos fiscales y de contacto de una empresa',
    'empresas.desactivar': 'Desactivar una empresa (no se borra)',
    'empresas.cambiar_logo': 'Subir o quitar el logo de una empresa',
    'empresas.cambiar_pais':
        'Cambiar el país de la localización fiscal de una empresa (solo sin documentos); solo admin',

    // Localización fiscal (`contratos/localizacion-fiscal.md` §10.2); los endpoints son de A3
    'fiscal.ver': 'Ver la localización fiscal, parámetros, régimen, establecimientos y el tablero fiscal',
    'fiscal.configurar': 'Configurar establecimientos, frases y consejos fiscales de la empresa',
    'fiscal.instalar': 'Instalar o actualizar el paquete de localización fiscal de una empresa; solo admin',
    'fiscal.editar_parametros': 'Agregar valores con vigencia a los parámetros fiscales',
    'fiscal.cambiar_regimen': 'Cambiar el régimen tributario de la empresa (con vigencia y aviso a la SAT)',
    'fel.ver': 'Ver la configuración FEL y los DTE (estado, XML y PDF)',
    'fel.configurar': 'Configurar el proveedor FEL, credenciales y modo de emisión; solo admin',
    'fel.certificar': 'Certificar facturas con FEL y reintentar DTE',
    'fel.anular': 'Anular DTE certificados (junto con facturas.anular)',
    'fel.contingencia': 'Activar o desactivar la contingencia FEL',
    'proveedores.ver': 'Ver proveedores',
    'proveedores.editar': 'Crear y editar proveedores',
    'compras.ver': 'Ver compras (libro de compras)',
    'compras.registrar': 'Registrar compras, también desde un egreso',
    'compras.anular': 'Anular compras con asiento de reverso',
    'compras.pagar': 'Registrar y anular pagos a proveedores',
    'activos.ver': 'Ver activos fijos, su depreciación y sus bajas',
    'activos.registrar': 'Dar de alta activos fijos sin compra y registrar la depreciación pendiente',
    'activos.dar_de_baja': 'Dar de baja (venta o retiro) un activo fijo con su asiento',
    'libros.ver': 'Ver los libros legales (vista previa) y sus habilitaciones',
    'libros.emitir': 'Emitir libros legales con folio sobre un periodo bloqueado',
    'libros.habilitar': 'Registrar habilitaciones de folios de libros',
    'libro.cerrar_ejercicio': 'Cerrar el ejercicio anual (resultados a cero y reserva legal)',
    'libro.reabrir_ejercicio': 'Reabrir un ejercicio cerrado (con motivo); solo admin',
    'libro.bloquear': 'Bloquear el libro hasta una fecha (global, ventas, compras o impuestos); solo avanza',
    'libro.bloquear_duro': 'Bloqueo duro del libro (no retrocede); solo admin',
    'libro.desbloquear': 'Mover hacia atrás o quitar un bloqueo global, de ventas o de compras (con motivo)',
    'libro.excepcion_bloqueo': 'Crear y revocar excepciones de bloqueo con fecha de fin; solo admin',
    'declaraciones.ver': 'Ver obligaciones fiscales y borradores de declaraciones',
    'declaraciones.calcular': 'Calcular borradores de declaraciones',
    'declaraciones.revisar': 'Marcar como revisado un borrador de declaración',
    'declaraciones.presentar': 'Marcar una declaración como presentada en la SAT (el sistema no la envía)',
    'declaraciones.pagar': 'Registrar el pago de una declaración',
    'declaraciones.anular_pago': 'Anular el pago de una declaración (reverso de su asiento)',
    'declaraciones.ajustar': 'Registrar o anular ajustes fiscales del ISR (cierre parcial y anual)',
    'empresa.ver': 'Ver la configuración de la empresa (contacto e instrucciones de pago)',
    'empresa.editar': 'Editar la configuración de la empresa (contacto e instrucciones de pago)',
    'documentos.ver': 'Ver plantillas de documentos (aviso de cobro) y sus PDF',
    'documentos.editar': 'Editar plantillas de documentos (aviso de cobro)',
    'anuncios.ver': 'Ver los anuncios del portal y sus métricas (vistas y clics)',
    'anuncios.administrar':
        'Crear, editar, publicar y archivar los anuncios del portal y la página de corte; solo admin',

    // Programa de lealtad (`contratos/lealtad.md` §14); los endpoints son de A3
    'lealtad.ver': 'Ver el programa de lealtad, reglas, premios, puntos de clientes, canjes y referidos',
    'lealtad.configurar': 'Configurar el programa de lealtad de la empresa: activarlo, reglas y premios',
    'lealtad.ajustar': 'Ajustar puntos a mano (con motivo) y rechazar referidos',
    'lealtad.canjear': 'Canjear puntos de un cliente por un premio (panel o caja)',
    'lealtad.revertir_canje':
        'Revertir un canje reservado o aplicado a una factura anulada (devuelve los puntos)',
    'lealtad.entregar': 'Registrar la entrega física de un premio en bienes (con constancia)',
    'sorteos.ver': 'Ver sorteos, sus bases, participantes, resultados y acta',
    'sorteos.gestionar': 'Crear y editar sorteos en borrador',
    'sorteos.publicar': 'Publicar bases, abrir, cerrar el corte o cancelar un sorteo',
    'sorteos.marcar_requisito':
        'Marcar requisitos legales del sorteo con evidencia (DIACO, Gobernación, ISR)',
    'sorteos.exportar': 'Exportar la lista de participantes de un sorteo (CSV o XLSX)',
    'sorteos.ejecutar': 'Ejecutar un sorteo y cerrar su acta (con checklist legal completo)',
    'sorteos.entregar': 'Registrar la entrega de un premio de sorteo o marcarlo no reclamado',

    'bitacora.ver': 'Ver bitácora de acciones y cambios',
    'usuarios.ver': 'Ver usuarios',
    'usuarios.crear': 'Crear usuarios',
    'usuarios.editar': 'Editar usuarios y sus roles',
    'usuarios.asignar_empresas': 'Definir en qué empresas (NIT) trabaja un usuario o darle alcance global',
    'roles.ver': 'Ver roles y permisos',
    'roles.crear': 'Crear roles',
    'roles.editar': 'Editar roles y sus permisos',
    'tokens.ver': 'Ver tokens de API',
    'tokens.crear': 'Crear tokens de API',
    'tokens.revocar': 'Revocar tokens de API',
    'nodos_portal.administrar':
        'Crear, ver y revocar los tokens de los nodos portal remotos (portal del cliente en otro servidor); solo admin',
    'horus.generar_token':
        'Generar el token de una integración (usuario técnico Horus con ip.resolver, clientes.ver y servicios.ver)',
    'horus.revocar_token': 'Revocar el token de una integración',
    'sso.emitir':
        'Pedir un ticket de autologin para un usuario del otro sistema (solo el token de la integración Horus)',
    'vinculaciones.revocar': 'Revocar las vinculaciones de autologin de todos los usuarios o de uno',
} as const satisfies Record<string, string>

export type Permiso = keyof typeof PERMISOS

export const NOMBRES_PERMISOS = Object.keys(PERMISOS).sort() as Permiso[]

export function esPermiso(nombre: string): nombre is Permiso {
    return Object.hasOwn(PERMISOS, nombre)
}

const lectura = NOMBRES_PERMISOS.filter((p) => p.endsWith('.ver'))

/**
 * Permisos nuevos de la localización fiscal (§10.2) y los que `contabilidad` NO recibe (quedan para
 * `admin`): instalar paquetes, configurar FEL, bloqueo duro, reabrir ejercicio y cambiar el país.
 */
const PERMISOS_FISCALES = NOMBRES_PERMISOS.filter(
    (p) =>
        p === 'empresas.cambiar_pais' ||
        /^(fiscal|fel|proveedores|compras|libros|declaraciones|activos)\./.test(p) ||
        /^libro\.(cerrar_ejercicio|reabrir_ejercicio|bloquear|bloquear_duro|desbloquear|excepcion_bloqueo)$/.test(
            p,
        ),
)
const SOLO_ADMIN_FISCAL: readonly Permiso[] = [
    'fiscal.instalar',
    'fel.configurar',
    'libro.bloquear_duro',
    'libro.reabrir_ejercicio',
    'libro.excepcion_bloqueo',
    'empresas.cambiar_pais',
]
export const PERMISOS_FISCALES_CONTABILIDAD = PERMISOS_FISCALES.filter((p) => !SOLO_ADMIN_FISCAL.includes(p))

/**
 * Programa de lealtad (`contratos/lealtad.md` §14): `contabilidad` recibe todos menos
 * `sorteos.ejecutar`; `cajero` y `soporte`, ver y canjear (soporte además ve sorteos).
 */
const PERMISOS_LEALTAD = NOMBRES_PERMISOS.filter((p) => /^(lealtad|sorteos)\./.test(p))
export const PERMISOS_LEALTAD_CONTABILIDAD = PERMISOS_LEALTAD.filter((p) => p !== 'sorteos.ejecutar')

/**
 * Roles base. `admin` tiene todo. `cajero` NO tiene `routers.*` ni `servicios.suspender`.
 */
export const ROLES_BASE: Record<string, { descripcion: string; permisos: readonly Permiso[] }> = {
    admin: {
        descripcion: 'Acceso total',
        permisos: NOMBRES_PERMISOS,
    },
    cajero: {
        descripcion: 'Cobro en caja: pagos, turnos y promesas',
        permisos: [
            'clientes.ver',
            'clientes.estado_cuenta',
            'clientes.asignar_responsable_pago',
            'clientes.quitar_responsable_pago',
            'zonas.ver',
            'servicios.ver',
            'adicionales.ver',
            'planes.ver',
            'facturas.ver',
            'facturas.emitir_cargo_unico',
            'pagos.ver',
            'pagos.registrar',
            'cajas.ver',
            'cajas.abrir',
            'cajas.cerrar',
            'cuentas_bancarias.ver',
            'promesas.ver',
            'promesas.crear',
            'comprobantes.ver',
            'comprobantes.aprobar',
            'comprobantes.rechazar',
            'fel.ver',
            'cajas.depositar',
            'lealtad.ver',
            'lealtad.canjear',
        ],
    },
    soporte: {
        descripcion: 'Atención al cliente y gestión de servicios',
        permisos: [
            'clientes.ver',
            'clientes.crear',
            'clientes.editar',
            'clientes.estado_cuenta',
            'clientes.vincular_telegram',
            'clientes.desvincular_telegram',
            'clientes.asignar_responsable_pago',
            'clientes.quitar_responsable_pago',
            'zonas.ver',
            'servicios.ver',
            'servicios.crear',
            'servicios.editar',
            'servicios.suspender',
            'servicios.reactivar',
            'servicios.limitar',
            'servicios.quitar_limite',
            'servicios.desconectar',
            'servicios.ver_credenciales',
            'servicios.agregar_adicional',
            'servicios.editar_adicional',
            'servicios.quitar_adicional',
            'servicios.ver_credencial_adicional',
            'adicionales.ver',
            'routers.ver',
            'redes.ver',
            'ipv6.ver',
            'planes.ver',
            'plantillas.ver',
            'facturas.ver',
            'facturas.emitir_cargo_unico',
            'pagos.ver',
            'promesas.ver',
            'promesas.crear',
            'sesiones.ver',
            'sesiones.desconectar',
            'red.ver',
            'ip.resolver',
            'bitacora.ver',
            'notificaciones.ver',
            'servicios.programar_plan_temporal',
            'servicios.cancelar_plan_temporal',
            'lealtad.ver',
            'lealtad.canjear',
            'sorteos.ver',
        ],
    },
    tecnico: {
        descripcion: 'Red: routers, IPAM, planes por router, sesiones e instalaciones',
        permisos: [
            'clientes.ver',
            'zonas.ver',
            'servicios.ver',
            'servicios.crear',
            'servicios.editar',
            'servicios.desconectar',
            'servicios.ver_credenciales',
            'servicios.agregar_adicional',
            'servicios.editar_adicional',
            'servicios.quitar_adicional',
            'servicios.ver_credencial_adicional',
            'adicionales.ver',
            'routers.ver',
            'routers.crear',
            'routers.editar',
            'routers.marcar_migrado',
            'redes.ver',
            'redes.crear',
            'ipv6.ver',
            'ipv6.crear',
            'planes.ver',
            'sesiones.ver',
            'sesiones.desconectar',
            'red.ver',
            'ip.resolver',
        ],
    },
    contabilidad: {
        descripcion:
            'Facturación, pagos, libro, cierres y localización fiscal (FEL, compras, libros, declaraciones)',
        permisos: [
            'clientes.ver',
            'clientes.estado_cuenta',
            'zonas.ver',
            'servicios.ver',
            'adicionales.ver',
            'planes.ver',
            'plantillas.ver',
            'plantillas.crear',
            'plantillas.editar',
            'facturas.ver',
            'facturas.generar',
            'facturas.anular',
            'facturas.nota_credito',
            'facturas.sustituir',
            'facturas.anular_nota_credito',
            'facturas.emitir_cargo_unico',
            'facturas.cargo_sin_costo',
            'facturas.configurar_motivos',
            'facturas.configurar_conceptos',
            'pagos.ver',
            'pagos.registrar',
            'pagos.anular',
            'cajas.ver',
            'cajas.crear',
            'cuentas_bancarias.ver',
            'cuentas_bancarias.editar',
            'promesas.ver',
            'promesas.aprobar',
            'promesas.rechazar',
            'promesas.cancelar',
            'comprobantes.ver',
            'comprobantes.aprobar',
            'comprobantes.rechazar',
            'libro.ver',
            'libro.registrar_asiento',
            'libro.revertir_asiento',
            'libro.cerrar_periodo',
            'cierres.verificar',
            'cierres.revisar_check',
            'egresos.ver',
            'egresos.registrar',
            'egresos.anular',
            'reportes.ver',
            'bitacora.ver',
            'cobros.configurar',
            'cobros.liquidar',
            'cajas.depositar',
            'bancos.ver',
            'bancos.trasladar',
            'bancos.importar_extracto',
            'bancos.conciliar',
            'bancos.reatribuir_llegada',
            'cartera.provisionar',
            'cartera.castigar',
            'pagos.cerrar_diferencia',
            ...PERMISOS_FISCALES_CONTABILIDAD,
            ...PERMISOS_LEALTAD_CONTABILIDAD,
        ],
    },
    lectura: {
        descripcion: 'Solo lectura',
        permisos: [...lectura, 'clientes.estado_cuenta'],
    },
}
