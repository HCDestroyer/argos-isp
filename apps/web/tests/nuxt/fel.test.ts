import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import Decimal from 'decimal.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Component } from 'vue'
import { DEMORA_WORKER_MS, reiniciarFixtures, romperCadenaFixture, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import AvisoFel from '~/components/AvisoFel.vue'
import LibroIntegridad from '~/components/LibroIntegridad.vue'
import PaginaFel from '~/pages/configuracion/fel.vue'
import PaginaDte from '~/pages/dte/index.vue'
import PaginaFactura from '~/pages/facturas/[id].vue'
import PaginaNota from '~/pages/notas-credito/[id].vue'
import { esperar } from '../ayudas/esperar'

/**
 * FEL en el panel (A3, fase 3; contrato §8, §10.9, §10.10 y §17): composables contra los fixtures
 * (formas capturadas de la API con el certificador falso), errores legibles y las pantallas.
 */

type Dte = Schema<'Dte'>
type Factura = Schema<'Factura'>

const ESPERA_WORKER = { timeout: DEMORA_WORKER_MS * 4, interval: 100 }

function dteDe(estado: Dte['estado'], tipo: Dte['documento_tipo'] = 'factura'): Dte {
    const dte = bd.fel.dte.find(d => d.estado === estado && d.documento_tipo === tipo)
    if (!dte) {
        throw new Error(`sin DTE ${tipo} ${estado} sembrado`)
    }
    return dte
}

function facturaDe(dte: Dte): Factura {
    const factura = bd.facturas.find(f => f.id === dte.documento_id)
    if (!factura) {
        throw new Error(`sin factura ${dte.documento_id}`)
    }
    return factura
}

/** Una factura certificada sin pagos: la anulación y la NCRE se prueban en ella. */
function certificadaSinPagos(): Factura {
    const factura = bd.facturas.find(f => f.fel_estado === 'certificado' && new Decimal(f.pagado).isZero() && f.estado !== 'anulada')
    if (factura) {
        return factura
    }
    const conNota = bd.facturas.find(f => f.fel_estado === 'certificado' && new Decimal(f.total).gt(f.pagado) && new Decimal(f.pagado).equals(f.acreditado ?? '0'))
    if (!conNota) {
        throw new Error('sin factura certificada con saldo')
    }
    return conNota
}

function conApp(componente: Component) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente) }) })
}

