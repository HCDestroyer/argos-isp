import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { fijarComprobanteFixture, fijarEmpresaFixture, fijarSesionFixture } from '~~/fixtures'
import { EMPRESA_FIXTURE } from '~~/fixtures/empresa'
import SubirComprobante from '~/components/comprobante/Subir.vue'
import PaginaCorte from '~/pages/corte.vue'
import PaginaCuenta from '~/pages/cuenta.vue'

const HOY = '2026-10-16'

/** Montados en la prueba: se desmontan antes de la siguiente (comparten `useEmpresa`). */
const montados: { unmount: () => void }[] = []

async function montar(...args: Parameters<typeof mountSuspended>) {
    const wrapper = await mountSuspended(...args)
    montados.push(wrapper)
    return wrapper
}

function archivo(nombre: string, tipo: string, bytes = 1024): File {
    return new File([new Uint8Array(bytes)], nombre, { type: tipo })
}

async function esperar() {
    for (let i = 0; i < 8; i += 1) {
        await flushPromises()
    }
}

/** Una sola cuenta: el formulario la deja elegida y no hay que abrir el `USelect`. */
async function montarModal(props: Record<string, unknown> = {}) {
    fijarEmpresaFixture({ ...EMPRESA_FIXTURE, cuentas_deposito: [EMPRESA_FIXTURE.cuentas_deposito[0]!] })
    clearNuxtData(clave => clave.startsWith('portal:empresa'))
    const wrapper = await montar(SubirComprobante, { props: { open: true, ...props } })
    await esperar()
    return wrapper
}

function texto(): string {
    return document.body.textContent ?? ''
}

function escribir(selector: string, valor: string) {
    const campo = document.querySelector<HTMLInputElement>(selector)!
    campo.value = valor
    campo.dispatchEvent(new Event('input', { bubbles: true }))
}

function adjuntar(elegido: File) {
    const campo = document.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(campo, 'files', { value: [elegido], configurable: true })
    campo.dispatchEvent(new Event('change', { bubbles: true }))
}

async function llenarYEnviar(elegido: File = archivo('boleta.jpg', 'image/jpeg')) {
    escribir('input[inputmode="decimal"]', '275.00')
    escribir('input[autocapitalize="characters"]', '845120377')
    adjuntar(elegido)
    await esperar()
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await esperar()
}

afterEach(() => {
    for (const wrapper of montados.splice(0)) {
        wrapper.unmount()
    }
    fijarComprobanteFixture(null)
    fijarEmpresaFixture(EMPRESA_FIXTURE)
    fijarSesionFixture(false)
    document.body.innerHTML = ''
    window.history.replaceState({}, '', '/')
})

