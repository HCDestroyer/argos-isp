---
orden: 1
---

# Importar desde archivos CSV

Si tu sistema anterior no es Mikrowisp ni SmartISP, o no tienes acceso a su base de datos, puedes pasar los datos a ArgosIsp en hojas de cálculo: una hoja por tipo de dato, guardada como CSV. Sirve para cualquier sistema que exporte a Excel.

El paso a paso completo (corridas en seco, leer el reporte, corregir, importación real) está en el [runbook de importación](../runbooks/importacion.md). Esta página explica los archivos.

## 1. Pedir las plantillas

Quien administra el servidor genera las plantillas vacías:

```sh
pnpm importar:plantillas /ruta/plantillas
```

(En un servidor instalado, con la imagen de la API: ver [Comandos del servidor](../runbooks/comandos.md#comandos-de-la-api-dentro-del-contenedor).)

Quedan nueve archivos, cada uno con su encabezado y una fila de ejemplo, y un `LEEME.md` que explica cada columna:

| Archivo         | Qué lleva                                                                                                    | ¿Obligatorio? |
| --------------- | ------------------------------------------------------------------------------------------------------------ | ------------- |
| `routers.csv`   | Los routers: nombre, dirección de su API, IP con que habla RADIUS, usuario y clave de la API, secreto RADIUS | Sí            |
| `redes.csv`     | Las redes IPv4 de cada router                                                                                | No            |
| `planes.csv`    | Planes: nombre, precio mensual con IVA, velocidades                                                          | Sí            |
| `clientes.csv`  | Clientes: nombre, tipo, NIT, datos de factura, correo, teléfonos, dirección, zona                            | Sí            |
| `servicios.csv` | Servicios: cliente, router, plan, tipo de conexión, usuario y clave PPPoE, IP, MAC, estado                   | Sí            |
| `facturas.csv`  | Facturas: cliente, servicio, periodo, total, lo ya pagado, vencimiento                                       | No            |
| `saldos.csv`    | El saldo de cada cliente al exportar (positivo debe, negativo a favor)                                       | No            |
| `pagos.csv`     | Pagos: cliente, factura que pagó, monto, fecha, forma de pago                                                | No            |
| `promesas.csv`  | Promesas de pago vigentes                                                                                    | No            |

Sin `saldos.csv`, el saldo de cada cliente es lo pendiente de sus facturas.

## 2. Llenarlas

1. Abre cada plantilla en Excel, **borra la fila de ejemplo** y pega los datos del sistema anterior en las columnas que correspondan. Las columnas que no tengas se quedan vacías o se borran; las obligatorias no.
2. Los `id`, `cliente_id`, `router_id`, `plan_id` y `factura_id` son **los ids del sistema anterior, tal cual**. Con ellos se enlazan los archivos entre sí (el servicio `S1` del cliente `C1`, en el router `R1`, con el plan `P1`).
3. Guarda cada hoja como **CSV UTF-8**, con el mismo nombre de archivo, todas en una misma carpeta. Coma o punto y coma como separador da igual.
4. Montos con punto decimal (`150.00`, `Q 1,250.50`). Un monto como `1,50` es ambiguo y esa fila no entra: corrígelo o pide la importación con coma decimal.

Algunos valores que el importador entiende:

- **Velocidades:** en kbps (`10000`) o con unidad (`512k`, `10M`, `1G`).
- **Tipo de conexión** del servicio: `pppoe` (por defecto), `ip_estatica` o `dhcp_fija`. En PPPoE el usuario es obligatorio; en IP estática, la IP; en DHCP fija, la MAC.
- **Estado** del servicio: `activo` (por defecto), `suspendido` o `retirado` (los retirados no se importan).
- **Fechas:** `2024-03-15`, `2024-03-15 10:00:00` o `15/03/2024`.
- **Periodo** de una factura: `2026-08`, `08/2026` o `2026-08-01`. Vacío, es un cargo único (instalación, equipo).
- **NIT:** el NIT, el CUI o `CF`.

Una columna con un nombre que el importador no conoce se ignora y sale como aviso en el reporte: casi siempre es un encabezado mal escrito.

## 3. Archivos de ejemplo

En el repositorio hay una carpeta de ejemplo llena, con datos inventados y un caso de cada problema que el reporte detecta (IP repetida, IP fuera de la red del router, plan sin equivalente, cliente sin NIT, NIT inválido, usuario PPPoE repetido, servicio suspendido y retirado, filas mal formadas, servicios sin PPPoE, facturas con abono parcial o de un cliente que no existe, saldos a favor): [`scripts/importacion/ejemplo/`](../../scripts/importacion/ejemplo/).

| Archivo de ejemplo                                                 |                                                 |
| ------------------------------------------------------------------ | ----------------------------------------------- |
| [`routers.csv`](../../scripts/importacion/ejemplo/routers.csv)     | Dos routers, uno sin credenciales               |
| [`redes.csv`](../../scripts/importacion/ejemplo/redes.csv)         | Una red por router                              |
| [`planes.csv`](../../scripts/importacion/ejemplo/planes.csv)       | Planes con precio en distintos formatos         |
| [`clientes.csv`](../../scripts/importacion/ejemplo/clientes.csv)   | Personas y empresas, con y sin NIT              |
| [`servicios.csv`](../../scripts/importacion/ejemplo/servicios.csv) | PPPoE, IP estática y DHCP fija                  |
| [`facturas.csv`](../../scripts/importacion/ejemplo/facturas.csv)   | Con y sin servicio, abonos parciales y pagadas  |
| [`saldos.csv`](../../scripts/importacion/ejemplo/saldos.csv)       | Debe, a favor y de un cliente que no se importa |

Para practicar con ellos (en desarrollo):

```sh
pnpm importar --origen=csv --fuente=scripts/importacion/ejemplo --sistema=mikrowisp --dry-run
```

`--dry-run` no cambia nada en la base: hace todo y lo deshace al final, pero el reporte dice exactamente lo que pasaría. Hay además un juego completo (con pagos y promesas) en [`scripts/importacion/sintetico-csv/`](../../scripts/importacion/sintetico-csv/).

## 4. Importar

```sh
pnpm importar --origen=csv --fuente=/ruta/plantillas --sistema=<nombre> --dry-run --salida=/ruta/reporte-1
```

- `--sistema` es un nombre corto para tu sistema anterior (minúsculas, dígitos y `_`: `wisphub`, `excel_2026`). **Usa siempre el mismo**: con él ArgosIsp reconoce lo que ya importó y no lo duplica.
- Haz **dos corridas en seco limpias** antes de la importación real.

Sigue con [Leer el reporte](../runbooks/importacion.md#_2-leer-el-reporte) en el runbook.

## Relacionado

- [Runbook de importación](../runbooks/importacion.md)
- [Mapeo desde Mikrowisp](./mapeo-mikrowisp.md) y [desde SmartISP](./mapeo-smartisp.md), si tu sistema es uno de esos y tienes su base
