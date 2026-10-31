# inventario (A3)

Inventario interno del ISP: productos, bodegas (lugares y técnicos), kardex a costo promedio y su
asiento en el libro. Contrato: `.claude/integration/contratos/inventario.md`. Fases **A** (modelo,
cuentas, productos, bodegas, saldo inicial, compras, consumo, traslado, ajuste, baja, existencias y
kardex) y **B** (unidades por serie o MAC, comodato con su activo fijo, equipos por recuperar y
devolución al proveedor con NCRE) y **C** (venta por cargo único con costo de ventas, conteos físicos,
reporte valorizado, salida por premio, `marcar_reparada` y fechas pasadas en consumos y ajustes) y **D**
(pedidos del PM 31 oct: orden de traslado que recibe quien recibe, con firma digital, en papel o aceptación;
tipos de producto editables; modalidad por producto con cobro al cliente; alta por lotes; factura de compra
desde XML FEL, PDF o imagen con IA; la bodega del técnico e Iris).

## Piezas

| Archivo | Qué hace |
| --- | --- |
| `productos.ts`, `bodegas.ts` | Lectura, alcance ACL de bodegas y tope por técnico |
| `kardex.ts` | Única puerta de `inventario.movimientos`: costo, lock por producto, asiento propio, eventos; existencias, kardex y las lecturas del auditor (`valorKardex`, `existenciasDelKardex`) |
| `compras.ts` | Ganchos de `compras.registrar` (entrada; NCRE = devolución al proveedor) y `compras.anular` (reverso) |
| `unidades.ts` | Unidades por serie o MAC: validación (`serie_duplicada`), alta, salida de bodega, lecturas e historial |
| `comodato.ts`, `consumidor.ts` | Lo común del comodato, equipos del servicio y por recuperar; consumidor de `servicio.estado_cambiado` |
| `ventas.ts` | Ganchos de los cargos únicos: costear y registrar la venta; reversos al anular la factura, con NCRE de toda la línea, al anular la nota o sustituir |
| `conteos.ts` | Lectura de conteos y la diferencia valorizada (vista previa) |
| `premios.ts` | Salida `premio` (5.1.03 / 1.1.14) y su reverso, para `sorteos.entregar` y `sorteos.anular_entrega` |
| `reportes.ts` | Inventario valorizado a una fecha y su cuadre con 1.1.14 |
| `ordenes_traslado.ts`, `traslado_pdf.ts`, `archivos.ts` | Fase D: órdenes de traslado (lecturas, bodega «en tránsito», configuración por empresa), su PDF imprimible (`pdfkit`) y el almacén de firmas, papeles firmados y facturas de compra (SHA-256; en auditoría solo la huella) |
| `tipos_producto.ts` | Fase D: catálogo de tipos (empresa o global) y la modalidad (`comodato`, `consumible_gasto`, `consumible_cobro`) |
| `consumos.ts` | Fase D: el consumo a un servicio según la modalidad de cada producto (gasto, cargo único al cliente o comodato), de una línea o en lote |
| `tecnicos.ts`, `mi_bodega.ts` | Fase D: el técnico de Argos por `id_externo` o correo (Iris), su bodega y `GET /inventario/mi-bodega` |
| `facturas_compra/` | Fase D: esquema común de la factura (`extraccion.ts`), parser FEL (`fel_xml.ts`), lector mínimo de texto de PDF, IA configurable por `fetch` (`ia.ts`) y borradores con su propuesta y duplicados (`borradores.ts`) |
| `actions/` | `productos.*`, `bodegas.*`, `inventario.cargar_saldo_inicial`, `consumir`, `trasladar`, `ajustar`, `dar_de_baja`, `asignar_comodato`, `devolver_comodato`, `declarar_perdida_comodato`, `abrir_conteo`, `contar`, `cerrar_conteo`, `cancelar_conteo`, `marcar_reparada` y la interna `revisar_comodatos` |
| `start/routes/inventario_traslados.ts`, `inventario_catalogo.ts`, `inventario_compras.ts` | Fase D: `/inventario/traslados` (`/enviar`, `/:id/recibir`, `/cancelar`, `/pdf`, `/firma`, `/documento`), `/inventario/configuracion`, `/inventario/mi-bodega`, `/inventario/tipos-producto`, `/compras/borradores[...]`, `/inventario/ia/configuracion` (se montan desde `inventario.ts`) |
| `start/routes/inventario.ts` | `/productos`, `/bodegas`, `/inventario/existencias`, `/inventario/movimientos`, `/inventario/unidades`, `/inventario/{consumos,traslados,ajustes,bajas,saldos-iniciales}`, `/servicios/:id/equipos[...]`, `/inventario/conteos[...]`, `/inventario/unidades/:id/marcar-reparada`, `/reportes/equipos-por-recuperar`, `/reportes/inventario-valorizado` |

