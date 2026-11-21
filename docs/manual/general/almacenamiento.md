---
orden: 7
---

# Almacenamiento

Muestra qué está guardando el sistema y cuánto espacio ocupa: el disco de datos, la base de datos, Redis y las carpetas de archivos (comprobantes de depósito, logos, imágenes de anuncios, adjuntos de inventario y facturas de compra, libros legales, documentos de sorteos y respaldos locales).

## Quién la usa

- **Ver:** `sistema.ver_almacenamiento` (solo `admin`).
- **Recalcular:** `sistema.recalcular_almacenamiento` (solo `admin`).

## Qué muestra

- **Discos**: cuánto hay usado y libre en el disco de datos. Pasa a «con fallas» desde el 80 % de uso y a «caído» desde el 95 %; en ese caso también queda un aviso en el **Registro del sistema**. El disco de la base de datos solo se puede medir si la base corre en el mismo servidor sin contenedores.
- **Carpetas**: tamaño, cantidad de archivos, cuánto creció en los últimos 30 días y el archivo más grande de cada una.
- **Base de datos**: tamaño total, por módulo (clientes y servicios, red, facturación, libro contable, auditoría, inventario…) y las 10 tablas más grandes. La auditoría y el libro contable crecen siempre: por ley del sistema nunca se borran.
- **Redis**: memoria usada.

## Cuándo se calcula

Todas las noches (22:23, hora de Guatemala) y cuando pulsas **Recalcular**. Arriba ves «Calculado hace …». Si hay muchísimos archivos y el cálculo no termina a tiempo, la carpeta sale como **parcial**: el número es un mínimo, no un error.

El sistema **nunca borra nada por su cuenta**. Si el disco se llena, avisa al administrador del servidor para ampliar el disco o mover respaldos viejos a otro lugar.
