-- FIXTURE SINTÉTICO de ArgosIsp: datos inventados, no son de ningún ISP.
--
-- Solo trae los datos (INSERT, al estilo de phpMyAdmin); la estructura es la real de SmartISP:
-- scripts/importacion/esquemas/smartisp.sql. Un volcado de prueba completo es la estructura
-- seguida de este archivo (así lo arman las pruebas):
--
--   cat scripts/importacion/esquemas/smartisp.sql scripts/importacion/smartisp-sintetico.sql > /tmp/smartisp.sql
--
-- Casos difíciles que cubre (tests/importacion/smartisp.spec.ts):
--   * tipo de conexión por control_routers: router 1 PPPoE ('pp'), 2 colas simples con amarre
--     IP/MAC ('sq', arpmac = 1), 3 DHCP leases ('dl', dhcp = 1), 4 hotspot ('ho', no se importa)
--   * secreto RADIUS en la tabla radius (router 1); la clave de la API (routers.password) viene
--     cifrada por SmartISP y no se importa: todos quedan con credenciales pendientes
--   * red con la máscara como '/24' (router 2) y con el /nn dentro de network (router 3)
--   * plan con IVA aparte (plans.iva = 12.00, aviso) y velocidades en kbps
--   * clientes duplicados por NIT (2 y 3), NIT inválido (6), sin NIT (4), correo y coordenadas
--     inválidos (5)
--   * servicio con MAC 00:00:00:00:00:00 (el defecto: sin MAC), IP repetida (4 con la de 1),
--     sin plan (8), estado 'de' (5, suspendido), estado desconocido (9), PPPoE sin usuario (10),
--     DHCP sin IP (6), IP estática con amarre (3), hotspot (7)
--   * facturas (status confirmado: 1 pagada, 2 sin cargo, 3 pendiente): pendiente (101), pagada
--     con su pago (102), abonada (103), vencida con el pago de otro cliente (104), sin cargo
--     (105, total 0), total_pay NULL = cost + iva y sin servicio (106), status desconocido (107),
--     pagada sin paid_on y sin ningún pago (108: aviso y saldada en el origen), pendiente con
--     paid_on (109, aviso), de un servicio sin plan (110: cargo único del cliente)
--   * pagos: por num_bill; uno borrado (deleted_at, 504) no cuenta (solo archivo); pago cruzado
--     (503); num_bill que no existe (505: pago sin factura)
--   * saldo a favor en wallet_balance (4 sin facturas, 6 con factura); balance distinto de lo
--     pendiente (5, aviso)
--   * la tabla vieja invoices trae una fila (aviso: queda en el archivo del origen)
--
-- Suma de saldos en el origen = Q 925.00

INSERT INTO `routers` (`id`, `name`, `model`, `ip`, `location`, `coordinates`, `clients`, `status`, `connection`, `login`, `password`, `port`, `lan`, `map_marker_icon`) VALUES
(1, 'SI Torre Norte', 'RB4011', '198.18.70.1', 'Norte', '', 4, 'on', 1, 'argos', 'clave-si-norte', 8728, 'ether2', '{}'),
(2, 'SI Torre Sur', 'hEX', '198.18.80.1', 'Sur', '', 1, 'on', 1, '', '', 8728, 'ether2', '{}'),
(3, 'SI Aldea DHCP', 'hEX', '198.18.90.1', 'Aldea', '', 1, 'on', 1, '', '', 8728, 'ether2', '{}'),
(4, 'SI Hotspot Parque', 'hAP', '198.18.100.1', 'Parque', '', 1, 'on', 1, '', '', 8728, 'wlan1', '{}');

INSERT INTO `radius` (`id`, `created_at`, `updated_at`, `secret`, `router_id`) VALUES
(1, NULL, NULL, 'secreto-si-norte', 1);

INSERT INTO `control_routers` (`id`, `router_id`, `type_control`, `dhcp`, `arpmac`, `adv`, `address_list`) VALUES
(1, 1, 'pp', 0, 0, 0, 0),
(2, 2, 'sq', 0, 1, 0, 0),
(3, 3, 'dl', 1, 0, 0, 0),
(4, 4, 'ho', 0, 0, 0, 0);

INSERT INTO `address_routers` (`id`, `name`, `router_id`, `gateway`, `type`, `mask`, `network`, `hosts`, `used`) VALUES
(1, 'Red Norte', 1, '198.18.70.1', 'static', '24', '198.18.70.0', 254, '0.00'),
(2, 'Red Sur', 2, '198.18.80.1', 'static', '/24', '198.18.80.0', 254, '0.00'),
(3, 'Red Aldea', 3, '198.18.90.1', 'static', '24', '198.18.90.0/24', 254, '0.00');

