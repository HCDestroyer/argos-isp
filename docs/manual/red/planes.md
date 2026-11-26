---
orden: 5
pantallas:
    - /planes
    - /planes/[id]#ficha-del-plan
    - /planes/nuevo#crear-o-editar-un-plan
    - /planes/[id]/editar#crear-o-editar-un-plan
---

# Planes

Los planes de internet que vendes: velocidad, velocidad cuando el servicio está limitado, precio y cómo se reparte el enlace. Aquí los creas, decides en qué routers están y qué adicionales traen.

## Quién la usa

- Ver: `planes.ver` (todos los roles base).
- Crear y editar: `planes.crear` y `planes.editar` (`admin`).
- Sincronizar: `planes.sincronizar` (`admin`, `tecnico`).

## Lista de planes

Abre **Red → Planes**. Arriba de la lista, la pestaña **Promociones de velocidad** lleva a las [promociones](promociones-de-velocidad.md).

| Columna                      | Qué muestra                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| Plan                         | Nombre, tipo de plan (Residencial, Empresarial o Dedicado), «Inactivo» y «Por router» si no es global. |
| Bajada / subida              | Velocidad normal.                                                                                      |
| Reuso · garantía · prioridad | El modelo de reparto del enlace.                                                                       |
| Limitado                     | La velocidad cuando el servicio está limitado.                                                         |
| Precio                       | Precio mensual.                                                                                        |

Se filtra por tipo de plan. Cada fila tiene «Editar» (`planes.editar`) y un enlace a su ficha.

## Crear o editar un plan

- **Permisos:** `planes.crear` («Nuevo plan») y `planes.editar` («Editar»).
- **Dónde:** el formulario se abre en su propia página. Al crear vas a la ficha del plan, para elegir en qué routers se ofrece si no es global; al editar vuelves a la ficha.
- **Campos** (velocidades en kbps; 1 Mbps = 1000 kbps):
    - **Nombre**, **Precio mensual** y **Tipo de plan.** El tipo solo cambia avisos y reportes, nunca la velocidad; un dedicado suele ser 1:1 y simétrico.
    - **Bajada** y **Subida.**
    - **Bajada limitada** y **Subida limitada:** la velocidad cuando el corte limita el servicio. Si son cero, el servicio nunca se limita: sigue activo hasta que le toque el corte.
    - **Reuso 1:N:** 1 es dedicado; 4 significa que cuatro clientes comparten la capacidad de uno.
    - **Garantizado (CIR):** el mínimo reservado. «Automático» lo calcula como 100 / reuso.
    - **Prioridad:** corporativos alta, residenciales 8.
    - **Con ráfaga:** ráfaga de bajada y de subida, **Umbral** (el porcentaje de la velocidad bajo el cual vuelve a ganar ráfaga) y **Tiempo** (segundos de promedio).
    - **IP:** IPv4 e IPv6, Solo IPv4 o Solo IPv6.
    - **Prefijo delegado IPv6:** /64, /56 o /48.
    - **Global (disponible en todos los routers)** y **Activo (se ofrece en altas).**
- **Vista previa del rate-limit:** mientras escribes, ArgosIsp calcula la cadena que recibirá el router en estado activo y limitado, sin guardar. Si algún valor no es válido, aparece «La API rechaza estos valores» con el porqué.
- **Qué pasa al guardar:**
    - El precio nuevo aplica a las facturas que se generen después.
    - Los servicios del plan toman la velocidad nueva cuando se vuelven a conectar. Para aplicarla ya a los que están en línea, usa «Sincronizar plan».
    - Un plan inactivo deja de ofrecerse en las altas; los servicios que ya lo tienen siguen igual.

## Ficha del plan

Abre un plan desde la lista. Arriba, su nombre, tipo, «Inactivo» o «Por router», número y versión. Botones «Sincronizar plan» y «Editar».

### Velocidad y precio

Precio mensual, bajada y subida, limitado, reuso, garantía y prioridad, direcciones (IPv4, IPv6 y tamaño del prefijo) y última modificación.

### Adicionales incluidos

Lo que el plan trae sin cobro aparte (por ejemplo, una cuenta de streaming), con su cantidad.

- **Permisos:** `planes.editar` y `adicionales.ver` para «Editar lista».
- Agregas o quitas adicionales del catálogo y pulsas «Guardar lista». Un adicional desactivado que ya estaba se puede conservar o quitar, pero no agregar.
- Aplica desde la próxima alta o cambio de plan: los servicios actuales no cambian.

### Implementación por router

Cómo se aplica el plan en cada router. Lo vacío hereda del plan o de la configuración del router.

- «Implementar en un router» (`planes.editar`): elige el **Router** y, si hace falta, **Profile PPP**, **Local address**, **Pool IPv4**, **Pool IPv6 de enlace**, **Pool IPv6 delegado**, «No crear reglas automáticas» (si el router ya tiene sus propias colas o reglas para este plan) y **Rate-limit propio** (la cadena completa; vacía usa la calculada).
- Un plan **por router** solo se ofrece en los routers donde está implementado. Un plan **global** aplica igual en todos, aunque no tenga filas aquí.
- Si un router trae una velocidad propia heredada para este plan, se marca: se unifica desde la [ficha del router](ficha-del-router.md#unificar-excepciones-por-plan).

### Sincronizar plan

- **Permiso:** `planes.sincronizar`
- **Dónde:** «Sincronizar plan» arriba (todos los routers) o en la fila de un router (solo ese).
- **Qué pasa:** aplica la velocidad vigente del plan a las sesiones PPPoE abiertas sin desconectar a nadie, y reconcilia las colas del plan en cada router. Al terminar ves cuántos servicios quedaron con la velocidad nueva y el resultado por router («Al día», «Solo RADIUS» o «Con error»). Un router con error se reintenta solo; también puedes pulsar «Reintentar».

## Preguntas frecuentes y errores

**El plan no aparece al dar de alta un servicio.** Está inactivo, o es «Por router» y no está implementado en ese router.

**Cambié la velocidad y el cliente sigue igual.** Pulsa «Sincronizar plan», o espera a que su equipo se vuelva a conectar.

**Mientras editabas, alguien más guardó el plan.** Verás un error de conflicto: recarga y vuelve a aplicar el cambio.

## Relacionado

- [Conceptos: planes](../../guia/conceptos.md#planes)
- [Ficha del router: control de velocidad](ficha-del-router.md#control-de-velocidad)
- [Adicionales](../clientes-y-servicios/adicionales.md)
- [Promociones de velocidad](promociones-de-velocidad.md): la otra pestaña de Red → Planes
