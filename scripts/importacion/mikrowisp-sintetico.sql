-- FIXTURE SINTÉTICO de ArgosIsp: datos inventados, no son de ningún ISP.
--
-- Solo trae los datos (INSERT); la estructura es la real de Mikrowisp 6:
-- scripts/importacion/esquemas/mikrowisp6.sql. Un volcado de prueba completo es la estructura
-- seguida de este archivo (así lo arman las pruebas):
--
--   cat scripts/importacion/esquemas/mikrowisp6.sql scripts/importacion/mikrowisp-sintetico.sql > /tmp/mikrowisp.sql
--
-- Casos difíciles que cubre (tests/importacion/mikrowisp.spec.ts):
--   * clientes duplicados por NIT: 2 y 3 (mismo NIT con y sin guion)
--   * servicio sin plan: 107 (idperfil = 0) y su factura 5005 va al saldo inicial
--   * router con credenciales vacías: 2 (sin usuario, clave ni secreto RADIUS, sin ip_radius)
--   * IP NAS del router 1 desde server.ip_radius (198.18.0.11), distinta de su IP de API; la clave
--     de la API (server.pass) viene cifrada por Mikrowisp y no se importa
--   * facturas abonadas: 5003 (cobrado 250) y 5004 (cobrado 100 por otro cliente)
--   * saldos a favor (tabla saldos, estado 'no cobrado'): clientes 4 (sin facturas) y 5; el saldo
--     'cobrado' del cliente 1 ya se aplicó y no cuenta
--   * pago de un cliente a la factura de otro: operación 9003 (cliente 5 paga la 5004 del 6)
--   * IPs repetidas: 101 y 111 con 198.18.10.10
--   * MAC en distintos formatos: aabb.cc00.0801, AA-BB-CC-00-09-01, aabbcc000902, aa:bb:cc:00:01:01
--   * servicios sin PPPoE: sin pppuser = IP estática con su IP y MAC, sin amarre (server.seguridad
--     no decide): 108 IP estática; 113 y 109 sin IP (se omiten)
--   * estado del cliente: 4 SUSPENDIDO (su servicio 104 entra activo), 11 RETIRADO (112 no entra)
--   * factura anulada (5009, solo archivo), pagada (5002), concepto de dos líneas de facturaitems (5004)
--   * cargo único (facturas.tipo = 1): 5013, instalación pagada por la operación 9005
--   * segunda factura de servicio del mismo cliente en el mismo mes de vencimiento: 5014 (cliente 8)
--   * cliente RETIRADO sin servicios con deuda: 11 (factura 5015 No pagado)
--   * promesas (credito): 1 vigente sobre 5001; 2 vencida (solo archivo)
--   * saldos 'facturado' (traslado entre facturas): solo archivo
--   * zona por tblavisouser; cliente 8 sin fila (sin zona)
--   * NIT inválido (cliente 9), clientes sin NIT (4 y 10), correo inválido (7)
--   * cadenas con comillas, comas, acentos y saltos de línea escapadas como las deja mysqldump
--
-- Casos propios del esquema real de Mikrowisp 6:
--   * ids zerofill con ceros, como los exporta Adminer: cliente '000010' (= 10), factura '00005009'
--   * IP dinámica (tipoipv4 = 1): 105 trae la IP de su última sesión; no entra como IP fija
--   * clave PPPoE vacía en tblservicios y presente en radcheck (Cleartext-Password): 106
--   * varias IPs en tblservicios.ip: 102 (entra la primera, con aviso)
--   * precio del servicio distinto al del plan: 101 (140 frente a 150, aviso)
--   * IPv6 y DUID en el servicio: 110 (no se importan, aviso)
--   * servicio que no es de internet (tiposervicio 'tv'): 114 (no entra)
--   * factura y pago en dólares (moneda 2): 5011 y 9004 (no entran)
--   * estado de factura desconocido ('Vencida'): 5012 (no entra; pregunta para el PM)
--   * cobrado distinto de la suma de sus operaciones: 5007 (cobrado 50 sin pagos; aviso)
--   * los triggers de la estructura (DELIMITER ;;, con INSERT dentro) no son datos
--
-- Suma de saldos en el origen = Q 2280.00 (1780 + 5014 de 300 + 5015 de 200)

SET NAMES utf8mb4;

INSERT INTO `server` (`id`, `nodo`, `ip`, `user`, `pass`, `secret_radius`, `ip_radius`, `seguridad`, `seguridad2`, `port_api`) VALUES
(1,'Torre Norte','198.18.0.1','argos','clave-lab-norte','secreto-lab-norte','198.18.0.11',1,0,'8728'),
(2,'Torre Sur','198.18.0.2','','','','',0,3,'8728');

INSERT INTO `nas` (`id`, `idserver`, `nasname`, `shortname`, `secret`) VALUES
(1,1,'198.18.0.11','norte','secreto-lab-norte');

INSERT INTO `ipv4` (`id`, `nodo`, `nombre`, `red`, `cidr`, `tipo`, `rangos`, `host`) VALUES
(1,1,'red-norte','198.18.10.0','24',0,'',0),
(2,2,'red-sur','198.18.20.0','24',0,'',0);

