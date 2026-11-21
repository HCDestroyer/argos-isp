---
orden: 4
pantallas:
    - /anuncios
    - /anuncios/[id]#ficha-del-anuncio
---

# Anuncios del portal

Promociones de la empresa que ven tus clientes en el **inicio del portal** y en la **página de corte** (la que ve un cliente suspendido al navegar). Un anuncio solo se ve publicado, dentro de sus fechas y para los clientes de su audiencia. Si no hay ninguno publicado, el portal y la página de corte se ven como siempre.

![Lista de anuncios con su estado, audiencia, vigencia y orden](/capturas/general/anuncios.png)

## Quién la usa

- **Ver** la lista, la ficha y las métricas: `anuncios.ver` (roles `admin` y `lectura`).
- **Crear, editar, cambiar la imagen, publicar y archivar:** `anuncios.administrar` (solo `admin`).

## Lista de anuncios

Menú **Clientes y lealtad → Anuncios**.

| Columna       | Qué dice                                                                                                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anuncio**   | Título (con un icono de imagen si tiene), el inicio del texto y dónde se ve: «Inicio del portal», «Página de corte» o los dos                                                                                              |
| **Estado**    | **Borrador** (gris), **Publicado** (verde) o **Archivado** (gris). Debajo, «Se ve ahora» si está publicado y en fechas, o por qué no se ve («Publicado: empieza a verse el …», «Publicado pero vencido el …: ya no se ve») |
| **Audiencia** | A quién se le muestra (abajo)                                                                                                                                                                                              |
| **Empresa**   | Solo si trabajas con varias empresas                                                                                                                                                                                       |
| **Vigencia**  | Desde y hasta cuándo, en hora de Guatemala                                                                                                                                                                                 |
| **Orden**     | El de número mayor sale primero                                                                                                                                                                                            |

Filtra por estado con el selector de arriba.

### Audiencias

| Audiencia                   | A quién                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| **Todos**                   | Todos los clientes con servicio en la empresa                            |
| **Suspendidos o limitados** | Clientes con algún servicio suspendido o limitado                        |
| **Al día**                  | Sin servicios suspendidos ni limitados y sin facturas vencidas con saldo |
| **Con puntos**              | Clientes con saldo de puntos de lealtad en la empresa                    |

## Ficha del anuncio

Al tocar un anuncio se abre su ficha con:

- El título, su estado y «Se ve ahora» si está visible en este momento. Debajo, «Anuncio #N · versión N».
- **Datos:** audiencia, dónde se ve, vigencia, orden, botón (texto y dirección), imagen (medidas y texto alternativo) y las fechas en que se publicó o archivó.
- **Vista previa** de cómo se ve en el teléfono del cliente.
- **Métricas:** **Vistas** (visitantes distintos que lo vieron), **Clics** (visitantes distintos que tocaron el botón) y **Tasa de clics**, por lugar y por día de los últimos 30 días. Una vista cuenta cuando la tarjeta queda al menos a la mitad en la pantalla del cliente. Las métricas no guardan quién es el cliente.

## Acciones

### Crear un anuncio

- **Permiso:** `anuncios.administrar`
- **Dónde:** botón «Nuevo anuncio» en la lista.
- **Campos:**
    - **Título** (obligatorio, hasta 80 caracteres) y **Texto** (hasta 500). Solo texto: no se puede poner formato ni HTML.
    - **Texto del botón** (hasta 40) y **Dirección del botón**: van juntos o ninguno. La dirección empieza con `https://` o `http://`, o es una página del portal que empieza con `/` (por ejemplo `/cuenta`).
    - **Desde** y **Hasta** (hora de Guatemala), opcionales. Sin «Desde», se ve desde que se publica; sin «Hasta», no vence. «Hasta» debe ser después de «Desde».
    - **Audiencia**, **Orden** (de −1000 a 1000) y **Dónde se ve** (al menos un lugar).
- **Qué pasa:** se crea en **Borrador**: todavía no lo ve nadie. Te lleva a su ficha para agregar la imagen y publicarlo.
- Si trabajas con varias empresas, el anuncio es de la empresa elegida arriba. Con «Todas las empresas» el botón se desactiva y aparece «Elige una empresa para crear anuncios».

### Editar

- **Permiso:** `anuncios.administrar`
- **Dónde:** botón «Editar» en la ficha.
- **Qué pasa:** guarda solo lo que cambiaste. Un anuncio **archivado no se edita**: primero publícalo de nuevo.

### Agregar o cambiar la imagen

- **Permiso:** `anuncios.administrar`
- **Dónde:** botón «Agregar imagen» o «Cambiar imagen» en la ficha.
- **Reglas:** PNG, JPEG o WebP de hasta 1 MB; cada lado entre 64 y 4096 px. Recomendado: 1200×600 px. El **Texto alternativo** es obligatorio (hasta 200 caracteres): describe la imagen para quien no la puede ver.
- «Quitar imagen» la quita.

### Publicar

- **Permiso:** `anuncios.administrar`
- **Dónde:** botón «Publicar» en la ficha (no aparece si ya está publicado).
- **Qué pasa:** la ventana te dice dónde y para quién se verá. Al confirmar, aparece en el portal dentro de su vigencia. Sirve también para volver a publicar uno archivado.

### Archivar

- **Permiso:** `anuncios.administrar`
- **Dónde:** botón «Archivar» en la ficha.
- **Qué pasa:** deja de verse en el portal y ya no se edita. Sus métricas se conservan. Se puede deshacer publicándolo de nuevo.

Todo queda en la [bitácora](./bitacora.md) con lo que cambió.

## Cómo lo ve el cliente

- En la **página de corte**, debajo de pagar, de los accesos (comprobante, prometer pago, depósito) y del estado del servicio. Nunca tapa lo demás.
- En el **inicio del portal**, al final, después de sus servicios.
- Con varios anuncios se muestran en un carrusel que avanza solo cada 8 segundos y se puede pausar.

## Preguntas frecuentes y errores

- **«El anuncio ya venció».** Intentaste publicar uno cuya fecha «Hasta» ya pasó. Cambia o quita esa fecha y publícalo.
- **«El anuncio está archivado».** No se edita archivado: publícalo de nuevo.
- **«Elige la empresa del anuncio».** Tienes «Todas las empresas» en el selector de arriba: elige una.
- **«Publicado pero fuera de su vigencia».** Está publicado, pero hoy no está dentro de sus fechas.
- **Un cliente no lo ve.** Revisa la audiencia (por ejemplo, «Al día» no se muestra a quien tiene facturas vencidas) y los lugares. El portal solo muestra anuncios de las empresas donde el cliente tiene servicios.
- **Conflicto de versión.** Otra persona lo cambió mientras lo editabas. Recarga la ficha y vuelve a hacer el cambio.

## Relacionado

- [Portal del cliente](../portal/)
- [Bitácora](./bitacora.md)
