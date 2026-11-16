---
orden: 6
---

# Ayudar a un cliente a entrar al portal

Al terminar, el cliente puede entrar a su portal: le llega un código a su correo o a su Telegram.

El portal no usa contraseña. El cliente escribe su **NIT, CUI o usuario de conexión (PPPoE)** y ArgosIsp le manda un **código de 6 dígitos** a su correo o Telegram **registrado**. Desde el panel no hay un botón para enviarle el acceso: lo que haces en soporte es dejar bien sus datos de contacto.

## Antes de empezar

- Permisos: `clientes.ver`; para corregir datos, `clientes.editar`; para Telegram, `clientes.vincular_telegram` (todos en el rol `soporte`).

## Pasos

1. [Busca al cliente](./buscar-cliente.md) y abre su ficha en **Datos**.
2. Revisa el **Correo** y el **Telegram**:
    - Si el correo está mal o vacío, toca «Editar», corrígelo y guarda.
    - Si prefiere Telegram, toca «Vincular» junto a **Telegram** y sigue los pasos en pantalla.
3. Revisa el **Canal preferido**: el código va por Telegram si es su canal preferido y está vinculado; si no, por correo; si no tiene correo, por Telegram.
4. Dile al cliente que entre al portal, escriba su NIT, CUI o usuario PPPoE y pida el código.
5. Si está cortado, también puede entrar desde la página de corte, que lo reconoce por su conexión.

## Qué pasa después

- El código llega solo al correo o Telegram que tiene registrado; nunca a otro que alguien escriba en el momento.
- Al escribir el código, el cliente entra a su portal: ve sus facturas, paga, sube comprobantes y puede prometer pagar.

## Si algo sale mal

| Situación                                        | Causa                                                                              | Qué hacer                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| «No tienes un correo ni un Telegram registrado…» | El cliente no tiene ningún destino                                                 | Agrega su correo o vincula su Telegram                                                   |
| No le llega el código                            | Correo mal escrito, el correo cayó en spam, o pidió demasiados códigos en una hora | Revisa el correo registrado, que busque en spam y que espere un rato antes de pedir otro |
| Le dice que lo intente más tarde                 | Pidió muchos códigos seguidos                                                      | Que espere y vuelva a pedirlo                                                            |

## Relacionado

- [Manual del portal](../../manual/portal/)
- [Manual de clientes y servicios](../../manual/clientes-y-servicios/)
