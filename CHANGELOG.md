# Changelog

## [1.5.1](https://github.com/HCDestroyer/argos-isp/compare/v1.5.0...v1.5.1) (2026-10-31)


### Correcciones

* **infra:** actualizar no se cae cuando cambia la red de compose ([#208](https://github.com/HCDestroyer/argos-isp/issues/208)) ([faf6c04](https://github.com/HCDestroyer/argos-isp/commit/faf6c04b36ed00a062ee000827b3ae8e5ed1a3e1))

## [1.5.0](https://github.com/HCDestroyer/argos-isp/compare/v1.4.1...v1.5.0) (2026-10-31)


### Funcionalidades

* **integraciones:** conectar Iris con un botón (contrato 0.4.0 §1.4) ([#205](https://github.com/HCDestroyer/argos-isp/issues/205)) ([f7a213d](https://github.com/HCDestroyer/argos-isp/commit/f7a213d938e698a9aad2ff1163bab36b40b33320))
* **network:** PPPoE sin RADIUS con secrets locales (API, panel, plantilla y script) ([#206](https://github.com/HCDestroyer/argos-isp/issues/206)) ([df5ecf6](https://github.com/HCDestroyer/argos-isp/commit/df5ecf6b4f75162178c01067584ad7f546dd8aa5))
* **network:** prioridad por protocolo (QoS) con clases configurables ([#204](https://github.com/HCDestroyer/argos-isp/issues/204)) ([10078a6](https://github.com/HCDestroyer/argos-isp/commit/10078a6cbbbf791e4b8c5511047998519a9ef7b5))
* **network:** routers sin RADIUS (modo api) en la API y el panel ([#200](https://github.com/HCDestroyer/argos-isp/issues/200)) ([3de1990](https://github.com/HCDestroyer/argos-isp/commit/3de1990f32eaf7b7a85ce8063223ecc068351e27))
* **web:** pantalla Integraciones → Iris ([#203](https://github.com/HCDestroyer/argos-isp/issues/203)) ([021981d](https://github.com/HCDestroyer/argos-isp/commit/021981d3a97bdde6749589aa26dcb44d9c2ee16f))

## [1.4.1](https://github.com/HCDestroyer/argos-isp/compare/v1.4.0...v1.4.1) (2026-10-30)


### Correcciones

* **infra:** Caddy sin SNI detrás de un proxy y confianza en la red de compose ([#198](https://github.com/HCDestroyer/argos-isp/issues/198)) ([9f82148](https://github.com/HCDestroyer/argos-isp/commit/9f82148e6313e4a5c0213663d78e3c714a73d786))
* **infra:** prueba de distribución sin grep -q sobre la tubería de compose logs ([#196](https://github.com/HCDestroyer/argos-isp/issues/196)) ([eed0da2](https://github.com/HCDestroyer/argos-isp/commit/eed0da286724809bb7b54868d952f8259e6a1bc4))

## [1.4.0](https://github.com/HCDestroyer/argos-isp/compare/v1.3.0...v1.4.0) (2026-10-30)


### Funcionalidades

* **billing:** la promesa de pago cubre todo lo vencido, sin monto escrito ([#190](https://github.com/HCDestroyer/argos-isp/issues/190)) ([f6d8b6e](https://github.com/HCDestroyer/argos-isp/commit/f6d8b6ea249a55c7f0cb8454db903a56cd8f5c92))
* **core:** eliminar servicios y routers sin historial ([#186](https://github.com/HCDestroyer/argos-isp/issues/186)) ([8a007d8](https://github.com/HCDestroyer/argos-isp/commit/8a007d878f8459ccea0ebdd862ff9eb1ce545222))
* **integraciones:** pedidos de Iris tras la prueba de punta a punta (contrato 0.3.1) ([#185](https://github.com/HCDestroyer/argos-isp/issues/185)) ([008f81c](https://github.com/HCDestroyer/argos-isp/commit/008f81c0f7679eceb326afd0f16f23810ae1ee66))
* **network:** control de velocidad por capas, sincronizar plan y diagnóstico de corte ([#188](https://github.com/HCDestroyer/argos-isp/issues/188)) ([8acca91](https://github.com/HCDestroyer/argos-isp/commit/8acca9191cab2796b9d3c31b21a8f769e9f38073))
* **network:** impedir, detectar y unir routers duplicados ([#192](https://github.com/HCDestroyer/argos-isp/issues/192)) ([59bcbc8](https://github.com/HCDestroyer/argos-isp/commit/59bcbc86a0c5273233717dbf51f97264ca5872c2))


### Correcciones

* **infra:** el script de conexión nunca deja fuera al administrador ([#183](https://github.com/HCDestroyer/argos-isp/issues/183)) ([ca1f619](https://github.com/HCDestroyer/argos-isp/commit/ca1f619168d5fe30b2218927ed0e376ae19f040d))

## [1.3.0](https://github.com/HCDestroyer/argos-isp/compare/v1.2.0...v1.3.0) (2026-10-29)


### Funcionalidades

* **integraciones:** conector Iris, webhooks Argos → Iris y bienvenida al activar la instalación ([#179](https://github.com/HCDestroyer/argos-isp/issues/179)) ([00c46f9](https://github.com/HCDestroyer/argos-isp/commit/00c46f9c1d11082c3f7e9b470f6900abad3c0af8))
* **network:** script de conexión con WireGuard, probar conexión, reconciliar y sincronizar servicio ([#181](https://github.com/HCDestroyer/argos-isp/issues/181)) ([8914141](https://github.com/HCDestroyer/argos-isp/commit/891414157ecce348f71d44f093bfda2e0c3d85cb))
* **web:** observaciones del PM — alta de servicio, caja, modales, campos obligatorios, textos, pools e IPv6 ([#180](https://github.com/HCDestroyer/argos-isp/issues/180)) ([beca227](https://github.com/HCDestroyer/argos-isp/commit/beca227b9b2c84b67ddbbed676303ac508bc07a7))


### Correcciones

* **billing:** observaciones del auditor sobre pendiente de instalación ([#178](https://github.com/HCDestroyer/argos-isp/issues/178)) ([f437d8c](https://github.com/HCDestroyer/argos-isp/commit/f437d8c4fa0080154d80e3e81d102fec143c1df4))
* **portal:** textos para el cliente sin notas internas y campos obligatorios con su motivo ([#177](https://github.com/HCDestroyer/argos-isp/issues/177)) ([d402a6b](https://github.com/HCDestroyer/argos-isp/commit/d402a6b11db5a905422360604f11a37fd2d04e83))

## [1.2.0](https://github.com/HCDestroyer/argos-isp/compare/v1.1.0...v1.2.0) (2026-10-28)


### Funcionalidades

* **infra:** Argos detrás de Nginx Proxy Manager, admin-clave, desinstalar y arreglo de instalar.sh por pipe ([#173](https://github.com/HCDestroyer/argos-isp/issues/173)) ([9563fa8](https://github.com/HCDestroyer/argos-isp/commit/9563fa85772386731fed6fa1372dae1b708bc2e8))
* **inventario:** origen de la orden de Iris (pedidos Iris A3/A4) ([#172](https://github.com/HCDestroyer/argos-isp/issues/172)) ([c89d2c4](https://github.com/HCDestroyer/argos-isp/commit/c89d2c4b12453ad3e48580bda22a2c42ebffff03))
* servicio pendiente de instalación (pedidos Iris A1, A6 y A9) ([#175](https://github.com/HCDestroyer/argos-isp/issues/175)) ([23bc36f](https://github.com/HCDestroyer/argos-isp/commit/23bc36fcbbfcba6ec6fdf124814d205499b603c4))


### Correcciones

* **core:** límite de login por la IP real del cliente detrás del proxy ([#174](https://github.com/HCDestroyer/argos-isp/issues/174)) ([00fae9b](https://github.com/HCDestroyer/argos-isp/commit/00fae9b14c58e9cc24285fa409334e2c650a03ea))

## [1.1.0](https://github.com/HCDestroyer/argos-isp/compare/v1.0.0...v1.1.0) (2026-10-24)


### Funcionalidades

* **core:** catálogo de permisos y roles base en el OpenAPI; Router sin api_ca ([#167](https://github.com/HCDestroyer/argos-isp/issues/167)) ([7c30717](https://github.com/HCDestroyer/argos-isp/commit/7c30717345f88544b29797b4afbecf3a13dd89d3))
* **core:** contratos obligatorios, catálogo de campos personalizados y contacto de routers ([#157](https://github.com/HCDestroyer/argos-isp/issues/157)) ([5f97332](https://github.com/HCDestroyer/argos-isp/commit/5f97332ec2f77438fcc1cd355f09cabe6d1d4bad))
* **core:** Rol.base, alcances de tokens tipados, CA del router oculta y origen externo de clientes y servicios ([#161](https://github.com/HCDestroyer/argos-isp/issues/161)) ([0e8c38e](https://github.com/HCDestroyer/argos-isp/commit/0e8c38e41ce97cde96d5135f6fa910f5160129e7))
* **inventario:** inventario interno completo (productos, bodegas, kardex, comodato, ventas, conteos) ([#165](https://github.com/HCDestroyer/argos-isp/issues/165)) ([1d553c8](https://github.com/HCDestroyer/argos-isp/commit/1d553c80309db9ebd22c2b078de05c4da95f9906))
* **inventario:** pantallas del inventario en el panel y precio de venta del producto ([#169](https://github.com/HCDestroyer/argos-isp/issues/169)) ([a4b9a82](https://github.com/HCDestroyer/argos-isp/commit/a4b9a82d072e2cbbf469a0fcb117de2816b358e1))
* **ledger:** cierre de saldos de apertura, H27, egresos del cajero, canje espejo y pasarela Recurrente ([#160](https://github.com/HCDestroyer/argos-isp/issues/160)) ([f566b70](https://github.com/HCDestroyer/argos-isp/commit/f566b70ef8352983935cfbe299f80eb4dd707956))
* **network:** contacto periódico de los routers (accounting, RouterOS y sondeo) ([#163](https://github.com/HCDestroyer/argos-isp/issues/163)) ([d3c8506](https://github.com/HCDestroyer/argos-isp/commit/d3c8506b8e45d428374b08d1fba7a34a8b8f52f7))
* **notify:** aviso de contracargo a contabilidad y variables de Recurrente en los compose ([#164](https://github.com/HCDestroyer/argos-isp/issues/164)) ([6bda4f1](https://github.com/HCDestroyer/argos-isp/commit/6bda4f161a1b283edae13316ab4561b37d6326f2))
* **notify:** catálogo de eventos y vista previa de plantillas; walled garden de Recurrente ([#159](https://github.com/HCDestroyer/argos-isp/issues/159)) ([16b83ba](https://github.com/HCDestroyer/argos-isp/commit/16b83ba719cc9300a935b60db3a38afe6668edac))
* **web:** plantillas, usuarios/roles/tokens y pantallas pendientes del panel (tareas 8 y 9) ([#166](https://github.com/HCDestroyer/argos-isp/issues/166)) ([fcd2084](https://github.com/HCDestroyer/argos-isp/commit/fcd2084556080a33f661650163ca3e22e92c4c1e))


### Correcciones

* **billing:** H60–H64, disputas de la pasarela y pedidos del panel ([#162](https://github.com/HCDestroyer/argos-isp/issues/162)) ([92770ed](https://github.com/HCDestroyer/argos-isp/commit/92770edb3f943daefe3db5a4088c7a982d3a401c))
* **billing:** regla única de comisión en reembolsos de la pasarela (H72, H73) ([#168](https://github.com/HCDestroyer/argos-isp/issues/168)) ([4734756](https://github.com/HCDestroyer/argos-isp/commit/4734756ef34b18af0f3e0dde427442bcafe53368))
* **notify:** recordatorios solo de deuda cobrable y avisos de los eventos contables, de lealtad y de sorteos ([#158](https://github.com/HCDestroyer/argos-isp/issues/158)) ([e2646cb](https://github.com/HCDestroyer/argos-isp/commit/e2646cbbf6d7c1a7d098ec1b56e8bd0e0f907c12))
* **portal:** facturas castigadas y acreditadas sin saldo en el portal ([#155](https://github.com/HCDestroyer/argos-isp/issues/155)) ([94a45e9](https://github.com/HCDestroyer/argos-isp/commit/94a45e9924df15cd6c2624fd285ff97bfa27a347))

## [1.0.0](https://github.com/HCDestroyer/argos-isp/compare/v0.9.2...v1.0.0) (2026-10-23)


### Integración continua

* comentario de las partes de Playwright en una sola frase ([#151](https://github.com/HCDestroyer/argos-isp/issues/151)) ([574926a](https://github.com/HCDestroyer/argos-isp/commit/574926aa8312a4f4c9874fde05efc791cd3d1e00))

## [0.9.2](https://github.com/HCDestroyer/argos-isp/compare/v0.9.1...v0.9.2) (2026-10-23)


### Funcionalidades

* **fiscal:** fase 6 PR D, libros legales con folio y sus pantallas (auditado) ([#142](https://github.com/HCDestroyer/argos-isp/issues/142)) ([4db64fb](https://github.com/HCDestroyer/argos-isp/commit/4db64fbaacf0fd6ea5a809ad1cf912b49759f079))
* **fiscal:** fase 7 PR A, calendario fiscal, feriados y alertas de vencimiento (auditado) ([#143](https://github.com/HCDestroyer/argos-isp/issues/143)) ([3493836](https://github.com/HCDestroyer/argos-isp/commit/3493836f7e6201d7d4721a1f6610a20243ad7315))
* **fiscal:** fase 7 PR B, declaraciones de IVA y pequeño contribuyente con liquidación obligatoria (auditado) ([#144](https://github.com/HCDestroyer/argos-isp/issues/144)) ([f218b3e](https://github.com/HCDestroyer/argos-isp/commit/f218b3e3aa447f1d0fe85fe615fa13da3c13da72))
* **fiscal:** fase 7 PR C, ISR, ISO, retenciones y anulación del pago de declaraciones (auditado) ([#145](https://github.com/HCDestroyer/argos-isp/issues/145)) ([cf9699c](https://github.com/HCDestroyer/argos-isp/commit/cf9699cda425b26e3fde73afef802d3b0ae4f455))
* **fiscal:** fase 8, tablero fiscal, comparador de regímenes y consejos (auditado) ([#147](https://github.com/HCDestroyer/argos-isp/issues/147)) ([afd9bd8](https://github.com/HCDestroyer/argos-isp/commit/afd9bd846ab66a6869cebeebe41be96f1301e6b0))
* **lealtad:** sorteos completos, contabilidad auditada, panel y portal ([#130](https://github.com/HCDestroyer/argos-isp/issues/130)) ([78edaef](https://github.com/HCDestroyer/argos-isp/commit/78edaef5f9c7c4670a2d1af666b6bdd5fa0d1927))
* **ledger:** fase 6 PR A, bloqueos del libro por tipo, bloqueo duro y excepciones (auditado) ([#128](https://github.com/HCDestroyer/argos-isp/issues/128)) ([461af38](https://github.com/HCDestroyer/argos-isp/commit/461af386e9bc98563e8e4b932272a9c71cc993a8))
* **ledger:** fase 6 PR B, checks de cierre mensual y anual (auditado) ([#137](https://github.com/HCDestroyer/argos-isp/issues/137)) ([d4c05ac](https://github.com/HCDestroyer/argos-isp/commit/d4c05ac3ab3a5b2be7823ed848ef0cdb0335d227))
* **ledger:** fase 6 PR C, cierre anual del ejercicio (auditado) ([#140](https://github.com/HCDestroyer/argos-isp/issues/140)) ([23875bc](https://github.com/HCDestroyer/argos-isp/commit/23875bc9df07d6f6f817f832bb0e8af819d2da09))
* **portal:** meses bonificados en las facturas y el estado de cuenta ([#125](https://github.com/HCDestroyer/argos-isp/issues/125)) ([838201d](https://github.com/HCDestroyer/argos-isp/commit/838201d746806aedaf0a781c6f24de3009923c20))
* **web:** bonificaciones en lugar de facturas de Q0 y cargo único ([#127](https://github.com/HCDestroyer/argos-isp/issues/127)) ([9ae5c49](https://github.com/HCDestroyer/argos-isp/commit/9ae5c4986a3f6ecf91f72668a2224069a8744323))
* **web:** lista de verificación de cierre y procesos detenidos por un bloqueo (fase 6 PR B) ([#138](https://github.com/HCDestroyer/argos-isp/issues/138)) ([a7bad5e](https://github.com/HCDestroyer/argos-isp/commit/a7bad5e03bcd38c8ef4c96f96a4e398ce8923215))
* **web:** pantallas de bloqueos del libro (fase 6 PR A) ([#131](https://github.com/HCDestroyer/argos-isp/issues/131)) ([9a175ea](https://github.com/HCDestroyer/argos-isp/commit/9a175ea30106c35d062717df8946afeb19b3bdbf))
* **web:** pantallas de la fase 5, proveedores, compras, activos fijos y diferidos ([#146](https://github.com/HCDestroyer/argos-isp/issues/146)) ([26321c7](https://github.com/HCDestroyer/argos-isp/commit/26321c7546a01f06cfaffd0bc4a20310e434254b))


### Correcciones

* **billing:** generar, vencer y cortar a mano solo en las empresas del usuario; pruebas estables (auditado) ([#133](https://github.com/HCDestroyer/argos-isp/issues/133)) ([f729fc9](https://github.com/HCDestroyer/argos-isp/commit/f729fc9d3e6355381fbb49fd3c7a6bf4db334720))
* **web:** fecha de Guatemala en los pagos del estado de cuenta de las fixtures ([#136](https://github.com/HCDestroyer/argos-isp/issues/136)) ([28b22bb](https://github.com/HCDestroyer/argos-isp/commit/28b22bb74a89e5fbbae718a529404ed88a69fd45))

## [0.9.1](https://github.com/HCDestroyer/argos-isp/compare/v0.9.0...v0.9.1) (2026-10-19)


### Funcionalidades

* **billing:** decisión B, cerrar diferencia como gasto interno 5.3.05 (auditado) ([104f490](https://github.com/HCDestroyer/argos-isp/commit/104f4905deb2af364f6db905c207570acc52e7f7))
* **billing:** decisiones del PM, sin facturas de Q0 (bonificaciones), cargo único, saldo a favor y adicionales cobrados (auditado) ([#118](https://github.com/HCDestroyer/argos-isp/issues/118)) ([18a33c1](https://github.com/HCDestroyer/argos-isp/commit/18a33c194da935ccea02a009b3446c2b0bad6ce5))
* **core:** adicionales bloqueados con el servicio suspendido y primer periodo del cobrado ([4ec5fb1](https://github.com/HCDestroyer/argos-isp/commit/4ec5fb1d6ce5736c3aa04ec7354a7443962a808b))
* **core:** adicionales bloqueados con el servicio suspendido y primer periodo prorrateado o sin costo ([e163071](https://github.com/HCDestroyer/argos-isp/commit/e1630713bdc9d1408c6438e56f0c3dafefe86104))
* **infra:** prueba de punta a punta final con una versión publicada ([ad94452](https://github.com/HCDestroyer/argos-isp/commit/ad94452432af8e4b48dfe0ef0a21f8bb11650709))
* **portal:** adicionales bloqueados por suspensión en /cuenta ([a8024f7](https://github.com/HCDestroyer/argos-isp/commit/a8024f771d9be496280a7e0092b2161330e7fa39))
* **portal:** anuncios y promociones del portal con su panel, y vista de lealtad ([a9ad99c](https://github.com/HCDestroyer/argos-isp/commit/a9ad99c721f48c09378be33c098ce5ea6fcd60bc))
* **portal:** servicios adicionales y tipo de plan en el portal, con estado bloqueado ([cd5cd66](https://github.com/HCDestroyer/argos-isp/commit/cd5cd6616eb6733d6da90362e9952de73da4edd4))
* **web:** adicionales bloqueados por la suspensión y primer periodo del cobrado ([#123](https://github.com/HCDestroyer/argos-isp/issues/123)) ([d7f5aa6](https://github.com/HCDestroyer/argos-isp/commit/d7f5aa6bc4ba3776a2cc3531b5cae4c5744aeaeb))


### Correcciones

* **core:** la búsqueda de clientes usa el teléfono solo si q tiene forma de teléfono ([51ce999](https://github.com/HCDestroyer/argos-isp/commit/51ce999732118fbb355c5492b45b243da71f1698))
* **notify:** la vigilancia de crons cuenta la corrida de su mismo milisegundo ([d587f04](https://github.com/HCDestroyer/argos-isp/commit/d587f043bb30ecf480f1614e5f2d56032d2054f8))
* **notify:** la vigilancia de crons ve una corrida en el mismo milisegundo y su prueba no depende de la hora ([6df75be](https://github.com/HCDestroyer/argos-isp/commit/6df75be5f2d8e4a6e0f4cb39465f245a5ba63547))

## 0.9.0 (2026-10-19)


### Funcionalidades

* **billing:** anulación de DTE en dos pasos, NCRE y nota por línea, facturas.sustituir ([716b3c5](https://github.com/HCDestroyer/argos-isp/commit/716b3c5556e847e2084e79d326dd81cee10fbdb8))
* **billing:** anular nota con NCRE rechazada y cierre bloqueado por NCRE sin certificar ([927070c](https://github.com/HCDestroyer/argos-isp/commit/927070c2dc9e14157f73640718510decaf654e24))
* **billing:** contabilidad y cobros por empresa (multiempresa) ([743bff7](https://github.com/HCDestroyer/argos-isp/commit/743bff72fa37ea4ff62a34a1f496ff8497df191b))
* **billing:** declarar nulable en ColumnaReporte del OpenAPI ([85437ac](https://github.com/HCDestroyer/argos-isp/commit/85437ac06bc5e0751d170b4b898861c351682145))
* **billing:** factura castigada con estado propio y recuperación de cuentas incobrables (decisión g) ([085359e](https://github.com/HCDestroyer/argos-isp/commit/085359ec52d462c415734885fef882779a65f817))
* **billing:** filtros, resumen y verificado_por_nombre en la cola de comprobantes ([cca1e59](https://github.com/HCDestroyer/argos-isp/commit/cca1e59300d84200f2ccd25ab5838243f09d51a6))
* **billing:** hallazgos H16–H18 de la fase 4 (acreditada, recuperación con IVA, cargo de diferencia) ([98ad12e](https://github.com/HCDestroyer/argos-isp/commit/98ad12e0e83530cfdf7efab451ece0b378ec5585))
* **billing:** importación completa: cargos únicos, facturas sin cargo o saldadas y promesas vigentes ([9196680](https://github.com/HCDestroyer/argos-isp/commit/9196680aaaf02f7c901348c18af99008125376a8))
* **billing:** importación neutral por origen (tanda 2, tarea 4) ([3fc0fe4](https://github.com/HCDestroyer/argos-isp/commit/3fc0fe47ba4e6f9ffa8e11cd27d8cdb49619d662))
* **billing:** notas de crédito internas (tanda 2, tarea 2) ([735bec0](https://github.com/HCDestroyer/argos-isp/commit/735bec0f7442bfc3cc20a89b969fa675a6320595))
* **billing:** pago histórico y reverso del saldo inicial para la importación ([427487c](https://github.com/HCDestroyer/argos-isp/commit/427487c3b000ec7fe5e155d426ed79f216edc957))
* **billing:** reportes con histórico y filtro origen (tanda 2, tarea 3) ([f799896](https://github.com/HCDestroyer/argos-isp/commit/f7998961472c943e0a65073985aff84149a2e298))
* **billing:** tipo estable EvaluacionPromesa para resultado_evaluacion ([115ae92](https://github.com/HCDestroyer/argos-isp/commit/115ae92429c5006cbc0fbe56d20498c934cbbd3a))
* **billing:** url_retorno del pago en línea y 303 de la pasarela falsa ([1356fb7](https://github.com/HCDestroyer/argos-isp/commit/1356fb7d3373ae2662ceb1d19d943e599c5c2812))
* **core:** alcance de usuarios por empresa (multiempresa, paso 3) ([918fa93](https://github.com/HCDestroyer/argos-isp/commit/918fa936d77206095f38c4fb97a1e065b6b23fa1))
* **core:** carga por lotes de registros aaa y comando aaa:repoblar ([fe6001f](https://github.com/HCDestroyer/argos-isp/commit/fe6001fb6ac0a6e93ce5d0e481142687bb442bca))
* **core:** empresa activa por X-Empresa-Id (multiempresa, paso 4) ([6d2d735](https://github.com/HCDestroyer/argos-isp/commit/6d2d73511ff24af846c5eb5dfd56d8e8a40075fe))
* **core:** empresa en la bitácora de acciones (multiempresa) ([098b465](https://github.com/HCDestroyer/argos-isp/commit/098b465cf524d7ed286d8a1553a92375fba5c199))
* **core:** empresa_id en servicios, zonas y routers (multiempresa, paso 2) ([90b77ea](https://github.com/HCDestroyer/argos-isp/commit/90b77ea23269b259f90013964b7b298260250798))
* **core:** empresas (multiempresa, paso 1) ([3b59ec5](https://github.com/HCDestroyer/argos-isp/commit/3b59ec5229357689dc73bd0742c04f29925c9097))
* **core:** integración Horus 1.2.0 (resolver por lotes, código de cliente, cliente.actualizado, token técnico y autologin) ([4f287ef](https://github.com/HCDestroyer/argos-isp/commit/4f287ef39766bebcd34636a88beccfd88a463ca9))
* **core:** límite de intentos de login por IP y por usuario ([ac507f8](https://github.com/HCDestroyer/argos-isp/commit/ac507f88403786121141dae30f0af071ca18394d))
* **core:** localización fiscal, fase 1 (país de la empresa, documento fiscal del cliente y permisos) ([f6bdd26](https://github.com/HCDestroyer/argos-isp/commit/f6bdd263df6dccae03c253bdcd096e94817c3797))
* **core:** OpenAPI estricto en los esquemas del núcleo ([4890fe2](https://github.com/HCDestroyer/argos-isp/commit/4890fe2d6e32de2a2f8899fb1515bdc339db8217))
* **core:** planes temporales y códigos de referido del programa de lealtad ([ed674ae](https://github.com/HCDestroyer/argos-isp/commit/ed674aec1033b81385e8a9ba00469c47f12648d6))
* **core:** plantilla por defecto usa la marca por_defecto de billing ([2ad9641](https://github.com/HCDestroyer/argos-isp/commit/2ad96413d824b330b202f4d38ea6f7bdb2f681f6))
* **core:** servicios adicionales (incluido, cortesía, cobrado) por servicio y por plan ([9f194bc](https://github.com/HCDestroyer/argos-isp/commit/9f194bcb0858c05f710d3b4e76b20b6962b919f8))
* **core:** servicios adicionales (streaming, IPTV) incluidos, de cortesía o cobrados ([e617c1b](https://github.com/HCDestroyer/argos-isp/commit/e617c1b4b5ca9defd9687a4f51f4fa9cac9c786a))
* **core:** sesión del panel deslizante con tope absoluto ([f275ba2](https://github.com/HCDestroyer/argos-isp/commit/f275ba27e210472b52164cd6433d4ff8caef0daf))
* **core:** sesión del panel en cookie HttpOnly con CSRF ([a01ec48](https://github.com/HCDestroyer/argos-isp/commit/a01ec48deb11e5e5dc47bb43a5fa3cecd38c53a0))
* **core:** tipo de actor cliente para las acciones del portal ([e194fed](https://github.com/HCDestroyer/argos-isp/commit/e194fedadbe6ce6395d4ddb7c7c439df2eaad1c2))
* **fiscal:** API de FEL (configuración, credenciales, DTE, certificar, lotes, sustituir) y contratos ([08d55ac](https://github.com/HCDestroyer/argos-isp/commit/08d55ace3c2e269b5ff5c996db85a8b861db7cdb))
* **fiscal:** lecturas FEL para panel, portal y notify (proveedores, filtros e intentos de DTE, NCRE en la nota, sustituciones, diarios) ([3e1c218](https://github.com/HCDestroyer/argos-isp/commit/3e1c218648874f6360482b0571d1c5a986f98c25))
* **fiscal:** localización GT gt-2026.1, parámetros e impuestos con vigencia, régimen, establecimientos y frases (fase 2) ([8b1cb45](https://github.com/HCDestroyer/argos-isp/commit/8b1cb45bc94416255306ed198514662923d2a11b))
* **fiscal:** modos de emisión, ciclo de 2.1.11 y cola FEL con reintentos ([8d41d47](https://github.com/HCDestroyer/argos-isp/commit/8d41d479d7d867ec64ab0c432306fda8a685a14f))
* **fiscal:** ProveedorFel con INFILE y falso, fiscal.dte, configuración y credenciales cifradas ([dd26bb9](https://github.com/HCDestroyer/argos-isp/commit/dd26bb9c36d50822c00728b21f8ddaceae35a63f))
* **fiscal:** valor de parámetros como objeto libre en el OpenAPI y tipos de DTE en la localización (pedidos de A4) ([0a59470](https://github.com/HCDestroyer/argos-isp/commit/0a59470d3ceb4c5d6f0c21b72fa18f0e3a3e8ace))
* **importacion:** --empresa y --excluir-tablas ([f3e9979](https://github.com/HCDestroyer/argos-isp/commit/f3e9979cb0759ce17db9c82279911e5c85a8254e))
* **importacion,notify:** empresa explícita en la importación y avisos de cobro repartido ([ba0831c](https://github.com/HCDestroyer/argos-isp/commit/ba0831cf3fca759a00d0d8d5bed3d9c134eef55d))
* **importacion:** adaptadores de Mikrowisp 6 y SmartISP contra el esquema real ([8423100](https://github.com/HCDestroyer/argos-isp/commit/842310040ac21b6bc91c928b9ea9ed4c6e5718d2))
* **importacion:** importación completa con archivo del origen y cuadre obligatorio ([08e83f3](https://github.com/HCDestroyer/argos-isp/commit/08e83f3a0d4d463e5f1374c320f3934bf0c2f006))
* **importacion:** importador multi-origen con formato canónico y adaptadores mikrowisp, csv y smartisp (tarea 1) ([60594d9](https://github.com/HCDestroyer/argos-isp/commit/60594d920bcae2ae5c4e9c4706061476e7e17903))
* **importacion:** origen neutral de A3 en facturas, pagos y saldos importados ([bc63f48](https://github.com/HCDestroyer/argos-isp/commit/bc63f488c082a7b3b3e14dfff12b692038fc3cc1))
* **importacion:** pagos históricos con RegistrarPagoHistorico de A3 en modo B (tarea 2) ([6fe490a](https://github.com/HCDestroyer/argos-isp/commit/6fe490a33ac6d74891e2e68a098559d3019f538e))
* **infra:** Alertmanager manda las alertas de Prometheus a Telegram ([373025c](https://github.com/HCDestroyer/argos-isp/commit/373025c59403105aa6da5e12929c0122d5615f82))
* **infra:** api-portal para el tráfico del portal y nodo portal remoto ([9002dd3](https://github.com/HCDestroyer/argos-isp/commit/9002dd3cc409c56d9099cb2bca52162972a1e6ed))
* **infra:** compose de producción, instalar.sh y argosisp actualizar/revertir ([bf6c992](https://github.com/HCDestroyer/argos-isp/commit/bf6c9925eb70b8a43cec2091aee1aed239617707))
* **infra:** distribución en arm64 (Raspberry Pi) y FreeRADIUS multi-arquitectura ([f970f19](https://github.com/HCDestroyer/argos-isp/commit/f970f191d1a0635d1c3d6241310463484000fbd0))
* **infra:** ensayo de restauración en un compose limpio con smoke test ([d1b2bdc](https://github.com/HCDestroyer/argos-isp/commit/d1b2bdc77f1adbb524f713475a11700fa4469978))
* **infra:** imágenes de producción con versión, sin gestores de paquetes ni root ([9017f5b](https://github.com/HCDestroyer/argos-isp/commit/9017f5b582586ebfe021ea67d181197e301fe63b))
* **infra:** nodo portal según el contrato nodo-portal 1.0.0 ([fff7fd8](https://github.com/HCDestroyer/argos-isp/commit/fff7fd8314a043729d42b6e2f66c2645f1878151))
* **infra:** pasarela en el compose y proxy que pasa el webhook crudo ([2b74ebd](https://github.com/HCDestroyer/argos-isp/commit/2b74ebd5edf4d0bfae08d58cd7c9411689018a96))
* **infra:** portal por HTTPS con HSTS y /corte por HTTP (tarea 4) ([c2da88a](https://github.com/HCDestroyer/argos-isp/commit/c2da88a44f59b2a9d71de56013c380dad1621fd9))
* **infra:** PORTAL_URL_PUBLICA y PASARELA_RETORNO_ORIGENES en la API (pedido de A5) ([594bad8](https://github.com/HCDestroyer/argos-isp/commit/594bad8acc5e4b675f332318658ef80ef6bf9137))
* **infra:** sesiones-worker con AAA_INTERIM_SEGUNDOS y alerta NasSinAccounting (pedido de A2) ([b648e21](https://github.com/HCDestroyer/argos-isp/commit/b648e21d510c10f24b10a2061bc526c38a6237d8))
* **integraciones:** conector Horus Flow (contrato 1.2.0: A4, A6, A7, A8, A9) ([0e690cd](https://github.com/HCDestroyer/argos-isp/commit/0e690cd11ba3d25653247481059c8cfcf8abbcbc))
* **integraciones:** pedidos de A4 sobre Horus (enlace al panel, estado, datos 360, reintentar_en) ([4a6b7af](https://github.com/HCDestroyer/argos-isp/commit/4a6b7afa9fb4d1f5b4e90125ab5f801636e74886))
* **lealtad:** programa, reglas, movimientos por lotes, consumidor y pasivo (wip) ([4354165](https://github.com/HCDestroyer/argos-isp/commit/4354165db2f847b170d1f706ba134ecf6183ef1a))
* **ledger:** activos fijos con depreciación lineal y diferidos con amortización mensual (fase 5, §10.10) ([8056f18](https://github.com/HCDestroyer/argos-isp/commit/8056f18ee264f4268b780e3f832ed0ca39e0dc34))
* **ledger:** cadena de hash con sellador e integridad del libro (§10.10, fase 2) ([b5d1326](https://github.com/HCDestroyer/argos-isp/commit/b5d1326ae0a153c95cb2ce84d60ef8aee818b765))
* **ledger:** cierre de diferencias, estimación y castigo de cartera (fase 4, §10.9) ([f50177c](https://github.com/HCDestroyer/argos-isp/commit/f50177c19c5bd748bd03e9e02432b75bc8f7d053))
* **ledger:** cobros por liquidar 1.1.10.NN y liquidaciones de proveedores (fase 4, §10.3) ([970fb38](https://github.com/HCDestroyer/argos-isp/commit/970fb3881703736d5b3b437a60b8263fcd79d0de))
* **ledger:** contabilidad fase 5 con H19, H20 y bloqueo por activo (auditada) ([b505333](https://github.com/HCDestroyer/argos-isp/commit/b505333ceae532e3d9cf71877b5ef32cf810634c))
* **ledger:** contrato, eventos y README de la fase 4 (cobros, bancos y cartera) ([e403883](https://github.com/HCDestroyer/argos-isp/commit/e40388310e072e8885382eb7b31c28d4ed38c34c))
* **ledger:** depósito de caja y traslados entre bancos vía 1.1.11 (fase 4, §10.3) ([1c0a771](https://github.com/HCDestroyer/argos-isp/commit/1c0a771085b10e9cbc27070a0c3063eb016f2692))
* **ledger:** depósitos legibles por el cajero de su caja y proveedor_cobro_nombre en Pago (pedidos de A4) ([e1ed3ca](https://github.com/HCDestroyer/argos-isp/commit/e1ed3ca7f3f09a73097fc72799e5ff0849e317d9))
* **ledger:** extractos y conciliación bancaria de solo inserción (fase 4, §10.3) ([b925796](https://github.com/HCDestroyer/argos-isp/commit/b925796a0d1dcedb7a8b155c1f8a61506c61cc31))
* **ledger:** H19 y H20 de la fase 5; un lock por activo; pago a proveedor no precede a su compra ([9114be2](https://github.com/HCDestroyer/argos-isp/commit/9114be2238b175a967e41bf853ffcbc54c1b73df))
* **ledger:** H4 diarios y numeración guardada (§10.7); partida al cerrar el mes y reapertura en orden ([0ec669e](https://github.com/HCDestroyer/argos-isp/commit/0ec669e368e5feb3d0455b5886bda68d5943c2f6))
* **ledger:** integra a3/fase4-bancos (042288d) en la fase 5 ([3988b6a](https://github.com/HCDestroyer/argos-isp/commit/3988b6a22f82bd6de39d68be1704088e235b408d))
* **ledger:** integra a3/fase4-bancos en la fase 5 ([c2786cf](https://github.com/HCDestroyer/argos-isp/commit/c2786cf8612dbc4b6d63a115aa12a072106e44a1))
* **ledger:** integra origin/main (fase 4 completa, pantallas y lealtad) en la fase 5 ([088b1e5](https://github.com/HCDestroyer/argos-isp/commit/088b1e5b2467f248a5ad1ea193e5cd2d0cd07e82))
* **ledger:** proveedores y compras de solo inserción con libro de compras (fase 5, §3.4) ([bacaaf3](https://github.com/HCDestroyer/argos-isp/commit/bacaaf30282385671c482b2219beb794a40e2712))
* **ledger:** retenciones, constancias y pagos a proveedores con su auxiliar y antigüedad (fase 5, §3.4, §3.5) ([aa8d6d3](https://github.com/HCDestroyer/argos-isp/commit/aa8d6d3d8d94baecd9a2279f93642bffaf8184a9))
* **ledger:** revertir asiento por endpoint (tanda 2, tarea 1) ([e184d8c](https://github.com/HCDestroyer/argos-isp/commit/e184d8c9613c5f120ac4b90df56a44b8a5c0bc21))
* **monitoreo:** GET /api/v1/version con la versión instalada y sus cambios ([852aadf](https://github.com/HCDestroyer/argos-isp/commit/852aadfce1c87226e7da638b2be581aabf108c14))
* **network:** aaa:verificar-router, lista previa a migrar un router al nuevo RADIUS ([2da0f06](https://github.com/HCDestroyer/argos-isp/commit/2da0f0632c507c5028210a1f8d7e1bc90252a777))
* **network:** cierre automático de sesiones colgadas sin_interim (semana 3, tanda 2, tarea 4) ([fe271ab](https://github.com/HCDestroyer/argos-isp/commit/fe271ab9736bd4998b2c3b79e1e874a120f319d6))
* **network:** conexión del router para la API REST de RouterOS ([b13daca](https://github.com/HCDestroyer/argos-isp/commit/b13daca50e619566a10dcf80e4c56c6d42b03991))
* **network:** conexión y red del router desde sus columnas en el cliente RouterOS ([09a2fc5](https://github.com/HCDestroyer/argos-isp/commit/09a2fc5535c6990ef2a1b0ba81d4f9e9e9cb03f9))
* **network:** desde/hasta en GET /sesiones y GET /routers/:id/resumen-sesiones (semana 3, tanda 2, tarea 2) ([a07d8b8](https://github.com/HCDestroyer/argos-isp/commit/a07d8b8b3116b9d135aa6b65ca1c0ceab98718c1))
* **network:** fecha de migración del router al nuevo aaa, routers.marcar_migrado (semana 3, tanda 2, tarea 3) ([168bc59](https://github.com/HCDestroyer/argos-isp/commit/168bc59eb20e22af352dcfc52c7deb32503368ce))
* **network:** GET /red/eventos, lectura paginada de audit.red (semana 3, tanda 2, tarea 1) ([f258245](https://github.com/HCDestroyer/argos-isp/commit/f258245b77e45e4942e64cf6844719aea748d252))
* **network:** tipo de plan (residencial, empresarial, dedicado) con advertencias ([332c19f](https://github.com/HCDestroyer/argos-isp/commit/332c19f86d01274dc88719e0029ccb68446668b7))
* **network:** vista previa del rate-limit de un plan ([fe8a331](https://github.com/HCDestroyer/argos-isp/commit/fe8a3319c93b96bc42e750b8d16fe52a8e2904fa))
* **notify:** avisos de lealtad fase 1 y vigilancia de sus crons diarios ([c01ab30](https://github.com/HCDestroyer/argos-isp/commit/c01ab30f082605b6f89d1b9ca73a5e68f595d9ca))
* **notify:** avisos fiscales al equipo y a contabilidad ([cee5b66](https://github.com/HCDestroyer/argos-isp/commit/cee5b666b446b7a7531560ab55dabe8611e5806c))
* **notify:** configurar y probar canales desde el panel; resolución por empresa e interruptores ([3d2e61d](https://github.com/HCDestroyer/argos-isp/commit/3d2e61da102ee94c0a93c83223099cb66015e34a))
* **notify:** marca, remitente y bot de Telegram por empresa ([ddbf479](https://github.com/HCDestroyer/argos-isp/commit/ddbf479410fff32f4cf5e90607ec636ce31a8d0f))
* **notify:** mensaje directo, empresa desde core.empresa y alertas de velocidad aparte ([6ed77e6](https://github.com/HCDestroyer/argos-isp/commit/6ed77e6fd330bbe174e91ac00e191c049bc0e4f6))
* **notify:** modelo de configuración de canales global y por empresa ([34d0954](https://github.com/HCDestroyer/argos-isp/commit/34d0954aacdf64114737db29ccfc6d9010beb8b6))
* **notify:** número y autorización de la factura desde fiscal.dte ([b3f3bc6](https://github.com/HCDestroyer/argos-isp/commit/b3f3bc6b575edef3ee9ad05c7547855295481341))
* **notify:** sembrar la configuración desde el entorno y recargarla por evento en el worker ([fcd6740](https://github.com/HCDestroyer/argos-isp/commit/fcd67409cbf3ebcbd7bfdc1901f2b9f05397be70))
* **notify:** tipo de aviso lealtad con interruptor por empresa ([a404370](https://github.com/HCDestroyer/argos-isp/commit/a40437076e508d8a50cd26c0863048272f080221))
* **operacion:** exportar secrets PPPoE de emergencia de un router a .rsc (tarea 3) ([6efb48b](https://github.com/HCDestroyer/argos-isp/commit/6efb48b519aa77047374572f7606cf8db53e4b11))
* **portal:** /cuenta por empresa, Telegram por bot y errores multiempresa en pantalla ([c7c5acb](https://github.com/HCDestroyer/argos-isp/commit/c7c5acb3c08598bfe0a7ccc8bd919c60549b2d9a))
* **portal:** actor cliente en las acciones del portal autenticado ([f7b2c50](https://github.com/HCDestroyer/argos-isp/commit/f7b2c5068b6a66eb449ae0493138dda1fff6c6a1))
* **portal:** anular los códigos de Telegram al desvincular desde el portal ([6f8ddea](https://github.com/HCDestroyer/argos-isp/commit/6f8ddea3051f927054612bad11204286811b9f5e))
* **portal:** código de acceso por EnviarMensajeDirecto de notify ([fbcf74c](https://github.com/HCDestroyer/argos-isp/commit/fbcf74c2276e7eec195254cea5014de6e8e94be4))
* **portal:** estados con icono, texto y color ([7331065](https://github.com/HCDestroyer/argos-isp/commit/7331065e0bcfbd587bdecf35630b83f7a12d5146))
* **portal:** facturas con su DTE, XML certificado y notas de crédito (FEL) ([e703d61](https://github.com/HCDestroyer/argos-isp/commit/e703d6155aeee59a4a53d9dfd24ef02d274c8997))
* **portal:** facturas FEL, XML, sustituidas y notas de crédito en /cuenta ([2f8baea](https://github.com/HCDestroyer/argos-isp/commit/2f8baea633772f9a48aa3623d518cf97abdd600e))
* **portal:** favicon y logo de ArgosIsp en la página de error ([0da26bc](https://github.com/HCDestroyer/argos-isp/commit/0da26bc0472971c415afb3b5df776a735485a22c))
* **portal:** identidad "vidrio y luz" con aura, materiales y marca ([92b6f03](https://github.com/HCDestroyer/argos-isp/commit/92b6f03bee44d0f101940b6a4a81edb76bab1a97))
* **portal:** inicio del cliente móvil con accesos rápidos y barra inferior ([30c007c](https://github.com/HCDestroyer/argos-isp/commit/30c007c02826161ea64303c4a08515e466bb460e))
* **portal:** manifiesto PWA para agregar el portal a la pantalla de inicio ([13c505f](https://github.com/HCDestroyer/argos-isp/commit/13c505fa1c306dedc00c8bcfba50454c4db51a70))
* **portal:** marca de la empresa de cada servicio en el portal ([bfbf916](https://github.com/HCDestroyer/argos-isp/commit/bfbf916b706aeeef6060790ea72f255a45f5c052))
* **portal:** marca de la empresa de cada servicio en la API del portal ([8f8e8ad](https://github.com/HCDestroyer/argos-isp/commit/8f8e8ad0ad7250e5fe9b7bbe03765865b6c5a4c5))
* **portal:** multiempresa en el api del portal (cuentas, comprobante, pago en línea, cuenta y Telegram por empresa) ([bd11d65](https://github.com/HCDestroyer/argos-isp/commit/bd11d651fbcef69502ef214c2186812bb3b5c9c1))
* **portal:** nodo portal remoto con token y la IP real del cliente ([dc0ec9d](https://github.com/HCDestroyer/argos-isp/commit/dc0ec9d15267f217d39b14cbb4a51ec28850bf33))
* **portal:** PDF de la nota de crédito (NCRE) y plantillas de fábrica ([7078281](https://github.com/HCDestroyer/argos-isp/commit/707828158ae536a598e71987d1f1b382de818c3e))
* **portal:** pedido a A3 del PDF de la NCRE y sustitución resuelta ([6bd1002](https://github.com/HCDestroyer/argos-isp/commit/6bd100260caa36c32e3e832fe55c2a6c4ffee744))
* **portal:** retorno de la pasarela a /corte con el estado del proveedor ([6b22a6e](https://github.com/HCDestroyer/argos-isp/commit/6b22a6e66b3c9944c020ecfd74cdf670b4116337))
* **portal:** seguridad portal, PDF y multipart declarados en el OpenAPI ([15a586a](https://github.com/HCDestroyer/argos-isp/commit/15a586aa260bf0b359ed5263c9d4da6b80a6e88a))
* **shared:** gancho antes de validar en el despachador de rutas ([373c2b2](https://github.com/HCDestroyer/argos-isp/commit/373c2b271d122ad631e9817e59c8c2a0e1ed1623))
* **shared:** huella de Idempotency-Key con el hash de los archivos multipart ([74affed](https://github.com/HCDestroyer/argos-isp/commit/74affed2ba0d2bca34b0d53c7aa682e8354a6e4d))
* **shared:** Idempotency-Key acotada por sesión o IP en rutas públicas ([a1fc5d3](https://github.com/HCDestroyer/argos-isp/commit/a1fc5d3a6fb3f6aa9cd211a5571da13bf346beec))
* **shared:** redirecciones 303 declaradas en el despachador de rutas ([1bc9f74](https://github.com/HCDestroyer/argos-isp/commit/1bc9f746766d6f4da60bb7e91ac0512db47399ee))
* **web:** ACL por pantalla y checklist de seguridad (semana 3, tarea 3) ([b334551](https://github.com/HCDestroyer/argos-isp/commit/b33455148865022eedff2f616a6be0f9d3910afb))
* **web:** adoptar vista previa de planes, conexión del router, bancos del libro y filtros de comprobantes (semana 3b, tarea 1) ([8252d62](https://github.com/HCDestroyer/argos-isp/commit/8252d6286be9a4b9f43a0f63ae197bf2f9d292b2))
* **web:** alta de caja por empresa ([de98f3a](https://github.com/HCDestroyer/argos-isp/commit/de98f3a06d73cbffed2d12aa1d21fd1afeb8d1d9))
* **web:** balance de saldos y estado de resultados por empresa ([d14b482](https://github.com/HCDestroyer/argos-isp/commit/d14b482d1a2822327a8240a9f8ef2eab4f8bc05c))
* **web:** cobro repartido por empresa con recibo y caja no abierta ([7c8b2cb](https://github.com/HCDestroyer/argos-isp/commit/7c8b2cb62b4597fe8756d150ed52235582a61630))
* **web:** cobros por liquidar sin desbordar a 390 px ([90c62b5](https://github.com/HCDestroyer/argos-isp/commit/90c62b5957567c6597e4e191eb842ae116d3f3a9))
* **web:** cobros por liquidar, depósitos, conciliación bancaria y cartera (fase 4) ([b5414cf](https://github.com/HCDestroyer/argos-isp/commit/b5414cfa76592cfeba0cddf7a4c7528ebce84cc9))
* **web:** Configuración → Fiscal (país, régimen, establecimientos, frases, parámetros e impuestos) ([4a4b185](https://github.com/HCDestroyer/argos-isp/commit/4a4b185069dc18c63454b3a15b4603cecdb1fd28))
* **web:** configuración de notificaciones global y por empresa ([745d77e](https://github.com/HCDestroyer/argos-isp/commit/745d77ece19776a90d999ea4bf0d6c3cc5c9eaf7))
* **web:** consolidado con "Todas" en todas las listas y reportes por empresa ([c287f8f](https://github.com/HCDestroyer/argos-isp/commit/c287f8f00af41e944ef47d543a4e826d6ea33e71))
* **web:** datos fiscales del cliente (tipo de documento, NIT con verificador, CUI) ([523f506](https://github.com/HCDestroyer/argos-isp/commit/523f5069cfc17a57bebc3435a3ac096993ca2656))
* **web:** diarios, catálogo FEL, intentos de DTE y plantilla de la nota ([47b413e](https://github.com/HCDestroyer/argos-isp/commit/47b413e5f197b25dfe5d39bef59902385f8030d7))
* **web:** empresa en la bitácora ([1e7db6d](https://github.com/HCDestroyer/argos-isp/commit/1e7db6db594226cdf7bc2088da00798f25247b02))
* **web:** enlace del cliente subrayado en la ficha del pago (axe link-in-text-block) ([1cd7b13](https://github.com/HCDestroyer/argos-isp/commit/1cd7b137249324ad74280f4b7fc741ce2eb75a91))
* **web:** estado de Horus antes del clic, pausa con reintentar_en y tipos de la consulta 360 ([e7aa07e](https://github.com/HCDestroyer/argos-isp/commit/e7aa07e723514cdc4bdeadcafd2b06818580a83e))
* **web:** estados con icono, texto y color según la identidad ([0cbf179](https://github.com/HCDestroyer/argos-isp/commit/0cbf179f264002c24a46232401e0b8574d3ef7cd))
* **web:** fase 4 final de A3: acreditada, cargo interno, depósitos del turno y proveedor del pago ([c2b1e24](https://github.com/HCDestroyer/argos-isp/commit/c2b1e241bf83b451d8532cb989b791ac62a37ca7))
* **web:** fase 4 tras la revisión: reatribuir llegada, corte editable, solo contracargos, castigada ([2cc4a61](https://github.com/HCDestroyer/argos-isp/commit/2cc4a619e2f4af98012f72c7ec3522af79dc0928))
* **web:** FEL en el panel e integridad del libro ([00e3708](https://github.com/HCDestroyer/argos-isp/commit/00e370869787c141e2f18de60362109f23fa0837))
* **web:** fixtures con empresa_id y estado de cuenta por empresa ([6e6a06c](https://github.com/HCDestroyer/argos-isp/commit/6e6a06ce36f26e68f58cae4dc3ab86bf7d66795d))
* **web:** gráficas con la paleta de la identidad y frase de hallazgo ([bf716ad](https://github.com/HCDestroyer/argos-isp/commit/bf716adea244699c9c0ef5c73a3115676061c08a))
* **web:** lealtad fase 1: programa, reglas, puntos del cliente, ajustes, referidos y reporte ([d557268](https://github.com/HCDestroyer/argos-isp/commit/d5572682ac87cabaa4d88db8ab619b79ffc46f43))
* **web:** lealtad: porcentaje legible y pedidos en a4.md ([ed6e59b](https://github.com/HCDestroyer/argos-isp/commit/ed6e59bdd5175f88e55c4378008b98ef4440f3e9))
* **web:** lista y detalle de notas de crédito (semana 3, tanda 3, tarea 3) ([92c0f14](https://github.com/HCDestroyer/argos-isp/commit/92c0f144b1b9abdbfea248cd33de0bbffc316714))
* **web:** luz solo en señales, números que ruedan y una acción primaria con halo ([4d18462](https://github.com/HCDestroyer/argos-isp/commit/4d18462e03ce30f398783ebab6c3b44c86c81209))
* **web:** menú lateral resumido en grupos, barra compacta y buscador Ctrl+K ([c174d1a](https://github.com/HCDestroyer/argos-isp/commit/c174d1a69e50d31c694399daa4aff1ea27fb368b))
* **web:** migración con la API de A2, reverso de asiento y nota de crédito (semana 3b, tarea 6) ([6945505](https://github.com/HCDestroyer/argos-isp/commit/694550572e17117053a38354b84a4643a570ed6b))
* **web:** multiempresa en el panel (selector, empresas, usuarios, servicio, cliente y cobro) ([b6228aa](https://github.com/HCDestroyer/argos-isp/commit/b6228aaabd1109bc37d00927c6295c1c3d156e87))
* **web:** origen importado visible en ficha, estado de cuenta y pagos (semana 3b, tarea 4) ([88c36de](https://github.com/HCDestroyer/argos-isp/commit/88c36decbe889621ab05099326a44812d8bda5a5))
* **web:** pantalla de migracion de router para el piloto (semana 3, tarea 4) ([7754d8a](https://github.com/HCDestroyer/argos-isp/commit/7754d8a5b347c7e565193e96919b600ca252a594))
* **web:** pantallas de la integración con Horus (contrato 1.2.0) ([67637f3](https://github.com/HCDestroyer/argos-isp/commit/67637f383819a057203c8df3dad15780d65c16fc))
* **web:** pantallas de servicios adicionales y etiqueta de tipo de plan ([71bad0a](https://github.com/HCDestroyer/argos-isp/commit/71bad0aab78bd274c327f2590d58e3f0ce1d67a5))
* **web:** pedidos de la fase 4 en a4.md y axe en las pantallas de bancos ([685cff1](https://github.com/HCDestroyer/argos-isp/commit/685cff103cd9cbcd1c1fc1b0d653ec35e0cd5018))
* **web:** promesas con Schema&lt;'EvaluacionPromesa'&gt; (semana 3b, tarea 2) ([cc91e6d](https://github.com/HCDestroyer/argos-isp/commit/cc91e6dca5bcde7ad53332f940974ff34877efc4))
* **web:** reportes con origen, columnas agregadas y notas de crédito (semana 3, tanda 3, tarea 2) ([6202e91](https://github.com/HCDestroyer/argos-isp/commit/6202e9114f518f95be3546202ea5825e4b4e8ff3))
* **web:** servicios adicionales y tipo de plan ([0559a86](https://github.com/HCDestroyer/argos-isp/commit/0559a86afedc59dcdd852cef24fa5e2ecc1ed989))
* **web:** sesión del panel en cookie HttpOnly con CSRF (semana 3b, tarea 5) ([95e140b](https://github.com/HCDestroyer/argos-isp/commit/95e140bd31774faaf0f2c0249020f6bb1949bbef))
* **web:** sesión deslizante con ventana de bloqueo (semana 3, tanda 3, tarea 1) ([d0f101b](https://github.com/HCDestroyer/argos-isp/commit/d0f101bcc7f7a40ba39c35dee9585398ca1dbbd1))
* **web:** tema "vidrio y luz" con aura, materiales y marca de ArgosIsp ([6aa498d](https://github.com/HCDestroyer/argos-isp/commit/6aa498d55592d96b587e2690bffe6d458ecf5639))
* **web:** versión instalada en el panel ([3c8d781](https://github.com/HCDestroyer/argos-isp/commit/3c8d78196c9411cab4e8b8de4a52528e60e17dc7))
* **web:** versión instalada y "Qué cambió" en el menú de usuario ([61dfe9d](https://github.com/HCDestroyer/argos-isp/commit/61dfe9d49449a7f937994398844c894a4d44efb6))
* **web:** vista previa del cambio de modo del router (semana 3, tarea 1) ([f3ca176](https://github.com/HCDestroyer/argos-isp/commit/f3ca17635fb22ec56a7f7286f91f105580293578))


### Correcciones

* **billing:** acreditada solo para el aviso sin DTE vivo (con DTE, la NCRE no le quita la venta) ([8262ccb](https://github.com/HCDestroyer/argos-isp/commit/8262ccba9772792039a9063b2a171d6d4716c62b))
* **billing:** castigada no se anula ni se sustituye; neto FEL sin notas anuladas; histórico recupera castigos ([842c2b1](https://github.com/HCDestroyer/argos-isp/commit/842c2b1e6788b66a8801ca3d17d13323cb136e1e))
* **billing:** H1 la nota de crédito reparte sobre el restante y la última toma el resto exacto ([eec973f](https://github.com/HCDestroyer/argos-isp/commit/eec973f941f4eb976db4369b778cc480aefdceb7))
* **billing:** H2 anular un pago de terceros reaplica anticipos de cada dueño ([e400e73](https://github.com/HCDestroyer/argos-isp/commit/e400e738235d06554cf4911bc01173747dfa39e2))
* **billing:** usuarioDelActor en columnas de usuario (pedido de A1) ([efbbb79](https://github.com/HCDestroyer/argos-isp/commit/efbbb79551de400c2bd483c58a01c3aa4ca527e6))
* **core:** cookie del panel hasta el tope y Retry-After expuesto por CORS ([b51a102](https://github.com/HCDestroyer/argos-isp/commit/b51a10294c7c8777b1c65d588dbd2c3f44948ecf))
* **core:** Idempotency-Key anónima por cliente detrás de un nodo portal y correcciones de validadores ([ec7d128](https://github.com/HCDestroyer/argos-isp/commit/ec7d12806a4b98c62551a0e481b7e10c573ad0bc))
* **core:** reclasificar el documento fiscal al editar el NIT/CUI del cliente ([8016e1a](https://github.com/HCDestroyer/argos-isp/commit/8016e1a322e8cbae97379090fff10cb6f50939f2))
* **core:** usuarioDelActor en las columnas de usuario del núcleo ([cfd72a4](https://github.com/HCDestroyer/argos-isp/commit/cfd72a453ff0791c9ebd22b08a4496e2b335b562))
* **fiscal:** al rechazarse la anulación del DTE se aplican los anticipos del cliente (H6) ([eb38e32](https://github.com/HCDestroyer/argos-isp/commit/eb38e322a9a34595560adfeabb56cf7bfd1b8c0a))
* **fiscal:** anulación recuperable, NDEB anula la mora, avisos al desactivar y mora aviso (H6–H9) ([a5c6bae](https://github.com/HCDestroyer/argos-isp/commit/a5c6bae684b8c587e36ff5954a9310d452086ed4))
* **fiscal:** DTE del aviso por el neto de sus notas internas (H5) ([24f6c4d](https://github.com/HCDestroyer/argos-isp/commit/24f6c4d3379df2c9395f46881f05bbfd052f6cf8))
* **fiscal:** todo DTE de factura o mora por el neto de sus notas internas (H11); cierre de H5 y notas anuladas con la acción real ([ae9e4bd](https://github.com/HCDestroyer/argos-isp/commit/ae9e4bd62047a3ecaba8c882c7c5204d84c3fa59))
* **importacion:** montos ilegibles o ambiguos se reportan, nunca entran como 0 ([1bd0d70](https://github.com/HCDestroyer/argos-isp/commit/1bd0d70be3570713ac4ee2748ceeef890a31efcb))
* **infra:** argosisp ignora contenedores detenidos de la corrida anterior al esperar salud ([b4d4bd6](https://github.com/HCDestroyer/argos-isp/commit/b4d4bd6e6a6896551b19b994661d8124af4e35d1))
* **infra:** argosisp no toma por falla la salud vieja de un contenedor detenido ([b90c161](https://github.com/HCDestroyer/argos-isp/commit/b90c161ef2d2e04cd791795cb9daff5fb0d6dcd4))
* **infra:** instalar.sh no pisa VERSION al leer /etc/os-release ([69e7de9](https://github.com/HCDestroyer/argos-isp/commit/69e7de93882e2e396131c152678602ecd2558d29))
* **infra:** la prueba del proxy del portal espera al eco y a Caddy listos ([dd0e59d](https://github.com/HCDestroyer/argos-isp/commit/dd0e59d90e8035416c4147f18a2951ef19f6fd34))
* **infra:** prometheus espera a alertmanager en la prueba de alertas ([f38679d](https://github.com/HCDestroyer/argos-isp/commit/f38679dd3cba488f35610b9c3ea20affe1151d42))
* **infra:** Prometheus reenvía alertas a los 15 s, no al minuto ([278a40a](https://github.com/HCDestroyer/argos-isp/commit/278a40aa873781ac8f7dc9974f272e249e6de8ce))
* **infra:** prueba del proxy del webhook sin carrera de la limpieza de Caddy ([454f3ef](https://github.com/HCDestroyer/argos-isp/commit/454f3ef71673ec9e9e1c774a9c271ffcd838ba88))
* **integraciones:** contrato Horus 1.7.0 — canje idempotente, enlace anulado, servicio.config_cambiada y reglas del autologin ([6a2f18b](https://github.com/HCDestroyer/argos-isp/commit/6a2f18be41cd95829de8aee1d44b5d938b727f93))
* **integraciones:** Horus validada de extremo a extremo — contrato 1.7.0 ([9aa5587](https://github.com/HCDestroyer/argos-isp/commit/9aa5587affd687215d298c5cafe109a495646c9e))
* **integraciones:** webhooks a Horus con el reloj de la base; reintentar_en en Problem; meta.omitted como lista ([2d2a61d](https://github.com/HCDestroyer/argos-isp/commit/2d2a61d1697c6c6d41e466c86654b3cec07f8b4e))
* **lealtad:** lote bloqueado en el trigger de consumos (H15), vencimiento por empresa y pruebas con afirmarLibro ([6f5f8b2](https://github.com/HCDestroyer/argos-isp/commit/6f5f8b235bf1d593217514e301f6accc1e341315))
* **ledger:** H10 la cadena de hash detecta un asiento insertado en un mes cerrado; rango por sello en /libro/integridad ([1ac93f5](https://github.com/HCDestroyer/argos-isp/commit/1ac93f5d0732bcb028610555093a15a5c6eb3698))
* **ledger:** H3 turno de caja cerrado inmutable; aplicaciones solo inserción; TRUNCATE rechazado ([f5d28bb](https://github.com/HCDestroyer/argos-isp/commit/f5d28bbe511258239830c801efa73989486d7d4e))
* **ledger:** hallazgos H12–H14 y decisiones del líder sobre la fase 4 (desvíos a, c y f) ([49519ff](https://github.com/HCDestroyer/argos-isp/commit/49519ff8c0a0c39314d15379488198d930f791fe))
* **ledger:** llegada reatribuida en verde con el auditor; la bajada de la migración no recrea el UNIQUE ([55db972](https://github.com/HCDestroyer/argos-isp/commit/55db972f8b4eea2804ab56f801d2e2557d3e07e8))
* **ledger:** nombre de conteo del sellador sin falso positivo de dinero ([f9760ec](https://github.com/HCDestroyer/argos-isp/commit/f9760ec89928947d1a9b39c890b471dab5c1f467))
* **ledger:** porcentaje de la estimación como texto (ledger solo guarda dinero en numeric(14,2)) ([e84ff17](https://github.com/HCDestroyer/argos-isp/commit/e84ff170cdd76f6b8585bc38dad5e63adfcccec3))
* **portal:** empresa de la factura con coalesce(f.empresa_id, s.empresa_id, 1) ([205c4f3](https://github.com/HCDestroyer/argos-isp/commit/205c4f3e49122788521fe2ba2be5bee3452be2b1))
* **portal:** leer los flujos del PDF por /Length en las pruebas ([8e96e0e](https://github.com/HCDestroyer/argos-isp/commit/8e96e0e120c93b277d0bc29da6ad527b3276f89b))
* **portal:** revisión de seguridad del portal (tarea 3) ([149427a](https://github.com/HCDestroyer/argos-isp/commit/149427a3fb1ff63e16f61187f08f250df904a6fe))
* **portal:** robustez para el piloto: API caída, IP sin identificar y varios servicios (tarea 2) ([b22339a](https://github.com/HCDestroyer/argos-isp/commit/b22339a454053af1b79fc88c9e7becc4953c9cad))
* **shared:** .meta() de VineJS ya no vuelve nullable un campo obligatorio ([958f7ea](https://github.com/HCDestroyer/argos-isp/commit/958f7ead9c462fdf3c6b0496c6cde7553482d934))
* **shared:** Idempotency-Key anónima detrás de un nodo portal usa la IP del cliente ([fd31d2d](https://github.com/HCDestroyer/argos-isp/commit/fd31d2d71cc30cbf1e1e8894d509b37b617bf63f))
* **web:** capturas 06 y 07 verificadas; historial del servicio sin lecturas del portal (semana 3, tarea 2) ([a24ea85](https://github.com/HCDestroyer/argos-isp/commit/a24ea854978a7d5221a573f87d547303e4ea13c2))
* **web:** el esperado provisional de /caja resta los egresos en efectivo del turno (semana 3b, tarea 3) ([eca810e](https://github.com/HCDestroyer/argos-isp/commit/eca810e613302a046c713001a935ce1cb07b3250))
* **web:** el login no se vuelve a montar a media carga al salir ([871d8a8](https://github.com/HCDestroyer/argos-isp/commit/871d8a8a3dabdae2ab9407d22ddebc49b2f54eeb))
* **web:** quitar clave repetida promesas.importar en la bitácora ([37578d1](https://github.com/HCDestroyer/argos-isp/commit/37578d19fbb337e603d6f6dc9d4ca1510530990f))
* **web:** texto de bitácora para cajas.crear ([5005d86](https://github.com/HCDestroyer/argos-isp/commit/5005d865fc0001d5a3f9fdf7f3fe2d6424b8e42b))
* **web:** texto de bitácora para empresas.cambiar_pais ([918de1e](https://github.com/HCDestroyer/argos-isp/commit/918de1e473e7e34c27bda808547dad255cccd86f))
* **web:** texto de bitácora para notificaciones.telegram_desvincular ([2097d83](https://github.com/HCDestroyer/argos-isp/commit/2097d83d09932e7b0d8f797622a1bbdd52c49ad0))
* **web:** texto de bitácora para promesas.importar ([33db257](https://github.com/HCDestroyer/argos-isp/commit/33db257bd71f480d40584fdec115c70065851fb5))
* **web:** textos de bitácora de la integración Horus; cliente.actualizado en el catálogo ([550843a](https://github.com/HCDestroyer/argos-isp/commit/550843af1ebf0c7cda71eff9815f090fb017e57a))
* **web:** textos de bitácora de las acciones horus.* (renombre de integraciones.*); quitar dump.rdb ([83f5663](https://github.com/HCDestroyer/argos-isp/commit/83f5663074eb7f7645679ac86efae55861a2f93f))
* **web:** textos de bitácora de nodos_portal.crear y revocar ([83e8050](https://github.com/HCDestroyer/argos-isp/commit/83e805099c515ccda5dd41b5fec322fd2ee27d9a))
* **web:** textos de bitácora fiscales y establecimientos consolidables ([312d270](https://github.com/HCDestroyer/argos-isp/commit/312d270e8becad2a0f33e6c3739a5c7dfca8940c))
* **web:** textos de bitácora y rutas consolidables de adicionales ([f0dba64](https://github.com/HCDestroyer/argos-isp/commit/f0dba64cd9f915cac3b8f802cdce6cbed7a7e8d0))
* **web:** textos de las acciones nuevas de notify y prueba que solo lee nombres de acción ([e0de8a4](https://github.com/HCDestroyer/argos-isp/commit/e0de8a41f94ed4a2b391e444f75bbca0bbb209fa))
* **web:** textos de pagos.registrar_historico y facturas.anular_saldo_inicial ([b749b7e](https://github.com/HCDestroyer/argos-isp/commit/b749b7e342d232f06260a0c4e49be5e53240c0a6))

## Cambios

Todas las versiones publicadas de ArgosIsp. Este archivo lo genera release-please a partir de los
commits (Conventional Commits) al publicar cada versión; no se edita a mano.
