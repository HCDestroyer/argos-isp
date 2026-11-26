---
orden: 8
pantallas:
    - /configuracion/inventario
---

# Ajustes del inventario

Dos ajustes de la empresa activa: si recibir una orden de traslado exige firma, y la inteligencia artificial que lee las facturas de compra en PDF o imagen.

Menú: **Ajustes → Red y equipos → Inventario**.

## Quién la usa

- Para entrar necesitas `inventario.configurar` (solo `admin`) y también `inventario.ver`.
- La sección de la IA solo aparece con `inventario.configurar_ia` (solo `admin`).

## Recibir órdenes de traslado

Interruptor **Firma obligatoria al recibir**:

- **Encendido** (así viene): nadie recibe sin firmar. Se recibe con firma digital en pantalla o con firma en papel.
- **Apagado**: además se permite la «Aceptación simple», sin firma.

El cambio se guarda al mover el interruptor y vale para las recepciones que se hagan después. Ver [recibir una orden](./traslados.md#recibir-una-orden).

## IA para facturas de compra

Cuando subes una factura de compra en PDF o imagen, la IA la lee y propone el borrador para que lo revises. Un XML de FEL no la necesita. Sin IA (o apagada), el borrador se crea vacío para capturarlo a mano.

Campos:

- **Proveedor:** «IA privada» (un servidor propio compatible con OpenAI, como Ollama o vLLM), «Claude (Anthropic)», «DeepSeek» o «ChatGPT (OpenAI)». Con DeepSeek y ChatGPT un PDF se envía como texto; un PDF escaneado súbelo como imagen.
- **Modelo:** viene uno sugerido para cada proveedor; puedes cambiarlo.
- **URL base:** obligatoria en «IA privada» (por ejemplo, `http://<tu-servidor>:11434/v1`). En los demás, vacía usa la del proveedor.
- **Clave de API:** se escribe y nunca se vuelve a mostrar. Si hay una guardada, verás «Guardado». Usa «Reemplazar» (o «Escribir» si no hay ninguna) o «Borrar»; «Deshacer» descarta el cambio antes de guardar.
- **Activa:** apagada, las facturas en PDF o imagen se capturan a mano.

Pulsa «Guardar IA». El aviso te dice si quedó con clave guardada o sin ella.

::: tip Configuración global
Si ves «La empresa usa la configuración global», hay una IA para toda la instalación. Al guardar aquí se crea una propia para la empresa activa.
:::

::: warning Lo que lees se envía al proveedor
Con un proveedor externo, el contenido de la factura sale hacia ese servicio. Si no quieres que salga de tu red, usa «IA privada».
:::

## Preguntas frecuentes y errores

- **«La URL base es obligatoria en una IA privada».** Escribe la dirección de tu servidor, empezando con `http://` o `https://`.
- **No veo la sección de la IA.** Te falta `inventario.configurar_ia`.
- **Conflicto al guardar.** Otra persona cambió la configuración. Recarga la página y vuelve a intentar.

## Relacionado

- [Órdenes de traslado](./traslados.md)
- [Compras y activos](../compras-y-activos/index.md)
