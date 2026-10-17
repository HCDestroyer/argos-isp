# scripts/importacion

Datos de prueba del importador (`apps/api/app/importacion`, runbook en `docs/runbooks/importacion.md`).

`ejemplo/`: CSV en el formato canónico (origen `csv`) con un caso de cada diferencia que reporta: IP duplicada, IP fuera de red, plan sin equivalente, cliente sin NIT, NIT inválido, `user_ppp` repetido, servicio suspendido y retirado, referencia rota y filas mal formadas. También servicios sin PPPoE (`ip_estatica`, `dhcp_fija` con y sin IP, con amarre IP-MAC, y dos filas inválidas: IP estática sin IP y DHCP fija sin MAC), `facturas.csv` (con servicio, sin servicio, abono parcial, pagada, de un cliente inexistente y con monto inválido) y `saldos.csv` (debe, a favor y de un cliente que no se importa), para que el reporte en seco muestre la suma de saldos contra el origen y sus diferencias.

`esquemas/`: estructura real (solo DDL, sin datos) de Mikrowisp 6 (`mikrowisp6.sql`) y de SmartISP (`smartisp.sql`), tal como la exportó el ISP, con sus triggers. Mapeo en `docs/importacion/`.

`mikrowisp-sintetico.sql`: datos inventados (solo `INSERT`) para el esquema real de Mikrowisp 6, con los casos difíciles: clientes duplicados por NIT, servicio sin plan, router sin credenciales, facturas abonadas, saldos a favor, pago de un cliente a la factura de otro, IPs repetidas, MAC en cuatro formatos, servicios sin PPPoE según la seguridad del router, estado del cliente (suspendido, retirado). La lista completa está en su cabecera. El volcado de prueba es la estructura seguida de los datos:

```sh
cat scripts/importacion/esquemas/mikrowisp6.sql scripts/importacion/mikrowisp-sintetico.sql > /tmp/mikrowisp.sql
```

`sintetico-csv/`: los mismos datos que `mikrowisp-sintetico.sql`, traducidos por el adaptador de Mikrowisp al formato canónico y escritos como CSV. El importador da el mismo reporte con los dos (`tests/importacion/origenes.spec.ts`). Si cambian los datos sintéticos, se regeneran:

```sh
pnpm --filter @argosisp/api exec node --import ts-node-maintained/register/esm ../../scripts/importacion/generar-csv-sintetico.mts
```

```sh
pnpm importar --origen=csv --fuente=scripts/importacion/ejemplo --sistema=mikrowisp --dry-run
pnpm importar --origen=mikrowisp --fuente=/tmp/mikrowisp.sql --dry-run --salida=/tmp/reporte
pnpm importar --origen=csv --fuente=scripts/importacion/sintetico-csv --dry-run
pnpm importar:plantillas /tmp/plantillas
```
