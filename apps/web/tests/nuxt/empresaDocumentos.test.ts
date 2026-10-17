import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import PaginaAviso from '~/pages/configuracion/aviso-cobro.vue'
import PaginaEmpresa from '~/pages/configuracion/empresa.vue'
import PaginaFactura from '~/pages/facturas/[id].vue'

describe('empresa y plantilla del aviso de cobro', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('el esquema de empresa manda null en los vacíos y valida teléfono y correo', () => {
        const bueno = esquemaEmpresa.safeParse({
            nombre: ' Cable Visión Xela ', nit: '', direccion: '4a calle 12-30, zona 1', telefono: '7765-4321', telefono_alterno: '',
            whatsapp: '+502 5555-1234', correo: '', horario: '', instrucciones_pago: '',
        })
        expect(bueno.success && bueno.data).toMatchObject({ nombre: 'Cable Visión Xela', nit: null, telefono: '7765-4321', correo: null })

        const malo = esquemaEmpresa.safeParse({ ...entradaDesdeEmpresa({ nombre: '', nit: null, direccion: null, telefono: 'abc', telefono_alterno: null, whatsapp: null, correo: 'no-es-correo', horario: null, instrucciones_pago: null, version: 0 }) })
        expect(new Set(malo.error?.issues.map(i => i.path[0]))).toEqual(new Set(['nombre', 'telefono', 'correo']))
    })

    it('marcaVariable inserta {{x}} o una sección {{#x}}{{/x}} con el cursor adentro', () => {
        expect(marcaVariable({ nombre: 'cliente.nombre', descripcion: 'Nombre del cliente' })).toEqual({ texto: '{{cliente.nombre}}', cursor: 18 })
        expect(marcaVariable({ nombre: 'factura.tiene_pagos', descripcion: 'Sección: hay abonos' })).toEqual({ texto: '{{#factura.tiene_pagos}}{{/factura.tiene_pagos}}', cursor: 24 })
        expect(marcaVariable({ nombre: 'lineas', descripcion: 'Lista' }).texto).toBe('{{#lineas}}{{/lineas}}')
    })

    it('empresa: versión 0 al inicio, guarda y responde 409 con la versión vieja', async () => {
        const inicial = await useEmpresa().ver()
        expect(inicial.ok && inicial.data.version).toBe(0)

        const guardada = await useEmpresa().editar({ version: 0, nombre: 'Cable Visión Xela', telefono: '7765-4321' })
        expect(guardada.ok && guardada.data).toMatchObject({ version: 1, telefono: '7765-4321' })

        const vieja = await useEmpresa().editar({ version: 0, nombre: 'Otro' })
        expect(!vieja.ok && vieja.problema.status).toBe(409)
    })

    it('plantilla: 422 con triple bigote o sección sin cerrar, vista previa en PDF y 409 por versión', async () => {
        const triple = await useDocumentos().guardarPlantilla('<p>{{{cliente.nombre}}}</p>', 0)
        expect(!triple.ok && triple.problema.errors?.[0]?.field).toBe('html')

        const abierta = await useDocumentos().vistaPrevia('<p>{{#factura.fel}}FEL</p>')
        expect(!abierta.ok && abierta.problema.status).toBe(422)

        const vista = await useDocumentos().vistaPrevia('<h1>{{empresa.nombre}}</h1>')
        expect(vista.ok && vista.data.type).toBe('application/pdf')

        const guardada = await useDocumentos().guardarPlantilla('<h1>{{empresa.nombre}}</h1>', 0)
        expect(guardada.ok && guardada.data.version).toBe(1)
        const vieja = await useDocumentos().guardarPlantilla('<h1>Otra</h1>', 0)
        expect(!vieja.ok && vieja.problema.status).toBe(409)
    })

    it('el editor lista las variables de la API y las inserta en el HTML', async () => {
        const vista = await mountSuspended(PaginaAviso)
        await vi.waitFor(() => expect(vista.find('[data-variable="cliente.nombre"]').exists()).toBe(true))
        const area = vista.get<HTMLTextAreaElement>('textarea')
        await area.setValue('')
        await vista.get('[data-variable="cliente.nombre"]').trigger('click')
        await vi.waitFor(() => expect(area.element.value).toBe('{{cliente.nombre}}'))
    })

    it('la pantalla de empresa muestra el aviso de versión 0 y carga los datos', async () => {
        const vista = await mountSuspended(PaginaEmpresa)
        await vi.waitFor(() => expect(vista.text()).toContain('Aún no se ha guardado'))
        expect(vista.get<HTMLInputElement>('input').element.value).toBe('ArgosIsp')
    })

    it('la factura tiene el botón "Aviso de cobro (PDF)" y el PDF llega como Blob', async () => {
        const vista = await mountSuspended(PaginaFactura, { route: '/facturas/109' })
        await vi.waitFor(() => expect(vista.find('[data-prueba="aviso-pdf"]').exists()).toBe(true))
        const pdf = await useDocumentos().avisoCobro(109)
        expect(pdf.ok && pdf.data.size).toBeGreaterThan(100)
        const ausente = await useDocumentos().avisoCobro(999999)
        expect(!ausente.ok && ausente.problema.status).toBe(404)
    })
})
