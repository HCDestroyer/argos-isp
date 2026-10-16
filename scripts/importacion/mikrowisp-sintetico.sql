-- MySQL dump 10.13  Distrib 8.0.36, for Linux (x86_64)
--
-- Host: localhost    Database: mikrowisp
-- ------------------------------------------------------
--
-- FIXTURE SINTÉTICO de ArgosIsp (no son datos reales). Sigue el esquema supuesto de Mikrowisp
-- descrito en apps/api/app/importacion/mikrowisp_sql.ts (ESQUEMA). Cuando llegue el volcado real
-- del ISP se ajusta ese archivo y este fixture.
--
-- Casos difíciles que cubre (ver la prueba tests/importacion/mikrowisp_sql.spec.ts):
--   * clientes duplicados por NIT: 2 y 3 (mismo NIT con y sin guion)
--   * servicio sin plan: 107 (idperfil = 0) y su factura 5005 va al saldo inicial
--   * router con credenciales vacías: 2 (sin usuario, clave ni secreto RADIUS)
--   * facturas parcialmente pagadas: 5003 (abono de 250) y 5004 (abono de otro cliente)
--   * saldos a favor: clientes 4 (sin facturas) y 5 (con una factura pendiente)
--   * pago de un cliente a la factura de otro: operación 9003 (cliente 5 paga la 5004 del 6)
--   * IPs repetidas: 101 y 111 con 198.18.10.10
--   * MAC en distintos formatos: aabb.cc00.0801, AA-BB-CC-00-09-01, aabbcc000902, aa:bb:cc:00:01:01
--   * servicios con IP estática sin PPPoE: 108 (con amarre IP-MAC) y 113 (sin IP: se omite)
--   * DHCP fija sin IP: 109 (ArgosIsp le asigna una)
--   * servicio retirado (112), suspendido (104), factura anulada (5009) y pagada (5002)
--   * NIT inválido (cliente 9) y cliente sin NIT (4 y 10)
--   * cadenas con comillas, comas y acentos escapadas como las deja mysqldump
--
-- Suma de saldos en el origen = Q 1830.00

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;

--
-- Table structure for table `routers`
--

DROP TABLE IF EXISTS `routers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
CREATE TABLE `routers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL DEFAULT '',
  `ip` varchar(45) NOT NULL DEFAULT '',
  `ip_radius` varchar(45) DEFAULT NULL,
  `usuario` varchar(100) DEFAULT '',
  `clave` varchar(255) DEFAULT '',
  `puerto_api` int DEFAULT '8728',
  `secret_radius` varchar(255) DEFAULT '',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

