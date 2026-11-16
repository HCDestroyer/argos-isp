---
orden: 1
---

# Qué es ArgosIsp

ArgosIsp es el sistema con el que un proveedor de internet (ISP) en Guatemala lleva a sus clientes, sus servicios de internet, lo que les cobra y lo que le pagan. Controla la red: corta a quien no paga, reconecta solo a quien paga y deja anotado todo lo que pasa.

## Para quién es

- **Cajeros:** abren su caja, cobran en efectivo o por banco, entregan el recibo y cierran el turno con arqueo.
- **Soporte:** atienden al cliente, buscan su cuenta, revisan por qué no navega, crean promesas de pago y cambian planes.
- **Técnicos:** dan de alta e instalan servicios, configuran routers, llevan los equipos prestados (comodato) y su bodega.
- **Contabilidad:** facturación, libro contable, bancos, cierres, impuestos y factura electrónica (FEL).
- **Administradores:** configuran la empresa, los usuarios, los permisos y las integraciones.

Cada persona ve solo lo que su rol le permite (ver [Conoce el panel](./conoce-el-panel.md)).

## Cómo se ve el día a día

1. Se registra al **cliente** con sus datos y sus datos fiscales (NIT, CUI o consumidor final).
2. Se le crea un **servicio** de internet: en qué router se conecta, qué plan tiene, su IP y su usuario PPPoE.
3. Cada periodo ArgosIsp emite sus **facturas** (avisos de cobro) según la **plantilla de facturación** del servicio.
4. Si no paga a tiempo, las reglas de la plantilla **limitan** la velocidad o **suspenden** el servicio. El cliente que navega ve la página de corte con cómo pagar.
5. Cuando **paga** (en caja, por depósito, transferencia o en línea) o hace una **promesa de pago** aprobada, el servicio se **reactiva solo**, sin esperar a nadie.
6. Cada pago entra al **libro contable** con su asiento, y si la empresa usa FEL, la factura se certifica.

## Módulos

| Módulo                   | Qué cubre                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Clientes y servicios** | Fichas de cliente, datos fiscales, responsable de pago, servicios PPPoE con IPv4 e IPv6, estados y acciones (suspender, reactivar, limitar, retirar), sesión en línea |
| **Cobros**               | Cobro rápido, caja con turnos y arqueo, pagos, comprobantes de depósito del portal, promesas de pago, notas de crédito, bonificaciones                                |
| **Facturación**          | Facturas por periodo, plantillas con sus reglas de corte, mora y promesas, cargos únicos                                                                              |
| **Contabilidad**         | Libro diario y mayor de doble partida, egresos, cartera, cierres, bloqueos del libro                                                                                  |
| **Bancos**               | Depósitos de caja, fondos en tránsito, conciliación bancaria, cobros por liquidar de pasarelas                                                                        |
| **Fiscal**               | Factura electrónica (FEL) con su certificador, libros legales, declaraciones, calendario fiscal                                                                       |
| **Compras y activos**    | Proveedores, compras, pagos a proveedores, activos fijos y su depreciación                                                                                            |
| **Inventario**           | Productos, bodegas (también la del técnico), traslados, equipos por serie en comodato, conteos físicos                                                                |
| **Red**                  | Routers MikroTik, redes IPv4 y bloques IPv6, planes de velocidad, prioridad del tráfico (QoS), RADIUS                                                                 |
| **Portal del cliente**   | Donde el cliente ve sus facturas, paga, sube comprobantes, promete pagar y ve anuncios                                                                                |
| **Lealtad**              | Puntos, premios, canjes, referidos y sorteos                                                                                                                          |
| **Notificaciones**       | Avisos al cliente por correo, Telegram y WhatsApp (por Iris)                                                                                                          |
| **Control**              | Bitácora de todo lo que se hace, reportes con exportación a Excel o CSV, usuarios, roles y tokens de API                                                              |
| **Integraciones**        | Horus Flow (tráfico y seguridad) e Iris (operación de campo, tickets y mensajería)                                                                                    |

## Varias empresas

Una misma instalación puede atender a varias empresas, cada una con su NIT. Cada servicio, factura, pago y caja es de una empresa y nunca se mezclan. Con una sola empresa no notas nada de esto.

## Siguiente paso

- [Conoce el panel](./conoce-el-panel.md)
- [Glosario](./glosario.md)
- [Tutoriales por puesto](../tutoriales/)
