/*
|--------------------------------------------------------------------------
| Contactos del cliente (A1): contrato Iris 0.10.0 §3.5 (A42) y 0.10.1 §3.8 (A46)
|--------------------------------------------------------------------------
|
| Solo validan, comprueban alcance y llaman acciones. Con el token de Iris exigen `X-Iris-Actor`
| (`exigirActorIris`); gestionar nunca con el asistente (`403 actor_ia_no_permitido`).
|
*/
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import { exigirCliente } from '#core/acceso_empresa'
import { esTokenIris, exigirActorIris } from '#integraciones/iris/atencion'
import { claveLimite, exigirBajoLimite } from '#core/limite_ventana'
import { listarContactosACargo, listarContactosCliente, verContacto } from '#core/contactos'
import { ContactoCliente, ContactoEncontrado } from '#core/esquemas_contactos'
import * as vc from '#core/validators_contactos'
import BuscarContactos from '#core/actions/buscar_contactos'
import CrearContactoCliente from '#core/actions/crear_contacto_cliente'
import EditarContactoCliente from '#core/actions/editar_contacto_cliente'
import QuitarContactoCliente from '#core/actions/quitar_contacto_cliente'

function entero(nombre: string, defecto: number): number {
    const valor = Number(process.env[nombre])
    return Number.isInteger(valor) && valor >= 1 ? valor : defecto
}

/**
 * Límites de §3.5: 60 búsquedas por minuto por token y 20 por actor de Iris (`X-Iris-Actor`).
 * `CONTACTOS_LIMITE_TOKEN` y `CONTACTOS_LIMITE_ACTOR` los cambian (pruebas y `.env.example`).
 */
async function limitarBusqueda(ctx: HttpContext) {
    const origen = exigirActorIris(ctx)
    const usuario = ctx.auth.user!
    const tokenId = ctx.auth.authenticatedViaGuard === 'tokens' ? ctx.auth.use('tokens').token?.id : null
    const limites = [
        {
            clave: claveLimite('contactos', 'token', String(tokenId ?? `u${usuario.id}`)),
            tope: entero('CONTACTOS_LIMITE_TOKEN', 60),
            ventanaS: 60,
        },
    ]
    if (origen) {
        limites.push({
            clave: claveLimite('contactos', 'actor', origen.actor),
            tope: entero('CONTACTOS_LIMITE_ACTOR', 20),
            ventanaS: 60,
        })
    }
    await exigirBajoLimite(
        limites,
        {
            codigo: 'demasiadas_busquedas',
            titulo: 'Demasiadas búsquedas',
            detalle:
                'Se pasó el límite de búsquedas de contactos por minuto; intenta de nuevo después de Retry-After',
        },
        ctx,
    )
}

/** Con el token de Iris: `X-Iris-Actor` obligatoria y nunca el asistente de IA. */
function gestionDesdeIris(ctx: HttpContext): boolean {
    exigirActorIris(ctx, { sinAsistente: true })
    return esTokenIris(ctx)
}