describe('esquema del comprobante', () => {
    const esquema = esquemaComprobante(HOY)
    const valido = {
        metodo: 'deposito' as const,
        cuenta_bancaria_id: 3,
        referencia: '845120377',
        monto: '275.00',
        fecha_deposito: HOY,
        archivo: archivo('boleta.jpg', 'image/jpeg'),
    }
    const mensajes = (datos: Record<string, unknown>) =>
        esquema.safeParse({ ...valido, ...datos }).error?.issues.map(i => `${i.path.join('.')}: ${i.message}`) ?? []

    it('espejo del validador: método, cuenta, referencia, monto, fecha no futura y archivo', () => {
        expect(esquema.safeParse(valido).success).toBe(true)
        expect(esquema.safeParse({ ...valido, archivo: archivo('boleta.pdf', 'application/pdf') }).success).toBe(true)
        expect(mensajes({ fecha_deposito: '2026-10-17' })).toEqual(['fecha_deposito: La fecha del pago no puede ser posterior a hoy: elige hoy o un día anterior'])
        expect(mensajes({ monto: '0' })).toEqual(['monto: Escribe un monto mayor que Q 0.00'])
        expect(mensajes({ monto: 'Q275' })[0]).toContain('sin la Q')
        expect(mensajes({ referencia: '  ' })).toEqual(['referencia: Escribe el número de referencia o de boleta'])
        expect(mensajes({ cuenta_bancaria_id: undefined })).toEqual(['cuenta_bancaria_id: Elige la cuenta a la que depositaste'])
        expect(mensajes({ archivo: undefined })).toEqual(['archivo: Adjunta la foto o el PDF del comprobante'])
    })

    it('archivo: solo foto o PDF y hasta 5 MB', () => {
        expect(mensajes({ archivo: archivo('boleta.heic', 'image/heic') })).toEqual([
            'archivo: Sube una foto (JPG, PNG o WebP) o un PDF del comprobante.',
        ])
        expect(mensajes({ archivo: archivo('boleta.pdf', 'application/pdf', TAMANO_MAXIMO_ARCHIVO + 1) })).toEqual([
            'archivo: El archivo pesa 5.0 MB; el máximo es 5 MB.',
        ])
        expect(tamanoLegible(2_516_582)).toBe('2.4 MB')
        expect(tamanoLegible(830 * 1024)).toBe('830 KB')
    })

    it('banco de origen: obligatorio en transferencia y ACH, nunca se envía en depósito', () => {
        expect(mensajes({ metodo: 'transferencia' })).toEqual(['banco_origen_id: Elige el banco desde el que transferiste'])
        expect(mensajes({ metodo: 'ach', banco_origen_id: 2 })).toEqual([])
        expect(mensajes({ metodo: 'remesa' })).toEqual([])

        const datos = esquema.parse({ ...valido, banco_origen_id: 2 })
        expect(camposComprobante(datos)).toEqual({
            metodo: 'deposito',
            cuenta_bancaria_id: 3,
            referencia: '845120377',
            monto: '275.00',
            fecha_deposito: HOY,
        })
        expect(camposComprobante({ ...datos, metodo: 'transferencia' }, 41)).toMatchObject({
            banco_origen_id: 2,
            servicio_id: 41,
        })
    })

    it('fecha de hoy en Guatemala, no en UTC', () => {
        // 16/10 a las 23:30 en Guatemala ya es 17/10 en UTC
        expect(hoyGuatemala(new Date('2026-10-17T05:30:00Z'))).toBe('2026-10-16')
    })
})

