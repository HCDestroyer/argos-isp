---
orden: 5
pantallas:
    - /sistema/salud
---

# Salud del sistema

Muestra, en el momento, si el servidor y sus piezas están funcionando: la base de datos, Redis, las colas de trabajo, RADIUS, los routers, los procesos automáticos (facturación, vencimiento y corte), los respaldos y los recursos del servidor (procesador, memoria y disco). Aparece como tarjeta en el **Inicio** y en su pantalla completa.

## Quién la usa

- `sistema.ver_salud`: solo el rol `admin`.

## Cómo leerla

Arriba está el **estado general**:

| Estado         | Qué significa                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------ |
| **Bien**       | Todo responde                                                                                    |
| **Con fallas** | Algo no está del todo bien (una cola con errores, un router sin respuesta, el disco casi lleno…) |
| **Caído**      | No responde la API, la base de datos o Redis: el sistema no puede trabajar                       |

Debajo, una fila por pieza con su estado (**Bien**, **Con fallas**, **Caído** o **Sin datos**) y una frase que explica qué pasa. «Sin datos» quiere decir que esa pieza no se puede medir desde aquí (por ejemplo, los respaldos se guardan en otro servidor): no baja el estado general.

| Pieza                            | Cuándo avisa                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Base de datos                    | Tarda más de medio segundo o tiene el 80 % de sus conexiones ocupadas                   |
| Redis                            | No responde (las colas y RADIUS dependen de él)                                         |
| Colas                            | Hubo trabajos fallidos en la última hora o hay muchos esperando                         |
| Publicación de eventos           | Hay eventos sin publicar desde hace más de un minuto (avisos y reconexiones se atrasan) |
| RADIUS                           | Algún nodo de RADIUS dejó de responder                                                  |
| CoA y Disconnect                 | Falló un corte o una reconexión en los últimos 15 minutos                               |
| Routers                          | Algún router dejó de reportarse                                                         |
| Facturación, vencimiento y corte | El proceso no ha corrido en más de 26 horas                                             |
| Respaldos                        | El último respaldo tiene más de 26 horas (más de 72: caído)                             |
| Procesador y memoria             | El servidor está muy cargado o casi sin memoria                                         |
| Disco de datos                   | Usado al 80 % o más (con fallas) o al 95 % o más (caído). Revisa **Almacenamiento**     |

La pantalla se calcula cada vez que la abres o pulsas **Actualizar**; tarda como mucho dos segundos aunque algo no responda.

Contrato técnico: `.claude/integration/contratos/salud.md`.