INSERT INTO `plans` (`id`, `name`, `download`, `upload`, `num_clients`, `cost`, `iva`, `burst_limit`, `burst_threshold`, `burst_time`, `priority`, `limitat`, `aggregation`, `title`, `no_rules`, `address_list_name`) VALUES
(1, 'SI Residencial 10M', 10240, 5120, 6, '150.00', '0.00', 0, 0, 0, 5, 0, 1, NULL, 0, NULL),
(2, 'SI Empresarial 50M', 51200, 25600, 1, '535.71', '12.00', 0, 0, 0, 5, 0, 1, NULL, 0, NULL);

INSERT INTO `zone` (`id`, `name`, `created_at`, `updated_at`) VALUES
(1, 'SI Centro', NULL, NULL),
(2, 'SI Aldea', NULL, NULL);

INSERT INTO `clients` (`id`, `name`, `email`, `phone`, `address`, `coordinates`, `photo`, `dni`, `password`, `balance`, `zona_id`, `wallet_balance`, `map_marker_icon`, `odb_geo_json`, `odb_geo_json_styles`) VALUES
(1, 'Sofía Ramírez', 'sofia@example.com', '5555-1001', 'Zona 3, casa 12', '14.6350,-90.5100', '', '1234567-9', 'portal-1', '225.00', 1, 0.00, '{}', '{}', '{}'),
(2, 'Ferretería La Llave, S.A.', 'pagos@llave.example.com', '2222-1002', 'Km. 15, \"Bodega 2\"', NULL, '', '7654321-8', 'portal-2', '350.00', 1, 0.00, '{}', '{}', '{}'),
(3, 'Ferretería La Llave (sucursal)', '', '', 'Km. 15, \'La Ceiba\'', NULL, '', '76543218', 'portal-3', '150.00', 1, 0.00, '{}', '{}', '{}'),
(4, 'Tomás Pérez', '', '5555-1004', 'Aldea El Rosario', NULL, '', '', 'portal-4', '0.00', 2, 40.00, '{}', '{}', '{}'),
(5, 'Rosa Méndez', 'rosa@example', '5555-1005', 'Aldea El Rosario', 'cerca del parque', '', 'CF', 'portal-5', '999.00', 2, 0.00, '{}', '{}', '{}'),
(6, 'Mario Gómez', '', '5555-1006', 'Colonia Las Brisas\nCasa verde', NULL, '', '123', 'portal-6', '150.00', 1, 10.00, '{}', '{}', '{}'),
(7, 'Lucía Torres', 'lucia@example.com', '', 'Parque central', NULL, '', 'CF', 'portal-7', '0.00', NULL, 0.00, '{}', '{}', '{}');

INSERT INTO `client_services` (`id`, `client_id`, `ip`, `mac`, `date_in`, `plan_id`, `router_id`, `status`, `user_hot`, `pass_hot`, `typeauth`, `onmikrotik`, `billing_type`, `online`, `geo_json_styles`) VALUES
(1, 1, '198.18.70.10', '00:00:00:00:00:00', '2024-02-01', 1, 1, 'ac', 'si.sofia', 'clave-si-1', NULL, 1, 'recurring', 'on', '{}'),
(2, 2, '198.18.70.20', 'AA-BB-CC-00-70-20', '2023-10-01', 2, 1, 'ac', 'si.llave', 'clave-si-2', NULL, 1, 'recurring', 'on', '{}'),
(3, 3, '198.18.80.30', 'aabb.cc00.8030', '2024-01-15', 1, 2, 'ac', NULL, NULL, NULL, 1, 'recurring', 'ver', '{}'),
(4, 3, '198.18.70.10', '00:00:00:00:00:00', '2024-03-01', 1, 1, 'ac', 'si.llave.suc', 'clave-si-4', NULL, 1, 'recurring', 'off', '{}'),
(5, 5, '198.18.70.50', '00:00:00:00:00:00', '2024-04-01', 1, 1, 'de', 'si.rosa', 'clave-si-5', NULL, 1, 'recurring', 'off', '{}'),
(6, 6, '', 'aabbcc009060', '2024-05-01', 1, 3, 'ac', NULL, NULL, NULL, 1, 'recurring', 'ver', '{}'),
(7, 7, '198.18.100.70', '00:00:00:00:00:00', '2024-06-01', 1, 4, 'ac', 'hot.lucia', 'clave-si-7', 'userpass', 1, 'recurring', 'ver', '{}'),
(8, 1, '198.18.70.11', '00:00:00:00:00:00', '2024-07-01', 0, 1, 'ac', 'si.sofia.extra', 'clave-si-8', NULL, 1, 'recurring', 'ver', '{}'),
(9, 6, '198.18.70.60', '00:00:00:00:00:00', '2024-08-01', 1, 1, 'xx', 'si.mario', 'clave-si-9', NULL, 1, 'recurring', 'ver', '{}'),
(10, 2, '198.18.70.21', '00:00:00:00:00:00', '2024-09-01', 1, 1, 'ac', '', '', NULL, 1, 'recurring', 'ver', '{}');

