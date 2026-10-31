import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import ClienteFormulario from '~/components/ClienteFormulario.vue'
import ServicioEditar from '~/components/ServicioEditar.vue'
import PaginaServicio from '~/pages/servicios/[id].vue'
import { esperar } from '../ayudas/esperar'

/**
 * Pedidos de Iris A12–A14 (contrato 0.5.0, A1 en `a1/pedidos-iris-a10`): `referencia` del cliente;
 * `referencia`, `contacto_nombre` y `contacto_telefono` del servicio; teléfonos validados con la
 * regla de `apps/api/app/core/telefonos.ts` solo cuando cambian.
 */

function camposConError(resultado: { success: boolean, error?: { issues: { path: PropertyKey[] }[] } }): string[] {
    return resultado.success ? [] : (resultado.error?.issues ?? []).map(i => i.path.join('.'))
}

async function hasta(condicion: () => boolean): Promise<void> {
    for (let i = 0; i < 50 && !condicion(); i++) {
        await flushPromises()
        await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(condicion()).toBe(true)
}

describe('normalizarTelefono (espejo de la API)', () => {
    it.each([
        ['5512-3344', '+502 5512-3344'],
        ['5512 3344', '+502 5512-3344'],
        ['(502) 2233.4455', '+502 2233-4455'],
        ['+502 7712 3344', '+502 7712-3344'],
        ['50255123344', '+502 5512-3344'],
        ['00502 5512 3344', '+502 5512-3344'],
        ['+1 555 123 4567', '+15551234567'],
        ['+52 55 1234 5678', '+525512345678'],
    ])('acepta %s como %s', (valor, normalizado) => {
        expect(normalizarTelefono(valor)).toBe(normalizado)
    })

    it.each([
        ['1512-3344', 'Guatemala empieza en 2–7'],
        ['8512-3344', 'Guatemala empieza en 2–7'],
        ['5512-334', '7 dígitos'],
        ['5512-33445', '9 dígitos sin +'],
        ['+502 8512 3344', '+502 con un local que no empieza en 2–7'],
        ['+502 5512 334', '+502 con 7 dígitos'],
        ['+1234567', 'internacional con 7 dígitos'],
        ['+1 2345 6789 0123 4567', 'internacional con 17 dígitos'],
        ['5512-3344 ext 2', 'letras'],
        ['', 'vacío'],
    ])('rechaza %s (%s)', (valor) => {
        expect(normalizarTelefono(valor)).toBeNull()
    })
})

describe('formulario de cliente · referencia y teléfonos', () => {
    it('referencia hasta 300 caracteres; vacía va como null y llega al cuerpo', () => {
        const base = { ...entradaDesdeCliente(), nombre: 'Rosa Referencia' }
        const salida = esquemaCliente.parse({ ...base, referencia: '  Casa verde frente a la iglesia ' })
        expect(cuerpoCliente(salida)).toMatchObject({ referencia: 'Casa verde frente a la iglesia' })
        expect(esquemaCliente.parse(base).referencia).toBeNull()
        expect(camposConError(esquemaCliente.safeParse({ ...base, referencia: 'x'.repeat(301) }))).toEqual(['referencia'])
    })

    it('teléfono y móvil con la regla de la API y un mensaje con ejemplo', () => {
        const base = { ...entradaDesdeCliente(), nombre: 'Rosa Teléfono' }
        expect(camposConError(esquemaCliente.safeParse({ ...base, telefono: '5512-3344', movil: '+1 555 123 4567' }))).toEqual([])
        const malo = esquemaCliente.safeParse({ ...base, telefono: '1234', movil: '8512 3344' })
        expect(camposConError(malo)).toEqual(['telefono', 'movil'])
        expect(malo.error?.issues[0]?.message).toBe(MENSAJE_TELEFONO)
        expect(MENSAJE_TELEFONO).toContain('5512 3344')
    })

    it('al editar, un teléfono viejo que no cambió no se valida; si cambia, sí', () => {
        const guardado = { telefono: '1234', movil: null }
        const base = { ...entradaDesdeCliente(), nombre: 'Cliente Viejo', telefono: '1234' }
        expect(camposConError(esquemaClienteCon([], guardado).safeParse(base))).toEqual([])
        expect(camposConError(esquemaClienteCon([], guardado).safeParse({ ...base, telefono: ' 1234 ' }))).toEqual([])
        expect(camposConError(esquemaClienteCon([], guardado).safeParse({ ...base, telefono: '12345' }))).toEqual(['telefono'])
        // En un alta no hay valor guardado: se valida siempre.
        expect(camposConError(esquemaCliente.safeParse(base))).toEqual(['telefono'])
    })

    describe('con fixtures', () => {
        beforeEach(() => {
            reiniciarFixtures()
            sesionFixture('fixture-admin')
            useUsuarioActual().value = meAdmin
        })

        afterEach(() => {
            sesionFixture(null)
            useUsuarioActual().value = null
        })

        it('la API guarda la referencia y el teléfono normalizado; un teléfono malo es 422 rule telefono en su campo', async () => {
            const creado = await useClientes().crear({ nombre: 'Lucía Referencia', referencia: 'Casa verde', telefono: '5512 3344' }, nuevaClaveIdempotencia())
            expect(creado.ok && creado.data).toMatchObject({ referencia: 'Casa verde', telefono: '+502 5512-3344' })
            const malo = await useClientes().crear({ nombre: 'Lucía Mala', movil: '123' }, nuevaClaveIdempotencia())
            expect(!malo.ok && malo.problema.errors).toEqual([expect.objectContaining({ field: 'movil', rule: 'telefono' })])
            expect(!malo.ok && erroresDeFormulario(malo.problema).map(e => e.name)).toEqual(['movil'])
        })

        it('reenviar un teléfono viejo inválido sin cambiarlo no falla y no lo toca', async () => {
            const indice = bd.clientes.findIndex(c => c.id === 5)
            const cliente = bd.clientes[indice]!
            bd.clientes[indice] = { ...cliente, telefono: '55-12' }
            const editado = await useClientes().editar(5, { version: cliente.version, telefono: '55-12', referencia: 'Portón negro' })
            expect(editado.ok && editado.data).toMatchObject({ telefono: '55-12', referencia: 'Portón negro' })
        })

        it('el formulario muestra el error de teléfono junto al campo y no envía', async () => {
            const formulario = await mountSuspended(ClienteFormulario)
            await formulario.find('input[name="nombre"]').setValue('Rosa Formulario')
            await formulario.find('input[name="telefono"]').setValue('1234')
            await formulario.find('form').trigger('submit')
            await hasta(() => formulario.text().includes(MENSAJE_TELEFONO))
            expect(formulario.emitted('guardado')).toBeUndefined()
            expect(bd.clientes.some(c => c.nombre === 'Rosa Formulario')).toBe(false)
            formulario.unmount()
        })

        it('alta con referencia desde el formulario', async () => {
            const formulario = await mountSuspended(ClienteFormulario)
            await formulario.find('input[name="nombre"]').setValue('Rosa Con Referencia')
            await formulario.find('textarea[name="referencia"]').setValue('Casa verde frente a la iglesia')
            await formulario.find('input[name="telefono"]').setValue('5512-3344')
            await formulario.find('form').trigger('submit')
            await hasta(() => formulario.emitted('guardado') !== undefined)
            expect(bd.clientes.find(c => c.nombre === 'Rosa Con Referencia')).toMatchObject({ referencia: 'Casa verde frente a la iglesia', telefono: '+502 5512-3344' })
            formulario.unmount()
        })

        it('edición: el 422 rule telefono de la API se muestra junto al campo', async () => {
            // Un cliente con NIT válido (el 5 trae uno por corregir y el formulario no lo enviaría).
            const cliente = bd.clientes.find(c => c.id === 3)!
            const viejo = { ...cliente, telefono: '55-12' }
            const formulario = await mountSuspended(ClienteFormulario, { props: { cliente: viejo } })
            // Mientras el formulario está abierto, el valor guardado ya es otro (misma versión): para la
            // API el teléfono cambia a uno que no cumple.
            await formulario.find('form').trigger('submit')
            await hasta(() => formulario.text().includes('Teléfono inválido'))
            expect(formulario.text()).toContain('Hay datos por corregir')
            expect(formulario.emitted('guardado')).toBeUndefined()
            formulario.unmount()
        })
    })
})

describe('servicio · ubicación y contacto en sitio', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    function entradaAlta(extra: Partial<EntradaServicio> = {}): EntradaServicio {
        return { ...entradaServicioVacia(1), router_id: 1, plan_id: 1, user_ppp: 'ana.contacto1', ...extra }
    }

    it('alta: referencia, contacto y su teléfono van al cuerpo; el teléfono se valida', () => {
        const cuerpo = cuerpoServicio(esquemaServicio.parse(entradaAlta({ referencia: 'Casa verde', contacto_nombre: ' Don Julio ', contacto_telefono: '7712 3344' })))
        expect(cuerpo).toMatchObject({ referencia: 'Casa verde', contacto_nombre: 'Don Julio', contacto_telefono: '7712 3344' })
        expect(cuerpoServicio(esquemaServicio.parse(entradaAlta()))).toMatchObject({ referencia: null, contacto_nombre: null, contacto_telefono: null })
        expect(camposConError(esquemaServicio.safeParse(entradaAlta({ contacto_telefono: '12' })))).toEqual(['contacto_telefono'])
        expect(camposConError(esquemaServicio.safeParse(entradaAlta({ contacto_nombre: 'x'.repeat(201), referencia: 'x'.repeat(301) })))).toEqual(['referencia', 'contacto_nombre'])
    })

    it('edición: solo viaja lo que cambió; el teléfono viejo sin cambios no se valida ni se manda', async () => {
        const indice = bd.servicios.findIndex(s => s.id === 1)
        bd.servicios[indice] = { ...bd.servicios[indice]!, contacto_telefono: '12-34' }
        const servicio = bd.servicios[indice]!
        const entrada = entradaEdicionDesde(servicio)
        expect(entrada).toMatchObject({ referencia: '', contacto_nombre: '', contacto_telefono: '12-34' })
        const esquema = esquemaEdicionServicioPara(servicio)
        const conNombre = esquema.parse({ ...entrada, contacto_nombre: 'Doña Marta', referencia: 'Tienda La Bendición' })
        expect(cambiosServicio(conNombre, servicio)).toEqual({ version: servicio.version, contacto_nombre: 'Doña Marta', referencia: 'Tienda La Bendición' })
        expect(camposConError(esquema.safeParse({ ...entrada, contacto_telefono: '12-345' }))).toEqual(['contacto_telefono'])
        const nuevo = esquema.parse({ ...entrada, contacto_telefono: '+502 5512 3344' })
        expect(cambiosServicio(nuevo, servicio)).toEqual({ version: servicio.version, contacto_telefono: '+502 5512 3344' })
        const borrado = esquema.parse({ ...entrada, contacto_telefono: '' })
        expect(cambiosServicio(borrado, servicio)).toEqual({ version: servicio.version, contacto_telefono: null })

        const guardado = await useServicios().editar(servicio.id, cambiosServicio(nuevo, servicio))
        expect(guardado.ok && guardado.data.contacto_telefono).toBe('+502 5512-3344')
    })

    it('la API de fixtures guarda el contacto en el alta y responde 422 rule telefono', async () => {
        const base = { cliente_id: 4, router_id: 1, plan_id: 1, plantilla_facturacion_id: 1 }
        const creado = await useServicios().crear({ ...base, referencia: 'Casa verde', contacto_nombre: 'Don Julio', contacto_telefono: '5512 3344' }, nuevaClaveIdempotencia())
        expect(creado.ok && creado.data).toMatchObject({ referencia: 'Casa verde', contacto_nombre: 'Don Julio', contacto_telefono: '+502 5512-3344' })
        const malo = await useServicios().crear({ ...base, contacto_telefono: '99' }, nuevaClaveIdempotencia())
        expect(!malo.ok && malo.problema.errors?.map(e => [e.field, e.rule])).toEqual([['contacto_telefono', 'telefono']])
    })

    it('el panel de edición valida el teléfono que cambió y guarda el contacto en sitio', async () => {
        const indice = bd.servicios.findIndex(s => s.id === 1)
        bd.servicios[indice] = { ...bd.servicios[indice]!, contacto_telefono: '12-34' }
        const servicio = bd.servicios[indice]!
        const panel = await mountSuspended(ServicioEditar, { props: { servicio, open: true } })
        await hasta(() => document.body.querySelector('[data-prueba="editar-ubicacion-contacto"]') !== null)
        const escribir = (nombre: string, valor: string) => {
            const campo = document.body.querySelector<HTMLInputElement>(`[name="${nombre}"]`)!
            campo.value = valor
            campo.dispatchEvent(new Event('input'))
        }
        const enviar = () => document.body.querySelector<HTMLFormElement>('#form-editar-servicio')!.requestSubmit()

        escribir('contacto_telefono', '12-345')
        enviar()
        await hasta(() => (document.body.textContent ?? '').includes(MENSAJE_TELEFONO))
        expect(panel.emitted('guardado')).toBeUndefined()

        // El teléfono viejo sin cambios pasa; solo viajan el nombre y la referencia.
        escribir('contacto_telefono', '12-34')
        escribir('contacto_nombre', 'Doña Marta')
        escribir('referencia', 'Tienda La Bendición')
        enviar()
        await hasta(() => panel.emitted('guardado') !== undefined)
        expect(bd.servicios[indice]).toMatchObject({ contacto_nombre: 'Doña Marta', referencia: 'Tienda La Bendición', contacto_telefono: '12-34' })
        panel.unmount()
    })

    it('la ficha agrupa dirección, referencia, coordenadas y contacto en sitio', async () => {
        const indice = bd.servicios.findIndex(s => s.id === 1)
        bd.servicios[indice] = { ...bd.servicios[indice]!, referencia: 'Casa verde frente a la iglesia', contacto_nombre: 'Don Julio', contacto_telefono: '+502 5512-3344' }
        const vista = await mountSuspended(PaginaServicio, { route: '/servicios/1' })
        await esperar(() => expect(vista.find('[data-prueba="ubicacion-contacto-servicio"]').exists()).toBe(true))
        const tarjeta = vista.find('[data-prueba="ubicacion-contacto-servicio"]')
        expect(tarjeta.text()).toContain('Ubicación y contacto en sitio')
        expect(vista.find('[data-prueba="referencia-servicio"]').text()).toContain('Casa verde frente a la iglesia')
        expect(vista.find('[data-prueba="contacto-servicio"]').text()).toContain('Don Julio')
        expect(vista.find('[data-prueba="contacto-servicio"] a').attributes('href')).toBe('tel:+50255123344')
        vista.unmount()
    })
})