describe('FEL · composables y fixtures', () => {
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

    it('la configuración trae modo, proveedor y credenciales sin secretos; una empresa sin fila está desactivada con version 0', async () => {
        const argosnet = await useFel().configuracion(1)
        expect(argosnet.ok && argosnet.data).toMatchObject({ modo: 'obligatoria', proveedor: 'falso', ambiente: 'pruebas', contingencia_activa: false })
        expect(argosnet.ok && argosnet.data.credenciales[0]?.campos_visibles).toEqual({ usuario: 'argosnet' })
        expect(JSON.stringify(argosnet.ok && argosnet.data)).not.toContain('llave')
        const sur = await useFel().configuracion(2)
        expect(sur.ok && sur.data).toMatchObject({ modo: 'desactivada', proveedor: null, version: 0, credenciales: [] })
        expect(useFel().estado.value).toMatchObject({ empresaId: 2, modo: 'desactivada' })
    })

    it('desactivar con avisos vivos responde 422 avisos_por_certificar con la cuenta; la versión vieja es 409', async () => {
        const actual = await useFel().configuracion(1)
        const version = actual.ok ? actual.data.version : 0
        const desactivar = await useFel().configurar({ empresa_id: 1, proveedor: 'falso', ambiente: 'pruebas', modo: 'desactivada', version }, nuevaClaveIdempotencia())
        expect(!desactivar.ok && codigoProblema(desactivar.problema)).toBe('avisos_por_certificar')
        const cuenta = !desactivar.ok ? avisosPorCertificar(desactivar.problema) : null
        expect(cuenta).toBeGreaterThan(0)
        expect(!desactivar.ok && problemaFelLegible(desactivar.problema).title).toBe('Hay avisos de cobro sin certificar')

        const vieja = await useFel().configurar({ empresa_id: 1, proveedor: 'falso', ambiente: 'pruebas', modo: 'opcional', version: version - 1 }, nuevaClaveIdempotencia())
        expect(!vieja.ok && vieja.problema).toMatchObject({ status: 409, type: 'urn:argosisp:problema:conflicto_version' })

        const produccion = await useFel().configurar({ empresa_id: 1, proveedor: 'falso', ambiente: 'produccion', modo: 'opcional', version }, nuevaClaveIdempotencia())
        expect(!produccion.ok && produccion.problema.errors?.[0]?.field).toBe('proveedor')
    })

    it('obligatoria con una plantilla en «nunca» responde 422 certificar_al_incompatible', async () => {
        const plantilla = bd.plantillas[0]
        if (!plantilla) {
            throw new Error('sin plantillas')
        }
        const cambio = await usePlantillas().cambiarCertificarAl(plantilla, 'nunca')
        expect(cambio.ok && cambio.data.certificar_al).toBe('nunca')
        const actual = await useFel().configuracion(1)
        const opcional = await useFel().configurar({ empresa_id: 1, proveedor: 'falso', ambiente: 'pruebas', modo: 'opcional', version: actual.ok ? actual.data.version : 0 }, nuevaClaveIdempotencia())
        expect(opcional.ok).toBe(true)
        const obligatoria = await useFel().configurar({ empresa_id: 1, proveedor: 'falso', ambiente: 'pruebas', modo: 'obligatoria', version: opcional.ok ? opcional.data.version : 0 }, nuevaClaveIdempotencia())
        expect(!obligatoria.ok && codigoProblema(obligatoria.problema)).toBe('certificar_al_incompatible')
    })

    it('credenciales de solo escritura: guardar no devuelve llaves, probar guarda el resultado', async () => {
        const guardadas = await useFel().guardarCredenciales('pruebas', { empresa_id: 1, proveedor: 'falso', credenciales: { usuario: 'nuevo', llave: 'invalida' } }, nuevaClaveIdempotencia())
        expect(guardadas.ok && guardadas.data).toMatchObject({ campos_visibles: { usuario: 'nuevo' }, resultado_prueba: null })
        expect(JSON.stringify(guardadas.ok && guardadas.data)).not.toContain('invalida')
        const rechazada = await useFel().probarCredenciales('pruebas', 1)
        expect(rechazada.ok && rechazada.data.resultado_prueba).toEqual({ ok: false, detalle: 'Credenciales rechazadas (simulado)' })

        const faltan = await useFel().guardarCredenciales('pruebas', { empresa_id: 1, proveedor: 'infile', credenciales: { usuario_firma: 'x' } }, nuevaClaveIdempotencia())
        expect(!faltan.ok && faltan.problema.errors?.map(e => e.field)).toEqual(['credenciales.llave_firma', 'credenciales.usuario_api', 'credenciales.llave_api'])

        const sinProveedor = await useFel().probarCredenciales('pruebas', 2)
        expect(!sinProveedor.ok && codigoProblema(sinProveedor.problema)).toBe('fel_no_configurada')
    })

    it('contingencia: activar con motivo, 409 si no cambia; al levantarla la cola transmite', async () => {
        const activa = await useFel().cambiarContingencia(true, 'El certificador no responde', nuevaClaveIdempotencia(), 1)
        expect(activa.ok && activa.data).toMatchObject({ contingencia_activa: true, contingencia_motivo: 'El certificador no responde' })
        const otra = await useFel().cambiarContingencia(true, 'Otra vez', nuevaClaveIdempotencia(), 1)
        expect(!otra.ok && codigoProblema(otra.problema)).toBe('contingencia_sin_cambio')

        const factura = bd.facturas.find(f => (f.empresa_id ?? 1) === 1 && !f.dte_id && f.estado !== 'anulada')
        if (!factura) {
            throw new Error('sin factura sin DTE')
        }
        const solicitud = await useDte().certificarFactura(factura.id, nuevaClaveIdempotencia())
        expect(solicitud.ok && solicitud.data.dte?.estado).toBe('contingencia')

        await useFel().cambiarContingencia(false, 'Volvió el servicio', nuevaClaveIdempotencia(), 1)
        await esperar(() => expect(bd.fel.dte.find(d => d.documento_id === factura.id)?.estado).toBe('certificado'), ESPERA_WORKER)
    })

    it('la cola filtra por estado y documento; reintentar un rechazado crea otro DTE que se certifica', async () => {
        const rechazados = await useDte().listar({ estado: ['rechazado'] })
        expect(rechazados.ok && rechazados.data.data.length).toBeGreaterThanOrEqual(2)
        const ncre = await useDte().listar({ documento_tipo: 'nota_credito' })
        expect(ncre.ok && ncre.data.data.every(d => d.tipo_dte === 'NCRE')).toBe(true)

        const rechazado = dteDe('rechazado')
        const nuevo = await useDte().reintentar(rechazado.id, nuevaClaveIdempotencia())
        expect(nuevo.ok && nuevo.data).toMatchObject({ estado: 'pendiente', solicitud: 'manual', documento_id: rechazado.documento_id })
        expect(nuevo.ok && nuevo.data.id).not.toBe(rechazado.id)
        await esperar(() => expect(facturaDe(rechazado).fel_estado).toBe('certificado'), ESPERA_WORKER)

        const certificado = dteDe('certificado')
        const noReintentable = await useDte().reintentar(certificado.id, nuevaClaveIdempotencia())
        expect(!noReintentable.ok && codigoProblema(noReintentable.problema)).toBe('dte_no_reintentable')

        const xml = await useDte().xml(certificado.id)
        expect(xml.ok && xml.data).toContain(certificado.autorizacion ?? '—')
        const pdf = await useDte().pdf(certificado.id)
        expect(!pdf.ok && pdf.problema.status).toBe(404)
    })

    it('anular una factura certificada: anulación pendiente (sin notas), luego anulada con su reverso', async () => {
        const factura = certificadaSinPagos()
        if (new Decimal(factura.pagado).gt(0)) {
            return
        }
        const anulada = await useFacturas().anular(factura.id, 'Servicio dado de baja', nuevaClaveIdempotencia())
        expect(anulada.ok && anulada.data).toMatchObject({ estado: factura.estado, fel_estado: 'anulacion_pendiente' })
        const otra = await useFacturas().anular(factura.id, 'Otra vez', nuevaClaveIdempotencia())
        expect(!otra.ok && codigoProblema(otra.problema)).toBe('anulacion_en_proceso')
        const nota = await useFacturas().notaCredito(factura.id, { monto: '1.00', motivo: 'Prueba' }, nuevaClaveIdempotencia())
        expect(!nota.ok && nota.problema).toMatchObject({ status: 409, detail: expect.stringContaining('anulación pendiente') })
        expect(!nota.ok && problemaFelLegible(nota.problema).title).toBe('El DTE está en proceso')
        await esperar(() => expect(bd.facturas.find(f => f.id === factura.id)?.estado).toBe('anulada'), ESPERA_WORKER)
        expect(bd.asientos.some(a => a.origen_tipo === 'factura' && a.origen_id === factura.id && a.reversa_de !== null)).toBe(true)
    })

    it('sin fel.anular no se anula una factura certificada', async () => {
        const factura = certificadaSinPagos()
        const sinPermiso = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'fel.anular') }
        const comun = await import('~~/fixtures/comun')
        const original = comun.usuariosPorToken['fixture-admin']
        comun.usuariosPorToken['fixture-admin'] = sinPermiso
        try {
            const resultado = await useFacturas().anular(factura.id, 'Sin permiso FEL', nuevaClaveIdempotencia())
            expect(!resultado.ok && resultado.problema.status).toBe(new Decimal(factura.pagado).minus(factura.acreditado ?? '0').gt(0) ? 409 : 403)
        }
        finally {
            if (original) {
                comun.usuariosPorToken['fixture-admin'] = original
            }
        }
    })

    it('nota por línea sobre una factura certificada sale como NCRE en cola', async () => {
        const factura = bd.facturas.find(f => f.fel_estado === 'certificado' && new Decimal(f.total).gt(f.pagado))
        if (!factura) {
            throw new Error('sin certificada con saldo')
        }
        const detalle = await useFacturas().ver(factura.id)
        const linea = detalle.ok ? detalle.data.lineas[0] : undefined
        if (!linea) {
            throw new Error('sin líneas')
        }
        const nota = await useFacturas().notaCredito(factura.id, { lineas: [{ linea_id: linea.id, monto: '10.00' }], motivo: 'Cargo indebido' }, nuevaClaveIdempotencia())
        expect(nota.ok && nota.data.monto).toBe('10.00')
        const ncre = await useDte().deDocumento('nota_credito', nota.ok ? nota.data.id : 0)
        expect(ncre.ok && ncre.data).toMatchObject({ tipo_dte: 'NCRE', referencia: { autorizacion: factura.fel_uuid } })

        const mala = await useFacturas().notaCredito(factura.id, { lineas: [{ linea_id: 999, monto: '1.00' }], motivo: 'Línea ajena' }, nuevaClaveIdempotencia())
        expect(!mala.ok && mala.problema.errors?.[0]?.field).toBe('lineas.0.linea_id')
    })

    it('sustituir: sin DTE se anula la original; con DTE certificado se acredita con NCRE', async () => {
        const sinDte = bd.facturas.find(f => (f.empresa_id ?? 1) === 1 && !f.dte_id && new Decimal(f.pagado).isZero() && f.estado !== 'anulada' && f.tipo !== 'mora')
        if (!sinDte) {
            throw new Error('sin factura sin DTE')
        }
        const anulacion = await useFacturas().sustituir(sinDte.id, { motivo: 'NIT equivocado', cliente_fiscal: { tipo_documento_fiscal: 'nit', nit_cui: '5432101-5' } }, nuevaClaveIdempotencia())
        expect(anulacion.ok && anulacion.data).toMatchObject({ tipo: 'anulacion', original: { estado: 'anulada' }, nueva: { periodo: sinDte.periodo, clave_unica: `${sinDte.clave_unica}#s1` } })
        const otra = await useFacturas().sustituir(sinDte.id, { motivo: 'Otra vez' }, nuevaClaveIdempotencia())
        expect(!otra.ok && codigoProblema(otra.problema)).toBe('factura_anulada')

        const conDte = bd.facturas.find(f => f.fel_estado === 'certificado' && new Decimal(f.pagado).equals(f.acreditado ?? '0') && new Decimal(f.total).gt(f.pagado))
        if (!conDte) {
            throw new Error('sin certificada sin pagos')
        }
        const ncre = await useFacturas().sustituir(conDte.id, { motivo: 'Receptor equivocado' }, nuevaClaveIdempotencia())
        expect(ncre.ok && ncre.data.tipo).toBe('nota_credito')
        expect(ncre.ok && ncre.data.nota_credito_id).not.toBeNull()

        const pagada = bd.facturas.find(f => f.estado === 'pagada' && new Decimal(f.acreditado ?? '0').isZero())
        const conPagos = await useFacturas().sustituir(pagada?.id ?? 0, { motivo: 'Con pagos' }, nuevaClaveIdempotencia())
        expect(!conPagos.ok && codigoProblema(conPagos.problema)).toBe('sustitucion_no_permitida')
    })

    it('anular la nota cuya NCRE rechazó la SAT: reverso y el monto vuelve al saldo; dos veces es 409', async () => {
        const ncre = dteDe('rechazado', 'nota_credito')
        const nota = bd.notasCredito.find(n => n.id === ncre.documento_id)
        const factura = bd.facturas.find(f => f.id === nota?.factura_id)
        const pagadoAntes = new Decimal(factura?.pagado ?? 0)
        const anulada = await useNotasCredito().anular(ncre.documento_id, 'La SAT rechazó la NCRE', nuevaClaveIdempotencia())
        expect(anulada.ok && anulada.data.anulada_en).toBeTruthy()
        expect(new Decimal(factura?.pagado ?? 0).toFixed(2)).toBe(pagadoAntes.minus(nota?.monto ?? 0).toFixed(2))
        const otra = await useNotasCredito().anular(ncre.documento_id, 'Otra vez', nuevaClaveIdempotencia())
        expect(!otra.ok && codigoProblema(otra.problema)).toBe('nota_anulada')

        const interna = bd.notasCredito.find(n => n.id !== ncre.documento_id && !bd.fel.dte.some(d => d.documento_tipo === 'nota_credito' && d.documento_id === n.id))
        const sinNcre = await useNotasCredito().anular(interna?.id ?? 0, 'Nota interna', nuevaClaveIdempotencia())
        expect(!sinNcre.ok && codigoProblema(sinNcre.problema)).toBe('nota_sin_ncre_rechazada')
    })

    it('integridad: verificada por empresa; rota, el cierre del mes responde 409 integridad_rota', async () => {
        const integridad = await useLibro().integridad()
        expect(integridad.ok && integridad.data.map(i => [i.empresa_id, i.verificado])).toEqual([[1, true]])
        const seccion = integridad.ok ? integridad.data[0] : undefined
        expect(seccion?.sellos).toBeGreaterThan(0)
        expect(seccion?.ultimo_hash).toMatch(/^[0-9a-f]{64}$/)
        const rango = await useLibro().integridad({ desde_sello: 1, hasta_sello: 3 })
        expect(rango.ok && rango.data[0]).toMatchObject({ primer_sello: 1, ultimo_sello: 3, verificados: 3 })

        romperCadenaFixture(1, { sello: 4, asiento_id: 4, motivo: 'hash_distinto', esperado: 'a'.repeat(64), obtenido: 'b'.repeat(64) })
        const rota = await useLibro().integridad()
        expect(rota.ok && rota.data[0]).toMatchObject({ verificado: false, ruptura: { sello: 4, motivo: 'hash_distinto' } })
        const cierre = await useLibro().cerrarPeriodo('2026-08', nuevaClaveIdempotencia())
        expect(!cierre.ok && codigoProblema(cierre.problema)).toBe('integridad_rota')
        expect(!cierre.ok && problemaFelLegible(cierre.problema).title).toBe('La cadena del libro no verifica')
    })

    it('cierre del mes con una NCRE sin certificar: 409 ncre_sin_certificar con la lista', async () => {
        const ncre = dteDe('rechazado', 'nota_credito')
        const nota = bd.notasCredito.find(n => n.id === ncre.documento_id)
        if (nota) {
            nota.fecha = '2026-08-20'
        }
        const cierre = await useLibro().cerrarPeriodo('2026-08', nuevaClaveIdempotencia())
        expect(!cierre.ok && cierre.problema).toMatchObject({ status: 409, type: 'urn:argosisp:problema:ncre_sin_certificar', detail: expect.stringContaining(`nota ${ncre.documento_id}: rechazado`) })
    })
})

