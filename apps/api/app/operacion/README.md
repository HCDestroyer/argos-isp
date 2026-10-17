# operacion · herramientas de operación (A6)

Comandos para el turno de operación que no son de ningún módulo de dominio. Leen por las funciones públicas de los módulos y, si sacan datos sensibles, pasan por una acción de dominio para quedar auditados.

## Secrets PPPoE de emergencia

Para cuando `aaa` (RADIUS) no responde y no vuelve (runbook `docs/runbooks/aaa-caido.md`, paso 3):

```sh
pnpm emergencia:secrets-ppp <router_id> --salida=/ruta/argosisp-emergencia.rsc
# opciones: --perfil-base=default --perfil-suspendido=suspendido --sin-suspendidos --sobrescribir
```

- Acción `routers.exportar_secrets_emergencia` (`actions/exportar_secrets_emergencia.ts`, solo consola, sin endpoint ni permiso de panel). Se audita siempre (`audit.acciones`: quién, cuándo, qué router; nunca el `.rsc`). No cambia nada en la base.
- Lee los mismos registros que entrega `aaa` (`paginaRegistrosAaa` de `#core/aaa`, A1) y descifra `pass_ppp` con `AAA_PPP_KEY`. El texto lo arma `secrets_emergencia.ts`:
    - `activo` / `limitado` → perfil `argosisp-emergencia-plan-<id>[-limitado]`, copia del perfil del plan en el router (o `plan-<id>` con reuso > 1 en modo `simple`, o `--perfil-base`) con el `rate-limit` que mandaría `aaa`, y los pools del plan (`remote-address`, `remote-ipv6-prefix-pool`, `dhcpv6-pd-pool`) si los usa.
    - `suspendido` → `--perfil-suspendido` (el de corte de `lab.rsc`: rate-limit mínimo y `address-list=suspendidos`). `retirado` → no se exporta.
    - IPv4 fija → `remote-address`; /64 de enlace fijo → `remote-ipv6-prefix`. El /56 delegado fijo no tiene atributo en `/ppp secret`: con secrets el cliente recibe otro del pool del perfil mientras dure la emergencia.
    - Todo con `comment="argosisp-emergencia"`; el archivo empieza borrando lo de una importación anterior.
- **Contraseñas solo en el archivo**: se escribe con permisos 0600 y no pisa uno existente (salvo `--sobrescribir`); en pantalla y en el log solo va el resumen (cuántos, por estado, perfiles, omitidos con su motivo).
- Omite (y lo dice) los servicios cuya contraseña no descifra o que tienen caracteres de control.

**Pendiente de laboratorio**: importar el `.rsc` en RouterOS 7.24.5 y comprobar `copy-from` en `/ppp profile add`, `remote-ipv6-prefix` en el secret, que un secret local tiene prioridad sobre RADIUS con `use-radius=yes` y el retiro con `remove [find comment=…]`.

## Eventos

No emite ni consume.

## Archivos

| Archivo                                      | Qué es                                                 |
| -------------------------------------------- | ------------------------------------------------------ |
| `secrets_emergencia.ts`                      | Arma el `.rsc` y el resumen (sin contraseñas)          |
| `actions/exportar_secrets_emergencia.ts`     | Acción auditada: lee los registros de `aaa` y descifra |
| `commands/emergencia_secrets_ppp.ts`         | `node ace emergencia:secrets-ppp` (archivo 0600)       |
| `tests/operacion/secrets_emergencia.spec.ts` | Contenido del `.rsc`, auditoría y comando sin fugas    |
