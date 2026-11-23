<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Configuración › Facturación y cobro › Plantillas y conceptos (tablero OperConfigCobro, pestaña
 * «Plantillas y conceptos»): tres bloques de resumen con «Abrir», cada uno con lo que la API da:
 * plantillas de facturación (`GET /plantillas`), plantillas de documentos (`GET /documentos/
 * plantillas`), conceptos de cargo único (`GET /conceptos-cargo`) y, debajo, los adicionales con el
 * tipo «IP pública» (`GET /adicionales`, decisión 30). Cada bloque lee lo suyo y
 * muestra su error con «Reintentar»; un bloque sin permiso no aparece.
 */
definePageMeta({ permiso: ['plantillas.ver', 'documentos.ver'] })

useHead({ title: 'Plantillas y conceptos · ArgosIsp' })

const { puede, enlace } = usePermisos()

interface Lectura<T> {
    datos: T[]
    cargando: boolean
    problema: Problem | null
}

function lectura<T>(): Lectura<T> {
    return { datos: [], cargando: false, problema: null }
}

const plantillas = reactive(lectura<PlantillaFacturacion>()) as Lectura<PlantillaFacturacion>
const documentos = reactive(lectura<PlantillaDocumentoResumen>()) as Lectura<PlantillaDocumentoResumen>
const conceptos = reactive(lectura<ConceptoCargo>()) as Lectura<ConceptoCargo>
const adicionales = reactive(lectura<Adicional>()) as Lectura<Adicional>

async function leer<T>(destino: Lectura<T>, pedir: () => Promise<Resultado<T[]>>) {
    destino.cargando = true
    const resultado = await pedir()
    destino.cargando = false
    destino.datos = resultado.ok ? resultado.data : []
    destino.problema = resultado.ok ? null : resultado.problema
}

const cargarPlantillas = () => leer(plantillas, () => usePlantillas().listar())
const cargarDocumentos = () => leer(documentos, () => usePlantillasDocumentos().listar({ activa: true }))
const cargarConceptos = () => leer(conceptos, () => useCargoUnico().conceptos())
const cargarAdicionales = () => leer(adicionales, () => useAdicionales().activos())

onMounted(() => {
    if (puede('plantillas.ver')) {
        void cargarPlantillas()
    }
    if (puede('documentos.ver')) {
        void cargarDocumentos()
    }
    if (puede('facturas.ver')) {
        void cargarConceptos()
    }
    if (puede('adicionales.ver')) {
        void cargarAdicionales()
    }
})

const plantillasVigentes = computed(() => plantillas.datos.filter(p => !p.retirada_en))
</script>

<template>
    <ConfiguracionMarco
        id="plantillas-conceptos"
        titulo="Facturación y cobro"
        descripcion="Cuentas donde pagan los clientes, bancos de origen, plantillas y conceptos"
        empresas
    >
        <div class="grid gap-4 xl:grid-cols-3">
            <ConfiguracionBloque
                v-if="puede('plantillas.ver')"
                titulo="Plantillas de facturación"
                icono="i-lucide-calendar"
                accion="Abrir"
                :accion-a="enlace('/plantillas')"
                data-prueba="bloque-plantillas"
            >
                <ProblemaAlerta
                    v-if="plantillas.problema"
                    :problema="plantillas.problema"
                    :reintentar="cargarPlantillas"
                    :reintentando="plantillas.cargando"
                />
                <USkeleton
                    v-else-if="plantillas.cargando"
                    class="h-20 w-full"
                />
                <template v-else>
                    <ConfiguracionFila
                        v-for="plantilla in plantillasVigentes"
                        :key="plantilla.id"
                        :etiqueta="plantilla.nombre"
                        :valor="resumenCiclo(plantilla)"
                    />
                    <p
                        v-if="!plantillasVigentes.length"
                        class="py-2 text-sm text-muted"
                    >
                        Sin plantillas.
                    </p>
                </template>
            </ConfiguracionBloque>

            <ConfiguracionBloque
                v-if="puede('documentos.ver')"
                titulo="Plantillas de documentos"
                icono="i-lucide-printer"
                accion="Abrir"
                accion-a="/configuracion/aviso-cobro"
                data-prueba="bloque-documentos"
            >
                <ProblemaAlerta
                    v-if="documentos.problema"
                    :problema="documentos.problema"
                    :reintentar="cargarDocumentos"
                    :reintentando="documentos.cargando"
                />
                <USkeleton
                    v-else-if="documentos.cargando"
                    class="h-20 w-full"
                />
                <template v-else>
                    <ConfiguracionFila
                        v-for="tipo in TIPOS_DOCUMENTO"
                        :key="tipo.value"
                        :etiqueta="tipo.label"
                        :valor="documentos.datos.filter(d => d.tipo === tipo.value).map(d => etiquetaFormato(d.formato)).filter((f, i, todos) => todos.indexOf(f) === i).join(' · ') || 'De fábrica'"
                    />
                </template>
            </ConfiguracionBloque>

            <ConfiguracionBloque
                v-if="puede('facturas.ver')"
                titulo="Conceptos de cargo único"
                icono="i-lucide-tag"
                data-prueba="bloque-conceptos"
            >
                <ProblemaAlerta
                    v-if="conceptos.problema"
                    :problema="conceptos.problema"
                    :reintentar="cargarConceptos"
                    :reintentando="conceptos.cargando"
                />
                <USkeleton
                    v-else-if="conceptos.cargando"
                    class="h-20 w-full"
                />
                <template v-else>
                    <ConfiguracionFila
                        v-for="concepto in conceptos.datos"
                        :key="concepto.id"
                        :etiqueta="concepto.nombre"
                        :valor="concepto.gravable ? 'Con IVA' : 'Sin IVA'"
                    />
                    <p
                        v-if="!conceptos.datos.length"
                        class="py-2 text-sm text-muted"
                    >
                        Sin conceptos activos.
                    </p>
                </template>
            </ConfiguracionBloque>
        </div>

        <ConfiguracionBloque
            v-if="puede('adicionales.ver')"
            titulo="Adicionales"
            icono="i-lucide-plus"
            accion="Abrir"
            accion-a="/adicionales"
            data-prueba="bloque-adicionales"
        >
            <ProblemaAlerta
                v-if="adicionales.problema"
                :problema="adicionales.problema"
                :reintentar="cargarAdicionales"
                :reintentando="adicionales.cargando"
            />
            <USkeleton
                v-else-if="adicionales.cargando"
                class="h-16 w-full"
            />
            <template v-else>
                <ConfiguracionFila
                    v-for="adicional in adicionales.datos"
                    :key="adicional.id"
                    :etiqueta="adicional.nombre"
                    :fuerte="adicional.tipo === 'ip_publica'"
                    :data-adicional="adicional.codigo"
                >
                    <UBadge
                        v-if="adicional.tipo === 'ip_publica'"
                        label="tipo IP pública"
                        icon="i-lucide-globe"
                        color="secondary"
                        variant="subtle"
                        size="sm"
                    />
                    <span>{{ adicional.precio_sugerido ? `${formatearQuetzales(adicional.precio_sugerido)} /mes` : 'Sin precio sugerido' }}</span>
                </ConfiguracionFila>
                <p
                    v-if="!adicionales.datos.length"
                    class="py-2 text-sm text-muted"
                >
                    Sin adicionales activos.
                </p>
            </template>
            <template #pie>
                El tipo «IP pública» cambia la IP del servicio por una de la red pública de su router y la libera al quitarlo. Los planes empresariales pueden traerla incluida.
            </template>
        </ConfiguracionBloque>
    </ConfiguracionMarco>
</template>
