---
orden: 3
pantallas:
    - /usuarios/tokens
---

# Tokens de API

Un token de API es la llave con la que un programa (una integración o un agente de IA) usa ArgosIsp sin una persona sentada en el panel. Actúa como el usuario al que pertenece y pasa por los mismos permisos, recortados a lo que elijas.

## Quién la usa

- Ver la lista: `tokens.ver` (`admin`; `lectura` la ve).
- Crear: `tokens.crear` y además `usuarios.ver` (`admin`).
- Revocar: `tokens.revocar` (`admin`).

Los tokens de Horus y de Iris se generan en sus pantallas de [Integraciones](../integraciones/integraciones.md); como son tokens de los usuarios técnicos «Horus» e «Iris», también aparecen en esta lista.

## Qué ves

| Columna    | Qué muestra                                           |
| ---------- | ----------------------------------------------------- |
| Token      | Nombre, usuario al que pertenece y fecha de creación. |
| Alcance    | Los recortes: permisos, routers, zonas o cajas.       |
| Último uso | Cuándo se usó por última vez, o «Sin usar».           |
| Estado     | Activo o Revocado (con la fecha).                     |

La lista nunca muestra el valor del token: solo se ve una vez, al crearlo.

## Acciones

### Crear un token

- **Permisos:** `tokens.crear` y `usuarios.ver`
- **Dónde:** «Nuevo token».
- **Campos:**
    - **Usuario:** el token actúa como él y nunca tiene más permisos que él. Solo aparecen usuarios activos. Lo recomendable es crear un usuario propio para cada integración, con un rol acotado.
    - **Nombre:** para reconocerlo después (por ejemplo, «Agente de cobranza»).
    - **Solo estos routers**, **Solo estas zonas**, **Solo estas cajas:** vacío usa los del usuario.
    - **Recortar los permisos:** sin recorte, el token puede todo lo que pueden los roles de su usuario. Con recorte, eliges los permisos del token; elegir uno que el usuario no tiene no se lo da.
- **Qué pasa:** aparece una ventana con el valor del token y «Copiar». **Solo se muestra ahora:** ArgosIsp guarda únicamente una huella del token y no lo vuelve a mostrar ni lo guarda en tu navegador. Cópialo, entrégalo por un canal seguro y pulsa «Ya lo copié, cerrar». Si lo pierdes, crea otro.

::: warning Trátalo como una contraseña
Quien tenga el token puede hacer todo lo que su usuario y sus recortes permiten. No lo pegues en chats ni correos.
:::

### Revocar un token

- **Permiso:** `tokens.revocar`
- **Dónde:** «Revocar» en la fila.
- **Qué pasa:** deja de funcionar de inmediato. El token queda en la lista como «Revocado» con su fecha.

::: danger Revocar no se deshace
Para volver a dar acceso, crea un token nuevo.
:::

Desactivar al usuario de un token también apaga todos sus tokens.

## Preguntas frecuentes

**No veo el botón «Nuevo token».** Hacen falta `tokens.crear` y `usuarios.ver`.

**La integración recibe «sin permiso».** El usuario del token no tiene ese permiso, o el recorte del token no lo incluye, o la acción es sobre un router, zona o caja fuera de su alcance.

## Relacionado

- [Usuarios](usuarios.md)
- [Roles y permisos](roles.md)
