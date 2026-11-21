---
orden: 6
---

# Registro del sistema

Lista de lo que salió mal (o se recuperó) en el sistema en los últimos días, del más nuevo al más viejo: acciones que fallaron, comandos que un router rechazó, cortes o reconexiones (CoA) que no llegaron, caídas y recuperaciones de RADIUS, avisos del libro contable, avisos de disco lleno y trabajos de las colas que fallaron. Sirve para entender un problema sin entrar al servidor.

## Quién la usa

- `sistema.ver_registro`: solo el rol `admin`.

## Cómo leerlo

Cada fila tiene la hora, el **nivel** (**Error**, **Advertencia** o **Información**), el **origen** (API, Red, RADIUS, CoA, Colas, Contabilidad o Almacenamiento), un título en español y el detalle. Si la fila habla de un servicio, un router o una factura, tiene un enlace para abrirlo.

- **Error**: algo falló y puede necesitar que alguien actúe.
- **Advertencia**: el sistema rechazó algo por una regla (un periodo cerrado, un dato inválido) o el disco pasó del 80 %.
- **Información**: algo se recuperó (por ejemplo, RADIUS volvió a responder).

Filtra por nivel y origen arriba; **Cargar más** trae los anteriores. Por defecto muestra los últimos 7 días (hasta 31).

Las contraseñas, tokens y secretos nunca aparecen: se ven como `***`.

Para el historial completo de quién hizo qué, usa la **Bitácora**.
