---
orden: 7
pantallas:
    - /configuracion/reportes
---

# Ajustes de reportes

Cómo se cuentan las bajas en los reportes y en el panel del dueño, y cuándo avisa el panel que la empresa se acerca al límite anual del pequeño contribuyente.

## Quién la usa

- **Ver la pantalla:** `reportes.ver`.
- **Ver los ajustes:** `panel_financiero.ver`; **guardarlos** con `panel_financiero.configurar`.
- **Cambiar los umbrales del aviso:** además `fiscal.editar_parametros` (sin él se ven de solo lectura).

Se llega desde **Configuración → Reportes**. Los correos externos aprobados para los envíos programados ya no están aquí: viven en [Reportes → Envíos programados](../reportes/envios-programados.md).

## Qué ves

- **Altas y bajas · Días suspendido para contar una baja:** un servicio retirado, o suspendido más de estos días, cuenta como baja; si se reactiva deja de contar. De 1 a 365 (60 de fábrica). Es de cada empresa: con «Todas las empresas» pide elegir una arriba.
- **Aviso de pequeño contribuyente:**
    - **Avisar al acercarse al límite anual:** encendido de fábrica. Apagado, el panel financiero ya no muestra el aviso de esa empresa.
    - **Umbrales del aviso:** los porcentajes del límite anual en que avisa (de fábrica, 80 % y 95 %), de 1 a 5 valores mayores que 0 y hasta 100. Dice si son el valor de fábrica del país o si los cambió la empresa, y desde cuándo rigen. Son el parámetro fiscal `pc_alertas` de la empresa: el mismo que usa el resumen fiscal.
    - Si el régimen actual de la empresa no es pequeño contribuyente, una nota dice que el aviso no sale aunque esté encendido.

## Acciones

- **Guardar** los días de baja.
- **Encender o apagar** el aviso: se guarda al tocar el interruptor.
- **Guardar umbrales:** agrega o quita umbrales (botón **Agregar** y la **x** de cada uno), escribe un motivo si quieres y guarda. El cambio rige desde hoy y queda en el historial del parámetro fiscal.

## Preguntas frecuentes y errores

| Mensaje | Qué hacer |
| --- | --- |
| «Elige una empresa» | Estos ajustes son de cada empresa: elige una arriba. |
| «Los umbrales ya se cambiaron hoy» | Cada cambio rige desde el día en que se hace y solo cabe uno por día. Vuelve a intentarlo mañana o pide al contador que lo corrija en Configuración → Fiscal. |
| «La empresa no tiene la localización fiscal instalada» o «Sin localización fiscal» | Los umbrales son un parámetro fiscal: instala la localización del país en Configuración → Fiscal. |
| «Sin permiso para cambiar los umbrales» | Pide el permiso `fiscal.editar_parametros`. |
| Conflicto de versión | Otra persona guardó mientras editabas: toca **Recargar**. |

## Relacionado

- [Envíos programados](../reportes/envios-programados.md)
- [Catálogo de reportes](../reportes/catalogo.md)
