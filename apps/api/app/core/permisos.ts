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
    'clientes.verificar_identidad':
        'Verificar la identidad de un cliente (documento, nombre o código) sin ver el dato (contrato Iris 0.6.0 §7.5)',
    'clientes.registrar_identidad':
        'Registrar la identidad del titular (foto del documento, número y nombre; contrato Iris 0.10.0 §3.4.3)',
    'clientes.ver_identidad':
        'Ver la identidad del titular (número y foto del documento); cada vista queda auditada',
    'clientes.verificar_nit':
        'Marcar el NIT de un cliente como verificado (con el documento o la consulta SAT/FEL); solo una persona desde el panel',
    'clientes.restaurar_contrasena_portal':
        'Restaurar la contraseña del portal de un cliente a la de por defecto de la empresa (cierra sus sesiones del portal)',
    'contactos.buscar':
        'Buscar de quién es un número de teléfono y ver los contactos de un cliente, con su rol y permisos (contrato Iris 0.10.0 §3.5)',
    'contactos.gestionar':
        'Crear, editar y quitar contactos de un cliente (familiares, inquilinos, quien está a cargo de sus servicios)',
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
    'servicios.eliminar':
        'Eliminar un servicio que nunca se usó (sin facturas, pagos, sesiones ni otro historial); solo admin',
    'servicios.sincronizar_router':
        'Sincronizar ya un servicio con su MikroTik (cola, address-list, lease y ARP) y ver qué se corrigió',
    'servicios.activar_instalacion':
        'Activar la instalación de un servicio pendiente (lo pasa a activo e inicia la facturación)',
    'servicios.reservar_ip':
        'Reservar en sitio la IP de un servicio pendiente de instalación (IP fija o amarre; vence a los 30 días)',
    'servicios.cambiar_plan_pendiente':
        'Cambiar el plan de un servicio pendiente de instalación a otro plan aplicable (sin factura ni prorrateo)',
    'servicios.completar_datos':
        'Completar antes de activar los datos que faltan del titular (solo los vacíos) y corregir el lugar del servicio',
    'servicios.cambiar_titular':
        'Pasar un servicio pendiente de instalación a otro titular (Argos decide si es un cliente existente por documento y nombre)',
    'servicios.aprobar_titular_empresa':
        'Aprobar un cambio de titular a una empresa que quedó en revisión (representante nuevo o varios candidatos); exige además clientes.ver_identidad',
    'servicios.rechazar_titular_empresa':
        'Rechazar un cambio de titular a una empresa que quedó en revisión; exige además clientes.ver_identidad',
    'servicios.desconectar': 'Desconectar la sesión PPPoE de un servicio',
    'servicios.ver_credenciales': 'Ver la contraseña PPPoE de un servicio (queda auditado)',
    'servicios.cambiar_empresa': 'Pasar un servicio sin saldo pendiente a otra empresa (NIT)',
    'servicios.programar_plan_temporal':
        'Programar un plan temporal (mejora de plan con fecha de fin; lo usa el canje de lealtad)',
    'servicios.cancelar_plan_temporal':
        'Cancelar un plan temporal programado o activo (el servicio vuelve a su plan base)',
    'servicios.generar_codigo_identificacion':
        'Generar el código de un solo uso con el que el cliente se identifica en el portal (vale 15 min de fábrica)',
    'promociones_velocidad.ver': 'Ver las promociones de velocidad y a qué servicios se asignaron',
    'promociones_velocidad.crear':
        'Crear promociones de velocidad (multiplicador o plan destino, por días o franja horaria)',
    'promociones_velocidad.asignar': 'Asignar una promoción de velocidad a servicios',
    'promociones_velocidad.quitar': 'Quitar una promoción de velocidad de un servicio',
    'promociones_velocidad.cancelar': 'Cancelar una promoción de velocidad (vuelve la velocidad del plan)',
    'ajustes_operacion.ver': 'Ver los ajustes de operación (retiro, código de corte, caídas, falla general…)',
    'ajustes_operacion.editar': 'Cambiar los ajustes de operación, globales o por empresa',
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
    'routers.eliminar':
        'Eliminar un router que nunca se usó (sin servicios, sesiones ni comandos enviados); solo admin',
    'routers.marcar_migrado': 'Marcar cuándo un router pasó al nuevo RADIUS (aaa)',
    'routers.cambiar_control_velocidad':
        'Cambiar el control de velocidad de un router o de un plan en él (estrategia por capas); solo admin',
    'routers.unificar_control_velocidad':
        'Quitar las excepciones de velocidad por plan de un router: todos sus planes con el modo del router; solo admin',
    'routers.cambiar_tipo_conexion':
        'Cambiar el tipo de conexión de un router y de todos sus servicios (o unificar los que difieren); solo admin',
    'routers.unir':
        'Unir dos registros del mismo MikroTik: servicios, redes, pools, planes y sesiones pasan al que queda; solo admin',
    'routers.generar_script':
        'Generar el script de conexión del router (WireGuard, usuario de la API, RADIUS); rota su token',
    'routers.rotar_conexion':
        'Rotar la conexión WireGuard de un router (invalida el peer y genera un script nuevo)',
    'routers.conexion_clave': 'Pegar a mano la clave pública WireGuard de un router',
    'routers.probar_conexion':
        'Probar la conexión con un router (túnel, API REST, datos del equipo y RADIUS)',
    'routers.reconciliar': 'Reconciliar ahora la configuración de RouterOS de un router',
    'red_acceso.ver': 'Ver la red de acceso: OLT, puertos PON, VLAN y servidores PPPoE',
    'red_acceso.descubrir': 'Leer del router sus VLAN, servidores PPPoE, perfiles y pools (no escribe)',
    'red_acceso.adoptar':
        'Importar a Argos VLAN y servidores PPPoE que ya existen en el router (sin tocarlo)',
    'red_acceso.tomar_control':
        'Pasar a administrado una VLAN o servidor PPPoE adoptado (Argos lo empieza a escribir en el router)',
    'olts.crear': 'Registrar OLT',
    'olts.editar': 'Editar OLT y sus puertos PON',
    'olts.eliminar': 'Eliminar una OLT sin VLAN asignadas',
    'vlans.crear': 'Crear VLAN administradas por Argos en un router',
    'vlans.editar': 'Editar VLAN de un router',
    'vlans.eliminar': 'Eliminar VLAN sin servidor PPPoE',
    'servidores_pppoe.crear': 'Crear servidores PPPoE administrados por Argos en un router',
    'servidores_pppoe.editar': 'Editar servidores PPPoE de un router',
    'servidores_pppoe.eliminar': 'Eliminar servidores PPPoE sin servicios',
    'redes.ver': 'Ver redes IPv4',
    'redes.crear': 'Crear redes IPv4',
    'redes.editar': 'Editar redes IPv4: nombre, red, gateway, rango y DNS',
    'redes.migrar': 'Pasar redes IPv4 a otro router (con sus servicios, si además tiene servicios.editar)',
    'ipv6.ver': 'Ver bloques y pools IPv6',
    'ipv6.crear': 'Crear bloques y pools IPv6',
    'ipv6.editar': 'Editar bloques y pools IPv6',
    'ipv6.migrar': 'Pasar bloques IPv6 a otro router (con sus servicios, si además tiene servicios.editar)',
    'planes.ver': 'Ver planes',
    'planes.crear': 'Crear planes',
    'planes.editar': 'Editar planes e implementaciones por router',
    'planes.sincronizar':
        'Sincronizar un plan: reescribir RADIUS, CoA de velocidad a las sesiones vivas y reconciliar sus routers',
    'qos.ver': 'Ver los perfiles y clases de QoS (prioridad por protocolo en el árbol)',
    'qos.gestionar':
        'Crear perfiles de QoS, crear, editar, activar y desactivar sus clases y elegir el perfil de un router',
    'sesiones.ver': 'Ver sesiones PPPoE',
    'sesiones.desconectar': 'Desconectar sesiones PPPoE',
    'red.ver': 'Ver eventos de red (CoA, Disconnect y comandos a RouterOS con la respuesta del equipo)',
    'ip.resolver': 'Resolver una IP a su servicio',
    'ip.buscar_historial':
        'Buscar quién tenía una IP en una fecha y hora pasada (servicio, cliente y sesión); cada consulta queda auditada',
    'incidentes_red.leer': 'Ver las fallas generales de red (incidentes) y los servicios afectados',
    'incidentes_red.abrir': 'Abrir a mano un incidente de falla general (con motivo)',
    'incidentes_red.cerrar': 'Cerrar un incidente de falla general',

    'plantillas.ver': 'Ver plantillas de facturación',
    'plantillas.crear': 'Crear plantillas de facturación',
    'plantillas.editar': 'Editar plantillas de facturación',
    'plantillas.retirar':
        'Retirar una plantilla de facturación (sigue con sus servicios; no se asigna a nuevos)',
    'plantillas.asignar_sin_plantilla':
        'Asignar una plantilla de facturación a los servicios vigentes sin plantilla (sin facturar hacia atrás)',
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
    'facturas.emitir_periodos':
        'Emitir a mano facturas de periodos de un servicio: pago por adelantado (hasta 12 periodos futuros) o periodos que el cron no emitió',
    'facturas.emitir_periodo_anterior':
        'Emitir a mano un periodo anterior al inicio del servicio (hasta 24) o a su facturar_desde, con motivo (junto con facturas.emitir_periodos)',
    'facturas.editar_monto_periodo':
        'Cambiar el total calculado de una factura de periodo emitida a mano, con motivo (junto con facturas.emitir_periodos)',
    'facturas.cargo_sin_costo':
        'Emitir un cargo único en Q0 (todo descontado) con su motivo del catálogo (junto con facturas.emitir_cargo_unico)',
    'facturas.leer_origen_iris':
        'Leer una factura de origen Iris por su número o su DTE, sin pagos ni datos del cliente (solo el token de Iris, contrato Iris 0.14.3 §3)',
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
    'comprobantes.registrar':
        'Registrar un comprobante de depósito para revisión de caja (contrato Iris 0.6.0 §7.2)',
    'comprobantes.reconexion_temporal':
        'Pedir la reconexión temporal de un servicio cortado mientras caja revisa su comprobante (contrato Iris 0.6.0 §7.3)',
    'libro.ver': 'Ver libro diario, mayor y plan de cuentas',
    'libro.registrar_asiento': 'Registrar asientos manuales de ajuste',
    'libro.revertir_asiento': 'Revertir asientos con un asiento de reverso',
    'libro.aprobar_asiento':
        'Aprobar el borrador de asiento manual de otro usuario (lo registra en el libro; decisión del PM 10)',
    'libro.rechazar_asiento': 'Rechazar con motivo el borrador de asiento manual de otro usuario',
    'libro.cerrar_periodo': 'Cerrar un mes del libro (no admite más asientos con fecha en él)',
    'libro.reabrir_periodo': 'Reabrir un mes cerrado del libro (con motivo)',
    'cierres.verificar': 'Correr la lista de verificación de cierre (checks del mes o del año)',
    'cierres.revisar_check': 'Supervisar con nota un check de cierre en anomalía, o retirar la supervisión',
    'egresos.ver': 'Ver egresos y sus categorías',
    'egresos.registrar': 'Registrar egresos (gastos pagados por caja, banco o cuenta bancaria)',
    'egresos.anular': 'Anular egresos con asiento de reverso',
    'egresos.registrar_sin_limite':
        'Registrar egresos de cualquier caja, banco o cuenta, sin el tope egreso_cajero_maximo ni motivo obligatorio',
    'reportes.ver': 'Ver reportes (cartera, ingresos, IVA, cobranza…), exportarlos y el dashboard',
    // panel financiero y reportes (A3, decisiones del PM 2, 4, 6 y 12; contratos/reportes.md)
    'panel_financiero.ver':
        'Ver el panel financiero: ingreso mensual recurrente, bajas, ingreso promedio, efectivo (con libro.ver) y alertas',
    'panel_financiero.configurar':
        'Cambiar los ajustes del panel financiero de la empresa (días de suspensión para contar una baja y aviso de pequeño contribuyente)',
    'inicio.configurar_rol': 'Elegir la pantalla de inicio de un rol (panel financiero o día a día)',
    'inicio.configurar_usuario': 'Elegir la pantalla de inicio de otro usuario',
    'reportes.programar_envio':
        'Programar el envío de un reporte por correo a usuarios con permiso o a correos externos aprobados',
    'reportes.editar_envio': 'Editar, pausar o reanudar un envío programado de reportes',
    'reportes.aprobar_correo_externo':
        'Aprobar un correo externo (contador, socio) para recibir reportes contables programados; solo admin',
    'reportes.retirar_correo_externo': 'Retirar un correo externo de la lista aprobada; solo admin',
    // Cobros y bancos (localización fiscal §10.3 y §10.9, fase 4; los endpoints son de A3)
    'cobros.configurar':
        'Dar de alta y editar proveedores de cobro (pasarela, agente, débito) con su cuenta puente 1.1.10.NN',
    'cobros.liquidar': 'Registrar la liquidación de un proveedor de cobro (banco neto y comisión)',
    'cajas.depositar': 'Depositar en el banco el efectivo de un turno de caja (queda en fondos en tránsito)',
    'bancos.ver': 'Ver proveedores de cobro, liquidaciones, depósitos, traslados, extractos y conciliaciones',
    'bancos.trasladar': 'Trasladar fondos entre cuentas bancarias propias de la empresa',
    'bancos.importar_extracto': 'Importar extractos bancarios (solo inserción, con detección de duplicados)',
    'bancos.importar_extracto_archivo':
        'Importar el estado de cuenta tal como lo descarga el banco (.xlsx, .xls o .csv) y ver su vista previa',
    'bancos.guardar_mapeo_extracto':
        'Guardar el mapeo de columnas del estado de cuenta de una cuenta bancaria',
    'bancos.conciliar':
        'Conciliar líneas del extracto con el libro, registrar comisiones del extracto, deshacer conciliaciones y editar reglas',
    'bancos.reatribuir_llegada':
        'Corregir la llegada al banco atribuida al depósito o traslado equivocado (reverso y llegada nueva)',
    // plan de contabilidad B3 (§5.8): diferencias al conciliar
    'bancos.configurar_diferencias':
        'Configurar las diferencias al conciliar: tope por línea y por día de quien concilia y motivos con su cuenta',
    'bancos.aprobar_diferencia':
        'Aprobar o rechazar una diferencia de conciliación que pasa del tope (nunca la propia)',
    'cartera.provisionar': 'Registrar la estimación para cuentas incobrables (hasta el tope legal)',
    'cartera.castigar': 'Castigar facturas incobrables con motivo y evidencia de gestión de cobro',
    'pagos.cerrar_diferencia': 'Cerrar el saldo pequeño que deja un pago (hasta diferencia_cobro_tope)',
    // Decisiones del PM del 21 nov (operación de cobro, A3)
    'gestiones_cobro.ver':
        'Ver las gestiones de cobro de un cliente (llamadas, mensajes, visitas, cartas) y su adjunto',
    'gestiones_cobro.registrar':
        'Registrar una gestión de cobro de un cliente (solo informativa; evidencia para el castigo de cartera)',
    'gestiones_cobro.adjuntar': 'Agregar el archivo de respaldo de una gestión de cobro (una sola vez)',
    'comprobantes.reconectar':
        'Dar desde el panel la reconexión temporal de un servicio cortado mientras caja revisa su comprobante (mismas reglas y cupo que Iris)',
    'servicios.pausar_sin_cobro':
        'Pausar un servicio sin cobro (lo suspende, no se facturan los periodos de la pausa y se reactiva solo al terminar)',
    'servicios.terminar_pausa': 'Terminar antes de tiempo la pausa sin cobro de un servicio (lo reactiva)',
    'ajustes_cobro.ver': 'Ver los ajustes de cobro y libro de la empresa',
    'ajustes_cobro.editar':
        'Editar los ajustes de cobro y libro de la empresa (aprobación de asientos manuales, tope de la pausa sin cobro)',
    'cajas.configurar_impresion': 'Elegir el formato de impresión de recibos y facturas de una caja',
    'bancos_origen.crear':
        'Agregar un banco al catálogo de bancos de origen del sistema (todas las empresas)',
    'bancos_origen.editar': 'Editar nombre, orden o estado de un banco del catálogo de bancos de origen',
    'bancos_origen.ocultar': 'Ocultar en la empresa un banco de origen que no usa',
    'bancos_origen.mostrar': 'Volver a mostrar en la empresa un banco de origen oculto',

    'notificaciones.ver': 'Ver plantillas y envíos de notificaciones',
    'notificaciones.editar': 'Editar plantillas de notificaciones',
    'notificaciones.configurar':
        'Configurar los canales de notificación (correo SMTP, bot de Telegram, interruptores); solo admin',
    'notificaciones.probar':
        'Enviar un mensaje de prueba por correo o Telegram con la configuración guardada',
    'notificaciones.registrar_consentimiento':
        'Marcar o quitar «Acepta avisos por WhatsApp» de un cliente (el permiso de contacto vive en Iris)',

    'horus.ver':
        'Ver el conector con Horus Flow, sus tokens (sin el valor) y sus datos (consumo, salud y seguridad de los servicios)',
    'horus.configurar':
        'Configurar el conector con Horus Flow (URL, código de conexión, webhooks, enlace de conexión); solo admin',
    'horus.probar': 'Probar la conexión con Horus Flow con la configuración guardada',
    'horus.abrir': 'Abrir un cliente, servicio o router en Horus Flow sin volver a iniciar sesión',

    // SmartOLT (varias instancias, compartidas solo con alcance global) y ACS por separado
    // (`contratos/equipos-olt-acs.md` §5.2)
    'smartolt.ver':
        'Ver las instancias de SmartOLT (sin token), sus OLT, a qué OLT de Argos están vinculadas y sus perfiles',
    'smartolt.crear_instancia':
        'Registrar una instancia (subdominio y token) de SmartOLT; compartida solo con alcance global',
    'smartolt.editar_instancia':
        'Editar una instancia de SmartOLT (nombre, URL, token, encendido y perfiles por OLT y plan)',
    'smartolt.eliminar_instancia':
        'Eliminar una instancia de SmartOLT que ningún equipo ni pedido en curso usa',
    'smartolt.vincular_olt': 'Vincular una OLT de SmartOLT con una OLT de la red de acceso de Argos',
    'smartolt.probar_instancia': 'Probar la conexión con una instancia de SmartOLT y sincronizar sus OLT',
    'acs.ver': 'Ver la configuración del ACS (GenieACS) de la empresa (sin la clave)',
    'acs.configurar':
        'Configurar el ACS (GenieACS) de la empresa (URL, usuario, clave, certificado, PPPoE por ACS)',
    'acs.probar': 'Probar la conexión con el ACS (GenieACS) de la empresa con la configuración guardada',

    'iris.ver': 'Ver el conector con Iris (sin secretos) y los tokens de su usuario técnico (sin el valor)',
    'iris.configurar':
        'Configurar el conector con Iris (URL, token iris_pat_, encendido, enlace de conexión); solo admin',
    'iris.abrir': 'Abrir un ticket, orden o prospecto en Iris sin volver a iniciar sesión',
    'prospectos.registrar':
        'Registrar en Iris a alguien interesado en un servicio y ver los prospectos registrados desde Argos (contrato Iris 0.10.0 §3.6)',
    'iris.generar_token':
        'Generar el token atk_ del usuario técnico Iris (permisos del contrato Iris §1.1); solo admin',
    'iris.revocar_token': 'Revocar un token del usuario técnico Iris',

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

    // Inventario interno (`contratos/inventario.md` §6, fase A); los endpoints son de A3
    'inventario.ver': 'Ver productos, bodegas, existencias y el kardex',
    'productos.crear': 'Crear productos del inventario',
    'productos.editar': 'Editar productos del inventario',
    'productos.desactivar': 'Desactivar productos del inventario (sin existencias)',
    'bodegas.crear': 'Crear bodegas y bodegas de técnico',
    'bodegas.editar': 'Editar bodegas',
    'bodegas.desactivar': 'Desactivar bodegas (sin existencias)',
    'inventario.consumir': 'Registrar consumo de materiales en una instalación o reparación',
    'inventario.trasladar': 'Trasladar existencias entre bodegas o técnicos',
    'inventario.ajustar': 'Ajustar existencias a mano (con motivo)',
    'inventario.dar_de_baja': 'Dar de baja existencias dañadas, robadas u obsoletas',
    'inventario.cargar_saldo_inicial': 'Cargar el saldo inicial de un producto en una bodega',
    'inventario.asignar_comodato': 'Prestar un equipo en comodato a un servicio (alta del activo fijo)',
    'inventario.devolver_comodato': 'Recibir de vuelta un equipo en comodato (baja del activo sin resultado)',
    'inventario.declarar_perdida_comodato':
        'Declarar perdido un equipo en comodato (baja del activo a pérdida)',
    // decisión 17 del PM: «Crear orden de retiro (Iris)» en Inventario › Por recuperar
    'inventario.solicitar_orden_retiro':
        'Pedir a Iris, a mano, la orden de retiro de un equipo por recuperar',
    // fase C (`contratos/inventario.md` §5)
    'inventario.abrir_conteo': 'Abrir un conteo físico de una bodega',
    'inventario.contar': 'Capturar lo contado en un conteo físico abierto',
    'inventario.cerrar_conteo': 'Cerrar un conteo físico (ajusta faltantes y sobrantes con su asiento)',
    'inventario.cancelar_conteo': 'Cancelar un conteo físico abierto sin ajustar',
    'inventario.marcar_reparada': 'Devolver a disponible una unidad en reparación',
    // fase D (`contratos/inventario.md` D.1–D.7, pedidos del PM 31 oct)
    'inventario.crear_traslado':
        'Enviar una orden de traslado (lo enviado queda en tránsito hasta que el destino lo recibe)',
    'inventario.recibir_traslado':
        'Recibir una orden de traslado (firma digital, firma en papel o aceptación), marcando faltantes',
    'inventario.cancelar_traslado': 'Cancelar una orden de traslado en tránsito (todo vuelve al origen)',
    'inventario.adjuntar_documento_traslado':
        'Adjuntar el papel firmado (foto o escaneo) de una orden recibida en papel',
    'inventario.configurar':
        'Configurar el inventario de la empresa (firma obligatoria al recibir traslados)',
    'inventario.configurar_ia': 'Configurar la IA que lee facturas de compra (proveedor, modelo y clave)',
    // contrato Iris 0.12.0 §3.10 (A48): equipos del cliente
    'servicios.cambiar_equipo':
        'Cambiar el equipo en comodato de un servicio (sale y entra en una sola operación) y registrar intentos de recuperación',
    // contrato Iris 0.9.0 §12 (A32, A33, A35 y A37): equipos del cliente y bienvenida
    'servicios.aprovisionar':
        'Aprovisionar y activar un servicio pendiente con su equipo (ONT por SmartOLT, router o CPE por el ACS TR-069)',
    'servicios.ver_equipo': 'Ver el estado del equipo del cliente (en línea, señal y firmware)',
    'servicios.cambiar_wifi': 'Cambiar el nombre o la clave del Wi-Fi del equipo del cliente',
    'servicios.reenviar_bienvenida': 'Reenviar la bienvenida de un servicio activo por sus canales',
    'inventario.ver_unidad':
        'Ver una unidad (serie, MAC, modelo, estado e historial) sin costos ni proveedor',
    'inventario.cobrar_equipo':
        'Declarar un equipo no recuperado y decidir los cobros de equipo (Equipo no devuelto y cobros propuestos)',
    'inventario.enviar_garantia':
        'Enviar a garantía del proveedor una unidad en revisión (proveedor, RMA y vencimiento)',
    'inventario.resolver_garantia':
        'Resolver la garantía de una unidad: volvió reparada, reemplazada o rechazada',
    'inventario.registrar_contacto_recuperacion':
        'Registrar un contacto con el cliente para recuperar un equipo (cuenta para declararlo no recuperado)',
    // contrato Iris 0.11.0 §3.9 (A47): la membresía de la bodega de cuadrilla llega de Iris (sistema)
    // contrato Iris 0.14.0 (§3.10, §4.5, §6.6): verificación de intentos y cambios, intentos anteriores a la
    // verificación y vínculos de técnicos (el webhook y el worker corren como sistema)
    'inventario.verificar_operacion_iris':
        'Verificar con Iris los intentos de recuperación y los cambios con cobro propuesto (al abrir la declaración)',
    'inventario.decidir_intento_recuperacion':
        'Decidir si cuenta un intento de recuperación anterior a la verificación con Iris',
    'inventario.sincronizar_vinculo_tecnico':
        'Aplicar o conciliar con Iris el vínculo de un técnico con su usuario de Argos (solo inventario)',
    'inventario.sincronizar_cuadrilla':
        'Aplicar la membresía de una cuadrilla que llega de Iris (bodega de cuadrilla, jefe y miembros)',
    'tipos_producto.crear': 'Crear tipos de producto',
    'tipos_producto.editar': 'Editar tipos de producto',
    'tipos_producto.desactivar': 'Desactivar tipos de producto',
    'productos.crear_lote': 'Crear productos por lotes (con su saldo inicial opcional)',
    'compras.cargar_borrador': 'Cargar una factura de compra (XML FEL, PDF o imagen) como borrador',
    'compras.editar_borrador': 'Corregir un borrador de compra',
    'compras.confirmar_borrador':
        'Confirmar un borrador de compra (crea la compra y su entrada al inventario)',
    'compras.descartar_borrador': 'Descartar un borrador de compra',
    'libros.ver': 'Ver los libros legales (vista previa) y sus habilitaciones',
    'libros.emitir': 'Emitir libros legales con folio sobre un periodo bloqueado',
    'libros.habilitar': 'Registrar habilitaciones de folios de libros',
    'libro.cerrar_ejercicio': 'Cerrar el ejercicio anual (resultados a cero y reserva legal)',
    'libro.cerrar_apertura': 'Cerrar los saldos de apertura de la importación (2.9.01 a patrimonio)',
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
    'documentos.ver':
        'Ver las plantillas de documentos (aviso de cobro, nota de crédito, recibo de cobro) y elegir con cuál imprimir',
    'documentos.crear':
        'Crear otra plantilla de un documento (carta o POS 80 mm), desde la de fábrica o copiando otra',
    'documentos.editar': 'Editar el nombre, el formato y el HTML de una plantilla de documento',
    'documentos.predeterminar':
        'Elegir la plantilla predeterminada de un documento (la que usan el portal, el correo y los procesos)',
    'documentos.desactivar': 'Desactivar una plantilla de documento (nunca la predeterminada)',
    'documentos.activar': 'Volver a activar una plantilla de documento desactivada',
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
    // Salud, registro y apariencia del sistema (`contratos/salud.md`, `contratos/apariencia.md`); solo admin
    'sistema.ver_salud':
        'Ver la salud del sistema: base de datos, Redis, colas, RADIUS, routers, crons, respaldos y recursos del servidor',
    'sistema.ver_registro':
        'Ver el registro del sistema: errores de acciones, comandos de red fallidos, caídas de RADIUS y trabajos fallidos',
    'sistema.ver_almacenamiento':
        'Ver qué se almacena y cuánto espacio ocupa: carpetas de archivos, base de datos, Redis y discos',
    'sistema.recalcular_almacenamiento':
        'Recalcular el almacenamiento a pedido (solo lee y suma; no borra nada)',
    'sistema.ver_crons':
        'Ver las tareas programadas: horario, última y próxima corrida, atrasos, quién las corre e historial',
    'sistema.ejecutar_cron':
        'Ejecutar ahora una tarea programada (respeta su lock; algunas piden además el permiso de lo que hacen)',
    'apariencia.ver': 'Ver la apariencia de la instalación (tema, marca y archivos del inicio de sesión)',
    'apariencia.editar': 'Cambiar el tema, el modo predeterminado, el nombre de la marca y el eslogan',
    'apariencia.subir_logo_login': 'Subir el logo del inicio de sesión del panel y del portal',
    'apariencia.quitar_logo_login': 'Quitar el logo del inicio de sesión',
    'apariencia.subir_fondo_login': 'Subir la imagen de fondo del inicio de sesión',
    'apariencia.quitar_fondo_login': 'Quitar la imagen de fondo del inicio de sesión',
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
    'portal_corte.ver':
        'Ver la configuración del portal de corte (destino del NAT de los routers y modo de suspensión)',
    'portal_corte.configurar':
        'Configurar el portal de corte: IPv4/IPv6 y puerto a donde los routers redirigen a los suspendidos y modo de suspensión (desconectar o CoA); solo admin',
    'portal.configurar_contrasena_defecto':
        'Configurar la contraseña por defecto del portal del cliente de la empresa activa (solo se guarda el hash); solo admin',
    'nodos_portal.administrar':
        'Crear, ver y revocar los tokens de los nodos portal remotos (portal del cliente en otro servidor); solo admin',
    'horus.generar_token':
        'Generar el token de una integración (usuario técnico Horus con ip.resolver, clientes.ver y servicios.ver)',
    'horus.revocar_token': 'Revocar el token de una integración',
    'sso.emitir':
        'Pedir un ticket de autologin para un usuario del otro sistema (solo el token de la integración Horus o Iris)',
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
        /^libro\.(cerrar_ejercicio|cerrar_apertura|reabrir_ejercicio|bloquear|bloquear_duro|desbloquear|excepcion_bloqueo)$/.test(
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
            // caja: cuentas a cargo de un contacto (contrato Iris 0.10.1 §3.8)
            'contactos.buscar',
            'clientes.estado_cuenta',
            'clientes.asignar_responsable_pago',
            'clientes.quitar_responsable_pago',
            'zonas.ver',
            'servicios.ver',
            'adicionales.ver',
            'planes.ver',
            'facturas.ver',
            'facturas.emitir_cargo_unico',
            // pedido del PM (19 nov): cobrar meses adelantados en caja; sin periodos anteriores
            'facturas.emitir_periodos',
            'pagos.ver',
            // imprimir con otra plantilla (POS 80 mm): ver cuáles hay activas
            'documentos.ver',
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
            'comprobantes.registrar',
            'comprobantes.reconectar',
            'gestiones_cobro.ver',
            'gestiones_cobro.registrar',
            'gestiones_cobro.adjuntar',
            'fel.ver',
            'cajas.depositar',
            // decisión del PM: egresos de su caja abierta, con motivo y hasta egreso_cajero_maximo (sin
            // egresos.ver: lee solo los de su caja con cajas.ver, como antes)
            'egresos.registrar',
            'lealtad.ver',
            'lealtad.canjear',
            'inventario.ver',
            'prospectos.registrar',
            // decisión del PM 19: el código para identificarse en el portal
            'servicios.generar_codigo_identificacion',
        ],
    },
    soporte: {
        descripcion: 'Atención al cliente y gestión de servicios',
        permisos: [
            'clientes.ver',
            'contactos.buscar',
            'contactos.gestionar',
            'clientes.crear',
            'clientes.editar',
            // Iris 0.14.1: confirma el NIT de una empresa (marca nit_verificado_en)
            'clientes.verificar_nit',
            'notificaciones.registrar_consentimiento',
            'prospectos.registrar',
            'clientes.estado_cuenta',
            'gestiones_cobro.ver',
            'gestiones_cobro.registrar',
            'gestiones_cobro.adjuntar',
            'comprobantes.reconectar',
            'servicios.pausar_sin_cobro',
            'servicios.terminar_pausa',
            'clientes.vincular_telegram',
            'clientes.desvincular_telegram',
            'clientes.asignar_responsable_pago',
            'clientes.quitar_responsable_pago',
            'clientes.restaurar_contrasena_portal',
            'zonas.ver',
            'servicios.ver',
            'servicios.crear',
            'servicios.editar',
            'servicios.suspender',
            'servicios.reactivar',
            'servicios.limitar',
            'servicios.quitar_limite',
            'servicios.activar_instalacion',
            'servicios.reservar_ip',
            'servicios.cambiar_plan_pendiente',
            'clientes.registrar_identidad',
            'servicios.completar_datos',
            'servicios.cambiar_titular',
            'servicios.ver_equipo',
            'servicios.cambiar_wifi',
            'servicios.reenviar_bienvenida',
            'servicios.desconectar',
            'servicios.sincronizar_router',
            'servicios.ver_credenciales',
            'servicios.agregar_adicional',
            'servicios.editar_adicional',
            'servicios.quitar_adicional',
            'servicios.ver_credencial_adicional',
            'adicionales.ver',
            'routers.ver',
            'routers.probar_conexion',
            'red_acceso.ver',
            'redes.ver',
            'ipv6.ver',
            'planes.ver',
            'plantillas.ver',
            'facturas.ver',
            'facturas.emitir_cargo_unico',
            'pagos.ver',
            // imprimir con otra plantilla (POS 80 mm): ver cuáles hay activas
            'documentos.ver',
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
            'servicios.generar_codigo_identificacion',
            'promociones_velocidad.ver',
            'promociones_velocidad.asignar',
            'promociones_velocidad.quitar',
            'incidentes_red.leer',
            'lealtad.ver',
            'lealtad.canjear',
            'sorteos.ver',
            'inventario.ver',
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
            // instala lo que vende Iris (contratos/instalacion.md): tiene servicios.crear
            'servicios.activar_instalacion',
            'servicios.reservar_ip',
            'servicios.cambiar_plan_pendiente',
            'clientes.registrar_identidad',
            'servicios.completar_datos',
            'servicios.cambiar_titular',
            'servicios.aprovisionar',
            'servicios.ver_equipo',
            'servicios.cambiar_wifi',
            'servicios.desconectar',
            'servicios.sincronizar_router',
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
            'routers.generar_script',
            'routers.conexion_clave',
            'routers.probar_conexion',
            'routers.reconciliar',
            'red_acceso.ver',
            'red_acceso.descubrir',
            'red_acceso.adoptar',
            'red_acceso.tomar_control',
            'olts.crear',
            'olts.editar',
            'olts.eliminar',
            'vlans.crear',
            'vlans.editar',
            'vlans.eliminar',
            'servidores_pppoe.crear',
            'servidores_pppoe.editar',
            'servidores_pppoe.eliminar',
            'redes.ver',
            'redes.crear',
            'redes.editar',
            'redes.migrar',
            'ipv6.ver',
            'ipv6.crear',
            'ipv6.editar',
            'ipv6.migrar',
            'planes.ver',
            'planes.sincronizar',
            'qos.ver',
            'qos.gestionar',
            'sesiones.ver',
            'sesiones.desconectar',
            'red.ver',
            'ip.resolver',
            'incidentes_red.leer',
            'incidentes_red.abrir',
            'incidentes_red.cerrar',
            'inventario.ver',
            'inventario.consumir',
            'inventario.trasladar',
            'inventario.asignar_comodato',
            'inventario.devolver_comodato',
            'inventario.solicitar_orden_retiro',
            'inventario.contar',
            'inventario.marcar_reparada',
            'inventario.crear_traslado',
            'inventario.recibir_traslado',
            'inventario.cancelar_traslado',
            // A48: cambio de equipo e intentos de recuperación desde el panel
            'servicios.cambiar_equipo',
            'inventario.ver_unidad',
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
            'plantillas.retirar',
            'plantillas.asignar_sin_plantilla',
            'facturas.ver',
            'facturas.generar',
            'facturas.anular',
            'facturas.nota_credito',
            'facturas.sustituir',
            'facturas.anular_nota_credito',
            'facturas.emitir_cargo_unico',
            'facturas.emitir_periodos',
            'facturas.emitir_periodo_anterior',
            'facturas.editar_monto_periodo',
            'facturas.cargo_sin_costo',
            'facturas.configurar_motivos',
            'facturas.configurar_conceptos',
            'pagos.ver',
            // imprimir con otra plantilla (POS 80 mm): ver cuáles hay activas
            'documentos.ver',
            'pagos.registrar',
            'pagos.anular',
            'cajas.ver',
            'cajas.crear',
            'cajas.configurar_impresion',
            'bancos_origen.ocultar',
            'bancos_origen.mostrar',
            'cuentas_bancarias.ver',
            'cuentas_bancarias.editar',
            'promesas.ver',
            'promesas.aprobar',
            'promesas.rechazar',
            'promesas.cancelar',
            'comprobantes.ver',
            'comprobantes.aprobar',
            'comprobantes.rechazar',
            'comprobantes.registrar',
            'comprobantes.reconectar',
            'gestiones_cobro.ver',
            'gestiones_cobro.registrar',
            'gestiones_cobro.adjuntar',
            'libro.ver',
            'libro.registrar_asiento',
            'libro.revertir_asiento',
            'libro.aprobar_asiento',
            'libro.rechazar_asiento',
            'ajustes_cobro.ver',
            'ajustes_cobro.editar',
            'libro.cerrar_periodo',
            'cierres.verificar',
            'cierres.revisar_check',
            'egresos.ver',
            'egresos.registrar',
            'egresos.registrar_sin_limite',
            'egresos.anular',
            'reportes.ver',
            'panel_financiero.ver',
            'panel_financiero.configurar',
            'reportes.programar_envio',
            'reportes.editar_envio',
            'bitacora.ver',
            'cobros.configurar',
            'cobros.liquidar',
            'cajas.depositar',
            'bancos.ver',
            'bancos.trasladar',
            'bancos.importar_extracto',
            'bancos.importar_extracto_archivo',
            'bancos.guardar_mapeo_extracto',
            'bancos.conciliar',
            'bancos.reatribuir_llegada',
            'bancos.configurar_diferencias',
            'bancos.aprobar_diferencia',
            'cartera.provisionar',
            'cartera.castigar',
            'pagos.cerrar_diferencia',
            'inventario.ver',
            'inventario.ajustar',
            'inventario.cargar_saldo_inicial',
            'inventario.dar_de_baja',
            'inventario.abrir_conteo',
            'inventario.contar',
            'inventario.cerrar_conteo',
            'inventario.cancelar_conteo',
            'inventario.marcar_reparada',
            'inventario.enviar_garantia',
            'inventario.resolver_garantia',
            'inventario.registrar_contacto_recuperacion',
            'productos.crear',
            'productos.editar',
            'productos.desactivar',
            'bodegas.crear',
            'bodegas.editar',
            'bodegas.desactivar',
            'inventario.crear_traslado',
            'inventario.recibir_traslado',
            'inventario.cancelar_traslado',
            'inventario.adjuntar_documento_traslado',
            'tipos_producto.crear',
            'tipos_producto.editar',
            'tipos_producto.desactivar',
            'productos.crear_lote',
            // compras.cargar_borrador, .editar_borrador, .confirmar_borrador y .descartar_borrador llegan
            // con PERMISOS_FISCALES_CONTABILIDAD (todo compras.*)
            ...PERMISOS_FISCALES_CONTABILIDAD,
            ...PERMISOS_LEALTAD_CONTABILIDAD,
        ],
    },
    lectura: {
        descripcion: 'Solo lectura',
        permisos: [...lectura, 'clientes.estado_cuenta', 'incidentes_red.leer'],
    },
}
