-- Estructura de la base de Mikrowisp 6 (solo DDL, sin datos), exportada con Adminer.
-- Referencia de las pruebas del importador de ArgosIsp (apps/api/app/importacion/origenes/mikrowisp.ts).
-- Limpieza: se quitaron la línea con la versión del servidor y la hora del volcado.
-- Los dos INSERT del archivo están dentro de triggers (DELIMITER ;;): no son datos.

SET NAMES utf8;
SET time_zone = '+00:00';
SET foreign_key_checks = 0;

DROP TABLE IF EXISTS `afip`;
CREATE TABLE `afip` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cliente` int(6) unsigned zerofill NOT NULL,
  `pdf` text NOT NULL,
  `invoice_num` varchar(50) NOT NULL,
  `cae` varchar(150) NOT NULL,
  `vto` date NOT NULL,
  `barcode` varchar(150) NOT NULL,
  `idfactura` int(8) unsigned zerofill NOT NULL,
  `total` decimal(10,2) NOT NULL,
  `emitido` date NOT NULL,
  `idcredito` int(11) NOT NULL,
  `moneda` int(5) NOT NULL DEFAULT 1,
  `idempresa` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `cliente` (`cliente`),
  KEY `idfactura` (`idcredito`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


SET NAMES utf8mb4;

DROP TABLE IF EXISTS `afipaccounts`;
CREATE TABLE `afipaccounts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `punto_venta` varchar(11) NOT NULL,
  `monotributo` int(1) NOT NULL DEFAULT 0,
  `padron_a5` int(1) NOT NULL DEFAULT 0,
  `demo` int(1) NOT NULL DEFAULT 0,
  `crt` text NOT NULL,
  `llave` text NOT NULL,
  `cuit` varchar(50) NOT NULL,
  `razon` varchar(120) NOT NULL,
  `direccion` text NOT NULL,
  `brutos` bigint(20) NOT NULL,
  `actividad` date NOT NULL,
  `estado` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `afiptmp`;
CREATE TABLE `afiptmp` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `factura` int(8) unsigned zerofill NOT NULL,
  `idcliente` int(11) NOT NULL,
  `mail` int(11) NOT NULL,
  `contador` int(3) NOT NULL,
  `logafip` text NOT NULL,
  `idoperacion` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `almacen`;
CREATE TABLE `almacen` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `userid` int(6) unsigned zerofill NOT NULL,
  `productoid` int(11) NOT NULL,
  `serial_producto` varchar(30) NOT NULL,
  `mac_producto` varchar(25) NOT NULL,
  `fecha_ingreso` date NOT NULL,
  `fecha_salida` date NOT NULL,
  `estado` varchar(14) NOT NULL DEFAULT 'disponible',
  `cantidad` int(11) NOT NULL DEFAULT 1,
  `catid` varchar(20) NOT NULL DEFAULT 'producto',
  `costo` decimal(12,2) NOT NULL,
  `idproveedor` int(4) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `alquileres`;
