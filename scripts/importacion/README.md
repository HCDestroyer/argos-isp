# scripts/importacion

Datos de prueba del importador (`apps/api/app/importacion`, runbook en `docs/runbooks/importacion.md`).

`ejemplo/`: CSV en el formato canónico (origen `csv`) con un caso de cada diferencia que reporta: IP duplicada, IP fuera de red, plan sin equivalente, cliente sin NIT, NIT inválido, `user_ppp` repetido, servicio suspendido y retirado, referencia rota y filas mal formadas. También servicios sin PPPoE (`ip_estatica`, `dhcp_fija` con y sin IP, con amarre IP-MAC, y dos filas inválidas: IP estática sin IP y DHCP fija sin MAC), `facturas.csv` (con servicio, sin servicio, abono parcial, pagada, de un cliente inexistente y con monto inválido) y `saldos.csv` (debe, a favor y de un cliente que no se importa), para que el reporte en seco muestre la suma de saldos contra el origen y sus diferencias.

`mikrowisp-sintetico.sql`: volcado MySQL sintético con el esquema supuesto de Mikrowisp (ver `apps/api/app/importacion/origenes/mikrowisp.ts`) y los casos difíciles del dump real: clientes duplicados por NIT, servicio sin plan, router sin credenciales, facturas abonadas, saldos a favor, pago de un cliente a la factura de otro, IPs repetidas, MAC en cuatro formatos e IP estática sin PPPoE. Su suma de saldos es Q 1830.00 y el importador la cuadra.

`sintetico-csv/`: los mismos datos que `mikrowisp-sintetico.sql`, traducidos por el adaptador de Mikrowisp al formato canónico y escritos como CSV (`filasDesdeDump` + `escribirCsv`). El importador da el mismo reporte con los dos (`tests/importacion/origenes.spec.ts`). Si cambia el volcado sintético, se regeneran.

```sh
pnpm importar --origen=csv --fuente=scripts/importacion/ejemplo --sistema=mikrowisp --dry-run
pnpm importar --origen=mikrowisp --fuente=scripts/importacion/mikrowisp-sintetico.sql --dry-run --salida=/tmp/reporte
pnpm importar --origen=csv --fuente=scripts/importacion/sintetico-csv --dry-run
pnpm importar:plantillas /tmp/plantillas
```
