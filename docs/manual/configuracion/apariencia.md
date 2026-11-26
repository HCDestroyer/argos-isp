---
orden: 3
pantallas:
    - /configuracion/apariencia
---

# Apariencia

Cambia cómo se ve el sistema para todos: el **color** del panel y del portal, el modo inicial (claro, oscuro o el del dispositivo), el **nombre de la marca**, un eslogan y el **logo** y la **imagen de fondo** de las pantallas de inicio de sesión del panel y del portal.

## Quién la usa

- **Ver:** `apariencia.ver` (roles `admin` y `lectura`).
- **Cambiar color, modo, nombre y eslogan:** `apariencia.editar` (solo `admin`).
- **Subir o quitar el logo del inicio de sesión:** `apariencia.subir_logo_login` / `apariencia.quitar_logo_login` (solo `admin`).
- **Subir o quitar el fondo:** `apariencia.subir_fondo_login` / `apariencia.quitar_fondo_login` (solo `admin`).

## Colores disponibles

Índigo (el de siempre), Azul, Violeta, Esmeralda, Naranja, Rosa y Pizarra. Todos se leen bien en modo claro y oscuro (contraste AA).

## Logo y fondo

- **Logo**: PNG o SVG, hasta 512 KB.
- **Fondo**: PNG, JPG, WebP o SVG, hasta 1.5 MB.

Los SVG se limpian al subirlos (sin scripts ni enlaces externos). Si alguien más cambió la apariencia mientras la editabas, el sistema te pide recargar antes de guardar.

El logo de cada empresa (el que sale en el portal del cliente, los PDF y los correos) se cambia en **Ajustes → Empresa y fiscal → Datos de la empresa**, no aquí.

## Accesos rápidos

Cada usuario elige sus accesos rápidos de la barra superior (hasta 12). Si no ha elegido ninguno, ve los sugeridos para su rol (por ejemplo, el cajero: Cobrar, Caja, Clientes y Comprobantes). Se guardan por usuario y no afectan a nadie más.
