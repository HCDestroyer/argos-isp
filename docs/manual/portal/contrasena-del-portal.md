---
orden: 8
pantallas:
    - /configuracion/portal-contrasena
---

# Contraseña del portal (configuración)

Aquí defines la **contraseña por defecto** de la empresa: la que usan para entrar al portal, con su número de documento, los clientes que todavía no eligieron una propia. Cómo entra el cliente y qué pasa después: [Entrar con documento y contraseña](./acceso-con-contrasena.md).

## Quién la usa

- **Ver si está configurada:** permiso `empresa.ver`.
- **Configurarla o cambiarla:** permiso `portal.configurar_contrasena_defecto` (solo `admin`). Sin él la pantalla muestra el estado y dice «Solo lectura».

Está en **Configuración → Contraseña del portal**.

## Es de cada empresa

Cada empresa (NIT) tiene la suya. La pantalla trabaja con la empresa elegida en el selector de arriba. Si tienes elegido «Todas las empresas», la pantalla dice **«Elige una empresa»**: elige una en el selector y se carga sola.

## Qué ves

- **Configurada el …**: la empresa ya tiene contraseña por defecto, con la fecha del último cambio.
- **Sin configurar**: los clientes que no tienen contraseña propia solo pueden entrar con código (o con «Ver mi cuenta» desde la página de corte).
- El aviso **«El cliente debe cambiarla la primera vez que entre»**: el portal no le deja ver su cuenta hasta que elija una propia.

La contraseña **nunca se vuelve a mostrar**: el sistema guarda solo una huella cifrada. Si la olvidas, escribe una nueva.

## Configurarla o cambiarla

1. Escribe la contraseña en **Contraseña nueva** (de 8 a 128 caracteres; los espacios cuentan).
2. Escríbela otra vez en **Confirmar contraseña**. El botón del ojo la muestra mientras escribes.
3. Pulsa **«Guardar contraseña»** (o **«Cambiar contraseña»** si ya había una).

Al guardar ves el aviso «Contraseña del portal configurada» (o «cambiada»), el estado pasa a «Configurada el …» y el formulario queda vacío.

Cambiarla **no afecta** a los clientes que ya eligieron la suya ni cierra sesiones abiertas. A los que todavía usan la de la empresa, la anterior deja de servirles desde ese momento.

## Errores

- **«Al menos 8 caracteres»** o **«No coincide con la contraseña»**: corrige el campo marcado; no se envió nada.
- **«Alguien más cambió la contraseña mientras escribías»**: otra persona la guardó antes que tú. La pantalla ya cargó el estado actual y conserva lo que escribiste; si igual quieres reemplazarla, pulsa guardar otra vez.
- **Error con «Reintentar»**: no se pudo leer el estado. La pantalla no muestra nada supuesto; pulsa «Reintentar».

## Relacionado

- [Entrar con documento y contraseña](./acceso-con-contrasena.md)
- [Ficha del cliente: Portal del cliente](../clientes-y-servicios/clientes.md#portal-del-cliente)