LOCK TABLES `routers` WRITE;
/*!40000 ALTER TABLE `routers` DISABLE KEYS */;
INSERT INTO `routers` VALUES (1,'Torre Norte','198.18.0.1','198.18.0.11','argos','clave-lab-norte',8728,'secreto-lab-norte'),(2,'Torre Sur','198.18.0.2','','','',8728,'');
/*!40000 ALTER TABLE `routers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `redes`
--

DROP TABLE IF EXISTS `redes`;
CREATE TABLE `redes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `router` int NOT NULL,
  `red` varchar(45) NOT NULL,
  `cidr` int NOT NULL DEFAULT '24',
  `gateway` varchar(45) DEFAULT NULL,
  `tipo` varchar(20) DEFAULT 'estatico',
  PRIMARY KEY (`id`),
  KEY `router` (`router`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES `redes` WRITE;
INSERT INTO `redes` VALUES (1,1,'198.18.10.0',24,'198.18.10.1','estatico'),(2,2,'198.18.20.0',24,'198.18.20.1','estatico');
UNLOCK TABLES;

--
-- Table structure for table `perfiles`
--

DROP TABLE IF EXISTS `perfiles`;
CREATE TABLE `perfiles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `costo` decimal(10,2) NOT NULL DEFAULT '0.00',
  `velocidad` varchar(50) DEFAULT NULL COMMENT 'max-limit subida/bajada',
  `perfil_ppp` varchar(100) DEFAULT NULL,
  `pool` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES `perfiles` WRITE;
INSERT INTO `perfiles` VALUES (1,'MW Residencial 10M',150.00,'5M/10M','default',NULL),(2,'MW Empresarial 50M',600.00,'25M/50M',NULL,NULL);
UNLOCK TABLES;

--
-- Table structure for table `zonas`
--

DROP TABLE IF EXISTS `zonas`;
CREATE TABLE `zonas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES `zonas` WRITE;
INSERT INTO `zonas` VALUES (1,'MW Centro'),(2,'MW Aldea El Rosario');
UNLOCK TABLES;

--
-- Table structure for table `usuarios`
--

DROP TABLE IF EXISTS `usuarios`;
CREATE TABLE `usuarios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `estado` varchar(20) DEFAULT 'ACTIVO',
  `correo` varchar(255) DEFAULT '',
  `telefono` varchar(50) DEFAULT '',
  `movil` varchar(50) DEFAULT '',
  `cedula` varchar(50) DEFAULT '',
  `direccion_principal` text,
  `zona` int DEFAULT NULL,
  `saldo` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT 'saldo a favor',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES `usuarios` WRITE;
INSERT INTO `usuarios` VALUES (1,'Ana López','ACTIVO','ana.lopez@example.com','2222-0001','5555-0001','1234567-9','4a. calle 5-10, zona 1',1,0.00),(2,'Comercial El Sol, S.A.','ACTIVO','pagos@elsol.example.com','2222-0002','','7654321-8','Km. 14.5, \"Bodega 3\"',1,0.00),(3,'Comercial El Sol (bodega)','ACTIVO','','','','76543218','Km. 14.5, \'La Ceiba\'',1,0.00),(4,'Bruno Pérez','ACTIVO','','','5555-0004','','Aldea El Rosario',2,50.00),(5,'Carla Méndez','ACTIVO','carla@example.com','','5555-0005','CF','Aldea El Rosario',2,20.00),(6,'Elena Méndez','ACTIVO','','','5555-0006','3141592-K','Aldea El Rosario',2,0.00),(7,'Ernesto Juárez','ACTIVO','ernesto@example','','','2718281-9','Barrio El Centro\nCasa amarilla',1,0.00),(8,'Finca Las Flores','ACTIVO','finca@example.com','','','1122334-0','Finca Las Flores',NULL,0.00),(9,'Gabriel Ruiz','ACTIVO','','','5555-0009','123','Colonia Las Brisas',1,0.00),(10,'Hilda Castillo','ACTIVO','','','','',NULL,1,0.00);
UNLOCK TABLES;

--
-- Table structure for table `tblservicios`
--

DROP TABLE IF EXISTS `tblservicios`;
CREATE TABLE `tblservicios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `idcliente` int NOT NULL,
  `nodo` int NOT NULL,
  `idperfil` int DEFAULT '0',
  `tipo` varchar(20) DEFAULT 'PPPOE',
  `pppuser` varchar(100) DEFAULT '',
  `ppppass` varchar(100) DEFAULT '',
  `ip` varchar(45) DEFAULT '',
  `mac` varchar(45) DEFAULT '',
  `amarre` tinyint(1) DEFAULT '0',
  `direccion` text,
  `coordenadas` varchar(100) DEFAULT '',
  `instalado` datetime DEFAULT NULL,
  `estado` varchar(20) DEFAULT 'ACTIVO',
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES `tblservicios` WRITE;
INSERT INTO `tblservicios` VALUES (101,1,1,1,'PPPOE','mw.ana.lopez','clave101','198.18.10.10','aa:bb:cc:00:01:01',0,'4a. calle 5-10, zona 1','14.6349,-90.5069','2024-03-15 10:00:00','ACTIVO'),(102,2,1,2,'PPPOE','mw.elsol','clave102','198.18.10.20','',0,NULL,'','2023-11-02 00:00:00','ACTIVO'),(103,3,2,1,'PPPOE','mw.elsol.bodega','clave103','','',0,NULL,'','0000-00-00 00:00:00','ACTIVO'),(104,4,1,1,'PPPOE','mw.bruno','clave104','198.18.10.40','',0,NULL,'',NULL,'SUSPENDIDO'),(105,5,2,1,'PPPOE','mw.carla','clave105','198.18.20.50','',0,NULL,'',NULL,'ACTIVO'),(106,6,2,1,'PPPOE','mw.elena','clave106','198.18.20.60','',0,NULL,'',NULL,'ACTIVO'),(107,7,1,0,'PPPOE','mw.ernesto','clave107','198.18.10.70','',0,NULL,'',NULL,'ACTIVO'),(108,8,1,2,'ESTATICO','','','198.18.10.80','aabb.cc00.0801',1,'Finca Las Flores, casa patronal','',NULL,'ACTIVO'),(109,9,2,1,'DHCP','','','','AA-BB-CC-00-09-01',0,NULL,'',NULL,'ACTIVO'),(110,9,2,1,'PPPOE','mw.gabriel','clave110','198.18.20.90','aabbcc000902',0,NULL,'',NULL,'ACTIVO'),(111,10,1,1,'PPPOE','mw.hilda','clave111','198.18.10.10','',0,NULL,'',NULL,'ACTIVO'),(112,1,1,1,'PPPOE','mw.ana.vieja','clave112','198.18.10.12','',0,NULL,'',NULL,'RETIRADO'),(113,8,1,2,'ESTATICO','','','','',0,'Finca Las Flores, beneficio','',NULL,'ACTIVO');
UNLOCK TABLES;

--
-- Table structure for table `facturas`
--

DROP TABLE IF EXISTS `facturas`;
CREATE TABLE `facturas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `idcliente` int NOT NULL,
  `emitido` date NOT NULL,
  `vencimiento` date DEFAULT NULL,
  `total` decimal(10,2) NOT NULL DEFAULT '0.00',
  `estado` varchar(20) DEFAULT 'No pagado',
  `descripcion` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idcliente` (`idcliente`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES `facturas` WRITE;
INSERT INTO `facturas` VALUES (5001,1,'2026-09-01','2026-09-10',150.00,'No pagado','Internet septiembre 2026'),(5002,1,'2026-08-01','2026-08-10',150.00,'Pagado','Internet agosto 2026'),(5003,2,'2026-09-01','2026-09-10',600.00,'No pagado','Internet septiembre 2026'),(5004,6,'2026-09-01','2026-09-10',300.00,'No pagado','Internet septiembre y agosto'),(5005,7,'2026-09-01','2026-09-10',150.00,'No pagado',NULL),(5006,8,'2026-09-01','2026-09-10',600.00,'No pagado','Enlace dedicado'),(5007,9,'2026-09-01','2026-09-10',150.00,'No pagado',NULL),(5008,3,'2026-09-01','2026-09-10',150.00,'No pagado',NULL),(5009,10,'2026-09-01','2026-09-10',150.00,'Anulado',NULL),(5010,5,'2026-09-01','2026-09-10',150.00,'No pagado',NULL);
UNLOCK TABLES;

--
-- Table structure for table `operaciones`
--

DROP TABLE IF EXISTS `operaciones`;
CREATE TABLE `operaciones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nfactura` int DEFAULT NULL,
  `idcliente` int NOT NULL,
  `cobrado` decimal(10,2) NOT NULL,
  `fecha_pago` datetime DEFAULT NULL,
  `forma_pago` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES `operaciones` WRITE;
INSERT INTO `operaciones` VALUES (9001,5002,1,150.00,'2026-08-05 09:12:00','Efectivo'),(9002,5003,2,250.00,'2026-09-08 15:40:00','Transferencia'),(9003,5004,5,100.00,'2026-09-09 11:00:00','Efectivo');
UNLOCK TABLES;

/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;

-- Dump completed on 2026-10-16 12:00:00