CREATE TABLE `alquileres` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `userid` int(6) unsigned zerofill NOT NULL,
  `fechaingreso` date NOT NULL,
  `fechaproxima` date NOT NULL,
  `productoid` int(11) NOT NULL,
  `ciclo` int(11) NOT NULL,
  `tipoa` varchar(15) NOT NULL,
  `totalcuota` int(3) NOT NULL,
  `ncuota` int(3) NOT NULL,
  `monto` decimal(12,2) NOT NULL,
  `state` varchar(8) NOT NULL DEFAULT 'activo',
  `idinstall` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `alquiler_cliente` (`tipoa`,`state`,`totalcuota`,`userid`,`monto`,`productoid`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `banner`;
CREATE TABLE `banner` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `imagen` varchar(150) NOT NULL,
  `url` text NOT NULL,
  `modal` varchar(10) NOT NULL,
  `orden` int(3) NOT NULL,
  `time` int(7) NOT NULL DEFAULT 1500,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `blacklist`;
CREATE TABLE `blacklist` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` text NOT NULL,
  `ip` text NOT NULL,
  `fecha` datetime NOT NULL,
  `contador` int(11) NOT NULL,
  `detalles` text NOT NULL,
  `monitor_id` text NOT NULL,
  `report_id` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `botwhatsapp`;
CREATE TABLE `botwhatsapp` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `titulo` text NOT NULL,
  `tipo` int(11) NOT NULL,
  `accion` int(11) NOT NULL,
  `items` text NOT NULL,
  `disparador` int(11) NOT NULL,
  `mensaje_disparador` text NOT NULL,
  `mensajebody` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `campos_personalizados`;
CREATE TABLE `campos_personalizados` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `orden` int(3) NOT NULL,
  `nombre` varchar(50) NOT NULL,
  `tipo` varchar(10) NOT NULL,
  `descripcion` text NOT NULL,
  `combo` text NOT NULL,
  `requerido` varchar(8) NOT NULL,
  `name_mysql` varchar(120) NOT NULL,
  `ancho` varchar(10) NOT NULL,
  `defecto` varchar(2) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `chats_telegram`;
CREATE TABLE `chats_telegram` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `data` text NOT NULL,
  `user_id` int(11) NOT NULL,
  `unread` int(11) NOT NULL,
  `orden` int(11) NOT NULL,
  `tiempos` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `cloud`;
CREATE TABLE `cloud` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tipo` varchar(20) NOT NULL,
  `estado` varchar(2) NOT NULL,
  `token` text NOT NULL,
  `upbackup` varchar(2) NOT NULL,
  `uplog` varchar(2) NOT NULL,
  `upvisitadas` varchar(2) NOT NULL,
  `idcarpeta` text NOT NULL,
  `tokenupdate` text NOT NULL,
  `clienteid` varchar(150) NOT NULL,
  `clientesecret` varchar(150) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `conexiones`;
CREATE TABLE `conexiones` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `ip` varchar(16) DEFAULT NULL,
  `src` varchar(16) DEFAULT NULL,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `user` varchar(64) NOT NULL,
  `router` int(4) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ip` (`ip`),
  KEY `user` (`user`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci ROW_FORMAT=COMPRESSED;


DROP TABLE IF EXISTS `contratos`;
CREATE TABLE `contratos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(11) unsigned DEFAULT NULL,
  `titulo` varchar(100) NOT NULL,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `inicio` date NOT NULL,
  `fin` date NOT NULL,
  `meses` int(2) NOT NULL,
  `html` mediumtext NOT NULL,
  `portal` varchar(2) NOT NULL,
  `operador` int(3) NOT NULL,
  `estado` int(1) NOT NULL,
  `plantilla` int(3) NOT NULL,
  `firmado` date NOT NULL,
  `numero_externo` varchar(30) NOT NULL,
  `logo_contrato` varchar(5) NOT NULL DEFAULT 'on',
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`),
  KEY `fecha` (`fecha`),
  KEY `inicio` (`inicio`),
  KEY `fin` (`fin`),
  KEY `operador` (`operador`),
  KEY `estado` (`estado`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `credito`;
CREATE TABLE `credito` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(6) unsigned zerofill NOT NULL,
  `idfactura` int(8) unsigned zerofill NOT NULL,
  `fechaingreso` date NOT NULL,
  `fecha_limite` date NOT NULL,
  `operador` int(11) NOT NULL,
  `descripcion` mediumtext NOT NULL,
  `estado` int(1) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `cronfactura`;
CREATE TABLE `cronfactura` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(11) NOT NULL,
  `impuesto` varchar(20) NOT NULL,
  `fecha` date NOT NULL,
  `datauser` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `cuponcd`;
CREATE TABLE `cuponcd` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(11) NOT NULL,
  `cupon` text NOT NULL,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `departamentos`;
CREATE TABLE `departamentos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `dp` text NOT NULL,
  `dsp` text NOT NULL,
  `maildp` text NOT NULL,
  `color` varchar(20) NOT NULL,
  `portal` varchar(3) NOT NULL,
  `asuntos` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `dte`;
CREATE TABLE `dte` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(11) NOT NULL,
  `idfactura` int(11) NOT NULL,
  `tipodoc` int(1) NOT NULL,
  `neto` decimal(12,2) NOT NULL,
  `iva` decimal(12,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `token` text NOT NULL,
  `rut` varchar(20) NOT NULL,
  `razon` varchar(150) NOT NULL,
  `folio` int(11) NOT NULL,
  `folio_credito` int(11) NOT NULL,
  `data` text NOT NULL,
  `fecha` date NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`),
  KEY `idfactura` (`idfactura`),
  KEY `fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `electronicatmp`;
CREATE TABLE `electronicatmp` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `factura` int(8) unsigned zerofill NOT NULL,
  `idcliente` int(11) NOT NULL,
  `mail` int(11) NOT NULL,
  `contador` int(11) NOT NULL,
  `idoperacion` int(11) NOT NULL,
  `api` varchar(20) NOT NULL,
  `tipodoc` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `emisores`;
CREATE TABLE `emisores` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(350) NOT NULL,
  `equipo` varchar(350) NOT NULL,
  `ip` varchar(350) NOT NULL,
  `estado` int(1) NOT NULL,
  `user` text NOT NULL,
  `password` text NOT NULL,
  `access` varchar(3) NOT NULL,
  `alert` varchar(3) NOT NULL DEFAULT 'on',
  `lglt` varchar(350) NOT NULL,
  `alert2` varchar(2) NOT NULL,
  `snmp` int(1) NOT NULL,
  `snmp_comunidad` varchar(50) NOT NULL DEFAULT 'public',
  `snmp_version` int(1) NOT NULL DEFAULT 1,
  `port_web` varchar(8) NOT NULL DEFAULT '80',
  `fabricante` int(1) NOT NULL,
  `correos` text NOT NULL,
  `telefonos` text NOT NULL,
  `state_snmp` int(1) NOT NULL,
  `oid` text NOT NULL,
  `debug` int(1) NOT NULL,
  `personalizados` mediumtext NOT NULL,
  `direccion` text NOT NULL,
  `retraso` int(2) NOT NULL,
  `counterping` int(2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `nombre` (`nombre`),
  KEY `emisores_idx_id_nombre` (`id`,`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `fabricantes`;
CREATE TABLE `fabricantes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` text NOT NULL,
  `identificador` int(11) NOT NULL,
  `tipo` int(11) NOT NULL,
  `api` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `facturaitems`;
CREATE TABLE `facturaitems` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idfactura` int(8) unsigned zerofill NOT NULL,
  `descripcion` text NOT NULL,
  `cantidad` decimal(12,2) NOT NULL DEFAULT 0.00,
  `idalmacen` int(11) NOT NULL,
  `unidades` int(11) NOT NULL DEFAULT 1,
  `impuesto` decimal(4,2) NOT NULL,
  `block` int(1) NOT NULL,
  `impuesto911` decimal(12,2) NOT NULL,
  `clave_invoice` varchar(30) NOT NULL,
  `tipoitem` int(1) NOT NULL,
  `montodescuento` decimal(12,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idfactura` (`idfactura`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `facturas`;
CREATE TABLE `facturas` (
  `id` int(8) unsigned zerofill NOT NULL AUTO_INCREMENT,
  `legal` int(11) NOT NULL,
  `idcliente` int(6) unsigned zerofill NOT NULL,
  `emitido` date NOT NULL,
  `vencimiento` date NOT NULL,
  `pago` date NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `forma` varchar(50) NOT NULL,
  `estado` varchar(10) NOT NULL DEFAULT 'No pagado',
  `tipo` int(1) NOT NULL DEFAULT 1,
  `cobrado` decimal(12,2) NOT NULL,
  `iva_igv` decimal(12,2) NOT NULL,
  `sub_total` decimal(12,2) NOT NULL,
  `impuesto` varchar(5) NOT NULL DEFAULT 'NO',
  `mp_id` varchar(80) NOT NULL,
  `mp_estado` varchar(50) NOT NULL,
  `payu_id` varchar(50) NOT NULL,
  `payu_pdf` mediumtext NOT NULL,
  `payu_tipo` varchar(20) NOT NULL,
  `payu_urlpdf` mediumtext NOT NULL,
  `oxxo_id` varchar(50) NOT NULL,
  `oxxo_referencia` varchar(20) NOT NULL,
  `total_khipu` decimal(12,2) NOT NULL,
  `id_khipu` varchar(30) NOT NULL,
  `url_khipu` text NOT NULL,
  `barcode_cobro_digital` varchar(100) NOT NULL,
  `data_cobro_digital` text NOT NULL,
  `otros_impuestos` text NOT NULL,
  `siro` int(1) NOT NULL,
  `hashsiro` text NOT NULL,
  `siroconcepto` int(1) NOT NULL,
  `barcode_siro` varchar(60) NOT NULL,
  `percepcion_afip` decimal(12,2) NOT NULL,
  `saldo` decimal(12,2) NOT NULL,
  `moneda` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `facturas_idx_estado_idclien_id_cobrado` (`id`,`cobrado`),
  KEY `facturas_idx_estado_idcliente` (`estado`,`idcliente`),
  KEY `facturas_vencimiento` (`vencimiento`),
  KEY `totales_facturas` (`moneda`,`estado`,`vencimiento`),
  KEY `cliente_total` (`estado`,`idcliente`,`total`),
  KEY `buscar_fc_mes` (`tipo`,`idcliente`,`vencimiento`),
  KEY `clientes_vencimiento` (`estado`,`idcliente`,`vencimiento`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `factura_electronica_chile`;
CREATE TABLE `factura_electronica_chile` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(11) NOT NULL,
  `idfactura` int(11) NOT NULL,
  `tipodoc` int(1) NOT NULL,
  `datasent` text NOT NULL,
  `data` text NOT NULL,
  `neto` decimal(12,2) NOT NULL,
  `iva` decimal(12,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `rut` varchar(20) NOT NULL,
  `razon` varchar(150) NOT NULL,
  `fecha` date NOT NULL,
  `api` varchar(30) NOT NULL,
  `estado` varchar(50) NOT NULL,
  `folio_credito` varchar(100) NOT NULL DEFAULT '0',
  `folio` text NOT NULL,
  `token` text NOT NULL,
  `xml` text NOT NULL,
  `pdf` mediumtext NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`),
  KEY `idfactura` (`idfactura`),
  KEY `fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `factura_electronica_colombia`;
CREATE TABLE `factura_electronica_colombia` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(11) NOT NULL,
  `idfactura` int(11) NOT NULL,
  `tipodoc` int(1) NOT NULL,
  `neto` decimal(15,2) NOT NULL,
  `iva` decimal(15,2) NOT NULL,
  `total` decimal(15,2) NOT NULL,
  `nit` varchar(20) NOT NULL,
  `razon` varchar(150) NOT NULL,
  `data` text NOT NULL,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `api` varchar(30) NOT NULL,
  `estado_anulado` text NOT NULL,
  `datasent` text NOT NULL,
  `cufe` text NOT NULL,
  `estado` varchar(10) NOT NULL,
  `prefijo` varchar(10) NOT NULL,
  `numero` varchar(20) NOT NULL,
  `secuencial` text NOT NULL,
  `mail` int(1) NOT NULL,
  `adjunto` int(1) NOT NULL,
  `debug` int(1) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`),
  KEY `idfactura` (`idfactura`),
  KEY `fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `factura_electronica_dominicana`;
CREATE TABLE `factura_electronica_dominicana` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(11) NOT NULL,
  `idfactura` int(11) NOT NULL,
  `tipodoc` int(1) NOT NULL,
  `neto` decimal(15,2) NOT NULL,
  `iva` decimal(15,2) NOT NULL,
  `total` decimal(15,2) NOT NULL,
  `rnc` varchar(20) NOT NULL,
  `razon` varchar(150) NOT NULL,
  `data` text NOT NULL,
  `datasent` text NOT NULL,
  `fecha` date NOT NULL,
  `api` varchar(30) NOT NULL,
  `estado` varchar(50) NOT NULL,
  `estado_anulado` varchar(100) NOT NULL,
  `authdoc` varchar(20) NOT NULL,
  `xml` text NOT NULL,
  `pdf` mediumtext NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`),
  KEY `idfactura` (`idfactura`),
  KEY `fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `factura_electronica_ecuador`;
CREATE TABLE `factura_electronica_ecuador` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(11) NOT NULL,
  `idfactura` int(11) NOT NULL,
  `neto` decimal(12,2) NOT NULL,
  `iva` decimal(12,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `token` text NOT NULL,
  `ruc` varchar(20) NOT NULL,
  `razon` varchar(150) NOT NULL,
  `nfactura` text NOT NULL,
  `data` text NOT NULL,
  `fecha` date NOT NULL,
  `api` varchar(30) NOT NULL,
  `nfactura_credito` text NOT NULL,
  `data_credito` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`),
  KEY `idfactura` (`idfactura`),
  KEY `fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `factura_electronica_guatemala`;
CREATE TABLE `factura_electronica_guatemala` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(11) NOT NULL,
  `idfactura` int(11) NOT NULL,
  `iva` decimal(12,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `uuid` text NOT NULL,
  `nit` varchar(20) NOT NULL,
  `razon` varchar(150) NOT NULL,
  `nfactura` text NOT NULL,
  `data` text NOT NULL,
  `fecha` date NOT NULL,
  `api` varchar(30) NOT NULL,
  `nfactura_credito` text NOT NULL,
  `data_credito` text NOT NULL,
  `sandbox` tinyint(1) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `factura_electronica_mexico`;
CREATE TABLE `factura_electronica_mexico` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(11) NOT NULL,
  `idfactura` int(11) NOT NULL,
  `tipodoc` int(1) NOT NULL,
  `neto` decimal(12,2) NOT NULL,
  `iva` decimal(12,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `token` text NOT NULL,
  `rut` varchar(20) NOT NULL,
  `razon` varchar(150) NOT NULL,
  `folio` text NOT NULL,
  `folio_credito` text NOT NULL,
  `data` text NOT NULL,
  `fecha` date NOT NULL,
  `api` varchar(30) NOT NULL,
  `estado_anulado` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`),
  KEY `idfactura` (`idfactura`),
  KEY `fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `factura_electronica_panama`;
CREATE TABLE `factura_electronica_panama` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(11) NOT NULL,
  `idfactura` int(11) NOT NULL,
  `tipodoc` int(1) NOT NULL,
  `neto` decimal(15,2) NOT NULL,
  `iva` decimal(15,2) NOT NULL,
  `total` decimal(15,2) NOT NULL,
  `ruc` varchar(20) NOT NULL,
  `razon` varchar(150) NOT NULL,
  `data` text NOT NULL,
  `fecha` date NOT NULL,
  `api` varchar(30) NOT NULL,
  `estado_anulado` text NOT NULL,
  `datasent` text NOT NULL,
  `estado` varchar(50) NOT NULL,
  `numero` varchar(20) NOT NULL,
  `mail` int(1) NOT NULL,
  `debug` int(1) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`),
  KEY `idfactura` (`idfactura`),
  KEY `fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `factura_electronica_paraguay`;
CREATE TABLE `factura_electronica_paraguay` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(11) NOT NULL,
  `idfactura` int(11) NOT NULL,
  `tipodoc` int(1) NOT NULL,
  `datasent` text NOT NULL,
  `data` text NOT NULL,
  `neto` decimal(15,3) NOT NULL,
  `iva` decimal(15,3) NOT NULL,
  `total` decimal(15,3) NOT NULL,
  `ruc` varchar(20) NOT NULL,
  `razon` varchar(150) NOT NULL,
  `fecha` date NOT NULL,
  `api` varchar(30) NOT NULL,
  `estado` varchar(50) NOT NULL,
  `estado_anulado` varchar(100) NOT NULL,
  `numero` text NOT NULL,
  `cdc` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`),
  KEY `idfactura` (`idfactura`),
  KEY `fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `factura_electronica_peru`;
CREATE TABLE `factura_electronica_peru` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(11) NOT NULL,
  `idfactura` int(11) NOT NULL,
  `tipodoc` int(1) NOT NULL,
  `neto` decimal(12,2) NOT NULL,
  `iva` decimal(12,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `total_inafecta` decimal(12,2) NOT NULL,
  `total_descuento` decimal(12,2) NOT NULL,
  `sunat_description` text NOT NULL,
  `ruc` varchar(20) NOT NULL,
  `razon` varchar(150) NOT NULL,
  `data` text NOT NULL,
  `fecha` date NOT NULL,
  `api` varchar(30) NOT NULL,
  `estado_anulado` text NOT NULL,
  `sunat_note` text NOT NULL,
  `sunat_responsecode` text NOT NULL,
  `sunat_soap_error` text NOT NULL,
  `aceptada_por_sunat` int(1) NOT NULL,
  `send_data` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`),
  KEY `idfactura` (`idfactura`),
  KEY `fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `firewall`;
CREATE TABLE `firewall` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `ip` varchar(150) NOT NULL,
  `valor` text NOT NULL,
  `estado` varchar(13) NOT NULL DEFAULT 'activo',
  `nodo` int(11) NOT NULL,
  `tipo` int(2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ip` (`ip`),
  KEY `nodo` (`nodo`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `formatos`;
CREATE TABLE `formatos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `html` mediumtext NOT NULL,
  `tipoaviso` varchar(15) NOT NULL,
  `asuntofactura` varchar(120) NOT NULL,
  `tamano` varchar(10) NOT NULL DEFAULT 'A4',
  `ancho` int(11) NOT NULL DEFAULT 80,
  `alto` int(11) NOT NULL DEFAULT 200,
  `posicion` varchar(5) NOT NULL,
  `descripcion` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `tipoaviso` (`tipoaviso`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `gastos`;
CREATE TABLE `gastos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `descripcion` text NOT NULL,
  `fecha` date NOT NULL,
  `tipo` varchar(8) NOT NULL,
  `monto` decimal(12,2) NOT NULL,
  `idadmin` int(3) NOT NULL,
  `referencia` text NOT NULL,
  `idnodo` int(3) NOT NULL,
  `recurrente` int(2) NOT NULL,
  `archivo` text NOT NULL,
  `uid` text NOT NULL,
  `proveedor` int(5) NOT NULL,
  `personalizados` mediumtext NOT NULL,
  `moneda` int(5) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `gateway_invoice`;
CREATE TABLE `gateway_invoice` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `proveedor` text NOT NULL,
  `estado` varchar(5) NOT NULL,
  `pais` varchar(50) NOT NULL,
  `data` text NOT NULL,
  `link` text NOT NULL,
  `debug` int(1) NOT NULL,
  `custom` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `graficosoids`;
CREATE TABLE `graficosoids` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `titulo` text NOT NULL,
  `titulov` text NOT NULL,
  `publico` varchar(2) NOT NULL,
  `data` text NOT NULL,
  `idequipo` int(11) NOT NULL,
  `alto` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idequipo` (`idequipo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `hotspot_fichas`;
CREATE TABLE `hotspot_fichas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user` varchar(150) NOT NULL,
  `password` varchar(150) NOT NULL,
  `estado` int(1) NOT NULL,
  `perfil` int(11) NOT NULL,
  `fecha_creacion` timestamp NOT NULL DEFAULT current_timestamp(),
  `fecha_activacion` datetime NOT NULL,
  `fecha_fin` datetime NOT NULL,
  `grupo` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `perfil` (`perfil`),
  KEY `user` (`user`),
  KEY `grupo` (`grupo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `hotspot_perfiles`;
CREATE TABLE `hotspot_perfiles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(150) NOT NULL,
  `descripcion` text NOT NULL,
  `url_hotspot` text NOT NULL,
  `prefijo` varchar(50) NOT NULL,
  `server` varchar(100) NOT NULL,
  `profile` text NOT NULL,
  `costo` decimal(12,2) NOT NULL,
  `longitud_user` int(11) NOT NULL,
  `longitud_password` int(11) NOT NULL,
  `user_num` varchar(3) NOT NULL,
  `pass_num` varchar(3) NOT NULL,
  `limit_time` text NOT NULL,
  `limit_bytes` text NOT NULL,
  `router` int(11) NOT NULL,
  `plantilla` int(11) NOT NULL,
  `pin` varchar(2) NOT NULL,
  `moneda` int(5) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `router` (`router`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `hotspot_plantillas`;
CREATE TABLE `hotspot_plantillas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` text NOT NULL,
  `html` text NOT NULL,
  `tamano` varchar(20) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `hotspot_router`;
CREATE TABLE `hotspot_router` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `ip` varchar(150) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `user` varchar(150) NOT NULL,
  `password` varchar(150) NOT NULL,
  `estado` int(1) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `instalaciones`;
CREATE TABLE `instalaciones` (
  `id` int(8) unsigned zerofill NOT NULL AUTO_INCREMENT,
  `userid` int(6) unsigned zerofill NOT NULL,
  `fecha_ingreso` date NOT NULL,
  `fecha_salida` date NOT NULL,
  `idtecnico` int(6) NOT NULL,
  `direccion` varchar(250) NOT NULL,
  `telefono` text NOT NULL,
  `movil` text NOT NULL,
  `idnodo` int(4) NOT NULL,
  `email` text NOT NULL,
  `cedula` varchar(20) NOT NULL,
  `estate` varchar(15) NOT NULL DEFAULT 'PENDIENTE',
  `cliente` varchar(120) NOT NULL,
  `notas` text NOT NULL,
  `fecha_instalacion` datetime NOT NULL,
  `zona` int(3) NOT NULL,
  `idvendedor` int(3) NOT NULL,
  `tipo_estrato` int(2) NOT NULL DEFAULT 4,
  PRIMARY KEY (`id`),
  KEY `userid` (`userid`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `ipv4`;
CREATE TABLE `ipv4` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nodo` int(3) NOT NULL,
  `nombre` varchar(180) NOT NULL,
  `red` varchar(21) NOT NULL,
  `cidr` varchar(3) NOT NULL,
  `tipo` int(2) NOT NULL,
  `rangos` text NOT NULL,
  `host` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `nodo` (`nodo`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DELIMITER ;;

CREATE TRIGGER `cambionombre` BEFORE UPDATE ON `ipv4` FOR EACH ROW
IF NEW.nombre <> OLD.nombre  THEN
UPDATE radreply SET value=NEW.nombre WHERE value=OLD.nombre;
END IF;;

CREATE TRIGGER `cambiodetipo` AFTER UPDATE ON `ipv4` FOR EACH ROW
IF NEW.tipo <> OLD.tipo  THEN
UPDATE tblservicios SET tipoipv4=NEW.tipo,ip='' WHERE redipv4=NEW.id;
END IF;;

DELIMITER ;

DROP TABLE IF EXISTS `linkpagos`;
CREATE TABLE `linkpagos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `file` mediumtext NOT NULL,
  `transaccion` varchar(50) NOT NULL,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `estado` int(2) NOT NULL,
  `enviados` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `login`;
CREATE TABLE `login` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `password` varchar(32) NOT NULL,
  `privilege` int(6) NOT NULL DEFAULT 0,
  `nombre` varchar(300) DEFAULT NULL,
  `nodo` varchar(350) NOT NULL,
  `correo` varchar(350) NOT NULL,
  `chat` int(1) NOT NULL,
  `acceso` text NOT NULL,
  `estado` int(1) DEFAULT NULL,
  `timeout` int(4) NOT NULL,
  `mail` int(1) NOT NULL DEFAULT 1,
  `api` int(1) NOT NULL,
  `avatar` mediumblob NOT NULL,
  `color_avatar` varchar(10) NOT NULL DEFAULT '#348fe2',
  `movil` varchar(15) NOT NULL,
  `fb` varchar(150) NOT NULL,
  `twitter` varchar(150) NOT NULL,
  `comision_cobro` decimal(12,2) NOT NULL,
  `token_api` text NOT NULL,
  `recover` text NOT NULL,
  `dia_acceso` varchar(20) NOT NULL DEFAULT '1,1,1,1,1,1,1',
  `inicio_acceso` varchar(10) NOT NULL DEFAULT '00:00',
  `fin_acceso` varchar(10) NOT NULL DEFAULT '23:59',
  `new_password` text NOT NULL,
  `twofactor` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `password` (`password`),
  KEY `correo` (`correo`),
  KEY `username` (`username`),
  KEY `new_password` (`new_password`(3072))
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `loglogin`;
CREATE TABLE `loglogin` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idadmin` varchar(24) NOT NULL,
  `fecha` datetime NOT NULL,
  `ipadmin` varchar(20) NOT NULL,
  `error` varchar(50) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `logsistema`;
CREATE TABLE `logsistema` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `log` text NOT NULL,
  `fechalog` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `operador` int(3) NOT NULL,
  `idcliente` int(11) NOT NULL,
  `tipolog` int(1) NOT NULL,
  `data_cambios` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`),
  KEY `operador` (`operador`),
  KEY `fechalog` (`fechalog`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `mail`;
CREATE TABLE `mail` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `userid` int(6) unsigned zerofill NOT NULL,
  `asunto` varchar(50) NOT NULL,
  `cuerpo` text NOT NULL,
  `adjunto` varchar(200) DEFAULT NULL,
  `enviado` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `estado` varchar(10) NOT NULL DEFAULT 'no enviado',
  `mailremitente` varchar(150) NOT NULL,
  `maildestino` varchar(150) NOT NULL,
  `log` varchar(150) NOT NULL,
  `pdfpayu` varchar(150) NOT NULL,
  `facturaid` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `userid` (`userid`),
  KEY `estado` (`estado`),
  KEY `enviado` (`enviado`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `materiales`;
CREATE TABLE `materiales` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idalmacen` int(11) NOT NULL,
  `idinstall` int(8) unsigned zerofill NOT NULL,
  `cantidad` varchar(50) NOT NULL,
  `detalle` text NOT NULL,
  `tipo` varchar(50) NOT NULL,
  `serial` varchar(50) NOT NULL,
  `mac` varchar(20) NOT NULL,
  `tipopro` varchar(20) NOT NULL,
  `condicion` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idalmacen` (`idalmacen`),
  KEY `idinstall` (`idinstall`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `mensajeria`;
CREATE TABLE `mensajeria` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `destino` varchar(120) NOT NULL,
  `idcliente` int(11) NOT NULL,
  `mensaje` text NOT NULL,
  `adjunto` text NOT NULL,
  `gateway` int(2) NOT NULL,
  `estado` int(1) NOT NULL,
  `fecha` datetime NOT NULL DEFAULT current_timestamp(),
  `log` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`),
  KEY `estado` (`estado`),
  KEY `fecha` (`fecha`),
  KEY `gateway` (`gateway`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `monedas`;
CREATE TABLE `monedas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `codigo` text NOT NULL,
  `unidad_letra` text DEFAULT NULL,
  `sufijo` text NOT NULL,
  `cambio` decimal(12,2) NOT NULL DEFAULT 1.00,
  `format` varchar(20) NOT NULL,
  `simbolo` varchar(10) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `nap`;
CREATE TABLE `nap` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `descripcion` text NOT NULL,
  `puertos` int(11) NOT NULL,
  `coordenadas` varchar(150) NOT NULL,
  `ubicacion` text NOT NULL,
  `puertoinicio` int(1) NOT NULL DEFAULT 1,
  `detalles` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `nap_idx_id_descripcion` (`id`,`descripcion`(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `nas`;
CREATE TABLE `nas` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `idserver` int(11) NOT NULL,
  `nasname` varchar(120) NOT NULL,
  `shortname` varchar(80) DEFAULT NULL,
  `type` varchar(30) DEFAULT 'other',
  `ports` int(5) DEFAULT NULL,
  `secret` varchar(60) NOT NULL DEFAULT 'secret',
  `server` varchar(64) DEFAULT NULL,
  `community` varchar(50) DEFAULT NULL,
  `description` varchar(50) DEFAULT 'RADIUS Client',
  PRIMARY KEY (`id`),
  KEY `nasname` (`nasname`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `newcampos`;
CREATE TABLE `newcampos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tabla` varchar(100) NOT NULL,
  `campos` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `notacredito`;
CREATE TABLE `notacredito` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cliente` int(6) unsigned zerofill NOT NULL,
  `pdf` text NOT NULL,
  `invoice_num` varchar(50) NOT NULL,
  `credito_num` varchar(50) NOT NULL,
  `cae` varchar(150) NOT NULL,
  `vto` date NOT NULL,
  `barcode` varchar(150) NOT NULL,
  `total` decimal(10,2) NOT NULL,
  `emitido` date NOT NULL,
  `idafip` int(11) NOT NULL,
  `idempresa` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `cliente` (`cliente`),
  KEY `idafip` (`idafip`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `notas`;
CREATE TABLE `notas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(6) unsigned zerofill NOT NULL,
  `asunto` varchar(150) NOT NULL,
  `mensaje` text NOT NULL,
  `fecha` datetime NOT NULL,
  `adjuntos` varchar(300) NOT NULL,
  `idoperador` int(3) NOT NULL,
  `imagen` longtext NOT NULL,
  `tipo` int(1) NOT NULL,
  `portal` varchar(2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `noticenter`;
CREATE TABLE `noticenter` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `detalle` text NOT NULL,
  `tipo` int(1) NOT NULL,
  `titulo` tinytext NOT NULL,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `link` text NOT NULL,
  `portal` int(1) NOT NULL,
  `idsoporte` int(11) NOT NULL,
  `idreporte` int(11) NOT NULL,
  `cliente` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `tipo` (`tipo`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `notificaciones_factura`;
CREATE TABLE `notificaciones_factura` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `mensaje` text NOT NULL,
  `vencimiento` date NOT NULL,
  `filtro` varchar(50) NOT NULL,
  `aplicados` int(11) NOT NULL,
  `nombre` varchar(50) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `oids`;
CREATE TABLE `oids` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `oid` varchar(100) NOT NULL,
  `intervalo` int(2) NOT NULL DEFAULT 1,
  `tipo` varchar(30) NOT NULL,
  `estado` int(1) NOT NULL DEFAULT 1,
  `idequipo` int(11) NOT NULL,
  `activar` varchar(2) NOT NULL,
  `lastcheck` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `lastdata` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idequipo` (`idequipo`),
  KEY `intervalo` (`intervalo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `openvpn`;
CREATE TABLE `openvpn` (
  `id` int(11) NOT NULL,
  `router` int(11) NOT NULL,
  `ip` varchar(20) NOT NULL,
  `redes` mediumtext NOT NULL,
  `usuario` varchar(50) NOT NULL,
  `password` varchar(50) NOT NULL,
  `estado` int(1) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `router` (`router`),
  KEY `login` (`usuario`,`password`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `operaciones`;
CREATE TABLE `operaciones` (
  `id` int(8) unsigned zerofill NOT NULL AUTO_INCREMENT,
  `nfactura` int(8) unsigned zerofill NOT NULL,
  `idcliente` int(6) unsigned zerofill NOT NULL,
  `fecha_pago` datetime NOT NULL,
  `operador` int(3) NOT NULL,
  `transaccion` varchar(60) DEFAULT NULL,
  `meses` int(2) NOT NULL,
  `forma_pago` text NOT NULL,
  `descripcion` text NOT NULL,
  `cobrado` decimal(12,2) NOT NULL,
  `comision` decimal(12,2) NOT NULL,
  `saldo` decimal(12,2) NOT NULL,
  `descripcion_pago` text NOT NULL,
  `estado_invoice` int(1) NOT NULL,
  `idmoneda` int(2) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`),
  KEY `fecha_pago` (`fecha_pago`),
  KEY `ultimo_pago` (`idcliente`,`fecha_pago`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `pasarela`;
CREATE TABLE `pasarela` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idserver` text NOT NULL,
  `pais` varchar(20) NOT NULL,
  `pin` text NOT NULL,
  `cuenta` text NOT NULL,
  `correo` text NOT NULL,
  `tipo` varchar(20) NOT NULL,
  `dias` int(2) NOT NULL,
  `estado` varchar(2) NOT NULL DEFAULT 'on',
  `sandbox` varchar(10) NOT NULL DEFAULT 'live',
  `comision` int(1) NOT NULL,
  `porcentaje` decimal(10,2) NOT NULL DEFAULT 5.40,
  `fijo` decimal(10,2) NOT NULL DEFAULT 0.30,
  `mp_atm` varchar(120) NOT NULL DEFAULT 'atm',
  `mp_ticket` varchar(120) NOT NULL DEFAULT 'ticket',
  `extra_1` int(11) NOT NULL,
  `extra_2` text NOT NULL,
  `extra_3` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `pasarelaotros`;
CREATE TABLE `pasarelaotros` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `pasarela` text NOT NULL,
  `dsp1` text NOT NULL,
  `dsp2` text NOT NULL,
  `dsp3` text NOT NULL,
  `dsp4` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `perfiles`;
CREATE TABLE `perfiles` (
  `id` int(6) NOT NULL AUTO_INCREMENT,
  `plan` varchar(300) NOT NULL,
  `descripcion` text NOT NULL,
  `velocidad` varchar(300) NOT NULL,
  `pcq` varchar(300) NOT NULL,
  `prioridad` varchar(350) NOT NULL,
  `costo` decimal(12,2) NOT NULL DEFAULT 0.00,
  `profile` varchar(500) NOT NULL,
  `lista` varchar(30) NOT NULL,
  `limitat` int(4) NOT NULL,
  `burst_limit` int(3) NOT NULL,
  `burst_threshold` int(3) NOT NULL,
  `burst_time` int(3) NOT NULL,
  `impuesto` decimal(4,2) NOT NULL,
  `api` int(1) NOT NULL,
  `id_mikrotik` varchar(200) NOT NULL DEFAULT '0',
  `limit_down` varchar(20) NOT NULL DEFAULT '0',
  `limit_up` varchar(20) NOT NULL DEFAULT '0',
  `parent` varchar(100) NOT NULL,
  `reuso` int(3) NOT NULL DEFAULT 1,
  `is_disabled` int(1) NOT NULL,
  `queue_type_down` varchar(50) NOT NULL DEFAULT 'default-small',
  `queue_type_up` varchar(50) NOT NULL DEFAULT 'default-small',
  PRIMARY KEY (`id`),
  KEY `perfiles_idx_id_plan` (`id`,`plan`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `perfilesvoip`;
CREATE TABLE `perfilesvoip` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `plan` varchar(100) NOT NULL,
  `minutos` int(11) NOT NULL,
  `valormovil` decimal(10,2) NOT NULL,
  `valorfijo` decimal(10,2) NOT NULL,
  `costo` decimal(12,2) NOT NULL,
  `descripcion` text NOT NULL,
  `notas` text NOT NULL,
  `impuesto` decimal(4,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `perfilesvoip_idx_id_plan` (`id`,`plan`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `predeterminado`;
CREATE TABLE `predeterminado` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` text NOT NULL,
  `data` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `productos`;
CREATE TABLE `productos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `producto` varchar(150) NOT NULL,
  `descripcion` text NOT NULL,
  `costo` decimal(12,2) NOT NULL,
  `medida` varchar(20) NOT NULL,
  `tipo` varchar(15) NOT NULL,
  `impuesto` decimal(4,2) NOT NULL,
  `clave_invoice` varchar(30) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `productos_idx_id_producto` (`id`,`producto`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `proveedores`;
CREATE TABLE `proveedores` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `proveedor` text NOT NULL,
  `telefono` varchar(50) NOT NULL,
  `mail` varchar(50) NOT NULL,
  `direccion` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `push`;
CREATE TABLE `push` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cliente` int(6) NOT NULL,
  `token` text NOT NULL,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp(),
  `estado` int(2) NOT NULL,
  `mensaje` text NOT NULL,
  `titulo` varchar(200) NOT NULL,
  `url` text NOT NULL,
  `tipo` int(1) NOT NULL,
  `text_url` varchar(120) NOT NULL,
  `id_signal` text NOT NULL,
  `portal` int(1) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `cliente` (`cliente`),
  KEY `estado` (`estado`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `radacct`;
CREATE TABLE `radacct` (
  `radacctid` bigint(21) NOT NULL AUTO_INCREMENT,
  `acctsessionid` varchar(64) NOT NULL DEFAULT '',
  `acctuniqueid` varchar(32) NOT NULL DEFAULT '',
  `username` varchar(64) NOT NULL DEFAULT '',
  `groupname` varchar(64) NOT NULL DEFAULT '',
  `realm` varchar(64) DEFAULT '',
  `nasipaddress` varchar(15) NOT NULL DEFAULT '',
  `nasportid` varchar(15) DEFAULT NULL,
  `nasporttype` varchar(32) DEFAULT NULL,
  `acctstarttime` datetime DEFAULT NULL,
  `acctupdatetime` datetime DEFAULT NULL,
  `acctstoptime` datetime DEFAULT NULL,
  `acctinterval` int(12) DEFAULT NULL,
  `acctsessiontime` int(12) unsigned DEFAULT NULL,
  `acctauthentic` varchar(32) DEFAULT NULL,
  `connectinfo_start` varchar(50) DEFAULT NULL,
  `connectinfo_stop` varchar(50) DEFAULT NULL,
  `acctinputoctets` bigint(20) DEFAULT NULL,
  `acctoutputoctets` bigint(20) DEFAULT NULL,
  `calledstationid` varchar(50) NOT NULL DEFAULT '',
  `callingstationid` varchar(50) NOT NULL DEFAULT '',
  `acctterminatecause` varchar(32) NOT NULL DEFAULT '',
  `servicetype` varchar(32) DEFAULT NULL,
  `framedprotocol` varchar(32) DEFAULT NULL,
  `framedipaddress` varchar(15) NOT NULL DEFAULT '',
  `idcliente` int(11) DEFAULT NULL,
  `idservicio` int(11) DEFAULT NULL,
  `opt` int(1) NOT NULL,
  `framedipv6address` varchar(45) NOT NULL DEFAULT '',
  `framedipv6prefix` varchar(45) NOT NULL DEFAULT '',
  `framedinterfaceid` varchar(44) NOT NULL DEFAULT '',
  `delegatedipv6prefix` varchar(45) NOT NULL DEFAULT '',
  `class` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`radacctid`),
  UNIQUE KEY `acctuniqueid` (`acctuniqueid`),
  KEY `username` (`username`),
  KEY `framedipaddress` (`framedipaddress`),
  KEY `acctsessionid` (`acctsessionid`),
  KEY `acctsessiontime` (`acctsessiontime`),
  KEY `acctstarttime` (`acctstarttime`),
  KEY `acctinterval` (`acctinterval`),
  KEY `acctstoptime` (`acctstoptime`),
  KEY `nasipaddress` (`nasipaddress`),
  KEY `idcliente` (`idcliente`),
  KEY `idservicio` (`idservicio`),
  KEY `opt` (`opt`),
  KEY `radacct_idx_acctstartt_acctoutput_acctinputo` (`acctstarttime`,`acctoutputoctets`,`acctinputoctets`),
  KEY `radacct_idx_idcliente_framedipad_acctstartt` (`idcliente`,`framedipaddress`,`acctstarttime`),
  KEY `framedipv6address` (`framedipv6address`),
  KEY `framedipv6prefix` (`framedipv6prefix`),
  KEY `framedinterfaceid` (`framedinterfaceid`),
  KEY `delegatedipv6prefix` (`delegatedipv6prefix`),
  KEY `bulk_close` (`acctstoptime`,`nasipaddress`,`acctstarttime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DELIMITER ;;

CREATE TRIGGER `idcliente-servicios` BEFORE INSERT ON `radacct` FOR EACH ROW
IF NEW.idcliente IS NULL THEN
SET NEW.idcliente=(Select idcliente from tblservicios where  pppuser=NEW.username);

SET NEW.idservicio=(Select id from tblservicios where  pppuser=NEW.username);

END IF;;

CREATE TRIGGER `online-cliente-radius` AFTER INSERT ON `radacct` FOR EACH ROW
IF NEW.nasportid IS NOT NULL  THEN
UPDATE tblservicios SET ip=NEW.framedipaddress WHERE pppuser=NEW.username and tipoipv4 IN('1','2');

UPDATE tblservicios SET status_user='ONLINE' WHERE status_user='OFFLINE' and pppuser=NEW.username;
END IF;;

CREATE TRIGGER `offline-cliente-radius` AFTER UPDATE ON `radacct` FOR EACH ROW
IF NEW.acctstoptime IS NOT NULL and NEW.nasportid IS NOT NULL THEN

UPDATE tblservicios SET status_user='OFFLINE' WHERE status_user='ONLINE' and pppuser=NEW.username;

UPDATE tblservicios SET ip='' WHERE pppuser=NEW.username and tipoipv4 IN('1','2');

END IF;;

DELIMITER ;

DROP TABLE IF EXISTS `radcheck`;
CREATE TABLE `radcheck` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL DEFAULT '',
  `attribute` varchar(64) NOT NULL DEFAULT '',
  `op` char(2) NOT NULL DEFAULT '==',
  `value` varchar(253) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `username` (`username`(32))
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `radgroupcheck`;
CREATE TABLE `radgroupcheck` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `groupname` varchar(64) NOT NULL DEFAULT '',
  `attribute` varchar(64) NOT NULL DEFAULT '',
  `op` char(2) NOT NULL DEFAULT '==',
  `value` varchar(253) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `groupname` (`groupname`(32))
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `radgroupreply`;
CREATE TABLE `radgroupreply` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `groupname` varchar(64) NOT NULL DEFAULT '',
  `attribute` varchar(64) NOT NULL DEFAULT '',
  `op` char(2) NOT NULL DEFAULT '=',
  `value` varchar(253) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `groupname` (`groupname`(32))
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `radpostauth`;
CREATE TABLE `radpostauth` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL DEFAULT '',
  `pass` varchar(64) NOT NULL DEFAULT '',
  `reply` varchar(32) NOT NULL DEFAULT '',
  `authdate` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `radreply`;
CREATE TABLE `radreply` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL DEFAULT '',
  `attribute` varchar(64) NOT NULL DEFAULT '',
  `op` char(2) NOT NULL DEFAULT '=',
  `value` varchar(253) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `username` (`username`(32))
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `radusergroup`;
CREATE TABLE `radusergroup` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL DEFAULT '',
  `groupname` varchar(64) NOT NULL DEFAULT '',
  `priority` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `username` (`username`(32))
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `reconexiones`;
CREATE TABLE `reconexiones` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cliente` int(6) unsigned zerofill NOT NULL,
  `facorigen` int(8) unsigned zerofill NOT NULL,
  `monto_reconexion` decimal(10,2) NOT NULL,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `estado` int(1) NOT NULL DEFAULT 1,
  `detalle` varchar(200) NOT NULL DEFAULT 'Reconexión del servicio por Corte',
  PRIMARY KEY (`id`),
  KEY `cliente` (`cliente`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `reporte`;
CREATE TABLE `reporte` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(6) unsigned zerofill NOT NULL,
  `asunto` varchar(100) NOT NULL,
  `fecha` date NOT NULL,
  `lugar` varchar(50) NOT NULL,
  `tipo` varchar(50) NOT NULL,
  `transaccion` varchar(50) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `adjunto` text NOT NULL,
  `mensaje` text NOT NULL,
  `estado` int(1) NOT NULL DEFAULT 1,
  `fecha2` datetime NOT NULL,
  `nfactura` int(8) unsigned zerofill NOT NULL,
  PRIMARY KEY (`id`),
  KEY `cliente` (`idcliente`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `saldos`;
CREATE TABLE `saldos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `iduser` int(6) unsigned zerofill NOT NULL,
  `idorigen` int(8) unsigned zerofill NOT NULL,
  `iddestino` int(8) unsigned zerofill NOT NULL,
  `estado` varchar(11) NOT NULL DEFAULT 'no cobrado',
  `monto` decimal(12,2) NOT NULL,
  `fecha` date NOT NULL,
  `descripcion` varchar(300) NOT NULL DEFAULT 'Saldo generado Automático',
  `codigopasarela` text NOT NULL,
  `moneda` int(5) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `iduser` (`iduser`,`estado`),
  KEY `cliente_saldo` (`estado`,`iduser`,`monto`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `server`;
CREATE TABLE `server` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nodo` varchar(150) NOT NULL,
  `ip` varchar(150) NOT NULL,
  `user` varchar(150) NOT NULL,
  `pass` varchar(150) NOT NULL,
  `coordenadas` varchar(350) NOT NULL,
  `version` varchar(350) NOT NULL DEFAULT '5',
  `estado` varchar(30) NOT NULL DEFAULT 'API-ERROR',
  `port_web` varchar(100) NOT NULL,
  `conexiones` varchar(5) NOT NULL,
  `modelo` varchar(150) NOT NULL,
  `seguridad` int(2) NOT NULL,
  `velocidad` varchar(20) NOT NULL DEFAULT 'queues',
  `secret_radius` varchar(30) NOT NULL,
  `serial` varchar(60) NOT NULL,
  `seguridad2` int(1) NOT NULL,
  `block` int(1) NOT NULL,
  `ip_radius` varchar(100) NOT NULL,
  `mantenimiento` int(1) NOT NULL,
  `api_ssl` varchar(4) NOT NULL,
  `port_api` varchar(10) NOT NULL DEFAULT '8728',
  `api` varchar(20) NOT NULL,
  `flow` int(2) NOT NULL,
  `openvpn` int(1) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `txt_nodo` (`id`,`nodo`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `smartolt`;
CREATE TABLE `smartolt` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tipo` int(11) NOT NULL,
  `idolt` int(11) NOT NULL,
  `idvlan` int(11) NOT NULL,
  `detalle` text NOT NULL,
  `extra` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `smsconfig`;
CREATE TABLE `smsconfig` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `url` varchar(500) NOT NULL,
  `userapi` text NOT NULL,
  `contrasenaapi` text NOT NULL,
  `proveedor` varchar(50) NOT NULL DEFAULT 'API genérico',
  `state` varchar(20) NOT NULL,
  `idequipo` varchar(15) NOT NULL,
  `pausa` int(11) NOT NULL,
  `pais` int(11) NOT NULL,
  `metodo` varchar(10) NOT NULL DEFAULT 'get',
  `limite` int(11) NOT NULL DEFAULT 160,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `smsinbox`;
CREATE TABLE `smsinbox` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cliente` int(11) NOT NULL,
  `mensaje` text NOT NULL,
  `fecha` datetime NOT NULL,
  `numero` varchar(30) NOT NULL,
  `view` int(1) NOT NULL,
  `idsms` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `iduser` (`cliente`),
  KEY `idsms` (`idsms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `smsmensajes`;
CREATE TABLE `smsmensajes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user` int(6) unsigned zerofill NOT NULL,
  `enviado` datetime NOT NULL,
  `ndestino` varchar(150) NOT NULL,
  `stado` varchar(12) NOT NULL DEFAULT 'en espera',
  `mensaje` text NOT NULL,
  `proveedor` int(2) NOT NULL,
  `error` text NOT NULL,
  `adjunto` varchar(200) NOT NULL,
  `creado` datetime NOT NULL,
  `w` int(2) NOT NULL,
  `archivo` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `user` (`user`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `soporte`;
CREATE TABLE `soporte` (
  `id` int(7) unsigned zerofill NOT NULL AUTO_INCREMENT,
  `idcliente` int(6) unsigned zerofill NOT NULL,
  `idsoporte` int(3) NOT NULL,
  `asunto` varchar(150) NOT NULL,
  `fecha_soporte` datetime NOT NULL,
  `estado` varchar(20) NOT NULL DEFAULT 'abierto',
  `operador` varchar(20) NOT NULL,
  `fecha_cerrado` datetime NOT NULL,
  `procede` varchar(15) NOT NULL,
  `solicitante` varchar(250) NOT NULL,
  `fechavisita` date NOT NULL,
  `turno` varchar(10) NOT NULL,
  `agendado` varchar(10) NOT NULL,
  `lastdate` datetime NOT NULL,
  `dp` int(2) NOT NULL,
  `cun` text NOT NULL,
  `motivo_cierre` text NOT NULL,
  `oculto` int(1) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`),
  KEY `estado` (`estado`),
  KEY `idsoporte` (`idsoporte`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `tareas`;
CREATE TABLE `tareas` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `titulo` tinytext NOT NULL,
  `estado` int(1) NOT NULL,
  `fecha_inicio` datetime NOT NULL,
  `horas` int(2) NOT NULL,
  `cliente` int(6) unsigned zerofill NOT NULL,
  `operador` int(3) NOT NULL,
  `minutos` int(2) NOT NULL,
  `direccion` text NOT NULL,
  `gps` tinytext NOT NULL,
  `tareas` text NOT NULL,
  `idproyecto` int(11) NOT NULL DEFAULT 1,
  `descripcion` text NOT NULL,
  `fecha_fin` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `operador` (`operador`),
  KEY `inicio` (`fecha_inicio`),
  KEY `cliente` (`cliente`),
  KEY `idproyecto` (`idproyecto`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `tblapi`;
CREATE TABLE `tblapi` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `comando` text NOT NULL,
  `estado` int(11) NOT NULL,
  `fecha` timestamp NOT NULL DEFAULT current_timestamp(),
  `nodo` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `tblavisouser`;
CREATE TABLE `tblavisouser` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cliente` int(6) unsigned zerofill NOT NULL,
  `mora` varchar(2) NOT NULL,
  `reconexion` varchar(2) NOT NULL,
  `impuesto` varchar(5) NOT NULL DEFAULT 'NO',
  `avatar_cliente` mediumblob NOT NULL,
  `chat` int(2) NOT NULL,
  `zona` int(4) NOT NULL,
  `diapago` int(2) NOT NULL DEFAULT 1,
  `tipopago` int(1) NOT NULL DEFAULT 1,
  `tipoaviso` int(1) NOT NULL,
  `meses` int(2) NOT NULL DEFAULT 1,
  `fecha_factura` date NOT NULL,
  `diafactura` int(2) NOT NULL DEFAULT 1,
  `avisopantalla` int(11) NOT NULL,
  `corteautomatico` int(2) NOT NULL,
  `avisosms` int(2) NOT NULL,
  `avisosms2` int(2) NOT NULL,
  `avisosms3` int(2) NOT NULL,
  `afip_condicion_iva` varchar(40) NOT NULL DEFAULT 'Consumidor Final',
  `afip` varchar(2) NOT NULL,
  `afip_condicion_venta` varchar(30) NOT NULL DEFAULT 'Otra',
  `afip_automatico` int(2) NOT NULL,
  `avatar_color` varchar(15) NOT NULL,
  `tiporecordatorio` int(1) NOT NULL,
  `afip_punto_venta` text NOT NULL,
  `id_telegram` int(11) NOT NULL,
  `router_eliminado` int(6) NOT NULL,
  `otros_impuestos` text NOT NULL,
  `mikrowisp_app_id` text NOT NULL,
  `isaviable` int(1) NOT NULL,
  `invoice_electronic` int(2) NOT NULL,
  `invoice_data` text NOT NULL,
  `fecha_suspendido` datetime NOT NULL,
  `limit_velocidad` int(2) NOT NULL,
  `mantenimiento` int(1) NOT NULL,
  `data_retirado` text NOT NULL,
  `fecha_retirado` date NOT NULL,
  `tipo_estrato` int(2) NOT NULL DEFAULT 4,
  `fecha_corte_fija` date NOT NULL,
  `mensaje_comprobante` int(11) NOT NULL,
  `id_moneda` int(5) NOT NULL DEFAULT 1,
  `afip_enable_percepcion` decimal(4,2) NOT NULL,
  `gatewaynoty` text NOT NULL,
  `fecha_registro` timestamp NOT NULL DEFAULT current_timestamp(),
  `empresa_afip` int(11) NOT NULL DEFAULT 1,
  `code_toku` varchar(100) NOT NULL,
  `tipo_doc` int(11) NOT NULL DEFAULT 0,
  `tipo_operacion` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `iduser` (`cliente`),
  KEY `isaviable` (`isaviable`),
  KEY `lista_user` (`isaviable`,`cliente`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `tblcolumnas`;
CREATE TABLE `tblcolumnas` (
  `id` int(8) NOT NULL AUTO_INCREMENT,
  `col` varchar(50) NOT NULL,
  `orden` int(11) NOT NULL,
  `visible` varchar(3) NOT NULL,
  `label` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `tblconfiguration`;
CREATE TABLE `tblconfiguration` (
  `id` int(8) NOT NULL AUTO_INCREMENT,
  `setting` text NOT NULL,
  `value` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `setting` (`setting`(32))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;


DROP TABLE IF EXISTS `tblservicios`;
CREATE TABLE `tblservicios` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idcliente` int(6) unsigned zerofill NOT NULL,
  `idperfil` int(11) NOT NULL,
  `nodo` int(11) NOT NULL,
  `descripcion` text NOT NULL,
  `costo` decimal(12,2) NOT NULL,
  `ipap` varchar(30) NOT NULL,
  `mac` varchar(80) NOT NULL,
  `ip` varchar(700) NOT NULL,
  `instalado` date NOT NULL,
  `antena` int(4) NOT NULL,
  `pppuser` varchar(60) NOT NULL,
  `ppppass` varchar(60) NOT NULL,
  `emisor` int(6) NOT NULL,
  `user_ubnt` text NOT NULL,
  `pass_ubnt` text NOT NULL,
  `tiposervicio` varchar(9) NOT NULL DEFAULT 'internet',
  `status_user` varchar(8) NOT NULL DEFAULT 'OFFLINE',
  `tipoipv4` int(1) NOT NULL,
  `redipv4` int(4) NOT NULL,
  `coordenadas` varchar(150) NOT NULL,
  `direccion` varchar(150) NOT NULL,
  `snmp_comunidad` varchar(100) NOT NULL DEFAULT 'public',
  `firewall_state` varchar(2) NOT NULL,
  `smartolt` text NOT NULL,
  `limitado` int(1) NOT NULL,
  `ppp_routes` varchar(50) NOT NULL,
  `ppp_localaddress` varchar(50) NOT NULL,
  `idnap` int(11) NOT NULL,
  `portnap` int(11) NOT NULL,
  `onu_sn` varchar(100) NOT NULL,
  `onu_ssid_wifi` varchar(100) NOT NULL,
  `onu_password_wifi` varchar(100) NOT NULL,
  `personalizados` mediumtext NOT NULL,
  `smartolt_catv` int(1) NOT NULL DEFAULT 1,
  `ipv6` varchar(120) NOT NULL,
  `ipv6_duid` varchar(100) NOT NULL,
  `last_connected` datetime NOT NULL,
  `trapemn_id` int(11) NOT NULL DEFAULT 0,
  `trapemn_data` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `plan` (`idperfil`),
  KEY `ip` (`ip`),
  KEY `tblservicios_idx_idcliente_nodo` (`idcliente`,`nodo`),
  KEY `idnap` (`idnap`),
  KEY `emisor` (`emisor`),
  KEY `redipv4` (`redipv4`),
  KEY `status_user` (`status_user`),
  KEY `cliente_emisor` (`idcliente`,`emisor`),
  KEY `total_cobrar` (`idcliente`,`costo`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DELIMITER ;;

CREATE TRIGGER `LogStatusUser` AFTER UPDATE ON `tblservicios` FOR EACH ROW
IF OLD.status_user='OFFLINE' and NEW.status_user='ONLINE'  THEN

INSERT INTO logsistema(log,idcliente,tipolog) VALUES (CONCAT('Servicio Cliente ONLINE ({{cliente}}) - ','',NEW.ip), NEW.idcliente,'1');

ELSEIF OLD.status_user='ONLINE' and NEW.status_user='OFFLINE'  THEN

INSERT INTO logsistema(log,idcliente,tipolog) VALUES (CONCAT('Servicio Cliente OFFLINE ({{cliente}}) - ','',OLD.ip), NEW.idcliente,'1');

END IF;;

DELIMITER ;

DROP TABLE IF EXISTS `tblserviciosvoip`;
CREATE TABLE `tblserviciosvoip` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cliente` int(6) unsigned zerofill NOT NULL,
  `server` varchar(120) NOT NULL,
  `sipuser` varchar(100) NOT NULL,
  `sipid` varchar(50) NOT NULL,
  `contrasena` varchar(50) NOT NULL,
  `codigoverificacion` varchar(50) NOT NULL,
  `numerotelefono` varchar(30) NOT NULL,
  `costo` decimal(10,2) NOT NULL,
  `instalacion` date NOT NULL,
  `notas` text NOT NULL,
  `idperfil` int(11) NOT NULL,
  `descripcion` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `cliente` (`cliente`),
  KEY `tblserviciosvoip_idx_cliente_idperfil` (`cliente`,`idperfil`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `ticket`;
CREATE TABLE `ticket` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `idticket` int(7) unsigned zerofill NOT NULL,
  `contenido` text CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
  `adjunto` text CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
  `fecha_hora` datetime NOT NULL,
  `idtecnico` int(3) NOT NULL,
  `state` int(1) NOT NULL,
  `nota` int(1) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idticket` (`idticket`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;


DROP TABLE IF EXISTS `timeout`;
CREATE TABLE `timeout` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tipo` int(1) NOT NULL,
  `idequipo` int(11) NOT NULL,
  `contador` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `tmpfactura`;
CREATE TABLE `tmpfactura` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `userid` int(6) unsigned zerofill NOT NULL,
  `fechaingreso` date NOT NULL,
  `productoid` int(11) NOT NULL,
  `tipoa` varchar(15) NOT NULL,
  `monto` decimal(12,2) NOT NULL,
  `state` varchar(12) NOT NULL DEFAULT 'pendiente',
  `nfactura` int(8) unsigned zerofill NOT NULL,
  `idinstall` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `tmptl`;
CREATE TABLE `tmptl` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cliente` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `mensaje` text NOT NULL,
  `archivo` text NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `trafico_tmp`;
CREATE TABLE `trafico_tmp` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `src` varchar(22) NOT NULL,
  `bytes` bigint(20) NOT NULL,
  `user` varchar(60) NOT NULL,
  `tipo` int(1) NOT NULL,
  `router` int(4) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ip` (`src`),
  KEY `router` (`router`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `usergroup`;
CREATE TABLE `usergroup` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `UserName` varchar(64) NOT NULL DEFAULT '',
  `GroupName` varchar(64) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `UserName` (`UserName`(32))
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `usuarios`;
CREATE TABLE `usuarios` (
  `id` int(6) unsigned zerofill NOT NULL AUTO_INCREMENT,
  `nombre` varchar(400) DEFAULT NULL,
  `estado` varchar(300) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT 'ACTIVO',
  `correo` text NOT NULL,
  `telefono` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `movil` text NOT NULL,
  `cedula` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `pasarela` varchar(160) NOT NULL,
  `codigo` varchar(15) NOT NULL,
  `direccion_principal` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `estado_user` (`estado`(255)),
  KEY `nombre` (`nombre`(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_spanish_ci;


DROP TABLE IF EXISTS `webproxy`;
CREATE TABLE `webproxy` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `iduser` int(6) unsigned zerofill NOT NULL,
  `html` text NOT NULL,
  `tipo` int(1) NOT NULL,
  `fecha` datetime NOT NULL,
  `nodouser` int(3) NOT NULL,
  `idservicio` int(11) NOT NULL,
  `nombreplantilla` varchar(150) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `iduser` (`iduser`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


DROP TABLE IF EXISTS `whatsapp`;
CREATE TABLE `whatsapp` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` text NOT NULL,
  `namepersonal` text NOT NULL,
  `chat` varchar(200) NOT NULL,
  `fecha` varchar(100) NOT NULL,
  `operador` int(11) NOT NULL,
  `avatar` text NOT NULL,
  `unread` int(11) NOT NULL,
  `estado` int(11) NOT NULL,
  `lastmessge` text NOT NULL,
  `typemessage` text NOT NULL,
  `typechat` varchar(50) NOT NULL,
  `idcliente` int(11) NOT NULL,
  `area` int(2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `chat` (`chat`),
  KEY `fecha` (`fecha`),
  KEY `uread` (`unread`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


DROP TABLE IF EXISTS `zonas`;
CREATE TABLE `zonas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `zona` text NOT NULL,
  PRIMARY KEY (`id`),
  KEY `zonas_idx_id_zona` (`id`,`zona`(255))
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;