## Reglas

- `POST /servicios/:id/equipos` acepta `{ unidad_id }` o `{ serie }` (contrato Iris §3; `unidadParaComodato` de
  `comodato.ts`): exactamente uno (422 `unidad_o_serie`); la serie se busca sin distinguir mayúsculas en la
  empresa del servicio (404 si no existe). Un servicio `pendiente_instalacion` sí recibe comodatos.

- `inventario.movimientos` es solo inserción (trigger y `REVOKE`). `inventario.saldos` es la
  proyección por producto × bodega que mantiene un trigger; `cantidad >= 0`, `valor >= 0` y sin valor
  sin existencia.
- Costo promedio ponderado móvil **por producto y bodega**; la salida que vacía la bodega lleva todo
  su valor. Un reverso usa el costo del movimiento que corrige.
- Asientos (origen `inventario`, `origen_id` = movimiento): consumo `cuenta_consumo` (5.2.07) /
  1.1.14; faltante (ajuste o conteo) y baja 5.6.02 / 1.1.14; sobrante 1.1.14 / 4.2.04; saldo inicial
  1.1.14 / 2.9.01; venta `cuenta_costo` (5.6.01) / 1.1.14 en el diario de ventas; premio 5.1.03 / 1.1.14.
  Cada reverso (venta, premio) lleva su propio asiento al mismo costo.
  Las entradas de una compra van en el asiento de la compra (la línea `bien` con `producto_id` a
  1.1.14; un asiento de compra con varias líneas mueve 1.1.14 por la suma de sus movimientos). El
  traslado no tiene asiento.
- Traslado, baja, venta y premio llevan fecha de hoy. Consumo y ajuste aceptan una fecha pasada en un
  periodo abierto, al costo del momento, si no dejan existencia negativa en ninguna fecha posterior;
  saldo inicial y compras pueden ir a una fecha pasada. Los bloqueos del libro aplican por el asiento.
- Serie: costo específico por unidad; un movimiento de una unidad mueve ±1 a su costo. Comodato:
  `1.2.01.NN / 1.1.14` y alta del activo (`ledger.activos.unidad_id`); devolución `1.1.14 (valor en
  libros) + 1.2.02 / 1.2.01` sin resultado; pérdida con `activos.dar_de_baja` (5.3.06).
- Con el inventario sin usar, compras, facturas y cargos únicos se comportan igual que antes.
- Origen Iris (`origen_externo.ts`, `contratos/inventario.md` «Origen Iris»): consumo, comodato,
  devolución y pérdida aceptan `origen_tipo = iris_orden` + `origen_id`; se guardan en el movimiento
  como `origen_externo_tipo`/`origen_externo_id` (aparte del origen interno) y salen en el kardex,
  el historial de la unidad y los eventos. La pérdida, sin kardex, solo en la auditoría.

- **Fase D** (`contratos/inventario.md` «Fase D»):
    - Orden de traslado: lo enviado viaja en la bodega `transito` de la empresa (pares `traslado` con
      `origen_tipo = orden_traslado`, sin asiento); la unidad conserva su estado y cambia de bodega, y
      ninguna otra operación la toca (`bodega_transito`, `unidad_en_transito`). Recibe el técnico o un
      usuario con alcance global en su nombre; lo faltante vuelve al origen al costo de la línea.
    - Consumo: `consumible_cobro` emite un cargo único inmediato (`facturas.emitir_cargo_unico`, venta
      `5.6.01 / 1.1.14` e ingreso con IVA); `comodato` llama a `asignar_comodato`. `POST /inventario/consumos/lote`.
    - Lote de productos: todo o nada; la entrada es saldo inicial (`1.1.14 / 2.9.01`).
    - Factura de compra: nunca se crea sin `compras.confirmar_borrador`; la clave de la IA va cifrada y
      no sale por la API; en pruebas, extractor falso o servidor local (nunca una API real).

## Eventos

- Emite: `inventario.movimiento_registrado` (cada movimiento), `inventario.existencia_minima` (la
  existencia total cruza el mínimo hacia abajo), `inventario.comodato_asignado`,
  `inventario.comodato_devuelto`, `inventario.equipo_por_recuperar`, `inventario.conteo_cerrado` (y
  `activo.dado_de_baja` al devolver o perder un comodato); fase D: `inventario.traslado_enviado`,
  `inventario.traslado_recibido`, `inventario.traslado_cancelado` e `inventario.ia_config_cambiada`.
- Consume: `servicio.estado_cambiado` (grupo `inventario`, `billing:worker`): retirado → equipos por
  recuperar; de vuelta a otro estado → en comodato.