const contactos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/contactos/buscar',
        operacion: 'contactosBuscar',
        resumen: 'De quién es un número de teléfono (contrato Iris 0.10.0 §3.5)',
        descripcion:
            '`telefono` en E.164. Una fila por cliente y contacto: el titular (el número es su `telefono` o `movil`; ' +
            '`adicional: true` si es uno de sus números adicionales, que Iris trata como no verificado) o un ' +
            'contacto (`a_cargo: true`). Solo clientes dentro del alcance de empresas. Nunca devuelve otros números ' +
            'ni documentos. Con el token de Iris exige `X-Iris-Actor`. Límite: 60 por minuto por token y 20 por ' +
            'actor (`429 demasiadas_busquedas` con `Retry-After`). Cada búsqueda queda auditada con el número ' +
            'enmascarado.',
        etiqueta: 'clientes',
        permiso: 'contactos.buscar',
        query: vc.buscarContactosValidator,
        limitada: true,
        antes: limitarBusqueda,
        respuesta: { status: 200, descripcion: 'Coincidencias', esquema: lista(ContactoEncontrado) },
        handler: (ctx, { query }) =>
            new BuscarContactos().execute(
                { telefono: query.telefono, empresas: ctx.empresa?.permitidas ?? null },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/clientes/:id/contactos',
        operacion: 'clientesContactos',
        resumen: 'Contactos del cliente con sus teléfonos (el titular primero)',
        descripcion:
            'Lo que la ficha muestra como «A cargo de sus servicios». Del titular, sus números registrados son ' +
            '`telefono` y `movil` del cliente; en `telefonos` lleva solo los adicionales. Con el token de Iris exige ' +
            '`X-Iris-Actor` y tiene los límites de `GET /contactos/buscar`.',
        etiqueta: 'clientes',
        permiso: 'contactos.buscar',
        // Iris 0.14.2 §7.1: su caché de contactos se refresca con `X-Iris-Actor: sistema`
        actorSistemaIris: true,
        limitada: true,
        antes: limitarBusqueda,
        respuesta: { status: 200, descripcion: 'Contactos', esquema: pagina(ContactoCliente) },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            return { data: await listarContactosCliente(id), nextCursor: null }
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/clientes/:id/a-cargo',
        operacion: 'clientesACargo',
        resumen: 'Servicios de otros clientes que esta persona tiene a cargo (contrato Iris 0.10.1 §3.8)',
        descripcion:
            '«Está a cargo de»: los contactos de otros clientes vinculados a este (`persona_cliente_id`). Con el ' +
            'token de Iris exige `X-Iris-Actor` y tiene los límites de `GET /contactos/buscar`.',
        etiqueta: 'clientes',
        permiso: 'contactos.buscar',
        limitada: true,
        antes: limitarBusqueda,
        respuesta: { status: 200, descripcion: 'Contactos', esquema: pagina(ContactoCliente) },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            const permitidas = ctx.empresa?.permitidas ?? null
            const filas = await listarContactosACargo(id)
            return {
                data: filas.filter(
                    (c) => permitidas === null || c.empresa_id === null || permitidas.includes(c.empresa_id),
                ),
                nextCursor: null,
            }
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/clientes/:id/contactos',
        operacion: 'clientesCrearContacto',
        resumen: 'Crear un contacto del cliente',
        descripcion:
            'Con relación, servicios (null = todos), permisos (todos encendidos por defecto) y números E.164 (uno ' +
            'principal). `relacion: titular` → `422 contacto_titular_no_permitido`. Con el token de Iris: ' +
            '`X-Iris-Actor` obligatoria y nunca `asistente_ia` (`403 actor_ia_no_permitido`). Emite ' +
            '`cliente.contactos_cambiados` (sin números). `Idempotency-Key` obligatoria.',
        etiqueta: 'clientes',
        permiso: 'contactos.gestionar',
        cuerpo: vc.crearContactoValidator,
        idempotente: 'obligatoria',
        respuesta: { status: 201, descripcion: 'Contacto creado', esquema: ContactoCliente },
        handler: async (ctx, { cuerpo, params }) => {
            const desdeIris = gestionDesdeIris(ctx)
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            return new CrearContactoCliente().execute(
                { ...cuerpo, cliente_id: id, desdeIris },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/contactos/:id',
        operacion: 'contactosEditar',
        resumen: 'Editar un contacto del cliente',
        descripcion:
            'Con `version` (`409 conflicto_version`). Desde Iris, cualquier `PUT` sobre el contacto titular responde ' +
            '`422 contacto_titular_no_permitido`. Cambiar los números revalida el vínculo `persona_cliente_id`. ' +
            '`Idempotency-Key` obligatoria.',
        etiqueta: 'clientes',
        permiso: 'contactos.gestionar',
        cuerpo: vc.editarContactoValidator,
        idempotente: 'obligatoria',
        versionada: true,
        respuesta: { status: 200, descripcion: 'Contacto actualizado', esquema: ContactoCliente },
        handler: async (ctx, { cuerpo, params }) => {
            const desdeIris = gestionDesdeIris(ctx)
            const id = Number(params.id)
            const contacto = await verContacto(id)
            await exigirCliente(ctx, contacto.cliente_id)
            return new EditarContactoCliente().execute({ ...cuerpo, id, desdeIris }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'delete',
        ruta: '/contactos/:id',
        operacion: 'contactosQuitar',
        resumen: 'Quitar un contacto del cliente',
        descripcion:
            'Con `version`. El titular no se quita (`422 contacto_titular`; desde Iris, ' +
            '`422 contacto_titular_no_permitido`). Rompe su vínculo `persona_cliente_id`. `Idempotency-Key` obligatoria.',
        etiqueta: 'clientes',
        permiso: 'contactos.gestionar',
        cuerpo: vc.quitarContactoValidator,
        idempotente: 'obligatoria',
        versionada: true,
        respuesta: { status: 200, descripcion: 'Contacto quitado', esquema: ContactoCliente },
        handler: async (ctx, { cuerpo, params }) => {
            const desdeIris = gestionDesdeIris(ctx)
            const id = Number(params.id)
            const contacto = await verContacto(id)
            await exigirCliente(ctx, contacto.cliente_id)
            return new QuitarContactoCliente().execute(
                { id, version: cuerpo.version, desdeIris },
                ctx.contextoAccion(),
            )
        },
    }),
]

export default contactos
