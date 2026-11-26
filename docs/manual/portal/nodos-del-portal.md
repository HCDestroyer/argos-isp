---
orden: 4
pantallas:
    - /configuracion/nodos-portal
---

# Nodos del portal

Un nodo del portal es un portal del cliente (con su página de corte) instalado en otro servidor, por ejemplo en otra oficina o en la nube, que habla con este servidor. Aquí das de alta cada nodo con su token y lo revocas si el equipo se pierde o deja de usarse. Si tu portal corre en este mismo servidor, no necesitas ningún nodo.

## Quién la usa

Permiso `nodos_portal.administrar` (solo `admin`). Está en **Ajustes → Red y equipos → Corte, caídas y retiro → Nodos del portal**.

## Qué ves

Una tabla con cada nodo:

- **Nodo:** su nombre y la fecha de alta.
- **Último uso:** fecha y hora de su última consulta y la IP desde la que llamó, o «Sin usar».
- **Estado:** «Activo» o «Revocado».

Si no hay ninguno: «Sin nodos remotos».

## Acciones

### Crear un nodo

- **Permiso:** `nodos_portal.administrar`
- **Dónde:** botón «Nuevo nodo».
- **Pasos:**
    1. Escribe el «Nombre»: minúsculas, números y guiones, que empiece con letra o número (por ejemplo `portal-mixco`). Identifica al nodo en los registros.
    2. Toca «Crear nodo».
    3. Se abre una ventana con el **token** del nodo. Cópialo: va en `NODO_PORTAL_TOKEN` del archivo `.env` del nodo (o en el `--token` del instalador).
- **Qué pasa:** el nodo queda activo. Queda en la bitácora sin el token.

::: warning El token se ve una sola vez
Argos guarda solo una huella del token, no el token. Si lo pierdes, revoca el nodo y crea otro.
:::

### Revocar un nodo

- **Permiso:** `nodos_portal.administrar`
- **Dónde:** botón «Revocar» en la fila del nodo.
- **Qué pasa:** tras confirmar, el portal de ese nodo deja de funcionar desde su siguiente consulta: sus clientes no pueden ver la página de corte ni entrar a su cuenta desde ese servidor.

::: danger No se puede deshacer
Un nodo revocado no se reactiva. Para volver a conectarlo, crea otro nodo con otro nombre (el nombre de un nodo revocado no se puede reutilizar) y cambia el token en el servidor del nodo.
:::

## Preguntas frecuentes y errores

- **«Ya existe un nodo portal llamado …»:** el nombre ya se usó, aunque el nodo esté revocado. Elige otro.
- **«Minúsculas, números y guiones; empieza con letra o número»:** el nombre tiene mayúsculas, espacios u otros signos.
- **El nodo dice «Sin usar» después de instalarlo:** el nodo no está llegando a este servidor o tiene otro token. Revisa en el nodo la dirección del servidor central y el token.
- **Los clientes del nodo ven siempre «No pudimos identificar tu servicio»:** revisa la sección técnica de [Página de corte](./pagina-de-corte.md#nodo-del-portal).

## Sección técnica

También se gestionan desde la terminal del servidor principal: `argosisp nodo-portal crear|listar|revocar`. El nodo se instala con `instalar.sh --rol portal --central https://api.<dominio> --token <token>`. El nodo manda el token en la cabecera `X-Argos-Nodo-Token` y la IP del cliente en `X-Argos-Cliente-Ip`; un token revocado o desconocido recibe 401. Detalle en el contrato del [nodo del portal](../../../.claude/integration/contratos/nodo-portal.md).

## Relacionado

- [Página de corte](./pagina-de-corte.md)
- [Portal de corte (configuración)](./portal-de-corte.md)
