-- Estructura de la base de SmartISP (solo DDL, sin datos), exportada con phpMyAdmin.
-- Referencia de las pruebas del importador de ArgosIsp (apps/api/app/importacion/origenes/smartisp.ts).
-- Limpieza: se quitaron el servidor, las versiones de MySQL y PHP, la hora del volcado y los
-- contadores AUTO_INCREMENT=N (dicen cuántos registros tenía cada tabla).
-- phpMyAdmin SQL Dump
-- https://www.phpmyadmin.net/
--

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de datos: `smartisp`
--

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `accountingregime`
--

CREATE TABLE `accountingregime` (
  `cod` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `address_routers`
--

CREATE TABLE `address_routers` (
  `id` int(11) NOT NULL,
  `name` varchar(50) COLLATE utf8_spanish2_ci NOT NULL,
  `router_id` int(11) NOT NULL,
  `gateway` varchar(15) COLLATE utf8_spanish2_ci NOT NULL,
  `type` char(7) COLLATE utf8_spanish2_ci NOT NULL,
  `mask` char(3) COLLATE utf8_spanish2_ci NOT NULL,
  `network` varchar(17) COLLATE utf8_spanish2_ci NOT NULL,
  `hosts` int(10) NOT NULL,
  `used` decimal(10,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `adv_settings`
--

CREATE TABLE `adv_settings` (
  `id` int(11) NOT NULL,
  `routers_adv` tinyint(1) NOT NULL,
  `ip_server` varchar(50) COLLATE utf8_spanish2_ci NOT NULL,
  `server_path` varchar(20) COLLATE utf8_spanish2_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `answers`
--

CREATE TABLE `answers` (
  `id` int(11) NOT NULL,
  `ticket_id` int(12) NOT NULL,
  `message` text COLLATE utf8_spanish2_ci NOT NULL,
  `user` varchar(100) COLLATE utf8_spanish2_ci NOT NULL,
  `file` varchar(200) COLLATE utf8_spanish2_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_alertlog`
--

CREATE TABLE `app_alertlog` (
  `id` int(11) NOT NULL,
  `contactid` int(11) NOT NULL,
  `contactname` varchar(255) NOT NULL,
  `date` datetime NOT NULL,
  `subject` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `email` varchar(255) NOT NULL,
  `mobilenumber` varchar(255) NOT NULL,
  `pushbullet` varchar(255) NOT NULL,
  `twitter` varchar(255) NOT NULL,
  `pushover` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_checks`
--

CREATE TABLE `app_checks` (
  `id` int(11) NOT NULL,
  `groupid` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `common` varchar(12) NOT NULL,
  `type` varchar(12) NOT NULL,
  `port` varchar(12) NOT NULL,
  `timeout` int(11) NOT NULL,
  `host` varchar(512) NOT NULL,
  `send` text NOT NULL,
  `expect` text NOT NULL,
  `status` int(1) NOT NULL,
  `geodata` text NOT NULL,
  `on_map` int(1) NOT NULL,
  `lat` varchar(32) NOT NULL,
  `lng` varchar(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_checks_alerts`
--

CREATE TABLE `app_checks_alerts` (
  `id` int(11) NOT NULL,
  `checkid` int(11) NOT NULL,
  `type` varchar(25) NOT NULL,
  `comparison` varchar(25) NOT NULL,
  `comparison_limit` varchar(100) NOT NULL,
  `occurrences` int(10) NOT NULL DEFAULT '1',
  `contacts` text NOT NULL,
  `status` int(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_checks_history`
--

CREATE TABLE `app_checks_history` (
  `id` int(11) NOT NULL,
  `checkid` int(11) NOT NULL,
  `timestamp` datetime NOT NULL,
  `latency` varchar(10) NOT NULL,
  `statuscode` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_checks_incidents`
--

CREATE TABLE `app_checks_incidents` (
  `id` int(11) NOT NULL,
  `checkid` int(11) NOT NULL,
  `alertid` int(11) NOT NULL,
  `type` varchar(25) NOT NULL,
  `comparison` varchar(25) NOT NULL,
  `comparison_limit` varchar(100) NOT NULL,
  `value` varchar(100) NOT NULL,
  `start_time` datetime NOT NULL,
  `end_time` datetime NOT NULL,
  `status` int(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_contacts`
--

CREATE TABLE `app_contacts` (
  `id` int(11) NOT NULL,
  `status` int(1) NOT NULL DEFAULT '1',
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `mobilenumber` varchar(255) NOT NULL,
  `pushbullet` varchar(255) NOT NULL,
  `twitter` varchar(255) NOT NULL,
  `pushover` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_dnsbls`
--

CREATE TABLE `app_dnsbls` (
  `id` int(11) NOT NULL,
  `host` varchar(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_groups`
--

CREATE TABLE `app_groups` (
  `id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_pages`
--

CREATE TABLE `app_pages` (
  `id` int(11) NOT NULL,
  `pagekey` varchar(64) NOT NULL,
  `name` varchar(255) NOT NULL,
  `info` text NOT NULL,
  `servers` text NOT NULL,
  `websites` text NOT NULL,
  `checks` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_servers`
--

CREATE TABLE `app_servers` (
  `id` int(11) NOT NULL,
  `groupid` int(11) NOT NULL,
  `type` varchar(10) NOT NULL,
  `name` varchar(255) NOT NULL,
  `serverkey` varchar(64) NOT NULL,
  `status` int(1) NOT NULL,
  `geodata` text NOT NULL,
  `on_map` int(1) NOT NULL,
  `lat` varchar(32) NOT NULL,
  `lng` varchar(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_servers_alerts`
--

CREATE TABLE `app_servers_alerts` (
  `id` int(11) NOT NULL,
  `serverid` int(11) NOT NULL,
  `type` varchar(25) NOT NULL,
  `comparison` varchar(25) NOT NULL,
  `comparison_limit` varchar(100) NOT NULL,
  `occurrences` int(10) NOT NULL,
  `contacts` text NOT NULL,
  `status` int(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_servers_history`
--

CREATE TABLE `app_servers_history` (
  `id` int(11) NOT NULL,
  `serverid` int(11) NOT NULL,
  `timestamp` datetime NOT NULL,
  `data` blob NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_servers_incidents`
--

CREATE TABLE `app_servers_incidents` (
  `id` int(11) NOT NULL,
  `serverid` int(11) NOT NULL,
  `alertid` int(11) NOT NULL,
  `type` varchar(25) NOT NULL,
  `comparison` varchar(25) NOT NULL,
  `comparison_limit` varchar(100) NOT NULL,
  `value` varchar(100) NOT NULL,
  `start_time` datetime NOT NULL,
  `end_time` datetime NOT NULL,
  `status` int(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_websites`
--

CREATE TABLE `app_websites` (
  `id` int(11) NOT NULL,
  `groupid` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `url` varchar(255) NOT NULL,
  `expect` text NOT NULL,
  `timeout` int(11) NOT NULL,
  `status` int(1) NOT NULL,
  `geodata` text NOT NULL,
  `on_map` int(1) NOT NULL,
  `lat` varchar(32) NOT NULL,
  `lng` varchar(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_websites_alerts`
--

CREATE TABLE `app_websites_alerts` (
  `id` int(11) NOT NULL,
  `websiteid` int(11) NOT NULL,
  `type` varchar(25) NOT NULL,
  `comparison` varchar(25) NOT NULL,
  `comparison_limit` varchar(100) NOT NULL,
  `occurrences` int(10) NOT NULL,
  `contacts` text NOT NULL,
  `status` int(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_websites_history`
--

CREATE TABLE `app_websites_history` (
  `id` int(11) NOT NULL,
  `websiteid` int(11) NOT NULL,
  `timestamp` datetime NOT NULL,
  `latency` varchar(10) NOT NULL,
  `statuscode` varchar(10) NOT NULL,
  `has_expected` int(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `app_websites_incidents`
--

CREATE TABLE `app_websites_incidents` (
  `id` int(11) NOT NULL,
  `websiteid` int(11) NOT NULL,
  `alertid` int(11) NOT NULL,
  `type` varchar(25) NOT NULL,
  `comparison` varchar(25) NOT NULL,
  `comparison_limit` varchar(100) NOT NULL,
  `start_time` datetime NOT NULL,
  `end_time` datetime NOT NULL,
  `status` int(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `billing_settings`
--

CREATE TABLE `billing_settings` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `client_id` int(10) UNSIGNED NOT NULL,
  `billing_status` enum('0','1') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1',
  `billing_type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1',
  `billing_payment_method` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1',
  `billing_date` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1',
  `billing_due_date` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '15',
  `billing_grace_period` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0',
  `billing_min_balance` double(8,2) NOT NULL DEFAULT '0.00',
  `billing_partner_percent` double(8,2) NOT NULL DEFAULT '0.00',
  `billing_create_invoice` enum('0','1') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0',
  `billing_auto_pay_invoice` enum('0','1') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1',
  `billing_send_notification` enum('0','1') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0',
  `billing_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `billing_address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `billing_zip_code` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `billing_city` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invoice_status` enum('0','1') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0',
  `invoice_request_auto_day` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1',
  `invoice_request_auto_type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1',
  `invoice_request_auto_period` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0',
  `invoice_request_auto_next` date DEFAULT NULL,
  `reminder_status` enum('0','1') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0',
  `reminder_type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0',
  `reminder_day_1` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1',
  `reminder_day_2` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1',
  `reminder_day_3` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1',
  `reminder_payment_status` enum('0','1') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0',
  `reminder_payment_value` double(8,2) NOT NULL DEFAULT '0.00',
  `reminder_payment_comment` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `reminder_additional` text COLLATE utf8mb4_unicode_ci,
  `billing_invoice_pay_type` enum('prepay','postpay') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'prepay'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `bill_customers`
--

CREATE TABLE `bill_customers` (
  `id` int(11) NOT NULL,
  `num_bill` varchar(100) COLLATE utf8_spanish2_ci NOT NULL,
  `period` varchar(30) COLLATE utf8_spanish2_ci NOT NULL,
  `release_date` date NOT NULL,
  `expiration_date` date NOT NULL,
  `iva` decimal(10,2) NOT NULL,
  `cost` decimal(10,2) NOT NULL,
  `total_pay` decimal(10,2) DEFAULT NULL,
  `actual_total_pay` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `status` tinyint(1) NOT NULL,
  `client_id` int(11) NOT NULL,
  `service_id` bigint(20) UNSIGNED DEFAULT NULL,
  `open` tinyint(1) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `note` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `memo` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `xero_id` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `paid_on` date DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `use_transactions` enum('0','1') COLLATE utf8_spanish2_ci NOT NULL DEFAULT '0',
  `billing_type` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `recurring_invoice` enum('yes','no') COLLATE utf8_spanish2_ci NOT NULL DEFAULT 'no',
  `cortado_date` date DEFAULT NULL,
  `csv_generated` tinyint(1) NOT NULL DEFAULT '0',
  `payment_id` varchar(50) COLLATE utf8_spanish2_ci DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `bill_customer_item`
--

CREATE TABLE `bill_customer_item` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `bill_customer_id` int(10) UNSIGNED NOT NULL,
  `plan_id` int(10) UNSIGNED DEFAULT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `period_from` date DEFAULT NULL,
  `period_to` date DEFAULT NULL,
  `quantity` int(10) UNSIGNED NOT NULL,
  `unit` int(10) UNSIGNED DEFAULT NULL,
  `price` decimal(10,2) NOT NULL,
  `iva` decimal(8,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `boxes`
--

CREATE TABLE `boxes` (
  `id` int(10) UNSIGNED NOT NULL,
  `user_id` int(15) NOT NULL,
  `name` varchar(50) COLLATE utf8_spanish2_ci NOT NULL,
  `date_reg` date NOT NULL,
  `amount` decimal(10,2) DEFAULT NULL,
  `num_receipt` varchar(10) COLLATE utf8_spanish2_ci NOT NULL,
  `detail` text COLLATE utf8_spanish2_ci NOT NULL,
  `type` char(2) COLLATE utf8_spanish2_ci NOT NULL,
  `router_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `campos_view_client`
--

CREATE TABLE `campos_view_client` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `user_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ip` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `router` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `estado` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `control` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `plan` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `servicio` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `balance` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `day_payment` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cut` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mac` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `zone` int(11) DEFAULT NULL,
  `odb_id` int(11) DEFAULT NULL,
  `onu_id` int(11) DEFAULT NULL,
  `onusn` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `cashier_deposit_history`
--

CREATE TABLE `cashier_deposit_history` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `client_id` int(11) NOT NULL,
  `user_id` int(10) UNSIGNED NOT NULL,
  `amount` double(10,2) UNSIGNED NOT NULL,
  `comment` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `way_to_pay` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Cash'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `clients`
--

CREATE TABLE `clients` (
  `id` int(11) NOT NULL,
  `name` varchar(100) COLLATE utf8_spanish2_ci NOT NULL,
  `email` varchar(60) COLLATE utf8_spanish2_ci NOT NULL,
  `phone` varchar(255) COLLATE utf8_spanish2_ci NOT NULL,
  `address` varchar(100) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `coordinates` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `photo` varchar(200) COLLATE utf8_spanish2_ci NOT NULL,
  `dni` varchar(20) COLLATE utf8_spanish2_ci NOT NULL,
  `password` varchar(250) COLLATE utf8_spanish2_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL,
  `balance` decimal(15,2) DEFAULT '0.00' COMMENT 'pending invoice balance',
  `odb_id` int(11) DEFAULT NULL,
  `onu_id` int(11) DEFAULT NULL,
  `port` int(11) DEFAULT NULL,
  `onusn` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `zona_id` int(11) DEFAULT NULL,
  `typedoc_cod` varchar(2) COLLATE utf8_spanish2_ci NOT NULL DEFAULT '0',
  `economicactivity_cod` varchar(10) COLLATE utf8_spanish2_ci NOT NULL DEFAULT '0',
  `municipio_cod` varchar(10) COLLATE utf8_spanish2_ci NOT NULL DEFAULT '0',
  `typeresponsibility_cod` varchar(10) COLLATE utf8_spanish2_ci NOT NULL DEFAULT 'ZZ',
  `typetaxpayer_cod` varchar(2) COLLATE utf8_spanish2_ci NOT NULL DEFAULT '0',
  `adjustable_amount` decimal(8,2) UNSIGNED NOT NULL DEFAULT '0.00',
  `id_punto_emision` int(11) DEFAULT NULL,
  `wallet_balance` double(10,2) NOT NULL DEFAULT '0.00',
  `map_marker_icon` json NOT NULL,
  `odb_geo_json` json NOT NULL,
  `odb_geo_json_styles` json NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `client_services`
--

CREATE TABLE `client_services` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `client_id` int(11) NOT NULL,
  `ip` varchar(15) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mac` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '00:00:00:00:00:00',
  `date_in` date NOT NULL,
  `plan_id` int(10) UNSIGNED NOT NULL,
  `router_id` int(10) UNSIGNED NOT NULL,
  `status` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_hot` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pass_hot` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `typeauth` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `onmikrotik` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `billing_type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'recurring',
  `online` enum('on','off','ver') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ver',
  `tree_priority` int(10) UNSIGNED DEFAULT NULL,
  `manually_cortado` tinyint(1) NOT NULL DEFAULT '0',
  `smartolt_sn` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `geo_json` json DEFAULT NULL,
  `geo_json_styles` json NOT NULL,
  `send_invoice` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'factura Ecuador active'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `conceptonota`
--

CREATE TABLE `conceptonota` (
  `id` int(10) UNSIGNED NOT NULL,
  `cod` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `control_routers`
--

CREATE TABLE `control_routers` (
  `id` int(11) NOT NULL,
  `router_id` int(11) NOT NULL,
  `type_control` char(2) COLLATE utf8_spanish2_ci NOT NULL,
  `dhcp` tinyint(1) NOT NULL,
  `arpmac` tinyint(1) NOT NULL,
  `adv` tinyint(1) NOT NULL,
  `address_list` tinyint(1) NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `core_activitylog`
--

CREATE TABLE `core_activitylog` (
  `id` int(11) NOT NULL,
  `userid` int(11) NOT NULL,
  `ipaddress` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `timestamp` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `core_config`
--

CREATE TABLE `core_config` (
  `name` varchar(128) NOT NULL,
  `value` varchar(512) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `core_cronlog`
--

CREATE TABLE `core_cronlog` (
  `id` int(11) NOT NULL,
  `timestamp` datetime NOT NULL,
  `data` text NOT NULL,
  `execution_time` varchar(20) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `core_emaillog`
--

CREATE TABLE `core_emaillog` (
  `id` int(11) NOT NULL,
  `userid` int(11) NOT NULL,
  `to` varchar(128) NOT NULL,
  `subject` varchar(256) NOT NULL,
  `message` text NOT NULL,
  `timestamp` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `core_files`
--

CREATE TABLE `core_files` (
  `id` int(11) NOT NULL,
  `equipmentid` int(11) NOT NULL,
  `vehicleid` int(11) NOT NULL,
  `staffid` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `file` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `core_languages`
--

CREATE TABLE `core_languages` (
  `id` int(11) NOT NULL,
  `code` varchar(4) NOT NULL,
  `name` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `core_notifications`
--

CREATE TABLE `core_notifications` (
  `id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `subject` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `info` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `core_roles`
--

CREATE TABLE `core_roles` (
  `id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `perms` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `core_smslog`
--

CREATE TABLE `core_smslog` (
  `id` int(11) NOT NULL,
  `to` varchar(128) NOT NULL,
  `message` text NOT NULL,
  `timestamp` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `core_statuses`
--

CREATE TABLE `core_statuses` (
  `id` int(11) NOT NULL,
  `code` int(11) NOT NULL,
  `type` varchar(20) NOT NULL,
  `message` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `core_users`
--

CREATE TABLE `core_users` (
  `id` int(11) NOT NULL,
  `roleid` int(11) NOT NULL,
  `name` varchar(128) NOT NULL,
  `email` varchar(128) NOT NULL,
  `password` varchar(128) NOT NULL,
  `theme` varchar(64) NOT NULL,
  `sidebar` varchar(64) NOT NULL,
  `layout` varchar(64) NOT NULL,
  `notes` text NOT NULL,
  `sessionid` varchar(255) NOT NULL,
  `resetkey` varchar(255) NOT NULL,
  `lang` varchar(2) NOT NULL,
  `avatar` mediumblob NOT NULL,
  `autorefresh` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `cortado_reasons`
--

CREATE TABLE `cortado_reasons` (
  `id` int(10) UNSIGNED NOT NULL,
  `client_id` int(11) NOT NULL,
  `service_id` bigint(20) UNSIGNED DEFAULT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `status` enum('active','blocked') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `cron_jobs`
--

CREATE TABLE `cron_jobs` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `command` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `interval` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `departamento`
--

CREATE TABLE `departamento` (
  `cod` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pais_cod` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `detallenote`
--

CREATE TABLE `detallenote` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `note_id` bigint(20) UNSIGNED NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `plan_id` int(10) UNSIGNED NOT NULL,
  `unit` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` int(11) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `subtotal` decimal(12,2) NOT NULL,
  `iva` decimal(8,2) NOT NULL,
  `total_iva` decimal(10,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `dian_settings`
--

CREATE TABLE `dian_settings` (
  `id` int(11) NOT NULL,
  `typeoperation_cod` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '2',
  `softwarename` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT 'smartisp',
  `softwareid` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  `softwarepin` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '12345',
  `tecnicalkey` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  `testsetid` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  `resolutiondate` date NOT NULL DEFAULT '2019-01-19',
  `resolutiondatestar` date NOT NULL DEFAULT '2019-01-19',
  `resolutiondateend` date NOT NULL DEFAULT '2030-01-19',
  `resolutionnumber` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '18760000001',
  `prefix` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT 'SETP',
  `numberstart` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '990000000',
  `numberend` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '995000000',
  `prefixnc` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT 'NC',
  `numberstartnc` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '0',
  `numberendnc` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '999999999',
  `prefixnd` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT 'ND',
  `numberstartnd` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '0',
  `numberendnd` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '999999999',
  `fes` int(11) NOT NULL DEFAULT '0',
  `ncs` int(11) NOT NULL DEFAULT '0',
  `nds` int(11) NOT NULL DEFAULT '0',
  `zips` int(11) NOT NULL DEFAULT '0',
  `year` int(11) NOT NULL DEFAULT '2019',
  `typedoc_cod` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '31',
  `identificacion` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  `businessname` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  `tradename` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  `typetaxpayer_cod` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '1',
  `accountingregime_cod` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '0',
  `typeresponsibility_cod` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '0',
  `economicactivity_cod` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '0',
  `municipio_cod` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '0',
  `direction` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  `email` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  `phone` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `documents`
--

CREATE TABLE `documents` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `uploaded_by` int(10) UNSIGNED DEFAULT NULL,
  `client_id` int(11) NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `visible_to_client` tinyint(1) NOT NULL DEFAULT '0',
  `document_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` enum('document','contract') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'document',
  `contract_content` longtext COLLATE utf8mb4_unicode_ci,
  `template_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `economicactivity`
--

CREATE TABLE `economicactivity` (
  `cod` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `emisor`
--

CREATE TABLE `emisor` (
  `id` int(10) UNSIGNED NOT NULL,
  `ruc` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `razonSocial` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombreComercial` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `direccion` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `status_cont` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `regimenMicroempresas` int(11) DEFAULT NULL,
  `agenteRetencion` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `establecimientos`
--

CREATE TABLE `establecimientos` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `codigo` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `url` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombreComercial` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `direccion` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `export_history`
--

CREATE TABLE `export_history` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `from` date NOT NULL,
  `to` date NOT NULL,
  `router` int(10) UNSIGNED NOT NULL,
  `location` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `payment_type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `factel`
--

CREATE TABLE `factel` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `certificado_digital` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pass_certificado` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` int(11) NOT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `updatedAt` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `failed_jobs`
--

CREATE TABLE `failed_jobs` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `connection` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `queue` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `payload` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `exception` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `failed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `global_apis`
--

CREATE TABLE `global_apis` (
  `id` int(11) NOT NULL,
  `name` varchar(250) COLLATE utf8_spanish2_ci NOT NULL,
  `options` text COLLATE utf8_spanish2_ci NOT NULL,
  `status` tinyint(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `global_settings`
--

CREATE TABLE `global_settings` (
  `id` int(11) NOT NULL,
  `company` varchar(50) COLLATE utf8_spanish2_ci NOT NULL,
  `smoney` varchar(12) COLLATE utf8_spanish2_ci NOT NULL,
  `nmoney` varchar(12) COLLATE utf8_spanish2_ci NOT NULL,
  `num_bill` int(4) UNSIGNED ZEROFILL NOT NULL,
  `send_prebill` tinyint(1) NOT NULL,
  `send_presms` tinyint(1) NOT NULL,
  `version` varchar(10) COLLATE utf8_spanish2_ci NOT NULL,
  `before_days` int(11) NOT NULL,
  `tolerance` int(2) NOT NULL DEFAULT '0',
  `send_hrs` time NOT NULL,
  `backups` tinyint(1) NOT NULL,
  `create_copy` time NOT NULL,
  `status` char(2) COLLATE utf8_spanish2_ci NOT NULL,
  `last_update` date NOT NULL,
  `license` varchar(6) COLLATE utf8_spanish2_ci NOT NULL,
  `license_id` text COLLATE utf8_spanish2_ci NOT NULL,
  `platform` varchar(7) COLLATE utf8_spanish2_ci NOT NULL,
  `message` text COLLATE utf8_spanish2_ci NOT NULL,
  `email` varchar(60) COLLATE utf8_spanish2_ci NOT NULL,
  `email_tickets` varchar(200) COLLATE utf8_spanish2_ci NOT NULL,
  `password` varchar(250) COLLATE utf8_spanish2_ci NOT NULL,
  `server` varchar(30) COLLATE utf8_spanish2_ci NOT NULL,
  `port` int(5) NOT NULL,
  `protocol` char(3) COLLATE utf8_spanish2_ci NOT NULL,
  `zone` varchar(60) COLLATE utf8_spanish2_ci NOT NULL,
  `default_location` varchar(255) COLLATE utf8_spanish2_ci NOT NULL,
  `phone_code` int(10) NOT NULL DEFAULT '54',
  `delay_sms` int(2) NOT NULL DEFAULT '2',
  `logo` varchar(100) COLLATE utf8_spanish2_ci NOT NULL,
  `debug` tinyint(1) NOT NULL,
  `paypal_client_id` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `paypal_secret` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `paypal_mode` enum('sandbox','live') COLLATE utf8_spanish2_ci DEFAULT NULL,
  `stripe_key` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `stripe_secret` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `payu_merchant_id` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `payu_account_id` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `payu_api_key` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `payu_mode` enum('sandbox','live') COLLATE utf8_spanish2_ci DEFAULT NULL,
  `email_f` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `locale` varchar(255) COLLATE utf8_spanish2_ci NOT NULL DEFAULT 'en',
  `invoice_template_id` int(11) DEFAULT NULL,
  `router_interval` int(10) UNSIGNED NOT NULL DEFAULT '2',
  `actualizar_up` varchar(255) COLLATE utf8_spanish2_ci DEFAULT '1',
  `send_prewhatsapp` tinyint(4) NOT NULL,
  `send_prewaboxapp` tinyint(4) NOT NULL DEFAULT '0',
  `status_seed_dian` tinyint(1) NOT NULL DEFAULT '0',
  `search_show` tinyint(1) NOT NULL DEFAULT '0',
  `inactive_client_show` tinyint(1) NOT NULL DEFAULT '1',
  `dni` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `phone` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `company_email` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `directo_pago_api_key` varchar(60) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `directo_pago_secret_key` varchar(60) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `directo_pago_mode` enum('sandbox','live') COLLATE utf8_spanish2_ci NOT NULL DEFAULT 'sandbox',
  `directo_pago_status` tinyint(1) NOT NULL DEFAULT '0',
  `payu_status` tinyint(1) NOT NULL DEFAULT '0',
  `stripe_status` tinyint(1) NOT NULL DEFAULT '0',
  `paypal_status` tinyint(1) NOT NULL DEFAULT '0',
  `street` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `state` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `country` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `map_type` varchar(255) COLLATE utf8_spanish2_ci NOT NULL DEFAULT 'open_street_map',
  `send_prewhatsappcloudapi` tinyint(1) NOT NULL DEFAULT '0',
  `pay_valida_fixed_hash` varchar(200) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `pay_valida_fixed_hash_notification` varchar(200) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `pay_valida_merchant_id` varchar(100) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `pay_valida_mode` enum('sandbox','live') COLLATE utf8_spanish2_ci NOT NULL DEFAULT 'sandbox',
  `pay_valida_status` tinyint(1) NOT NULL DEFAULT '0',
  `activate_ven` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'factura venzuala active',
  `fecha_editable` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'payment date editable'
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `invoices`
--

CREATE TABLE `invoices` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `client_id` int(11) NOT NULL,
  `date` date NOT NULL,
  `bill_number` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `total` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `payment_date` date NOT NULL,
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `memo` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `xero_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `use_transactions` enum('0','1') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0',
  `status` enum('unpaid','paid(account_balance)','paid','late','removed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unpaid',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `invoices_dian`
--

CREATE TABLE `invoices_dian` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `bill_customers_id` int(11) NOT NULL DEFAULT '0',
  `resolutionnumber` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `client_id` int(11) NOT NULL,
  `date` date NOT NULL,
  `hour` time DEFAULT NULL,
  `typeoperation_cod` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `payment_cod` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `prefix` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `number` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `cufe` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `qr` mediumtext COLLATE utf8mb4_bin NOT NULL,
  `filename` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_bin DEFAULT NULL,
  `phone` varchar(255) COLLATE utf8mb4_bin DEFAULT NULL,
  `municipio_cod` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `address` varchar(255) COLLATE utf8mb4_bin DEFAULT NULL,
  `bill_number` varchar(255) COLLATE utf8mb4_bin DEFAULT NULL,
  `nmoney` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `subtotal` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `totaltax` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `total` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `payment_date` date NOT NULL,
  `xero_id` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `use_transactions` enum('0','1') COLLATE utf8mb4_bin NOT NULL DEFAULT '0',
  `status` enum('unpaid','paid(account_balance)','paid','late','removed') COLLATE utf8mb4_bin NOT NULL DEFAULT 'unpaid',
  `status_dian` enum('accepted','rejected') COLLATE utf8mb4_bin NOT NULL DEFAULT 'rejected',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `invoice_csv_files`
--

CREATE TABLE `invoice_csv_files` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `date` datetime NOT NULL,
  `refint_num` varchar(15) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fisc_num` varchar(15) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `type_doc` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Factura',
  `status` enum('STANDBY','IMPRESO','ERROR_IMP','DUPLICATED','REMOVED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'STANDBY' COMMENT 'impreso = printed',
  `printer` varchar(13) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `doc_refer` varchar(15) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `numz` varchar(4) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_name` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `inv_content` blob,
  `removed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `invoice_sat`
--

CREATE TABLE `invoice_sat` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `bill_customers_id` int(11) NOT NULL,
  `uuid` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `verification_url` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `json_response` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `invoice_setting`
--

CREATE TABLE `invoice_setting` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `provider_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `apikey` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `apikey_sandbox` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_live` tinyint(3) UNSIGNED NOT NULL DEFAULT '0',
  `is_active` tinyint(3) UNSIGNED NOT NULL DEFAULT '0',
  `rfc` varchar(15) COLLATE utf8mb4_unicode_ci NOT NULL,
  `product_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `unit_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `serie` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `folio` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT '0',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `inv_item_history`
--

CREATE TABLE `inv_item_history` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `item_id` bigint(20) UNSIGNED NOT NULL,
  `status` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `date_time` datetime NOT NULL,
  `current_status` enum('in_use','not_in_use') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'not_in_use',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `client_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `inv_products`
--

CREATE TABLE `inv_products` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `vendor_id` bigint(20) UNSIGNED NOT NULL,
  `photo` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sell_price` double(10,2) NOT NULL DEFAULT '0.00',
  `rent_price` double(10,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `inv_product_items`
--

CREATE TABLE `inv_product_items` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `supplier_invoice_id` bigint(20) UNSIGNED DEFAULT NULL,
  `bar_code` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `serial_code` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `photo` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `tax` int(11) NOT NULL DEFAULT '0',
  `quantity` int(11) NOT NULL DEFAULT '0',
  `amount` double(10,2) NOT NULL DEFAULT '0.00',
  `amount_with_tax` double(10,2) NOT NULL DEFAULT '0.00',
  `mark` enum('New','Used','Broken') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'New',
  `status` enum('In Stock','Assigned','Returned','Sold','Rented','Internal Usages') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'In Stock',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `inv_supplier`
--

CREATE TABLE `inv_supplier` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `contact_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(15) COLLATE utf8mb4_unicode_ci NOT NULL,
  `address` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tax_included` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `inv_supplier_invoice`
--

CREATE TABLE `inv_supplier_invoice` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `supplier_id` bigint(20) UNSIGNED NOT NULL,
  `file` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invoice_number` int(11) NOT NULL,
  `invoice_date` datetime DEFAULT NULL,
  `amount` double DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `inv_vendors`
--

CREATE TABLE `inv_vendors` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `jobs`
--

CREATE TABLE `jobs` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `queue` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `payload` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `attempts` tinyint(3) UNSIGNED NOT NULL,
  `reserved_at` int(10) UNSIGNED DEFAULT NULL,
  `available_at` int(10) UNSIGNED NOT NULL,
  `created_at` int(10) UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `languages`
--

CREATE TABLE `languages` (
  `id` int(10) UNSIGNED NOT NULL,
  `language_code` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `language_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('enabled','disabled') COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `logs`
--

CREATE TABLE `logs` (
  `id` int(11) NOT NULL,
  `detail` varchar(100) COLLATE utf8_spanish2_ci NOT NULL,
  `user` varchar(20) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `type` varchar(10) COLLATE utf8_spanish2_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `user_id` int(10) UNSIGNED DEFAULT NULL,
  `client_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `ltm_translations`
--

CREATE TABLE `ltm_translations` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `status` int(11) NOT NULL DEFAULT '0',
  `locale` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `group` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `key` text COLLATE utf8mb4_bin NOT NULL,
  `value` text COLLATE utf8mb4_bin,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `migrations`
--

CREATE TABLE `migrations` (
  `id` int(10) UNSIGNED NOT NULL,
  `migration` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `municipio`
--

CREATE TABLE `municipio` (
  `cod` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `departamento_cod` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `networks`
--

CREATE TABLE `networks` (
  `id` int(11) NOT NULL,
  `address_id` int(11) NOT NULL,
  `ip` varchar(15) COLLATE utf8_spanish2_ci NOT NULL,
  `is_used` tinyint(1) NOT NULL,
  `client_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `note`
--

CREATE TABLE `note` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `invoices_dian_id` bigint(20) UNSIGNED NOT NULL,
  `date` date NOT NULL,
  `hour` time NOT NULL,
  `prefix` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `number` int(11) NOT NULL,
  `cude` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `qr` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `conceptonote_cod` int(10) UNSIGNED NOT NULL,
  `subtotal` decimal(12,2) NOT NULL,
  `totaltax` decimal(12,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `observaciones` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `typeoperation_cod` int(11) NOT NULL,
  `note_type` int(11) NOT NULL,
  `status_note` enum('accepted','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'rejected',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `notices`
--

CREATE TABLE `notices` (
  `id` int(11) NOT NULL,
  `name` varchar(100) COLLATE utf8_spanish2_ci NOT NULL,
  `type` char(10) COLLATE utf8_spanish2_ci NOT NULL,
  `template_id` int(11) NOT NULL,
  `router_id` int(11) NOT NULL,
  `hits` int(11) NOT NULL,
  `total` int(11) NOT NULL,
  `registered` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `odb_splitter`
--

CREATE TABLE `odb_splitter` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `port` int(11) NOT NULL,
  `zone_id` int(11) NOT NULL,
  `coordinates` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `map_marker_icon` json NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `onu_type`
--

CREATE TABLE `onu_type` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `pontype` enum('GPON','EPON','CPE') COLLATE utf8mb4_unicode_ci NOT NULL,
  `onutype` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ethernet_ports` int(11) NOT NULL,
  `wifi_ssids` int(11) NOT NULL,
  `detail` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `pais`
--

CREATE TABLE `pais` (
  `cod` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `payments`
--

CREATE TABLE `payments` (
  `id` int(11) NOT NULL,
  `client_id` int(11) NOT NULL,
  `pay_date` date NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `iva` decimal(10,2) NOT NULL,
  `total_amount` decimal(10,2) DEFAULT NULL,
  `num_bill` varchar(100) COLLATE utf8_spanish2_ci NOT NULL,
  `month_pay` varchar(100) COLLATE utf8_spanish2_ci NOT NULL,
  `plan_id` int(14) NOT NULL,
  `router_id` int(14) NOT NULL,
  `expiries_date` date NOT NULL,
  `after_date` date NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `payment_news`
--

CREATE TABLE `payment_news` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `client_id` int(11) DEFAULT NULL,
  `way_to_pay` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `date` date NOT NULL,
  `amount` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `commentary` text COLLATE utf8mb4_unicode_ci,
  `note` text COLLATE utf8mb4_unicode_ci,
  `memo` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `num_bill` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `received_by` int(10) UNSIGNED DEFAULT NULL,
  `id_pago` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `payment_records`
--

CREATE TABLE `payment_records` (
  `id` int(10) UNSIGNED NOT NULL,
  `user_id` int(11) NOT NULL,
  `name` varchar(50) COLLATE utf8_spanish2_ci NOT NULL,
  `router_id` int(11) NOT NULL,
  `box_id` int(11) NOT NULL,
  `payment_id` int(11) NOT NULL,
  `detail` text COLLATE utf8_spanish2_ci NOT NULL,
  `type` char(2) COLLATE utf8_spanish2_ci NOT NULL,
  `date` date NOT NULL,
  `amount` decimal(10,2) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `permissions`
--

CREATE TABLE `permissions` (
  `id` int(11) NOT NULL,
  `user_id` int(14) NOT NULL,
  `access_clients` tinyint(1) NOT NULL,
  `access_plans` tinyint(1) NOT NULL,
  `access_routers` tinyint(1) NOT NULL,
  `access_users` tinyint(1) NOT NULL,
  `access_system` tinyint(1) NOT NULL,
  `access_pays` tinyint(1) NOT NULL,
  `access_templates` tinyint(1) NOT NULL,
  `access_tickets` tinyint(1) NOT NULL,
  `access_reports` tinyint(1) NOT NULL,
  `access_sms` tinyint(1) NOT NULL,
  `facturacion` int(11) DEFAULT NULL,
  `tran_facturacion_editar` int(11) DEFAULT NULL,
  `tran_facturacion_eliminar` int(11) DEFAULT NULL,
  `factura_pagar` int(11) DEFAULT NULL,
  `factura_editar` int(11) DEFAULT NULL,
  `factura_eliminar` int(11) DEFAULT NULL,
  `pagos_nuevo` int(11) DEFAULT NULL,
  `pagos_editar` int(11) DEFAULT NULL,
  `pagos_eliminar` int(11) DEFAULT NULL,
  `finanzas` int(11) DEFAULT NULL,
  `tran_finanzas_editar` int(11) DEFAULT NULL,
  `tran_finanzas_eliminar` int(11) DEFAULT NULL,
  `factura_finanzas_pagar` int(11) DEFAULT NULL,
  `factura_finanzas_editar` int(11) DEFAULT NULL,
  `factura_finanzas_eliminar` int(11) DEFAULT NULL,
  `pagos_finanzas_editar` int(11) DEFAULT NULL,
  `pagos_finanzas_eliminar` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `access_clients_editar` int(11) DEFAULT NULL,
  `access_clients_eliminar` int(11) DEFAULT NULL,
  `edit_client_balance` tinyint(1) DEFAULT NULL,
  `access_clients_activate` int(11) DEFAULT '0',
  `servicio_info` int(11) DEFAULT '1',
  `servicio_edit` int(11) DEFAULT '0',
  `servicio_delete` int(11) DEFAULT '0',
  `servicio_activate_desactivar` int(11) DEFAULT '0',
  `servicio_new` int(11) DEFAULT '0',
  `maps_client_access` varchar(255) COLLATE utf8_spanish2_ci NOT NULL DEFAULT '1',
  `locations_access` varchar(255) COLLATE utf8_spanish2_ci NOT NULL DEFAULT '1',
  `billing_setting_update` tinyint(1) NOT NULL DEFAULT '1',
  `splitter` tinyint(1) NOT NULL DEFAULT '1',
  `onu_cpe` tinyint(1) NOT NULL DEFAULT '1',
  `estado_financier` tinyint(1) NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `plans`
--

CREATE TABLE `plans` (
  `id` int(10) UNSIGNED NOT NULL,
  `name` varchar(30) COLLATE utf8_spanish2_ci NOT NULL,
  `download` int(6) NOT NULL,
  `upload` int(6) NOT NULL,
  `num_clients` int(12) UNSIGNED NOT NULL,
  `cost` decimal(10,2) DEFAULT NULL,
  `iva` decimal(10,2) DEFAULT NULL,
  `burst_limit` int(3) NOT NULL DEFAULT '0',
  `burst_threshold` int(3) NOT NULL DEFAULT '0',
  `burst_time` int(11) NOT NULL DEFAULT '0',
  `priority` int(1) NOT NULL DEFAULT '5',
  `limitat` int(3) NOT NULL DEFAULT '0',
  `aggregation` int(3) NOT NULL DEFAULT '1',
  `title` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL,
  `no_rules` tinyint(1) NOT NULL DEFAULT '0',
  `address_list_name` varchar(255) COLLATE utf8_spanish2_ci DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `punto_emision`
--

CREATE TABLE `punto_emision` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `id_establecimiento` int(11) NOT NULL,
  `nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `codigo` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `queued_processes`
--

CREATE TABLE `queued_processes` (
  `id` int(11) NOT NULL,
  `type` char(10) COLLATE utf8_spanish2_ci NOT NULL,
  `process` varchar(20) COLLATE utf8_spanish2_ci NOT NULL,
  `detail` varchar(250) COLLATE utf8_spanish2_ci NOT NULL,
  `values` text COLLATE utf8_spanish2_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `radius`
--

CREATE TABLE `radius` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `secret` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `router_id` int(10) UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `recurring_invoices`
--

CREATE TABLE `recurring_invoices` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `client_id` int(11) NOT NULL,
  `note` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `memorandum` longtext COLLATE utf8mb4_unicode_ci,
  `frequency` enum('week','month','year') COLLATE utf8mb4_unicode_ci NOT NULL,
  `price` decimal(8,2) NOT NULL,
  `start_date` datetime NOT NULL,
  `end_date` datetime DEFAULT NULL,
  `next_pay_date` datetime DEFAULT NULL,
  `expiration_date` datetime DEFAULT NULL,
  `status` enum('enable','disable') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'enable',
  `service_status` enum('active','block') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `item_id` bigint(20) UNSIGNED DEFAULT NULL,
  `router_id` int(10) UNSIGNED DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `recurring_invoice_items`
--

CREATE TABLE `recurring_invoice_items` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `recurring_invoice_id` bigint(20) UNSIGNED NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` int(10) UNSIGNED NOT NULL,
  `unit` int(10) UNSIGNED DEFAULT NULL,
  `price` decimal(10,2) NOT NULL,
  `iva` decimal(8,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `routers`
--

CREATE TABLE `routers` (
  `id` int(10) UNSIGNED NOT NULL,
  `name` varchar(30) COLLATE utf8_spanish2_ci NOT NULL,
  `model` varchar(30) COLLATE utf8_spanish2_ci NOT NULL,
  `ip` varchar(250) COLLATE utf8_spanish2_ci NOT NULL,
  `location` varchar(30) COLLATE utf8_spanish2_ci NOT NULL,
  `coordinates` varchar(250) COLLATE utf8_spanish2_ci NOT NULL,
  `clients` int(11) UNSIGNED NOT NULL,
  `status` char(2) COLLATE utf8_spanish2_ci NOT NULL,
  `connection` tinyint(1) NOT NULL,
  `login` varchar(50) COLLATE utf8_spanish2_ci NOT NULL,
  `password` varchar(250) COLLATE utf8_spanish2_ci NOT NULL,
  `port` int(11) NOT NULL,
  `lan` varchar(50) COLLATE utf8_spanish2_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `map_marker_icon` json NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `secuenciales`
--

CREATE TABLE `secuenciales` (
  `id` int(10) UNSIGNED NOT NULL,
  `comprobante` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `valor` int(11) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `smart_bandwidth`
--

CREATE TABLE `smart_bandwidth` (
  `id` int(11) NOT NULL,
  `plan_id` int(11) NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `mode` char(1) COLLATE utf8mb4_spanish2_ci NOT NULL,
  `days` varchar(100) COLLATE utf8mb4_spanish2_ci NOT NULL,
  `bandwidth` int(12) NOT NULL,
  `for_all` tinyint(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `sms`
--

CREATE TABLE `sms` (
  `id` int(11) NOT NULL,
  `client` varchar(100) COLLATE utf8_spanish2_ci NOT NULL,
  `router_id` int(10) NOT NULL,
  `send_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `phone` varchar(100) COLLATE utf8_spanish2_ci NOT NULL,
  `gateway` varchar(50) COLLATE utf8_spanish2_ci NOT NULL,
  `total_clients` int(11) NOT NULL,
  `send_rate` int(11) NOT NULL,
  `message` varchar(160) COLLATE utf8_spanish2_ci NOT NULL,
  `type` tinyint(4) DEFAULT NULL COMMENT '1 = send, 2 = receive',
  `received_at` datetime NOT NULL,
  `msg_status` tinyint(1) NOT NULL DEFAULT '0',
  `sender_id` int(11) NOT NULL DEFAULT '1'
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `sms_inbox`
--

CREATE TABLE `sms_inbox` (
  `id` int(11) NOT NULL,
  `client` varchar(100) COLLATE utf8_spanish2_ci NOT NULL,
  `received_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `phone` varchar(100) COLLATE utf8_spanish2_ci NOT NULL,
  `open` tinyint(1) NOT NULL,
  `message` varchar(160) COLLATE utf8_spanish2_ci NOT NULL,
  `gateway` varchar(50) COLLATE utf8_spanish2_ci NOT NULL,
  `smsgateway_id` varchar(20) COLLATE utf8_spanish2_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `sri`
--

CREATE TABLE `sri` (
  `id` int(10) UNSIGNED NOT NULL,
  `id_factura` int(11) NOT NULL,
  `id_error` int(11) NOT NULL,
  `mensaje` longtext CHARACTER SET utf8 COLLATE utf8_spanish2_ci,
  `informacionAdicional` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tipo` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `claveAcceso` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `estado` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `suspend_clients`
--

CREATE TABLE `suspend_clients` (
  `id` int(11) NOT NULL,
  `client_id` int(11) NOT NULL,
  `router_id` int(11) NOT NULL,
  `expiration` date NOT NULL,
  `service_id` bigint(20) UNSIGNED DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `templates`
--

CREATE TABLE `templates` (
  `id` int(11) NOT NULL,
  `name` varchar(100) COLLATE utf8_spanish2_ci NOT NULL,
  `registered` date NOT NULL,
  `type` char(10) COLLATE utf8_spanish2_ci NOT NULL,
  `system` tinyint(1) NOT NULL,
  `filename` varchar(120) COLLATE utf8_spanish2_ci NOT NULL,
  `content` mediumtext COLLATE utf8_spanish2_ci NOT NULL,
  `status` tinyint(4) DEFAULT '1',
  `provider_template_id` varchar(255) COLLATE utf8_spanish2_ci NOT NULL,
  `provider_template_name` varchar(255) COLLATE utf8_spanish2_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `temp_advs`
--

CREATE TABLE `temp_advs` (
  `id` int(11) NOT NULL,
  `id_notice` int(11) NOT NULL,
  `ip` varchar(15) COLLATE utf8_spanish2_ci NOT NULL,
  `time` time NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `temp_sms`
--

CREATE TABLE `temp_sms` (
  `id` int(11) NOT NULL,
  `sms_id` int(11) NOT NULL,
  `client_id` int(11) NOT NULL,
  `template_id` int(11) NOT NULL,
  `smsgateway_id` bigint(20) NOT NULL,
  `status` char(2) COLLATE utf8_spanish2_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `tickets`
--

CREATE TABLE `tickets` (
  `id` int(11) NOT NULL,
  `subject` varchar(200) COLLATE utf8_spanish2_ci NOT NULL,
  `section` varchar(200) COLLATE utf8_spanish2_ci NOT NULL,
  `status` enum('new','work_in_progress','resolved','waiting_on_customer','waiting_on_agent','cl','op') COLLATE utf8_spanish2_ci DEFAULT 'new',
  `read_admin` tinyint(1) NOT NULL,
  `read_client` tinyint(1) NOT NULL,
  `client_id` int(12) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `user_id` int(10) UNSIGNED DEFAULT NULL,
  `type` enum('question','incident','problem','feature_request','lead') COLLATE utf8_spanish2_ci NOT NULL DEFAULT 'question',
  `priority` enum('low','medium','high','urgent') COLLATE utf8_spanish2_ci NOT NULL DEFAULT 'low'
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `ticket_column_view`
--

CREATE TABLE `ticket_column_view` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `subject` tinyint(1) NOT NULL DEFAULT '1',
  `section` tinyint(1) NOT NULL DEFAULT '1',
  `status` tinyint(1) NOT NULL DEFAULT '1',
  `user_id` tinyint(1) NOT NULL DEFAULT '1',
  `client_id` tinyint(1) NOT NULL DEFAULT '1',
  `created_at_view` tinyint(1) NOT NULL DEFAULT '1',
  `priority` tinyint(1) NOT NULL DEFAULT '1',
  `type` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `transactions`
--

CREATE TABLE `transactions` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `client_id` int(11) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `account_balance` decimal(12,2) DEFAULT NULL,
  `category` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `date` date NOT NULL,
  `quantity` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `typedoc`
--

CREATE TABLE `typedoc` (
  `cod` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `typeoperation`
--

CREATE TABLE `typeoperation` (
  `cod` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `typeresponsibility`
--

CREATE TABLE `typeresponsibility` (
  `cod` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `typetaxpayer`
--

CREATE TABLE `typetaxpayer` (
  `cod` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `UpdateHome`
--

CREATE TABLE `UpdateHome` (
  `id` int(10) NOT NULL,
  `corrida` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `upgrade_v4`
--

CREATE TABLE `upgrade_v4` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `upgrade` tinyint(1) NOT NULL DEFAULT '1',
  `version` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'v4',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `users`
--

CREATE TABLE `users` (
  `id` int(10) UNSIGNED NOT NULL,
  `username` varchar(25) COLLATE utf8_spanish2_ci NOT NULL,
  `name` varchar(40) COLLATE utf8_spanish2_ci NOT NULL,
  `email` varchar(60) COLLATE utf8_spanish2_ci NOT NULL,
  `phone` varchar(250) COLLATE utf8_spanish2_ci NOT NULL,
  `level` char(2) COLLATE utf8_spanish2_ci NOT NULL,
  `status` tinyint(1) NOT NULL,
  `photo` varchar(200) COLLATE utf8_spanish2_ci NOT NULL,
  `remember_token` varchar(100) COLLATE utf8_spanish2_ci NOT NULL,
  `password` varchar(250) COLLATE utf8_spanish2_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `balance` double(10,2) UNSIGNED NOT NULL DEFAULT '0.00',
  `locale` varchar(255) COLLATE utf8_spanish2_ci NOT NULL DEFAULT 'en'
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_spanish2_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `user_credits`
--

CREATE TABLE `user_credits` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED NOT NULL,
  `credit` double(10,2) UNSIGNED NOT NULL DEFAULT '0.00',
  `comment` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `wallet_payments`
--

CREATE TABLE `wallet_payments` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `client_id` int(11) NOT NULL,
  `num_bill` int(11) NOT NULL,
  `amount` double(10,2) NOT NULL,
  `user_id` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `zone`
--

CREATE TABLE `zone` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Índices para tablas volcadas
--

--
-- Indices de la tabla `accountingregime`
--
ALTER TABLE `accountingregime`
  ADD PRIMARY KEY (`cod`);

--
-- Indices de la tabla `address_routers`
--
ALTER TABLE `address_routers`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `adv_settings`
--
ALTER TABLE `adv_settings`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `answers`
--
ALTER TABLE `answers`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `app_alertlog`
--
ALTER TABLE `app_alertlog`
  ADD PRIMARY KEY (`id`) USING BTREE;

--
-- Indices de la tabla `app_checks`
--
ALTER TABLE `app_checks`
  ADD PRIMARY KEY (`id`) USING BTREE;

--
-- Indices de la tabla `app_checks_alerts`
--
ALTER TABLE `app_checks_alerts`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD KEY `checkid` (`checkid`) USING BTREE;

--
-- Indices de la tabla `app_checks_history`
--
ALTER TABLE `app_checks_history`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD KEY `checkid` (`checkid`) USING BTREE,
  ADD KEY `timestamp` (`timestamp`) USING BTREE;

--
-- Indices de la tabla `app_checks_incidents`
--
ALTER TABLE `app_checks_incidents`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD KEY `serverid` (`checkid`) USING BTREE;

--
-- Indices de la tabla `app_contacts`
--
ALTER TABLE `app_contacts`
  ADD PRIMARY KEY (`id`) USING BTREE;

--
-- Indices de la tabla `app_dnsbls`
--
ALTER TABLE `app_dnsbls`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD UNIQUE KEY `host` (`host`) USING BTREE;

--
-- Indices de la tabla `app_groups`
--
ALTER TABLE `app_groups`
  ADD PRIMARY KEY (`id`) USING BTREE;

--
-- Indices de la tabla `app_pages`
--
ALTER TABLE `app_pages`
  ADD PRIMARY KEY (`id`) USING BTREE;

--
-- Indices de la tabla `app_servers`
--
ALTER TABLE `app_servers`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD UNIQUE KEY `serverkey` (`serverkey`) USING BTREE;

--
-- Indices de la tabla `app_servers_alerts`
--
ALTER TABLE `app_servers_alerts`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD KEY `serverid` (`serverid`) USING BTREE;

--
-- Indices de la tabla `app_servers_history`
--
ALTER TABLE `app_servers_history`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD KEY `serverid` (`serverid`) USING BTREE,
  ADD KEY `timestamp` (`timestamp`) USING BTREE;

--
-- Indices de la tabla `app_servers_incidents`
--
ALTER TABLE `app_servers_incidents`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD KEY `serverid` (`serverid`) USING BTREE;

--
-- Indices de la tabla `app_websites`
--
ALTER TABLE `app_websites`
  ADD PRIMARY KEY (`id`) USING BTREE;

--
-- Indices de la tabla `app_websites_alerts`
--
ALTER TABLE `app_websites_alerts`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD KEY `websiteid` (`websiteid`) USING BTREE;

--
-- Indices de la tabla `app_websites_history`
--
ALTER TABLE `app_websites_history`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD KEY `websiteid` (`websiteid`) USING BTREE,
  ADD KEY `timestamp` (`timestamp`) USING BTREE;

--
-- Indices de la tabla `app_websites_incidents`
--
ALTER TABLE `app_websites_incidents`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD KEY `serverid` (`websiteid`) USING BTREE;

--
-- Indices de la tabla `billing_settings`
--
ALTER TABLE `billing_settings`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `bill_customers`
--
ALTER TABLE `bill_customers`
  ADD PRIMARY KEY (`id`),
  ADD KEY `bill_customers_service_id_foreign` (`service_id`);

--
-- Indices de la tabla `bill_customer_item`
--
ALTER TABLE `bill_customer_item`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `boxes`
--
ALTER TABLE `boxes`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `campos_view_client`
--
ALTER TABLE `campos_view_client`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `cashier_deposit_history`
--
ALTER TABLE `cashier_deposit_history`
  ADD PRIMARY KEY (`id`),
  ADD KEY `cashier_deposit_history_client_id_foreign` (`client_id`),
  ADD KEY `cashier_deposit_history_user_id_foreign` (`user_id`);

--
-- Indices de la tabla `clients`
--
ALTER TABLE `clients`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `client_services`
--
ALTER TABLE `client_services`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `conceptonota`
--
ALTER TABLE `conceptonota`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `control_routers`
--
ALTER TABLE `control_routers`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `router_id` (`router_id`);

--
-- Indices de la tabla `core_activitylog`
--
ALTER TABLE `core_activitylog`
  ADD PRIMARY KEY (`id`) USING BTREE;

--
-- Indices de la tabla `core_config`
--
ALTER TABLE `core_config`
  ADD UNIQUE KEY `name` (`name`) USING BTREE;

--
-- Indices de la tabla `core_cronlog`
--
ALTER TABLE `core_cronlog`
  ADD PRIMARY KEY (`id`) USING BTREE;

--
-- Indices de la tabla `core_emaillog`
--
ALTER TABLE `core_emaillog`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD UNIQUE KEY `id` (`id`) USING BTREE;

--
-- Indices de la tabla `core_files`
--
ALTER TABLE `core_files`
  ADD PRIMARY KEY (`id`) USING BTREE;

--
-- Indices de la tabla `core_languages`
--
ALTER TABLE `core_languages`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD UNIQUE KEY `code` (`code`) USING BTREE;

--
-- Indices de la tabla `core_notifications`
--
ALTER TABLE `core_notifications`
  ADD PRIMARY KEY (`id`) USING BTREE;

--
-- Indices de la tabla `core_roles`
--
ALTER TABLE `core_roles`
  ADD PRIMARY KEY (`id`) USING BTREE;

--
-- Indices de la tabla `core_smslog`
--
ALTER TABLE `core_smslog`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD UNIQUE KEY `id` (`id`) USING BTREE;

--
-- Indices de la tabla `core_statuses`
--
ALTER TABLE `core_statuses`
  ADD PRIMARY KEY (`id`) USING BTREE;

--
-- Indices de la tabla `core_users`
--
ALTER TABLE `core_users`
  ADD PRIMARY KEY (`id`) USING BTREE,
  ADD UNIQUE KEY `email` (`email`) USING BTREE,
  ADD UNIQUE KEY `id` (`id`) USING BTREE;

--
-- Indices de la tabla `cortado_reasons`
--
ALTER TABLE `cortado_reasons`
  ADD PRIMARY KEY (`id`),
  ADD KEY `cortado_reasons_client_id_foreign` (`client_id`),
  ADD KEY `cortado_reasons_service_id_foreign` (`service_id`);

--
-- Indices de la tabla `cron_jobs`
--
ALTER TABLE `cron_jobs`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `departamento`
--
ALTER TABLE `departamento`
  ADD PRIMARY KEY (`cod`);

--
-- Indices de la tabla `detallenote`
--
ALTER TABLE `detallenote`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `dian_settings`
--
ALTER TABLE `dian_settings`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `documents`
--
ALTER TABLE `documents`
  ADD PRIMARY KEY (`id`),
  ADD KEY `documents_uploaded_by_foreign` (`uploaded_by`),
  ADD KEY `documents_client_id_foreign` (`client_id`);

--
-- Indices de la tabla `economicactivity`
--
ALTER TABLE `economicactivity`
  ADD PRIMARY KEY (`cod`);

--
-- Indices de la tabla `emisor`
--
ALTER TABLE `emisor`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `establecimientos`
--
ALTER TABLE `establecimientos`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `export_history`
--
ALTER TABLE `export_history`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `factel`
--
ALTER TABLE `factel`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `failed_jobs`
--
ALTER TABLE `failed_jobs`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `global_apis`
--
ALTER TABLE `global_apis`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `global_settings`
--
ALTER TABLE `global_settings`
  ADD PRIMARY KEY (`id`),
  ADD KEY `global_settings_invoice_template_id_foreign` (`invoice_template_id`);

--
-- Indices de la tabla `invoices`
--
ALTER TABLE `invoices`
  ADD PRIMARY KEY (`id`),
  ADD KEY `invoices_client_id_foreign` (`client_id`);

--
-- Indices de la tabla `invoices_dian`
--
ALTER TABLE `invoices_dian`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `invoice_csv_files`
--
ALTER TABLE `invoice_csv_files`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `invoice_sat`
--
ALTER TABLE `invoice_sat`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `invoice_setting`
--
ALTER TABLE `invoice_setting`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `inv_item_history`
--
ALTER TABLE `inv_item_history`
  ADD PRIMARY KEY (`id`),
  ADD KEY `inv_item_history_item_id_foreign` (`item_id`),
  ADD KEY `inv_item_history_client_id_foreign` (`client_id`);

--
-- Indices de la tabla `inv_products`
--
ALTER TABLE `inv_products`
  ADD PRIMARY KEY (`id`),
  ADD KEY `inv_products_vendor_id_foreign` (`vendor_id`);

--
-- Indices de la tabla `inv_product_items`
--
ALTER TABLE `inv_product_items`
  ADD PRIMARY KEY (`id`),
  ADD KEY `inv_product_items_product_id_foreign` (`product_id`),
  ADD KEY `inv_product_items_supplier_invoice_id_foreign` (`supplier_invoice_id`);

--
-- Indices de la tabla `inv_supplier`
--
ALTER TABLE `inv_supplier`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `inv_supplier_invoice`
--
ALTER TABLE `inv_supplier_invoice`
  ADD PRIMARY KEY (`id`),
  ADD KEY `inv_supplier_invoice_supplier_id_foreign` (`supplier_id`);

--
-- Indices de la tabla `inv_vendors`
--
ALTER TABLE `inv_vendors`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `jobs`
--
ALTER TABLE `jobs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `jobs_queue_index` (`queue`);

--
-- Indices de la tabla `languages`
--
ALTER TABLE `languages`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `logs`
--
ALTER TABLE `logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `logs_user_id_foreign` (`user_id`),
  ADD KEY `logs_client_id_foreign` (`client_id`);

--
-- Indices de la tabla `ltm_translations`
--
ALTER TABLE `ltm_translations`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `migrations`
--
ALTER TABLE `migrations`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `municipio`
--
ALTER TABLE `municipio`
  ADD PRIMARY KEY (`cod`);

--
-- Indices de la tabla `networks`
--
ALTER TABLE `networks`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `note`
--
ALTER TABLE `note`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `notices`
--
ALTER TABLE `notices`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `odb_splitter`
--
ALTER TABLE `odb_splitter`
  ADD PRIMARY KEY (`id`),
  ADD KEY `odb_splitter_zone_id_index` (`zone_id`);

--
-- Indices de la tabla `onu_type`
--
ALTER TABLE `onu_type`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `pais`
--
ALTER TABLE `pais`
  ADD PRIMARY KEY (`cod`);

--
-- Indices de la tabla `payments`
--
ALTER TABLE `payments`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `payment_news`
--
ALTER TABLE `payment_news`
  ADD PRIMARY KEY (`id`),
  ADD KEY `payment_news_client_id_foreign` (`client_id`),
  ADD KEY `payment_news_received_by_foreign` (`received_by`);

--
-- Indices de la tabla `payment_records`
--
ALTER TABLE `payment_records`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `permissions`
--
ALTER TABLE `permissions`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `plans`
--
ALTER TABLE `plans`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `name` (`name`);

--
-- Indices de la tabla `punto_emision`
--
ALTER TABLE `punto_emision`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `queued_processes`
--
ALTER TABLE `queued_processes`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `radius`
--
ALTER TABLE `radius`
  ADD PRIMARY KEY (`id`),
  ADD KEY `radius_router_id_foreign` (`router_id`);

--
-- Indices de la tabla `recurring_invoices`
--
ALTER TABLE `recurring_invoices`
  ADD PRIMARY KEY (`id`),
  ADD KEY `recurring_invoices_client_id_foreign` (`client_id`),
  ADD KEY `recurring_invoices_item_id_foreign` (`item_id`),
  ADD KEY `recurring_invoices_router_id_foreign` (`router_id`);

--
-- Indices de la tabla `recurring_invoice_items`
--
ALTER TABLE `recurring_invoice_items`
  ADD PRIMARY KEY (`id`),
  ADD KEY `recurring_invoice_items_recurring_invoice_id_foreign` (`recurring_invoice_id`);

--
-- Indices de la tabla `routers`
--
ALTER TABLE `routers`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `secuenciales`
--
ALTER TABLE `secuenciales`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `smart_bandwidth`
--
ALTER TABLE `smart_bandwidth`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `sms`
--
ALTER TABLE `sms`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `sms_inbox`
--
ALTER TABLE `sms_inbox`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `sri`
--
ALTER TABLE `sri`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `suspend_clients`
--
ALTER TABLE `suspend_clients`
  ADD PRIMARY KEY (`id`),
  ADD KEY `suspend_clients_service_id_foreign` (`service_id`);

--
-- Indices de la tabla `templates`
--
ALTER TABLE `templates`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `temp_advs`
--
ALTER TABLE `temp_advs`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `temp_sms`
--
ALTER TABLE `temp_sms`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `tickets`
--
ALTER TABLE `tickets`
  ADD PRIMARY KEY (`id`),
  ADD KEY `tickets_user_id_foreign` (`user_id`);

--
-- Indices de la tabla `ticket_column_view`
--
ALTER TABLE `ticket_column_view`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `transactions`
--
ALTER TABLE `transactions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `transactions_client_id_foreign` (`client_id`);

--
-- Indices de la tabla `typedoc`
--
ALTER TABLE `typedoc`
  ADD PRIMARY KEY (`cod`);

--
-- Indices de la tabla `typeoperation`
--
ALTER TABLE `typeoperation`
  ADD PRIMARY KEY (`cod`);

--
-- Indices de la tabla `typeresponsibility`
--
ALTER TABLE `typeresponsibility`
  ADD PRIMARY KEY (`cod`);

--
-- Indices de la tabla `typetaxpayer`
--
ALTER TABLE `typetaxpayer`
  ADD PRIMARY KEY (`cod`);

--
-- Indices de la tabla `UpdateHome`
--
ALTER TABLE `UpdateHome`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `upgrade_v4`
--
ALTER TABLE `upgrade_v4`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`);

--
-- Indices de la tabla `user_credits`
--
ALTER TABLE `user_credits`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_credits_user_id_foreign` (`user_id`);

--
-- Indices de la tabla `wallet_payments`
--
ALTER TABLE `wallet_payments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `wallet_payments_client_id_foreign` (`client_id`),
  ADD KEY `wallet_payments_user_id_foreign` (`user_id`);

--
-- Indices de la tabla `zone`
--
ALTER TABLE `zone`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `zone_name_unique` (`name`);

--
-- AUTO_INCREMENT de las tablas volcadas
--

--
-- AUTO_INCREMENT de la tabla `address_routers`
--
ALTER TABLE `address_routers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `adv_settings`
--
ALTER TABLE `adv_settings`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `answers`
--
ALTER TABLE `answers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_alertlog`
--
ALTER TABLE `app_alertlog`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_checks`
--
ALTER TABLE `app_checks`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_checks_alerts`
--
ALTER TABLE `app_checks_alerts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_checks_history`
--
ALTER TABLE `app_checks_history`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_checks_incidents`
--
ALTER TABLE `app_checks_incidents`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_contacts`
--
ALTER TABLE `app_contacts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_dnsbls`
--
ALTER TABLE `app_dnsbls`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_groups`
--
ALTER TABLE `app_groups`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_pages`
--
ALTER TABLE `app_pages`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_servers`
--
ALTER TABLE `app_servers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_servers_alerts`
--
ALTER TABLE `app_servers_alerts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_servers_history`
--
ALTER TABLE `app_servers_history`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_servers_incidents`
--
ALTER TABLE `app_servers_incidents`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_websites`
--
ALTER TABLE `app_websites`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_websites_alerts`
--
ALTER TABLE `app_websites_alerts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_websites_history`
--
ALTER TABLE `app_websites_history`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `app_websites_incidents`
--
ALTER TABLE `app_websites_incidents`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `billing_settings`
--
ALTER TABLE `billing_settings`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `bill_customers`
--
ALTER TABLE `bill_customers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `bill_customer_item`
--
ALTER TABLE `bill_customer_item`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `boxes`
--
ALTER TABLE `boxes`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `campos_view_client`
--
ALTER TABLE `campos_view_client`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `cashier_deposit_history`
--
ALTER TABLE `cashier_deposit_history`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `clients`
--
ALTER TABLE `clients`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `client_services`
--
ALTER TABLE `client_services`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `conceptonota`
--
ALTER TABLE `conceptonota`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `control_routers`
--
ALTER TABLE `control_routers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `core_activitylog`
--
ALTER TABLE `core_activitylog`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `core_cronlog`
--
ALTER TABLE `core_cronlog`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `core_emaillog`
--
ALTER TABLE `core_emaillog`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `core_files`
--
ALTER TABLE `core_files`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `core_languages`
--
ALTER TABLE `core_languages`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `core_notifications`
--
ALTER TABLE `core_notifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `core_roles`
--
ALTER TABLE `core_roles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `core_smslog`
--
ALTER TABLE `core_smslog`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `core_statuses`
--
ALTER TABLE `core_statuses`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `core_users`
--
ALTER TABLE `core_users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `cortado_reasons`
--
ALTER TABLE `cortado_reasons`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `cron_jobs`
--
ALTER TABLE `cron_jobs`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `detallenote`
--
ALTER TABLE `detallenote`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `documents`
--
ALTER TABLE `documents`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `emisor`
--
ALTER TABLE `emisor`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `establecimientos`
--
ALTER TABLE `establecimientos`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `export_history`
--
ALTER TABLE `export_history`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `factel`
--
ALTER TABLE `factel`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `failed_jobs`
--
ALTER TABLE `failed_jobs`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `global_apis`
--
ALTER TABLE `global_apis`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `global_settings`
--
ALTER TABLE `global_settings`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `invoices`
--
ALTER TABLE `invoices`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `invoices_dian`
--
ALTER TABLE `invoices_dian`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `invoice_csv_files`
--
ALTER TABLE `invoice_csv_files`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `invoice_sat`
--
ALTER TABLE `invoice_sat`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `invoice_setting`
--
ALTER TABLE `invoice_setting`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `inv_item_history`
--
ALTER TABLE `inv_item_history`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `inv_products`
--
ALTER TABLE `inv_products`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `inv_product_items`
--
ALTER TABLE `inv_product_items`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `inv_supplier`
--
ALTER TABLE `inv_supplier`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `inv_supplier_invoice`
--
ALTER TABLE `inv_supplier_invoice`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `inv_vendors`
--
ALTER TABLE `inv_vendors`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `jobs`
--
ALTER TABLE `jobs`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `languages`
--
ALTER TABLE `languages`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `logs`
--
ALTER TABLE `logs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `ltm_translations`
--
ALTER TABLE `ltm_translations`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `migrations`
--
ALTER TABLE `migrations`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `networks`
--
ALTER TABLE `networks`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `note`
--
ALTER TABLE `note`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `notices`
--
ALTER TABLE `notices`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `odb_splitter`
--
ALTER TABLE `odb_splitter`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `onu_type`
--
ALTER TABLE `onu_type`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `payments`
--
ALTER TABLE `payments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `payment_news`
--
ALTER TABLE `payment_news`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `payment_records`
--
ALTER TABLE `payment_records`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `permissions`
--
ALTER TABLE `permissions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `plans`
--
ALTER TABLE `plans`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `punto_emision`
--
ALTER TABLE `punto_emision`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `queued_processes`
--
ALTER TABLE `queued_processes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `radius`
--
ALTER TABLE `radius`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `recurring_invoices`
--
ALTER TABLE `recurring_invoices`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `recurring_invoice_items`
--
ALTER TABLE `recurring_invoice_items`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `routers`
--
ALTER TABLE `routers`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `secuenciales`
--
ALTER TABLE `secuenciales`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `smart_bandwidth`
--
ALTER TABLE `smart_bandwidth`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `sms`
--
ALTER TABLE `sms`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `sms_inbox`
--
ALTER TABLE `sms_inbox`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `sri`
--
ALTER TABLE `sri`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `suspend_clients`
--
ALTER TABLE `suspend_clients`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `templates`
--
ALTER TABLE `templates`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `temp_advs`
--
ALTER TABLE `temp_advs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `temp_sms`
--
ALTER TABLE `temp_sms`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `tickets`
--
ALTER TABLE `tickets`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `ticket_column_view`
--
ALTER TABLE `ticket_column_view`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `transactions`
--
ALTER TABLE `transactions`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `UpdateHome`
--
ALTER TABLE `UpdateHome`
  MODIFY `id` int(10) NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `upgrade_v4`
--
ALTER TABLE `upgrade_v4`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `users`
--
ALTER TABLE `users`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `user_credits`
--
ALTER TABLE `user_credits`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `wallet_payments`
--
ALTER TABLE `wallet_payments`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- AUTO_INCREMENT de la tabla `zone`
--
ALTER TABLE `zone`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
--
-- Restricciones para tablas volcadas
--

--
-- Filtros para la tabla `bill_customers`
--
ALTER TABLE `bill_customers`
  ADD CONSTRAINT `bill_customers_service_id_foreign` FOREIGN KEY (`service_id`) REFERENCES `client_services` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Filtros para la tabla `cashier_deposit_history`
--
ALTER TABLE `cashier_deposit_history`
  ADD CONSTRAINT `cashier_deposit_history_client_id_foreign` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`),
  ADD CONSTRAINT `cashier_deposit_history_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

--
-- Filtros para la tabla `cortado_reasons`
--
ALTER TABLE `cortado_reasons`
  ADD CONSTRAINT `cortado_reasons_client_id_foreign` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `cortado_reasons_service_id_foreign` FOREIGN KEY (`service_id`) REFERENCES `client_services` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Filtros para la tabla `documents`
--
ALTER TABLE `documents`
  ADD CONSTRAINT `documents_client_id_foreign` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`),
  ADD CONSTRAINT `documents_uploaded_by_foreign` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`);

--
-- Filtros para la tabla `global_settings`
--
ALTER TABLE `global_settings`
  ADD CONSTRAINT `global_settings_invoice_template_id_foreign` FOREIGN KEY (`invoice_template_id`) REFERENCES `templates` (`id`) ON UPDATE CASCADE;

--
-- Filtros para la tabla `invoices`
--
ALTER TABLE `invoices`
  ADD CONSTRAINT `invoices_client_id_foreign` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`);

--
-- Filtros para la tabla `inv_item_history`
--
ALTER TABLE `inv_item_history`
  ADD CONSTRAINT `inv_item_history_client_id_foreign` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `inv_item_history_item_id_foreign` FOREIGN KEY (`item_id`) REFERENCES `inv_product_items` (`id`);

--
-- Filtros para la tabla `inv_products`
--
ALTER TABLE `inv_products`
  ADD CONSTRAINT `inv_products_vendor_id_foreign` FOREIGN KEY (`vendor_id`) REFERENCES `inv_vendors` (`id`);

--
-- Filtros para la tabla `inv_product_items`
--
ALTER TABLE `inv_product_items`
  ADD CONSTRAINT `inv_product_items_product_id_foreign` FOREIGN KEY (`product_id`) REFERENCES `inv_products` (`id`),
  ADD CONSTRAINT `inv_product_items_supplier_invoice_id_foreign` FOREIGN KEY (`supplier_invoice_id`) REFERENCES `inv_supplier_invoice` (`id`);

--
-- Filtros para la tabla `inv_supplier_invoice`
--
ALTER TABLE `inv_supplier_invoice`
  ADD CONSTRAINT `inv_supplier_invoice_supplier_id_foreign` FOREIGN KEY (`supplier_id`) REFERENCES `inv_supplier` (`id`);

--
-- Filtros para la tabla `logs`
--
ALTER TABLE `logs`
  ADD CONSTRAINT `logs_client_id_foreign` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`),
  ADD CONSTRAINT `logs_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

--
-- Filtros para la tabla `payment_news`
--
ALTER TABLE `payment_news`
  ADD CONSTRAINT `payment_news_client_id_foreign` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE SET NULL ON UPDATE SET NULL,
  ADD CONSTRAINT `payment_news_received_by_foreign` FOREIGN KEY (`received_by`) REFERENCES `users` (`id`);

--
-- Filtros para la tabla `radius`
--
ALTER TABLE `radius`
  ADD CONSTRAINT `radius_router_id_foreign` FOREIGN KEY (`router_id`) REFERENCES `routers` (`id`);

--
-- Filtros para la tabla `recurring_invoices`
--
ALTER TABLE `recurring_invoices`
  ADD CONSTRAINT `recurring_invoices_client_id_foreign` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `recurring_invoices_item_id_foreign` FOREIGN KEY (`item_id`) REFERENCES `inv_product_items` (`id`),
  ADD CONSTRAINT `recurring_invoices_router_id_foreign` FOREIGN KEY (`router_id`) REFERENCES `routers` (`id`);

--
-- Filtros para la tabla `recurring_invoice_items`
--
ALTER TABLE `recurring_invoice_items`
  ADD CONSTRAINT `recurring_invoice_items_recurring_invoice_id_foreign` FOREIGN KEY (`recurring_invoice_id`) REFERENCES `recurring_invoices` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Filtros para la tabla `suspend_clients`
--
ALTER TABLE `suspend_clients`
  ADD CONSTRAINT `suspend_clients_service_id_foreign` FOREIGN KEY (`service_id`) REFERENCES `client_services` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Filtros para la tabla `tickets`
--
ALTER TABLE `tickets`
  ADD CONSTRAINT `tickets_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

--
-- Filtros para la tabla `transactions`
--
ALTER TABLE `transactions`
  ADD CONSTRAINT `transactions_client_id_foreign` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE SET NULL ON UPDATE SET NULL;

--
-- Filtros para la tabla `user_credits`
--
ALTER TABLE `user_credits`
  ADD CONSTRAINT `user_credits_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

--
-- Filtros para la tabla `wallet_payments`
--
ALTER TABLE `wallet_payments`
  ADD CONSTRAINT `wallet_payments_client_id_foreign` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`),
  ADD CONSTRAINT `wallet_payments_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
