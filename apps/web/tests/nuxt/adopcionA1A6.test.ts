import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin, PERMISOS_PENDIENTES } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { permisosDelContrato } from '~~/herramientas/permisosContrato'
import { UApp } from '#components'
import ClienteFormulario from '~/components/ClienteFormulario.vue'
import PlantillaNotificacionModal from '~/components/PlantillaNotificacionModal.vue'
import RolFormulario from '~/components/RolFormulario.vue'
import PaginaCliente from '~/pages/clientes/[id]/index.vue'
import PaginaTokens from '~/pages/usuarios/tokens.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Adopción de lo nuevo de A1 (`Rol.base`, `AlcancesToken`, `tiene_api_ca`, `externo`, campos
 * personalizados en el cliente) y de A6 (catálogo de eventos y vista previa de plantillas), y el
 * catálogo de permisos de los fixtures derivado del contrato.
 */

function conApp(componente: Parameters<typeof h>[0], props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

beforeEach(() => {
    reiniciarFixtures()
    sesionFixture('fixture-admin')
    useUsuarioActual().value = meAdmin
    useEmpresaActiva().elegir(1)
})

afterEach(() => {
    sesionFixture(null)
    useUsuarioActual().value = null
})

describe('permisos de los fixtures desde el contrato', () => {
    it('el catálogo, el rol admin y la sesión del admin salen del enum del OpenAPI', () => {
        const OPENAPI = [resolve(process.cwd(), 'packages/contracts/openapi.json'), resolve(process.cwd(), '../../packages/contracts/openapi.json')].find(ruta => existsSync(ruta)) ?? ''
        const spec = JSON.parse(readFileSync(OPENAPI, 'utf8')) as {
            paths: Record<string, { post: { requestBody: { content: { 'application/json': { schema: { properties: { permisos: { items: { enum: string[] } } } } } } } } }>
        }
        const enumContrato = [...spec.paths['/api/v1/roles']!.post.requestBody.content['application/json'].schema.properties.permisos.items.enum].sort()
        expect(permisosDelContrato(OPENAPI).map(p => p.nombre)).toEqual(enumContrato)
        expect(bd.roles.find(r => r.nombre === 'admin')?.permisos).toEqual(enumContrato)
        // Más los permisos de contratos escritos cuyo código aún no llega al OpenAPI (`PERMISOS_PENDIENTES`).
        expect([...meAdmin.permisos].sort()).toEqual([...enumContrato, ...PERMISOS_PENDIENTES].sort())
        // la descripción es el resumen del endpoint que pide el permiso
        expect(permisosDelContrato(OPENAPI).find(p => p.nombre === 'campos_personalizados.activar')?.descripcion).toBe('Volver a activar un campo personalizado')
        // los demás roles base solo traen permisos que existen
        for (const rol of bd.roles.filter(r => r.base)) {
            expect(rol.permisos.every(p => enumContrato.includes(p))).toBe(true)
        }
    })
})

describe('A1: Rol.base, alcances de token y CA del router', () => {
    it('un rol base no edita permisos (409 rol_base); el formulario lo sabe por Rol.base', async () => {
        const cajero = bd.roles.find(r => r.nombre === 'cajero')
        expect(cajero?.base).toBe(true)
        const intento = await useRoles().editar(cajero?.id ?? 0, { version: 1, permisos: ['pagos.ver'] })
        expect(!intento.ok && [intento.problema.status, intento.problema.type]).toEqual([409, 'urn:argosisp:problema:rol_base'])
        const propio = await useRoles().crear({ nombre: 'auditor', permisos: ['bitacora.ver'] })
        expect(propio.ok && propio.data.base).toBe(false)
        // Un rol con nombre de rol base pero `base: false` no se bloquea: manda el campo, no el nombre.
        const base = await mountSuspended(conApp(RolFormulario, { rol: cajero, catalogo: [], open: true }))
        await esperar(() => expect(document.body.querySelector('[data-prueba="rol-base"]')).not.toBeNull())
        base.unmount()
        const propioVista = await mountSuspended(conApp(RolFormulario, { rol: { ...cajero, base: false }, catalogo: [], open: true }))
        await esperar(() => expect(document.body.textContent).toContain('cajero'))
        expect(document.body.querySelector('[data-prueba="rol-base"]')).toBeNull()
        propioVista.unmount()
    })

    it('tokens: alcances tipados; ausente = sin recorte', async () => {
        const creado = await useTokensApi().crear({ usuario_id: 2, nombre: 'Agente', alcances: { zonas: [1, 2], cajas: [1] } })
        expect(creado.ok && creado.data.datos.alcances).toEqual({ zonas: [1, 2], cajas: [1] })
        const pagina = await mountSuspended(conApp(PaginaTokens))
        await esperar(() => expect(pagina.text()).toContain('Agente de cobranza'))
        expect(pagina.text()).toContain('4 permisos · 1 caja')
        expect(pagina.text()).toContain('Permisos del usuario · 2 zonas · 1 caja')
    })

    it('router: tiene_api_ca, el PEM nunca vuelve', async () => {
        const PEM = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----'
        const editado = await useRouters().editar(1, { version: 1, api_ca: PEM })
        expect(editado.ok && editado.data.tiene_api_ca).toBe(true)
        expect(editado.ok && 'api_ca' in editado.data).toBe(false)
        const quitado = await useRouters().editar(1, { version: 2, api_ca: null })
        expect(quitado.ok && quitado.data.tiene_api_ca).toBe(false)
        expect(quitado.ok && 'api_ca' in quitado.data).toBe(false)
    })
})

describe('campos personalizados en el cliente', () => {
    it('el esquema del formulario valida con el catálogo y el cuerpo conserva lo que no muestra', () => {
        const catalogo = bd.camposPersonalizados.filter(c => c.activo).map(c => (c.clave === 'medio_contacto' ? { ...c, requerido: true } : c))
        const esquema = esquemaClienteCon(catalogo)
        const entrada = { ...entradaDesdeCliente(undefined, catalogo), nombre: 'Ana' }
        const sinValor = esquema.safeParse(entrada)
        expect(!sinValor.success && sinValor.error.issues.map(i => [i.path.join('.'), i.message])).toEqual([['campos_personalizados.medio_contacto', 'Cómo nos conoció es obligatorio']])
        const fechaMala = esquema.safeParse({ ...entrada, campos_personalizados: { ...entrada.campos_personalizados, medio_contacto: 'Vecino', fecha_visita: '2026-02-30' } })
        expect(!fechaMala.success && fechaMala.error.issues[0]?.path.join('.')).toBe('campos_personalizados.fecha_visita')
        const bien = esquema.parse({ ...entrada, campos_personalizados: { ...entrada.campos_personalizados, medio_contacto: 'Vecino', referencia_casa: '  Portón verde ' } })
        expect(cuerpoCliente(bien, { catalogo, guardados: { mikrowisp_id: '1042', numero_poste: 7 } }).campos_personalizados).toEqual({
            mikrowisp_id: '1042',
            numero_poste: 7,
            referencia_casa: 'Portón verde',
            medio_contacto: 'Vecino',
            fecha_visita: null,
            acepta_publicidad: false,
        })
        // Sin catálogo no se manda: la API no reemplaza lo guardado.
        expect(cuerpoCliente(esquemaCliente.parse({ ...entradaDesdeCliente(), nombre: 'Ana' }))).not.toHaveProperty('campos_personalizados')
    })

    it('la API (fixtures) rechaza un valor fuera de la lista con 422 en campos_personalizados.<clave>', async () => {
        const malo = await useClientes().crear({ nombre: 'Ana Prueba', campos_personalizados: { medio_contacto: 'Radio' } }, nuevaClaveIdempotencia())
        expect(!malo.ok && malo.problema.errors?.map(e => e.field)).toEqual(['campos_personalizados.medio_contacto'])
        const bien = await useClientes().crear({ nombre: 'Ana Prueba', campos_personalizados: { medio_contacto: 'Volante', acepta_publicidad: true } }, nuevaClaveIdempotencia())
        expect(bien.ok && bien.data.campos_personalizados).toEqual({ medio_contacto: 'Volante', acepta_publicidad: true })
    })

    it('el formulario pinta un control por campo activo y la ficha los muestra con su etiqueta', async () => {
        const formulario = await mountSuspended(conApp(ClienteFormulario))
        await esperar(() => expect(formulario.find('[data-prueba="campo-cliente-medio_contacto"]').exists()).toBe(true))
        expect(formulario.find('[data-prueba="campo-cliente-numero_poste"]').exists()).toBe(false)
        expect(formulario.find('[data-prueba="cliente-campos-personalizados"]').text()).toContain('Fecha de visita técnica')
        formulario.unmount()

        const cliente = bd.clientes.find(c => c.id === 8)
        if (cliente) {
            cliente.campos_personalizados = { ...cliente.campos_personalizados, medio_contacto: 'Vecino', acepta_publicidad: true, fecha_visita: '2026-10-05', numero_poste: 12 }
        }
        const ficha = await mountSuspended(conApp(PaginaCliente), { route: '/clientes/8' })
        await esperar(() => expect(ficha.find('[data-prueba="dato-campo-medio_contacto"]').exists()).toBe(true))
        expect(ficha.find('[data-prueba="dato-campo-medio_contacto"]').text()).toContain('Cómo nos conoció')
        expect(ficha.find('[data-prueba="dato-campo-acepta_publicidad"]').text()).toContain('Sí')
        expect(ficha.find('[data-prueba="dato-campo-fecha_visita"]').text()).toContain('05/10/2026')
        // inactivo con valor: con su etiqueta, después de los activos
        expect(ficha.find('[data-prueba="dato-campo-numero_poste"]').text()).toContain('Número de poste')
        expect(ficha.text()).not.toContain('mikrowisp_id')
    })

    it('si el catálogo falla, la ficha lo dice con Reintentar', async () => {
        bd.fallas['GET /api/v1/campos-personalizados'] = 500
        const ficha = await mountSuspended(conApp(PaginaCliente), { route: '/clientes/1' })
        await esperar(() => expect(ficha.text()).toContain('Reintentar'))
    })
})

describe('A6: catálogo de eventos y vista previa', () => {
    it('vista previa con los ejemplos del evento; variables desconocidas; Mustache inválido 422', async () => {
        const previa = await usePlantillasNotificacion().vistaPrevia({ evento: 'factura.emitida', canal: 'telegram', asunto: 'Hola {{cliente.nombre}}', cuerpo: 'Total {{factura.total_q}} {{no.existe}}' })
        const evento = bd.eventosNotificacion.find(e => e.evento === 'factura.emitida')
        const nombre = evento?.variables.flatMap(g => g.variables).find(v => v.nombre === 'cliente.nombre')?.ejemplo
        expect(previa.ok && previa.data).toMatchObject({ asunto: `Hola ${nombre}`, variables_desconocidas: ['no.existe'] })
        expect(previa.ok && previa.data.mensaje.startsWith(`Hola ${nombre}\n\nTotal Q`)).toBe(true)
        const malo = await usePlantillasNotificacion().vistaPrevia({ evento: 'factura.emitida', canal: 'correo', cuerpo: '{{#a}}x' })
        expect(!malo.ok && malo.problema.errors?.map(e => e.field)).toEqual(['cuerpo'])
        const eventos = await useEventosNotificacion().listar()
        expect(eventos.ok && eventos.data.find(e => e.evento === 'recordatorio.2')?.nombre).toBe('Recordatorio de pago 2')
    })

    it('el editor muestra las variables del catálogo y la vista previa', async () => {
        const plantilla = bd.plantillasNotificacion.find(p => p.evento === 'factura.emitida' && p.canal === 'correo')
        const evento = bd.eventosNotificacion.find(e => e.evento === 'factura.emitida') ?? null
        const vista = await mountSuspended(conApp(PlantillaNotificacionModal, { plantilla, evento, open: true }))
        await esperar(() => expect(document.body.querySelector('[data-prueba="aviso-variables"]')).not.toBeNull())
        expect(document.body.querySelector('[data-prueba="aviso-variables"]')?.textContent).toContain('factura.total_q')
        document.body.querySelector<HTMLButtonElement>('[data-prueba="aviso-ver-previa"]')?.click()
        await esperar(() => expect(document.body.querySelector('[data-prueba="previa-mensaje"]')).not.toBeNull())
        expect(document.body.querySelector('[data-prueba="previa-mensaje"]')?.textContent).not.toContain('{{')
        vista.unmount()
    })
})
