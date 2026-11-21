---
orden: 4
pantallas:
    - /lealtad/sorteos
    - /lealtad/sorteos/[id]#ficha-del-sorteo
---

# Sorteos

Sorteos entre los clientes, hechos de forma que un notario o un delegado de la Gobernación pueda darlos por buenos: bases publicadas y selladas, lista de participantes con su huella, un resultado que nadie puede ajustar y que cualquiera puede recalcular, acta en PDF y entrega de premios con constancia.

Menú: **Clientes y lealtad → Sorteos**.

## Quién la usa

| Acción                                                                  | Permiso                    | Roles base                                    |
| ----------------------------------------------------------------------- | -------------------------- | --------------------------------------------- |
| Ver sorteos                                                             | `sorteos.ver`              | `admin`, `contabilidad`, `soporte`, `lectura` |
| Crear y editar en borrador, imagen de premios, anuncio en el portal     | `sorteos.gestionar`        | `admin`, `contabilidad`                       |
| Publicar bases, abrir, cerrar el corte, cancelar                        | `sorteos.publicar`         | `admin`, `contabilidad`                       |
| Marcar requisitos legales                                               | `sorteos.marcar_requisito` | `admin`, `contabilidad`                       |
| Exportar participantes                                                  | `sorteos.exportar`         | `admin`, `contabilidad`                       |
| Ejecutar el sorteo y cerrar el acta                                     | `sorteos.ejecutar`         | Solo `admin`                                  |
| Notificar ganadores, entregar, anular una entrega, dar por no reclamado | `sorteos.entregar`         | `admin`, `contabilidad`                       |

## Qué ves

La lista muestra cada sorteo con su nombre, la fecha del sorteo, sus premios y su estado (con el motivo si se canceló). Filtro por estado. «Nuevo sorteo» con `sorteos.gestionar`.

Un sorteo avanza siempre hacia adelante por estos pasos:

| Estado                | Qué significa                                                             |
| --------------------- | ------------------------------------------------------------------------- |
| Borrador              | Se está armando; todo se puede cambiar.                                   |
| Bases publicadas      | Las bases, los criterios y los premios quedaron congelados con su huella. |
| Participación abierta | Los clientes ganan boletos (y los canjean con puntos, si se admite).      |
| Corte cerrado         | Se tomó la foto de los participantes; ya no entra nadie.                  |
| Ejecutado             | Ya hay titulares y suplentes.                                             |
| Acta cerrada          | El acta en PDF quedó generada y sellada.                                  |
| Premios entregados    | Todos los premios se entregaron o se dieron por no reclamados.            |
| Cancelado             | Se canceló antes de ejecutarlo.                                           |

## Ficha del sorteo

Arriba: nombre, número, fecha, hora y lugar, la línea de pasos con la fecha de cada uno y los botones del paso que toca. Debajo, en secciones: premios, checklist legal, bases (con su huella y el compromiso de la semilla), participación y, ya ejecutado, el resultado y el acta.

Si al sorteo le falta algo del checklist para el siguiente paso, un aviso dice qué requisitos faltan.

### 1. Crear y editar el borrador

- **Permiso:** `sorteos.gestionar`. Botón «Nuevo sorteo» o «Editar» (solo en borrador).
- **Bases:** nombre, descripción, mecánica y forma del sorteo, regla de participación (el texto que ve el cliente), plazo para reclamar en días, qué pasa con los premios no reclamados, número de resolución de la Gobernación (si ya existe), **fuente del valor público** (de dónde saldrá en el acto un dato que nadie controla, por ejemplo un resultado de la Lotería Santa Lucía de ese día) y cómo se publicarán los resultados.
- **Fechas y lugar:** desde cuándo participan, el **corte** y la fecha y hora del sorteo (hora de Guatemala), y el lugar.
- **Participación:** boletos por servicio (por cada servicio activo sin facturas vencidas al corte), número de suplentes y si «Admite boletos canjeados con puntos».
- **Premios:** nombre, tipo («Efectivo», «Bien» o «Servicio»), valor de libre competencia, cantidad, si lleva ISR y su porcentaje. Un premio «Servicio» se elige del catálogo de lealtad (descuento o mes gratis). Los puedes ordenar con las flechas; el orden es el puesto.
- **Imagen de un premio:** desde la ficha, solo en borrador. PNG, JPEG o WebP, hasta 1 MB y de 64 a 4096 px por lado.