INSERT INTO `bill_customers` (`id`, `num_bill`, `period`, `release_date`, `expiration_date`, `iva`, `cost`, `total_pay`, `actual_total_pay`, `status`, `client_id`, `service_id`, `open`, `paid_on`, `start_date`, `recurring_invoice`) VALUES
(101, 'F-101', 'Septiembre 2026', '2026-09-01', '2026-09-10', '0.00', '150.00', '150.00', NULL, 3, 1, 1, 0, NULL, '2026-09-01', 'yes'),
(102, 'F-102', 'Agosto 2026', '2026-08-01', '2026-08-10', '0.00', '150.00', '150.00', NULL, 1, 1, 1, 0, '2026-08-05', '2026-08-01', 'yes'),
(103, 'F-103', 'Septiembre 2026', '2026-09-01', '2026-09-10', '64.29', '535.71', '600.00', NULL, 3, 2, 2, 0, NULL, '2026-09-01', 'yes'),
(104, 'F-104', 'Septiembre 2026', '2026-09-01', '2026-09-10', '0.00', '150.00', '150.00', NULL, 3, 5, 5, 0, NULL, '2026-09-01', 'yes'),
(105, 'F-105', 'Julio 2026', '2026-07-01', '2026-07-10', '0.00', '0.00', '0.00', NULL, 2, 1, 1, 0, NULL, '2026-07-01', 'yes'),
(106, 'F-106', 'Septiembre 2026', '2026-09-03', '2026-09-13', '0.00', '150.00', NULL, NULL, 3, 6, NULL, 0, NULL, NULL, 'yes'),
(107, 'F-107', 'Septiembre 2026', '2026-09-01', '2026-09-10', '0.00', '150.00', '150.00', NULL, 9, 3, 3, 0, NULL, '2026-09-01', 'yes'),
(108, 'F-108', 'Agosto 2026', '2026-08-01', '2026-08-10', '0.00', '150.00', '150.00', NULL, 1, 3, 3, 0, NULL, '2026-08-01', 'yes'),
(109, 'F-109', 'Septiembre 2026', '2026-09-01', '2026-09-10', '0.00', '150.00', '150.00', NULL, 3, 3, 3, 0, '2026-09-03', '2026-09-01', 'yes'),
(110, 'F-110', 'Septiembre 2026', '2026-09-01', '2026-09-10', '0.00', '75.00', '75.00', NULL, 3, 1, 8, 0, NULL, '2026-09-01', 'yes');

INSERT INTO `bill_customer_item` (`id`, `bill_customer_id`, `plan_id`, `description`, `period_from`, `period_to`, `quantity`, `unit`, `price`, `iva`, `total`) VALUES
(1, 101, 1, 'Internet septiembre 2026', '2026-09-01', '2026-09-30', 1, NULL, '150.00', '0.00', '150.00'),
(2, 103, 2, 'Enlace 50M septiembre 2026', '2026-09-01', '2026-09-30', 1, NULL, '535.71', '64.29', '600.00'),
(3, 103, NULL, 'Visita técnica', NULL, NULL, 1, NULL, '0.00', '0.00', '0.00');

INSERT INTO `payment_news` (`id`, `client_id`, `way_to_pay`, `date`, `amount`, `commentary`, `note`, `memo`, `created_at`, `updated_at`, `deleted_at`, `num_bill`, `received_by`, `id_pago`) VALUES
(501, 1, 'Efectivo', '2026-08-05', '150.00', NULL, NULL, NULL, NULL, NULL, NULL, 'F-102', 1, NULL),
(502, 2, 'Depósito BI', '2026-09-08', '250.00', NULL, NULL, NULL, NULL, NULL, NULL, 'F-103', 1, 'BOL-552'),
(503, 4, 'Transferencia', '2026-09-09', '50.00', 'paga lo de su vecina', NULL, NULL, NULL, NULL, NULL, 'F-104', 1, NULL),
(504, 1, 'Efectivo', '2026-09-12', '20.00', 'cobro duplicado', NULL, NULL, NULL, NULL, '2026-09-12 18:00:00', 'F-101', 1, NULL),
(505, 7, 'Efectivo', '2026-09-14', '30.00', 'factura que no existe', NULL, NULL, NULL, NULL, NULL, 'F-999', 1, NULL);

INSERT INTO `invoices` (`id`, `client_id`, `date`, `bill_number`, `total`, `payment_date`, `status`) VALUES
(1, 1, '2025-01-01', 'V-0001', '150.00', '2025-01-10', 'unpaid');
