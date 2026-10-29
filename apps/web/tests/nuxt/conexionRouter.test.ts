import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import RouterClaveModal from '~/components/RouterClaveModal.vue'
import RouterConexionSeccion from '~/components/RouterConexionSeccion.vue'
import RouterPruebaConexionModal from '~/components/RouterPruebaConexionModal.vue'
import RouterScriptModal from '~/components/RouterScriptModal.vue'
import { esperar } from '../ayudas/esperar'

/** Conexión del router por WireGuard (`contratos/conexion-routers.md`): probar, script, clave, rotar. */
describe('conexión del router', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    const router = (id: number) => structuredClone(bd.routers.find(r => r.id === id)!)
    const cuerpo = () => document.body

    function escribir(selector: string, valor: string) {
        const campo = cuerpo().querySelector<HTMLInputElement>(`${selector} input, input${selector}`)
        expect(campo, selector).not.toBeNull()
        campo!.value = valor
        campo!.dispatchEvent(new Event('input', { bubbles: true }))
    }

    function pulsar(selector: string) {
        const boton = cuerpo().querySelector<HTMLElement>(selector)
        expect(boton, selector).not.toBeNull()
        boton!.click()
    }

    it('probar conexión: cada chequeo con su estado, los datos del equipo y RADIUS sin verificar como neutral', async () => {
        const vista = await mountSuspended(RouterPruebaConexionModal, { props: { router: router(1), open: false } })
        await vista.setProps({ open: true })
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="prueba-resumen"]')).not.toBeNull())
        expect(cuerpo().querySelector('[data-prueba="prueba-resumen"]')?.textContent).toContain('Todo en orden')
        const equipo = cuerpo().querySelector('[data-prueba="prueba-equipo"]')?.textContent ?? ''
        expect(equipo).toContain('7.24.5 (stable)')
        expect(equipo).toContain('RB5009UG+S+')
        expect(equipo).toContain('12d4h31m')
        expect(equipo).toContain('7 %')
        const radius = cuerpo().querySelector('[data-chequeo="radius"]')?.textContent ?? ''
        expect(radius).toContain('Responde · secreto no verificado')
        expect(radius).not.toContain('Falla')
        expect(vista.emitted('probado')).toHaveLength(1)
    })

    it('probar conexión: si la API no responde dice qué revisar y lo demás queda «no se pudo comprobar»', async () => {
        const vista = await mountSuspended(RouterPruebaConexionModal, { props: { router: router(2), open: false } })
        await vista.setProps({ open: true })
        await esperar(() => expect(cuerpo().querySelector('[data-chequeo="api"]')).not.toBeNull())
        const api = cuerpo().querySelector('[data-chequeo="api"]')?.textContent ?? ''
        expect(api).toContain('Falla')
        expect(api).toContain('Qué revisar: El router no responde')
        expect(cuerpo().querySelector('[data-chequeo="equipo"]')?.textContent).toContain('No se pudo comprobar')
        expect(cuerpo().querySelector('[data-prueba="prueba-resumen"]')?.textContent).toMatch(/chequeos? fall/)
    })

    it('reconciliar: 202 encolado y, si ya hay una en curso, encolado false', async () => {
        const primera = await useRouters().reconciliar(1)
        expect(primera.ok && primera.data).toMatchObject({ router_id: 1, encolado: true })
        const segunda = await useRouters().reconciliar(1)
        expect(segunda.ok && segunda.data.encolado).toBe(false)
    })

    it('sección Conexión: estado del túnel y los botones según el permiso exacto', async () => {
        const conectado = await mountSuspended(RouterConexionSeccion, { props: { router: router(1) } })
        await esperar(() => expect(conectado.find('[data-prueba="estado-tunel"]').exists()).toBe(true))
        expect(conectado.get('[data-prueba="estado-tunel"]').text()).toBe('Conectado')
        expect(conectado.text()).toContain('10.255.0.2')
        expect(conectado.find('[data-prueba="abrir-rotar"]').exists()).toBe(true)
        conectado.unmount()

        const nuevo = await mountSuspended(RouterConexionSeccion, { props: { router: router(3) } })
        await esperar(() => expect(nuevo.find('[data-prueba="estado-tunel"]').exists()).toBe(true))
        expect(nuevo.get('[data-prueba="estado-tunel"]').text()).toBe('Sin configurar')
        expect(nuevo.find('[data-prueba="abrir-script"]').exists()).toBe(true)
        expect(nuevo.find('[data-prueba="abrir-clave"]').exists()).toBe(false)
        nuevo.unmount()

        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => !['routers.generar_script', 'routers.rotar_conexion', 'routers.conexion_clave'].includes(p)) }
        const lectura = await mountSuspended(RouterConexionSeccion, { props: { router: router(1) } })
        await esperar(() => expect(lectura.find('[data-prueba="estado-tunel"]').exists()).toBe(true))
        expect(lectura.find('[data-prueba="abrir-script"]').exists()).toBe(false)
        expect(lectura.find('[data-prueba="abrir-rotar"]').exists()).toBe(false)
        expect(lectura.find('[data-prueba="abrir-clave"]').exists()).toBe(false)
    })

    it('script de conexión: genera, deja descargar o copiar y muestra los pasos; avisa que lleva claves', async () => {
        const vista = await mountSuspended(RouterScriptModal, { props: { router: router(1), open: false } })
        await vista.setProps({ open: true })
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="script-conexion"]')).not.toBeNull())
        expect(cuerpo().querySelector('[data-prueba="script-conexion"]')?.textContent).toContain('El script lleva claves')
        escribir('[data-prueba="script-admin"]', '190.56.10.20, 10.10.0.0/24')
        pulsar('[data-prueba="script-generar"]')
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="script-listo"]')).not.toBeNull())
        expect(cuerpo().querySelector<HTMLTextAreaElement>('[data-prueba="script-texto"] textarea, textarea[data-prueba="script-texto"]')?.value).toContain('argosisp: listo')
        expect(cuerpo().querySelector('[data-prueba="script-pasos"]')?.textContent).toContain('New Terminal')
        expect(cuerpo().querySelector('[data-prueba="script-descargar"]')).not.toBeNull()
        expect(vista.emitted('generado')).toHaveLength(1)
        // Al cerrar, el script no queda en memoria.
        await vista.setProps({ open: false })
        await flushPromises()
        await vista.setProps({ open: true })
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="script-generar"]')).not.toBeNull())
        expect(cuerpo().querySelector('[data-prueba="script-listo"]')).toBeNull()
    })

    it('script de conexión: sin secreto RADIUS y con servicio incompleto lo explica con la lista', async () => {
        const sinSecreto = await mountSuspended(RouterScriptModal, { props: { router: router(3), open: false } })
        await sinSecreto.setProps({ open: true })
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="script-generar"]')).not.toBeNull())
        pulsar('[data-prueba="script-generar"]')
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="problema-pools"]')?.textContent).toContain('Falta el secreto RADIUS del router'))
        sinSecreto.unmount()

        const incompleto = await useRouters().scriptConexion(2, { incluir: 'servicio' })
        expect(!incompleto.ok && codigoProblema(incompleto.problema)).toBe('servicio_incompleto')
        expect(!incompleto.ok && incompleto.problema.errors?.map(e => e.message)).toContain('ROUTERS_SERVICIO_POOL_PPPOE')
        const malaIp = await useRouters().scriptConexion(1, { admin: '999.1.1.1' })
        expect(!malaIp.ok && malaIp.problema.errors?.[0]?.field).toBe('admin')
    })

    it('rotar pide confirmación y deja el router pendiente con un script nuevo', async () => {
        const vista = await mountSuspended(RouterScriptModal, { props: { router: router(1), modo: 'rotar', open: false } })
        await vista.setProps({ open: true })
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="aviso-rotar"]')).not.toBeNull())
        expect(cuerpo().querySelector('[data-prueba="script-generar"]')?.textContent).toContain('Rotar y generar script nuevo')
        pulsar('[data-prueba="script-generar"]')
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="script-listo"]')).not.toBeNull())
        expect(bd.conexionesRouter.find(c => c.router_id === 1)).toMatchObject({ public_key: null, estado: 'pendiente', handshake_reciente: false })
        const conexion = await useRouters().conexion(1)
        expect(conexion.ok && conexion.data.token_vence).not.toBeNull()
    })

    it('pegar clave pública: valida el formato y la guarda', async () => {
        const vista = await mountSuspended(RouterClaveModal, { props: { router: router(2), open: false } })
        await vista.setProps({ open: true })
        await esperar(() => expect(cuerpo().querySelector('[data-prueba="clave-publica"]')).not.toBeNull())
        escribir('[data-prueba="clave-publica"]', 'corta')
        pulsar('[data-prueba="clave-guardar"]')
        await esperar(() => expect(cuerpo().textContent).toContain('44 caracteres que terminan en ='))
        escribir('[data-prueba="clave-publica"]', 'Q2xhdmVEZVBydWViYURlV2lyZUd1YXJkUGFyYUFyZ28=')
        pulsar('[data-prueba="clave-guardar"]')
        await esperar(() => expect(vista.emitted('guardado')).toHaveLength(1))
        expect(bd.conexionesRouter.find(c => c.router_id === 2)?.public_key).toBe('Q2xhdmVEZVBydWViYURlV2lyZUd1YXJkUGFyYUFyZ28=')
    })

    it('editar router: zona y borrar el secreto a propósito; vacío no cambia', async () => {
        const vacio = await useRouters().editar(1, { version: 1, radius_secret: '' })
        expect(vacio.ok && vacio.data.tiene_radius_secret).toBe(true)
        const editado = await useRouters().editar(1, { version: 2, zona_id: 2, quitar_radius_secret: true })
        expect(editado.ok && editado.data).toMatchObject({ zona_id: 2, tiene_radius_secret: false })
        const ambos = await useRouters().editar(1, { version: 3, api_password: 'nueva-clave-123', quitar_api_password: true })
        expect(!ambos.ok && ambos.problema.errors?.[0]?.field).toBe('api_password')
    })
})