describe('modal "Subir comprobante de pago"', () => {
    it('cámara y galería: acepta foto o PDF y la cámara se pide solo con "Tomar foto"', async () => {
        await montarModal()
        const selector = document.querySelector<HTMLInputElement>('input[type="file"]')!
        expect(selector.accept).toBe('image/*,application/pdf')
        expect(selector.hasAttribute('capture')).toBe(false)
        // happy-dom no tiene diálogo de archivos: basta saber que se abrió
        let abierto = 0
        selector.click = () => {
            abierto += 1
        }
        const camara = document.querySelector<HTMLElement>('[data-testid="comprobante-camara"]')!
        camara.click()
        await esperar()
        expect(selector.getAttribute('capture')).toBe('environment')
        expect(abierto).toBe(1)
    })

    it('vista previa del archivo elegido, con nombre y tamaño', async () => {
        await montarModal()
        adjuntar(archivo('boleta.pdf', 'application/pdf', 2 * 1024 * 1024))
        await esperar()
        const vista = document.querySelector('[data-testid="comprobante-vista-previa"]')!.textContent ?? ''
        expect(vista).toContain('boleta.pdf')
        expect(vista).toContain('2.0 MB')
    })

    it('recibido: "Recibimos tu comprobante, lo revisaremos" con el resumen', async () => {
        const wrapper = await montarModal()
        await llenarYEnviar()
        const emitido = wrapper.emitted('enviado')?.[0]?.[0] as ComprobantePortal
        expect(emitido).toMatchObject({ estado: 'pendiente', monto: '275.00', referencia: '845120377' })
        const recibido = document.querySelector('[data-testid="comprobante-enviado"]')!.textContent ?? ''
        expect(recibido).toContain('Recibimos tu comprobante, lo revisaremos')
        expect(recibido).toContain('Q 275.00')
        expect(recibido).toContain('Banco Industrial · Monetaria Red Altiplano')
    })

    it('409 referencia duplicada: el mensaje va en el campo referencia', async () => {
        fijarComprobanteFixture('duplicada')
        const wrapper = await montarModal()
        await llenarYEnviar()
        expect(wrapper.emitted('enviado')).toBeUndefined()
        expect(texto()).toContain('Ya recibimos un pago o comprobante con esa referencia')
        expect(document.querySelector('[data-testid="comprobante-enviado"]')).toBeNull()
    })

    it('422 de la API en el archivo: se muestra en su campo', async () => {
        fijarComprobanteFixture('archivo')
        await montarModal()
        await llenarYEnviar()
        expect(texto()).toContain('Sube una foto (JPG, PNG o WebP) o un PDF del comprobante.')
    })

    it('422 cuenta de otra empresa: lo explica arriba, marca la cuenta y no se envía', async () => {
        fijarComprobanteFixture('otra_empresa')
        const wrapper = await montarModal()
        await llenarYEnviar()
        expect(wrapper.emitted('enviado')).toBeUndefined()
        const aviso = document.querySelector('[data-testid="comprobante-error-envio"]')?.textContent ?? ''
        expect(aviso).toContain('Esa cuenta es de otra empresa, no de la que te factura este servicio')
        expect(texto()).toContain('Elige una de las cuentas de tu servicio.')
        expect(document.querySelector('[data-testid="comprobante-enviado"]')).toBeNull()
    })

    it('archivo no permitido: no se envía', async () => {
        const wrapper = await montarModal()
        await llenarYEnviar(archivo('boleta.heic', 'image/heic'))
        expect(wrapper.emitted('enviado')).toBeUndefined()
        expect(texto()).toContain('Sube una foto (JPG, PNG o WebP) o un PDF del comprobante.')
    })

    it('cuentas de destino con el número completo a la vista (nada truncado en el teléfono)', async () => {
        clearNuxtData(clave => clave.startsWith('portal:empresa'))
        await montar(SubirComprobante, { props: { open: true } })
        await esperar()
        const cuentas = document.querySelector('[data-testid="comprobante-cuentas"]')!.textContent ?? ''
        expect(cuentas).toContain('Banco Industrial · Monetaria Red Altiplano')
        expect(cuentas).toContain('123-456789-0')
        expect(cuentas).toContain('Banrural · Ahorro Red Altiplano')
        expect(cuentas).toContain('3-033-12345-6')
    })

    it('sin cuentas para depósito: lo dice y no muestra el formulario', async () => {
        fijarEmpresaFixture({ ...EMPRESA_FIXTURE, cuentas_deposito: [] })
        clearNuxtData(clave => clave.startsWith('portal:empresa'))
        await montar(SubirComprobante, { props: { open: true } })
        await esperar()
        expect(document.querySelector('[data-testid="comprobante-sin-cuentas"]')).not.toBeNull()
        expect(document.querySelector('form')).toBeNull()
    })
})

describe('comprobantes en /corte y /cuenta', () => {
    it('/corte: el botón "Subir comprobante de pago" está habilitado', async () => {
        window.history.replaceState({}, '', '/corte')
        clearNuxtData('portal:quien-soy')
        clearNuxtData(clave => clave.startsWith('portal:empresa'))
        const wrapper = await montar(PaginaCorte)
        await esperar()
        const boton = wrapper.find('[data-testid="subir-comprobante"]')
        expect(boton.exists()).toBe(true)
        expect(boton.attributes('disabled')).toBeUndefined()
        expect(wrapper.text()).not.toContain('estará disponible pronto')
    })

    it('/cuenta: lista con estado y el motivo del rechazo', async () => {
        fijarSesionFixture(true)
        clearNuxtData('portal:cuenta')
        const wrapper = await montar(PaginaCuenta, { route: '/cuenta?seccion=pagar' })
        await esperar()
        await esperar()
        const tarjetas = wrapper.findAll('[data-testid="comprobante"]')
        expect(tarjetas).toHaveLength(3)
        expect(tarjetas[0]!.text()).toContain('En revisión')
        expect(tarjetas[1]!.text()).toContain('Rechazado')
        expect(tarjetas[1]!.find('[data-testid="comprobante-motivo"]').text()).toContain('La foto no deja leer la referencia')
        expect(tarjetas[2]!.text()).toContain('Aprobado')
    })
})
