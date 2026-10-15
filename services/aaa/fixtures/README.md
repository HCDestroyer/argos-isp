# Fixtures de `aaa`

`servicios.json` reemplaza a `GET /internal/aaa/servicio` de A1 mientras ese endpoint no exista (`AAA_RESPALDO=fixtures`, contrato en `.claude/integration/contratos/aaa.md`). Cada entrada tiene la forma del contrato (`src/servicio.ts`) con una diferencia: la contraseña va en claro en `pass_ppp_claro` y `aaa` la cifra al cargar con `AAA_PPP_KEY`. Así Redis y el descifrado funcionan igual que con la API, y no hay claves en el repo. Son datos de prueba con direcciones de documentación.

| Usuario             | Contraseña         | Estado       | IPv4                                                  | IPv6                                    |
| ------------------- | ------------------ | ------------ | ----------------------------------------------------- | --------------------------------------- |
| `prueba-activo`     | `clave-activo`     | `activo`     | estática `10.10.1.10`                                 | `radius_servicio` /64 + /56             |
| `prueba-limitado`   | `clave-limitado`   | `limitado`   | pool `argos-v4-pppoe`                                 | `radius_pool` `argos-v6-enlace` / `-pd` |
| `prueba-suspendido` | `clave-suspendido` | `suspendido` | estática `10.10.1.11`                                 | `radius_servicio` /64 + /56             |
| `prueba-retirado`   | `clave-retirado`   | `retirado`   | —                                                     | —                                       |
| `prueba-burst`      | `clave-burst`      | `activo`     | pool; `rate_limit_override` con burst y `profile_ppp` | `ninguno`                               |

Cualquier otro usuario es inexistente.