describe('FEL · pantallas', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        useEmpresaActiva().elegir(1)
        useFel().estado.value = null
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('Configuración → FEL: modo, credenciales «configuradas» sin secretos y 422 avisos_por_certificar con la cuenta', async () => {
        const vista = await mountSuspended(conApp(PaginaFel), { route: '/configuracion/fel' })
        await esperar(() => expect(vista.find('[data-prueba="fel-modo"]').text()).toBe('Obligatoria'))
        const pruebas = vista.find('[data-credenciales="pruebas"]')
        expect(pruebas.find('[data-prueba="credenciales-estado"]').text()).toBe('Configuradas')
        expect(pruebas.text()).toContain('argosnet')
        expect(pruebas.text()).toContain('Válidas')
        expect(vista.find('[data-credenciales="produccion"]').text()).toContain('Sin configurar')

        const radios = vista.find('[data-prueba="fel-modos"]').findAll('[role="radio"]')
        expect(radios).toHaveLength(3)
        await radios[2]?.trigger('click')
        await vista.find('form').trigger('submit')
        await esperar(() => expect(vista.find('[data-prueba="fel-avisos-por-certificar"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="fel-avisos-por-certificar"]').text()).toMatch(/\d+ avisos de cobro sin certificar/)
    })

    it('Configuración → FEL con error de la API: el aviso con «Reintentar», sin datos inventados', async () => {
        simularFalla('GET /api/v1/fel/configuracion', 501)
        const vista = await mountSuspended(conApp(PaginaFel), { route: '/configuracion/fel' })
        await esperar(() => expect(vista.find('[data-prueba="fel-error"]').text()).toContain('Reintentar'))
        expect(vista.find('[data-prueba="fel-modo"]').exists()).toBe(false)
    })

    it('el aviso global aparece con la FEL desactivada (Fibra del Sur) y no con la obligatoria', async () => {
        useEmpresaActiva().elegir(2)
        const sur = await mountSuspended(conApp(AvisoFel), { route: '/facturas' })
        await esperar(() => expect(sur.find('[data-prueba="aviso-fel-desactivada"]').exists()).toBe(true))
        expect(sur.text()).toContain('obligatoria para el régimen general')
        sur.unmount()

        useEmpresaActiva().elegir(1)
        const argosnet = await mountSuspended(conApp(AvisoFel), { route: '/facturas' })
        await esperar(() => expect(useFel().estado.value?.empresaId).toBe(1))
        expect(argosnet.find('[data-prueba="aviso-fel"]').exists()).toBe(false)
    })

    it('la factura muestra su DTE (estado, autorización, serie y número) y el rechazo con «Reintentar»', async () => {
        const certificado = dteDe('certificado')
        const vista = await mountSuspended(conApp(PaginaFactura), { route: `/facturas/${certificado.documento_id}` })
        await esperar(() => expect(vista.find('[data-prueba="dte-estado"]').text()).toBe('Certificado'))
        expect(vista.find('[data-prueba="dte-autorizacion"]').text()).toContain(certificado.autorizacion ?? '—')
        expect(vista.find('[data-prueba="dte-serie-numero"]').text()).toContain(`${certificado.serie} · ${certificado.numero}`)
        expect(vista.find('[data-prueba="dte-xml"]').exists()).toBe(true)
        vista.unmount()

        const rechazado = dteDe('rechazado')
        const conError = await mountSuspended(conApp(PaginaFactura), { route: `/facturas/${rechazado.documento_id}` })
        await esperar(() => expect(conError.find('[data-prueba="dte-estado"]').text()).toBe('Rechazado'))
        expect(conError.find('[data-prueba="dte-error"]').text()).toContain('Error de validación de la SAT')
        expect(conError.find('[data-prueba="dte-reintentar"]').exists()).toBe(true)
    })

    it('una factura por certificar no es deuda: sin saldo pendiente y con su aviso', async () => {
        const factura = bd.facturas.find(f => f.estado === 'por_certificar')
        const vista = await mountSuspended(conApp(PaginaFactura), { route: `/facturas/${factura?.id}` })
        await esperar(() => expect(vista.find('[data-prueba="factura-por-certificar"]').exists()).toBe(true))
        expect(vista.text()).toContain('Por certificar')
        expect(vista.find('[data-prueba="factura-estado"]').text()).toBe('Por certificar')
    })

    it('la nota con la NCRE rechazada ofrece anularla; sin el permiso no', async () => {
        const ncre = dteDe('rechazado', 'nota_credito')
        const vista = await mountSuspended(conApp(PaginaNota), { route: `/notas-credito/${ncre.documento_id}` })
        await esperar(() => expect(vista.find('[data-prueba="nota-ncre-rechazada"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="abrir-anular-nota"]').exists()).toBe(true)
        vista.unmount()

        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'facturas.anular_nota_credito') }
        const sinPermiso = await mountSuspended(conApp(PaginaNota), { route: `/notas-credito/${ncre.documento_id}` })
        await esperar(() => expect(sinPermiso.find('[data-prueba="nota-ncre-rechazada"]').exists()).toBe(true))
        expect(sinPermiso.find('[data-prueba="abrir-anular-nota"]').exists()).toBe(false)
    })

    it('la cola de DTE lista los rechazados y con error muestra «Reintentar»', async () => {
        const vista = await mountSuspended(conApp(PaginaDte), { route: '/dte?estado=rechazado' })
        await esperar(() => expect(vista.find('[data-prueba="tabla-dte"]').text()).toContain('Rechazado'))
        expect(vista.find('[data-prueba="tabla-dte"]').text()).not.toContain('Certificado')
        vista.unmount()

        simularFalla('GET /api/v1/dte', 501)
        const conError = await mountSuspended(conApp(PaginaDte), { route: '/dte' })
        await esperar(() => expect(conError.find('[data-prueba="dte-lista-error"]').text()).toContain('Reintentar'))
        expect(conError.find('[data-prueba="tabla-dte"]').exists()).toBe(false)
    })

    it('integridad del libro: verificada, y la ruptura con su asiento', async () => {
        const vista = await mountSuspended(conApp(LibroIntegridad))
        await esperar(() => expect(vista.find('[data-prueba="integridad-estado"]').text()).toBe('Cadena verificada'))
        expect(vista.find('[data-prueba="integridad-ultimo-hash"]').text()).toMatch(/[0-9a-f]{64}/)
        vista.unmount()

        romperCadenaFixture(1, { sello: 5, asiento_id: 5, motivo: 'asiento_en_mes_cerrado', esperado: 'c'.repeat(64), obtenido: 'd'.repeat(64) })
        const rota = await mountSuspended(conApp(LibroIntegridad))
        await esperar(() => expect(rota.find('[data-prueba="integridad-ruptura"]').text()).toContain('Ruptura en el sello 5'))
        expect(rota.find('[data-prueba="integridad-ruptura"]').text()).toContain('mes ya cerrado')
        expect(rota.find('[data-prueba="integridad-asiento"]').exists()).toBe(true)
    })

    it('el cajero (fel.ver) ve el DTE de la factura pero no reintenta ni sustituye', async () => {
        useUsuarioActual().value = meCajero
        sesionFixture('fixture-cajero')
        const rechazado = bd.fel.dte.find(d => d.estado === 'rechazado' && d.documento_tipo === 'factura' && meCajero.empresas.some(e => e.id === d.empresa_id))
        if (!rechazado) {
            return
        }
        const vista = await mountSuspended(conApp(PaginaFactura), { route: `/facturas/${rechazado.documento_id}` })
        await esperar(() => expect(vista.find('[data-prueba="dte-estado"]').text()).toBe('Rechazado'))
        expect(vista.find('[data-prueba="dte-reintentar"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="abrir-sustituir"]').exists()).toBe(false)
    })
})
