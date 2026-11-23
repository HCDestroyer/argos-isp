---
orden: 7
pantallas:
    - /red/acceso
---

# Red de acceso

Por dónde llega cada cliente: OLT → puerto PON → VLAN → servidor PPPoE → red. Sirve para ordenar y filtrar; ArgosIsp no se conecta a las OLT.

## Quién la usa

- Ver la pantalla: `red_acceso.ver` (`admin`, `soporte`, `tecnico`).

## Qué ves

Tres columnas:

1. **OLT:** cada OLT registrada y «Sin OLT» para lo que no cuelga de ninguna.
2. **Puertos:** los puertos PON de la OLT elegida, con sus VLAN y cuántos clientes tiene cada una.
3. **Camino:** para cada VLAN del puerto elegido, el servidor PPPoE y la red por la que salen sus clientes.

Lo **adoptado** (lo que ya estaba configurado en el router y ArgosIsp no toca) va aparte. Para que ArgosIsp lo administre, usa «Tomar control» en la [ficha del router](ficha-del-router.md#red-de-acceso).

## Relacionado

- [Ficha del router: red de acceso](ficha-del-router.md#red-de-acceso)
- [Direcciones IP](direcciones-ip.md)
