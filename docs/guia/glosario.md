---
orden: 9
---

# Glosario

Los términos del ISP y de ArgosIsp que vas a ver en el panel, en orden alfabético.

- **Abono inicial:** Parte de lo vencido que la plantilla puede exigir que el cliente pague antes de aceptar una promesa de pago.
- **ACL:** La lista de permisos del sistema. Cada acción tiene un permiso con su nombre (`servicios.suspender`) y los roles agrupan permisos.
- **Actor:** Quién hizo una acción: un usuario, un token de API, un agente de IA o el sistema. Se ve en la bitácora.
- **Anticipo o saldo a favor:** Lo que el cliente pagó de más. Se aplica solo a sus próximas facturas.
- **Asiento:** El registro contable de un movimiento de dinero, con su debe y su haber, que siempre suman lo mismo. Nunca se borra; un error se corrige con un asiento de reverso.
- **Aviso de cobro:** La factura que ArgosIsp emite cada periodo. Si la empresa usa FEL y certifica al cobrar, se convierte en factura electrónica cuando se paga.
- **Bitácora:** El registro de todo lo que se hace en el sistema: quién, cuándo, por qué canal, sobre qué y con qué resultado.
- **Bodega:** Donde se guarda el inventario. Puede ser una bodega fija o la de un técnico (su vehículo).
- **Caja y turno:** La caja es el lugar donde se cobra en efectivo. Un turno empieza al abrir la caja con el fondo inicial y termina al cerrarla contando el efectivo.
- **Canal:** Por dónde llegó una acción: panel, portal, API, agente de IA, automático (cron o worker), webhook.
- **CF (consumidor final):** Cliente sin NIT. La factura va a nombre de «Consumidor Final».
- **CoA (Change of Authorization):** Mensaje que el sistema manda por RADIUS al router para cambiarle algo a una sesión abierta (por ejemplo, la velocidad) sin desconectarla.
- **Comodato:** Equipo del ISP (router, ONU, antena) prestado al cliente mientras tiene el servicio. Sigue siendo del ISP y se recupera al retirar el servicio.
- **Comprobante:** Foto o PDF de un depósito o transferencia que el cliente sube desde el portal. Un cajero lo verifica contra el banco y lo aprueba o lo rechaza.
- **Corte:** Suspender el servicio por falta de pago. El cliente que navega ve la página de corte.
- **CUI:** Código Único de Identificación del DPI. Sirve como identificación fiscal de una persona en lugar del NIT.
- **Desconectar sesión:** Cerrar la sesión PPPoE en el router. El equipo del cliente vuelve a conectarse solo, normalmente en segundos.
- **DTE (Documento Tributario Electrónico):** El documento que certifica la SAT por medio del certificador: factura, nota de crédito o nota de débito. Tiene número de autorización, serie y número.
- **Empresa activa:** La empresa (NIT) con la que estás trabajando cuando tu usuario atiende varias.
- **FEL (Factura Electrónica en Línea):** El régimen de factura electrónica de Guatemala. ArgosIsp manda cada documento al certificador (por ejemplo, INFILE) para obtener su DTE.
- **IPv4 e IPv6:** Las direcciones de internet del servicio. En IPv6 el cliente recibe un prefijo de enlace y, normalmente, un prefijo delegado para su red de casa.
- **Limitado:** Estado del servicio con la velocidad reducida (la «velocidad limitada» del plan) por falta de pago. Color ámbar.
- **MAC:** Identificador físico de un equipo de red, como `4C:5E:0C:12:34:56`.
- **MikroTik / RouterOS:** La marca de routers que usa el ISP y su sistema. ArgosIsp les da órdenes por RADIUS y por su API.
- **NAS:** El equipo de la red donde se conecta el cliente; en ArgosIsp, el router MikroTik.
- **NIT:** Número de Identificación Tributaria. Lo pide la factura; si el cliente no tiene, va como CF.
- **Nota de crédito:** Documento que rebaja el saldo de una factura ya emitida. Es la forma correcta de corregir una factura, en lugar de borrarla.
- **Pendiente de instalación:** Estado de un servicio vendido que todavía no se instala. Ya tiene usuario, router, plan e IP, pero no navega ni se factura hasta que alguien activa la instalación. Color azul.
- **Plan:** La velocidad y el precio del servicio. Un plan puede estar en todos los routers o solo en algunos.
- **Plantilla de facturación:** Las reglas de cobro de un servicio: cada cuándo se factura, cuántos días tiene para pagar, cuándo se limita y cuándo se corta, la mora y las reglas de las promesas de pago.
- **Portal del cliente:** La página donde el cliente entra con su NIT, CUI o usuario PPPoE y un código que le llega a su correo o Telegram. Ahí ve y paga sus facturas, sube comprobantes y promete pagar.
- **PPPoE y usuario PPP:** La forma en que el equipo del cliente se conecta a la red con un usuario y una contraseña. El usuario PPP sirve también para buscar al cliente.
- **Promesa de pago:** El compromiso del cliente de pagar lo vencido antes de una fecha. Si las reglas de la plantilla la aprueban, el servicio se reactiva mientras tanto. Cubre todo lo vencido: nadie escribe el monto.
- **RADIUS:** El servicio que autoriza a cada cliente a conectarse y le dice al router su velocidad, su IP y si está cortado.
- **Reactivar:** Volver a dar navegación completa a un servicio suspendido. Pasa solo cuando el cliente paga o tiene una promesa aprobada, o a mano con el botón «Reactivar».
- **Responsable de pago:** El cliente que paga las facturas de otro (por ejemplo, la mamá que paga el servicio de la hija). Es una sugerencia para el cobro: cualquiera puede pagar cualquier factura.
- **Retirado:** Baja definitiva del servicio. Libera sus IP y no se puede deshacer. Color gris.
- **Rol:** Un grupo de permisos: `admin`, `cajero`, `soporte`, `tecnico`, `contabilidad`, `lectura`.
- **Sesión:** La conexión PPPoE abierta de un servicio, con la IPv4 y los prefijos IPv6 que tiene en ese momento.
- **Suspendido:** Servicio cortado: su navegación va a la página de corte. Color rojo. En el tablero del Inicio se cuenta como «Cortados».
- **Suspensión manual:** Suspensión hecha a mano con el botón «Suspender». Ni el pago ni el corte automático la quitan: solo «Reactivar».
- **Token de API:** Una clave para que otro sistema o un agente de IA use ArgosIsp. Se ve una sola vez al crearlo y pasa por los mismos permisos que un usuario.
- **Traslado:** Orden para mover productos o equipos de una bodega a otra (por ejemplo, de la bodega central al técnico). Quien recibe la firma.
- **Zona:** Área geográfica para agrupar clientes. Sirve para filtrar y para limitar permisos.