En borrador todo se puede dejar a medias. Al publicar, las bases deben estar completas.

### 2. Publicar bases

- **Permiso:** `sorteos.publicar`. Botón «Publicar bases».
- **Qué pasa:** congela las bases, los criterios y los premios con su huella (SHA-256), y genera en secreto la semilla del sorteo. Se publica solo su compromiso (la huella de la semilla). Desde aquí nadie puede cambiar las bases ni la semilla.
- **Si falta algo** verás «Bases incompletas» con el dato que falta: mecánica, regla de participación, periodo con fecha de fin, premios, fecha, hora y lugar (el sorteo no puede ser antes del corte), plazo de reclamo y qué pasa con los no reclamados, forma de publicar los resultados o fuente del valor público.

El botón «Bases públicas» abre la página pública de las bases, que cualquiera puede ver sin iniciar sesión.

### 3. Checklist legal

Cada requisito se marca con su evidencia. El sistema **no hace trámites ni paga impuestos**: solo registra lo que tú hiciste. Junto a cada requisito verás su fuente y el aviso de validarlo con tu contador o abogado.

| Requisito                      | Para qué paso                        |
| ------------------------------ | ------------------------------------ |
| Bases publicadas (DIACO)       | Abrir la participación               |
| Autorización de la Gobernación | Ejecutar (se marca, pero no bloquea) |
| Fianza                         | Ejecutar (se marca, pero no bloquea) |
| ISR de los premios             | Ejecutar                             |
| Timbre fiscal                  | Ejecutar                             |
| Delegado o notario             | Ejecutar                             |
| Resultados publicados          | Cerrar el acta                       |
| Lista a la Gobernación         | Cerrar el sorteo (no bloquea)        |

- **Permiso:** `sorteos.marcar_requisito`. Botón «Marcar» (o «Cambiar»).
- **Campos:** estado («Cumplido», «No aplica» o «Pendiente»), el valor (número de resolución, de fianza, de recibo…), la evidencia en texto y, si quieres, un archivo (PDF, JPEG, PNG o WebP, hasta 5 MB), y una nota.
- Cada marca queda guardada con fecha y usuario; vale la última. Los archivos no se borran.

### 4. Abrir la participación

- **Permiso:** `sorteos.publicar`. Botón «Abrir participación».
- Exige «Bases publicadas (DIACO)» marcado.
- **Qué pasa:** los clientes empiezan a sumar boletos y, si se admite, pueden canjear puntos por boletos (con un premio de tipo «Boletos de sorteo» en el [catálogo](./premios-y-canjes.md)).
- No hay inscripción: al cerrar el corte participan solos los clientes con servicios activos y sin facturas vencidas, más los boletos canjeados.

**Anunciar en el portal del cliente:** con `sorteos.gestionar`, este interruptor muestra el sorteo, sus premios y los boletos de cada cliente en su portal. Se puede cambiar hasta antes de ejecutar.

### 5. Cerrar el corte

- **Permiso:** `sorteos.publicar`. Botón «Cerrar corte», a partir de la fecha y hora del corte. Antes, verás «Aún no llega la fecha de corte».
- **Qué pasa:** se toma la foto de los participantes: cada cliente recibe un seudónimo con sus boletos y se calcula la huella de la lista. Ya no entra nadie.
- Desde aquí, con `sorteos.exportar`, puedes descargar «Participantes CSV» o «Participantes XLSX», con la huella al pie.

### 6. Ejecutar el sorteo

- **Permiso:** `sorteos.ejecutar` (solo `admin`). Botón «Ejecutar sorteo», en el acto y frente al notario o delegado.
- **Campos:**
    - **Valor público del acto:** el dato de la fuente que declaran las bases, tal como lo lee el notario o el delegado.
    - **Cómo se obtuvo el valor:** quién lo leyó, dónde y a qué hora.
    - **Asistentes:** nombre y rol (opcional).
- **Requisitos:** «Bases publicadas (DIACO)», «ISR de los premios», «Timbre fiscal» y «Delegado o notario» marcados como cumplidos o que no aplican. Si falta uno, verás «Falta el requisito «…»».
- **Qué pasa:** el sistema revela la semilla, comprueba que coincide con el compromiso publicado y calcula los titulares (uno por premio) y luego los suplentes. **Nadie elige**: el resultado sale de la semilla, la lista y el valor público, y cualquiera lo puede recalcular.

::: danger La ejecución es definitiva
Un sorteo ejecutado no se repite ni se cancela.
:::