INSERT INTO `perfiles` (`id`, `plan`, `descripcion`, `velocidad`, `costo`, `profile`, `limit_down`, `limit_up`, `is_disabled`) VALUES
(1,'MW Residencial 10M','','5M/10M',150.00,'default','0','0',0),
(2,'MW Empresarial 50M','','25M/50M',600.00,'','0','0',0);

INSERT INTO `zonas` VALUES (1,'MW Centro'),(2,'MW Aldea El Rosario');

INSERT INTO `usuarios` (`id`, `nombre`, `estado`, `correo`, `telefono`, `movil`, `cedula`, `pasarela`, `codigo`, `direccion_principal`) VALUES
(1,'Ana López','ACTIVO','ana.lopez@example.com','2222-0001','5555-0001','1234567-9','','','4a. calle 5-10, zona 1'),
(2,'Comercial El Sol, S.A.','ACTIVO','pagos@elsol.example.com','2222-0002','','7654321-8','','','Km. 14.5, \"Bodega 3\"'),
(3,'Comercial El Sol (bodega)','ACTIVO','','','','76543218','','','Km. 14.5, \'La Ceiba\''),
(4,'Bruno Pérez','SUSPENDIDO','','','5555-0004','','','','Aldea El Rosario'),
(5,'Carla Méndez','ACTIVO','carla@example.com','','5555-0005','CF','','','Aldea El Rosario'),
(6,'Elena Méndez','ACTIVO','','','5555-0006','3141592-K','','','Aldea El Rosario'),
(7,'Ernesto Juárez','ACTIVO','ernesto@example','','','2718281-9','','','Barrio El Centro\nCasa amarilla'),
(8,'Finca Las Flores','ACTIVO','finca@example.com','','','1122334-0','','','Finca Las Flores'),
(9,'Gabriel Ruiz','ACTIVO','','','5555-0009','123','','','Colonia Las Brisas'),
('000010','Hilda Castillo','ACTIVO','','','','','','',''),
(11,'Iris Retirada','RETIRADO','','','','','','','Colonia Las Brisas');

INSERT INTO `tblavisouser` (`id`, `cliente`, `zona`, `diapago`) VALUES
(1,1,1,1),(2,2,1,1),(3,3,1,1),(4,4,2,1),(5,5,2,1),(6,6,2,1),(7,7,1,1),(8,9,1,1),(9,'000010',1,1),(10,11,1,1);

INSERT INTO `tblservicios` (`id`, `idcliente`, `idperfil`, `nodo`, `costo`, `ip`, `mac`, `instalado`, `pppuser`, `ppppass`, `tiposervicio`, `tipoipv4`, `redipv4`, `coordenadas`, `direccion`, `ipv6`, `ipv6_duid`) VALUES
(101,1,1,1,140.00,'198.18.10.10','aa:bb:cc:00:01:01','2024-03-15','mw.ana.lopez','clave101','internet',0,1,'14.6349,-90.5069','4a. calle 5-10, zona 1','',''),
(102,2,2,1,600.00,'198.18.10.20,198.18.10.21','','2023-11-02','mw.elsol','clave102','internet',0,1,'','','',''),
(103,3,1,2,150.00,'','','0000-00-00','mw.elsol.bodega','clave103','internet',0,2,'','','',''),
(104,4,1,1,150.00,'198.18.10.40','','0000-00-00','mw.bruno','clave104','internet',0,1,'','','',''),
(105,5,1,2,150.00,'198.18.20.50','','0000-00-00','mw.carla','clave105','internet',1,2,'','','',''),
(106,6,1,2,150.00,'198.18.20.60','','0000-00-00','mw.elena','','internet',0,2,'','','',''),
(107,7,0,1,150.00,'198.18.10.70','','0000-00-00','mw.ernesto','clave107','internet',0,1,'','','',''),
(108,8,2,1,600.00,'198.18.10.80','aabb.cc00.0801','0000-00-00','','','internet',0,1,'','Finca Las Flores, casa patronal','',''),
(109,9,1,2,150.00,'','AA-BB-CC-00-09-01','0000-00-00','','','internet',0,2,'','','',''),
(110,9,1,2,150.00,'198.18.20.90','aabbcc000902','0000-00-00','mw.gabriel','clave110','internet',0,2,'','','2001:db8:20::/64','00:01:00:01:aa:bb:cc:00:09:02'),
(111,'000010',1,1,150.00,'198.18.10.10','','0000-00-00','mw.hilda','clave111','internet',0,1,'','','',''),
(112,11,1,1,150.00,'198.18.10.12','','0000-00-00','mw.iris','clave112','internet',0,1,'','','',''),
(113,8,2,1,600.00,'','','0000-00-00','','','internet',0,1,'','Finca Las Flores, beneficio','',''),
(114,2,1,1,95.00,'','','2024-05-01','','','tv',0,0,'','','','');

