---
orden: 6
pantallas:
    - /red/qos
    - /red/qos/[id]#detalle-de-un-perfil
---

# Prioridad por clases (QoS)

Con QoS, dentro del plan de cada cliente lo interactivo (DNS, llamadas, juegos) y la web pasan antes que las descargas pesadas cuando el plan o el enlace se llenan. Los **perfiles** definen esas **clases**; cada router usa un perfil.

## Quién la usa

- Ver: `qos.ver` (`admin`, `tecnico`).
- Crear perfiles, crear y editar clases, activarlas y desactivarlas, y elegir el perfil de un router: `qos.gestionar` (`admin`, `tecnico`).

## Cómo funciona

- Funciona con el control «Árbol de colas con PCQ» y exige «Verificar FastTrack»: lo acelerado por FastTrack no se clasifica. Se prende por router con el extra «Prioridad por clases (QoS)» del [control de velocidad](ficha-del-router.md#control-de-velocidad).
- La prioridad actúa cuando el plan o el router se llenan. Si sobra ancho, cada clase usa lo que quiera.
- Un cliente que usa varias clases a la vez puede pasar la velocidad de su plan, salvo que los topes sumen 100 % o menos.
- «Web» y «Streaming» no se separan por puerto; para eso usa una lista de destino que mantienes en el router.

## Lista de perfiles

Abre **Red → QoS**.

| Columna             | Qué muestra                                                                          |
| ------------------- | ------------------------------------------------------------------------------------ |
| Perfil              | Nombre, con la marca «Predeterminado» en el que usan los routers sin perfil elegido. |
| Clases activas      | Cuántas clases tiene prendidas.                                                      |
| Routers que lo usan | Cada router, con cuántos planes tienen QoS.                                          |
| Costo               | Hojas del árbol contra el límite del router.                                         |

Si el detalle de un perfil no se pudo leer, su fila lo dice con «Reintentar» y no muestra costo.

### Nuevo perfil

- **Permiso:** `qos.gestionar`
- **Dónde:** «Nuevo perfil», o el botón de copiar en una fila.
- **Campos:** **Nombre**, **Descripción**, **Empresa** («Común a todas las empresas», solo con alcance global, o una empresa; un router solo usa perfiles comunes o de su empresa sugerida) y **Copiar las clases de** (otro perfil).
- **Qué pasa:** se crea con una copia de las clases activas del origen. Ningún router lo usa hasta que lo elijas en su ficha (pestaña Avanzado).

## Detalle de un perfil

Abre un perfil desde la lista. Arriba, si es predeterminado y de qué empresa es; «Copiar perfil» (`qos.gestionar`). Debajo, las advertencias del perfil, sus clases y los routers que lo usan con su costo.

### Clases

| Columna     | Qué muestra                                                                    |
| ----------- | ------------------------------------------------------------------------------ |
| Orden       | La primera clase que coincide gana.                                            |
| Clase       | Nombre y si está activa.                                                       |
| Prioridad   | 1 pasa primero cuando hay cuello; 8 último.                                    |
| Garantizado | Porcentaje del plan reservado. La suma de las activas no puede pasar de 100 %. |
| Tope        | Porcentaje máximo del plan (vacío: sin tope).                                  |
| Reglas      | Resumen de lo que entra en la clase.                                           |

### Crear o editar una clase

- **Permiso:** `qos.gestionar`
- **Dónde:** «Nueva clase» o el lápiz de una fila.
- **Qué toma la clase:**
    - **Por reglas:** cada regla puede tener **Protocolo**, **Puertos de destino**, **Puertos de origen**, **DSCP** y **Lista de destino** (una address-list que mantienes en el router). Una conexión entra si cumple cualquiera de las reglas; dentro de una regla, todo lo escrito. Se mira el primer paquete del cliente hacia internet.
    - **Descargas pesadas:** conexiones que ya pasaron cierta cantidad de bytes (**Desde (bytes)**, por ejemplo 10000000 = 10 MB), tomadas de las clases que elijas.
- La clase «resto» (lo que no coincide con ninguna otra) solo cambia nombre, prioridad y porcentajes.
- **Qué pasa:** la clase nueva se agrega activa. Los routers que usan el perfil se reconcilian solos.

### Activar y desactivar una clase

Con `qos.gestionar`, el botón de cada fila. La clase «resto» no se desactiva. Los routers que usan el perfil se reconcilian solos.

## Preguntas frecuentes y errores

**«El perfil no quedaría válido».** El cambio rompería una regla del perfil, por ejemplo que los garantizados sumen más de 100 % o que se pase el costo permitido. Ajusta los porcentajes.

**Ya existe un perfil o una clase con ese nombre.** El error sale junto al nombre: usa otro.

**Elegí un perfil y no cambia nada.** Revisa que el control de velocidad del router tenga prendido el extra «Prioridad por clases (QoS)».

**«Perfil no encontrado».** El número de perfil no existe.

## Relacionado

- [Ficha del router: Avanzado](ficha-del-router.md#avanzado)
- [Planes](planes.md)