### 7. Resultado y verificación

La sección **Resultado** muestra a los titulares con su premio, su estado y su entrega, y a los suplentes. Debajo, los datos para verificarlo: valor público, semilla revelada, compromiso y huellas.

- «Abrir verificación» abre la página pública con todo lo necesario para recalcular el sorteo.
- «Comprobar resultado» repite el cálculo en tu navegador y te dice si «El resultado se reproduce».

### 8. Notificar ganadores

- **Permiso:** `sorteos.entregar`. Botón «Notificar ganadores (n)».
- **Qué pasa:** cada ganador por notificar pasa a «Notificado», con su fecha límite para reclamar según el plazo de las bases. Si las notificaciones están configuradas, el cliente recibe el aviso. Quien ya fue notificado no recibe otro.

### 9. Cerrar el acta

- **Permiso:** `sorteos.ejecutar`. Botón «Cerrar acta».
- Exige «Resultados publicados» marcado. Pide la firma o constancia del notario o delegado (nombre, colegiado, fecha).
- **Qué pasa:** se genera una sola vez el acta en PDF con la resolución, el checklist, las huellas, la semilla, el valor público con su fuente y evidencia, el método de cálculo, los ganadores (con seudónimo y nombre), los asistentes y la constancia. Queda sellada con su huella. «Descargar acta (PDF)» la baja.

### 10. Entregar premios

- **Permiso:** `sorteos.entregar`. Botón «Entregar» en cada ganador, con el sorteo ejecutado o con el acta cerrada.
- **Según el tipo de premio:**
    - **Efectivo:** elige de dónde sale («Caja», «Banco» o «Cuenta bancaria»). Se paga el valor menos el ISR retenido. Con caja, baja el esperado del turno abierto.
    - **Bien:** elige la contrapartida: «Compra registrada» (la línea de la compra con que se compró el bien y cuántas unidades se entregan; si se compró a crédito, registra antes la compra) o «Cuenta de activo» (por ejemplo, una cuenta de inventario de premios). Va a gasto de premios por la base sin IVA. El ISR en especie lo asume la empresa.
    - **Servicio:** se registra un canje sin puntos del premio del catálogo, que la próxima factura del ganador aplica como descuento.
- **Constancia firmada** (opcional, PDF o foto de hasta 5 MB) y **Nota** (quién recibió).
- Cuando, con el acta cerrada, ya no queda ningún premio por notificar ni notificado, el sorteo pasa a «Premios entregados».

### Premio no reclamado

- **Permiso:** `sorteos.entregar`. Botón «No reclamado» en un ganador notificado, cuando venció su plazo. Pide motivo.
- **Qué pasa:** el premio pasa al siguiente suplente en espera, que se notifica en el mismo paso. El ganador queda «Sustituido», o «No reclamado» si ya no hay suplentes (entonces el premio sigue lo que dicen las bases).

### Anular una entrega

- **Permiso:** `sorteos.entregar`. Botón «Anular entrega». Pide motivo.
- **Qué pasa:** se deshace todo junto: el egreso del efectivo, el registro del bien o el canje del servicio, y el del ISR. El ganador vuelve a «Por notificar» y el premio se puede volver a entregar. Si el canje del servicio ya se aplicó a una factura, no se puede anular.

### Cancelar el sorteo

- **Permiso:** `sorteos.publicar`. Botón «Cancelar sorteo», desde el borrador hasta el corte cerrado. Pide motivo.
- **Qué pasa:** el sorteo queda cancelado con su motivo y se publica la cancelación.

::: danger No se deshace
Un sorteo cancelado no se reactiva. Si hace falta, crea otro.
:::

## Preguntas frecuentes y errores

- **«El sorteo ya cambió de paso».** Otra persona avanzó el sorteo. Recarga la ficha.
- **«Sin participantes».** Al corte no hubo participantes, o hubo menos que premios.
- **«Falta el requisito «…»».** Márcalo en el checklist como cumplido o «No aplica», con su evidencia.
- **No veo «Ejecutar sorteo» ni «Cerrar acta».** Son solo del rol `admin`.
- **No puedo cambiar las bases.** Desde que se publican quedan congeladas.
- **No aparece «No reclamado».** El plazo del ganador todavía no vence.

## Relacionado

- [Premios y canjes](./premios-y-canjes.md)
- [Programa de lealtad](./programa.md)
- [Reporte de lealtad](./pasivo-de-puntos.md)