INSERT INTO `facturas` (`id`, `legal`, `idcliente`, `emitido`, `vencimiento`, `pago`, `total`, `estado`, `tipo`, `cobrado`, `iva_igv`, `sub_total`, `saldo`, `moneda`) VALUES
(5001,0,1,'2026-09-01','2026-09-10','0000-00-00',150.00,'No pagado',2,0.00,16.07,133.93,0.00,1),
(5002,0,1,'2026-08-01','2026-08-10','2026-08-05',150.00,'pagado',2,150.00,16.07,133.93,0.00,1),
(5003,0,2,'2026-09-01','2026-09-10','0000-00-00',600.00,'No pagado',2,250.00,64.29,535.71,0.00,1),
(5004,0,6,'2026-09-01','2026-09-10','0000-00-00',300.00,'No pagado',2,100.00,32.14,267.86,0.00,1),
(5005,0,7,'2026-09-01','2026-09-10','0000-00-00',150.00,'No pagado',2,0.00,16.07,133.93,0.00,1),
(5006,0,8,'2026-09-01','2026-09-10','0000-00-00',600.00,'No pagado',2,0.00,64.29,535.71,0.00,1),
(5007,0,9,'2026-09-01','2026-09-10','0000-00-00',150.00,'No pagado',2,50.00,16.07,133.93,0.00,1),
(5008,0,3,'2026-09-01','2026-09-10','0000-00-00',150.00,'No pagado',2,0.00,16.07,133.93,0.00,1),
('00005009',0,'000010','2026-09-01','2026-09-10','0000-00-00',150.00,'anulado',2,0.00,16.07,133.93,0.00,1),
(5010,0,5,'2026-09-01','2026-09-10','0000-00-00',150.00,'No pagado',2,0.00,16.07,133.93,0.00,1),
(5011,0,1,'2026-09-01','2026-09-10','0000-00-00',25.00,'No pagado',2,0.00,0.00,25.00,0.00,2),
(5012,0,3,'2026-07-01','2026-07-10','0000-00-00',150.00,'Vencida',2,0.00,16.07,133.93,0.00,1),
(5013,0,1,'2026-08-20','2026-08-20','2026-08-20',250.00,'pagado',1,250.00,26.79,223.21,0.00,1),
(5014,0,8,'2026-09-05','2026-09-15','0000-00-00',300.00,'No pagado',2,0.00,32.14,267.86,0.00,1),
(5015,0,11,'2026-06-01','2026-06-10','0000-00-00',200.00,'No pagado',2,0.00,21.43,178.57,0.00,1);

INSERT INTO `facturaitems` (`id`, `idfactura`, `descripcion`, `cantidad`, `unidades`) VALUES
(1,5001,'Internet septiembre 2026',150.00,1),
(2,5002,'Internet agosto 2026',150.00,1),
(3,5003,'Internet septiembre 2026',600.00,1),
(4,5004,'Internet septiembre',150.00,1),
(5,5004,'Internet agosto',150.00,1),
(6,5006,'Enlace dedicado',600.00,1);

INSERT INTO `operaciones` (`id`, `nfactura`, `idcliente`, `fecha_pago`, `operador`, `transaccion`, `forma_pago`, `descripcion`, `cobrado`, `comision`, `saldo`, `idmoneda`) VALUES
(9001,5002,1,'2026-08-05 09:12:00',1,NULL,'Efectivo','',150.00,0.00,0.00,1),
(9002,5003,2,'2026-09-08 15:40:00',1,'TRF-001','Transferencia','',250.00,0.00,0.00,1),
(9003,5004,5,'2026-09-09 11:00:00',1,NULL,'Efectivo','',100.00,0.00,0.00,1),
(9004,'00000000',1,'2026-09-12 10:00:00',1,'PAYPAL-77','PayPal','',10.00,0.00,0.00,2),
(9005,5013,1,'2026-08-20 08:30:00',1,NULL,'Efectivo','',250.00,0.00,0.00,1);

INSERT INTO `saldos` (`id`, `iduser`, `idorigen`, `iddestino`, `estado`, `monto`, `fecha`, `moneda`) VALUES
(1,4,0,0,'no cobrado',50.00,'2026-09-01',1),
(2,5,0,0,'no cobrado',20.00,'2026-09-01',1),
(3,1,0,0,'cobrado',30.00,'2026-07-01',1),
(4,6,5003,5004,'facturado',10.00,'2026-09-01',1);

INSERT INTO `credito` (`id`, `idcliente`, `idfactura`, `fechaingreso`, `fecha_limite`, `operador`, `descripcion`, `estado`) VALUES
(1,1,5001,'2026-09-12','2099-12-31',1,'Paga el viernes',0),
(2,3,5008,'2026-01-05','2026-01-10',1,'Promesa vieja',0);

INSERT INTO `monedas` VALUES (1,'GTQ','QUETZALES','',1.00,'','Q'),(2,'USD','DÓLARES','',7.75,'','$');

INSERT INTO `radcheck` (`id`, `username`, `attribute`, `op`, `value`) VALUES
(1,'mw.elena','Cleartext-Password',':=','clave106'),
(2,'mw.elena','Simultaneous-Use',':=','1');
