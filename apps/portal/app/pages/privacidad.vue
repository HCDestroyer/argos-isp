<script setup lang="ts">
/**
 * Política de privacidad pública (sin sesión), renderizada en el servidor con el texto completo:
 * es la «URL de la política de privacidad» de la app de Meta (WhatsApp Business). El responsable
 * es la empresa del ISP configurada en el panel (`usePoliticasEmpresa`). El texto describe lo que
 * el sistema guarda y hace de verdad; al cambiarlo, sube `VERSION_POLITICAS` y su fecha.
 */
const { empresa, problema, recargar } = usePoliticasEmpresa()

const nombre = computed(() => empresa.value?.nombre ?? EMPRESA_GENERICA)
const responsable = computed(() => nombreCompleto(empresa.value))

useSeoMeta({
    title: computed(() => `Política de privacidad · ${empresa.value?.nombre ?? 'Portal del cliente'}`),
    description: computed(() => `Qué datos personales trata ${nombreLegal(empresa.value)} como proveedor de Internet, para qué, con quién los comparte, cuánto tiempo los conserva y cómo ejercer tus derechos.`),
})
</script>

<template>
    <PoliticaPagina
        titulo="Política de privacidad"
        actual="/privacidad"
        :problema="problema"
        @reintentar="recargar()"
    >
        <p class="text-sm leading-relaxed text-default">
            Esta política explica cómo <strong data-testid="politica-empresa">{{ responsable }}</strong> trata los datos
            personales de sus clientes y de las personas que usan este portal y sus canales de mensajería
            (WhatsApp, Telegram y correo). Aplica al servicio de Internet, al portal del cliente, a la página de
            estado del servicio y a los avisos que te enviamos.
        </p>

        <PoliticaSeccion titulo="1. Responsable de tus datos">
            <p>
                El responsable del tratamiento es <strong>{{ responsable }}</strong>, con estos datos:
            </p>
            <PoliticaResponsable :empresa="empresa" />
        </PoliticaSeccion>

        <PoliticaSeccion titulo="2. Qué datos guardamos">
            <ul>
                <li>
                    <strong>Identificación y facturación:</strong> nombre, si eres persona o empresa, NIT o CUI, nombre y
                    dirección fiscal.
                </li>
                <li>
                    <strong>Contacto:</strong> correo, teléfono, celular, el canal por el que prefieres recibir avisos y, si
                    vinculas Telegram, el identificador de tu chat con nuestro bot.
                </li>
                <li>
                    <strong>Ubicación del servicio:</strong> dirección y coordenadas del lugar de instalación.
                </li>
                <li>
                    <strong>Datos del servicio:</strong> plan, estado del servicio, usuario de conexión (la contraseña se
                    guarda cifrada), dirección MAC del equipo cuando el tipo de conexión la usa y las direcciones IP
                    (IPv4 e IPv6) asignadas a tu servicio, con su historial.
                </li>
                <li>
                    <strong>Conexiones:</strong> inicio y fin de cada sesión, la IP usada, la cantidad de datos transferidos y
                    el motivo de desconexión. No guardamos el contenido de lo que navegas.
                </li>
                <li>
                    <strong>Cobros:</strong> facturas, pagos, notas de crédito, promesas de pago, comprobantes de depósito que
                    subes (foto o PDF, banco, referencia y monto) y, si participas, puntos, canjes y sorteos del programa de
                    lealtad.
                </li>
                <li>
                    <strong>Comunicaciones:</strong> los avisos que te enviamos (canal, destino, fecha y si se entregaron) y tu
                    permiso para recibir avisos por WhatsApp: si aceptas o te das de baja, cuándo y desde dónde.
                </li>
                <li>
                    <strong>Uso del portal:</strong> la IP desde la que te conectas, que sirve para reconocer tu servicio en
                    la página de estado y para limitar abusos; los códigos de verificación que pides y una cookie de sesión.
                </li>
                <li>
                    <strong>Registro de actividad:</strong> quién hizo cada cambio en tu cuenta y cuándo (personal de la
                    empresa, tú desde el portal o un proceso automático).
                </li>
            </ul>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="3. Para qué los usamos">
            <ul>
                <li>Prestarte el servicio de Internet: autorizar tu conexión, asignar tus direcciones IP y darte soporte técnico.</li>
                <li>Facturar, registrar tus pagos y comprobantes, y emitir tus facturas electrónicas (FEL) ante la SAT.</li>
                <li>
                    Aplicar las reglas de tu plan de facturación: avisos de vencimiento, limitación, suspensión y reactivación
                    del servicio, y evaluar las promesas de pago.
                </li>
                <li>Enviarte avisos sobre tu cuenta (facturas, pagos, promesas, estado del servicio) y los códigos de acceso al portal.</li>
                <li>Cuidar la seguridad y la calidad de la red y prevenir fraudes.</li>
                <li>Cumplir obligaciones legales, tributarias y contables.</li>
                <li>Administrar el programa de lealtad, si participas.</li>
            </ul>
            <p>
                No vendemos tus datos ni los usamos para publicidad de terceros.
            </p>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="4. Por qué podemos usarlos">
            <p>
                Usamos tus datos porque son necesarios para prestarte el servicio que contrataste y cobrarlo, porque la ley
                nos obliga a emitir facturas y llevar contabilidad, y, para los avisos por WhatsApp, porque nos diste tu
                permiso. Puedes retirar ese permiso cuando quieras (sección 8).
            </p>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="5. Con quién los compartimos">
            <p>
                Solo compartimos lo necesario para cada fin, y solo con los proveedores que {{ nombre }} tenga en uso:
            </p>
            <ul>
                <li>
                    <strong>Certificador de factura electrónica (FEL) y la SAT:</strong> los datos de cada factura (nombre, NIT
                    o CUI, dirección fiscal, detalle y montos), como exige la ley tributaria.
                </li>
                <li>
                    <strong>Procesador de pagos en línea:</strong> el monto y la referencia del cobro cuando pagas en línea. Los
                    datos de tu tarjeta los escribes en la página del procesador; nuestro sistema no los recibe ni los guarda.
                </li>
                <li>
                    <strong>Iris y Meta (WhatsApp):</strong> los avisos por WhatsApp se envían desde Iris, el sistema de atención
                    de la empresa, a través de la plataforma de WhatsApp Business de Meta. Para eso se comparten tu nombre, tu
                    número, el texto del aviso y tu permiso o baja. Meta trata esos mensajes según sus propias políticas.
                </li>
                <li>
                    <strong>Telegram:</strong> si vinculas tu cuenta con nuestro bot, los avisos viajan por Telegram.
                </li>
                <li>
                    <strong>Proveedor de correo:</strong> el servicio de correo de la empresa, para los avisos y códigos que te
                    enviamos por correo.
                </li>
                <li>
                    <strong>Monitoreo de la red:</strong> si la empresa usa un sistema de monitoreo de tráfico y seguridad (Horus
                    Flow), recibe el identificador de tu servicio, tus direcciones IP y tus sesiones para asociar las alertas a
                    tu servicio.
                </li>
                <li>
                    <strong>Autoridades:</strong> cuando una ley o una orden judicial nos obligue.
                </li>
            </ul>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="6. Cuánto tiempo los conservamos">
            <ul>
                <li>Tus datos de cliente y del servicio, mientras tengas una relación de servicio con nosotros.</li>
                <li>
                    Las facturas, pagos, notas de crédito, comprobantes y registros contables, durante los plazos que exigen las
                    leyes tributarias y mercantiles de Guatemala. Los registros contables no se modifican ni se borran: un
                    error se corrige con un nuevo registro.
                </li>
                <li>El registro de actividad de tu cuenta y el historial de conexiones e IP se conservan como registro técnico y de seguridad.</li>
                <li>Los códigos de verificación del portal son de un solo uso y vencen poco después de enviarse.</li>
                <li>
                    Tus datos de contacto (correo y teléfonos) y tus canales de mensajería se pueden quitar cuando termina el
                    servicio o cuando lo pides (ver «Eliminar mis datos»).
                </li>
            </ul>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="7. Cómo los protegemos">
            <ul>
                <li>Las contraseñas de conexión y las credenciales de los sistemas se guardan cifradas.</li>
                <li>El personal entra con su propio usuario y solo ve lo que su rol le permite; cada acción queda registrada.</li>
                <li>
                    Sin verificarte, el portal solo muestra tu nombre parcial y el monto pendiente. Para ver facturas, pagos y
                    datos completos pedimos un código que enviamos a tu correo o Telegram registrados; la sesión dura poco y usa
                    una cookie que el navegador no expone a otros sitios.
                </li>
                <li>El portal no carga publicidad, analítica ni recursos de terceros.</li>
            </ul>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="8. Tus derechos">
            <p>Puedes, en cualquier momento:</p>
            <ul>
                <li>Pedir qué datos tuyos tenemos y para qué los usamos.</li>
                <li>
                    Corregirlos o actualizarlos: tu correo, teléfonos y canal preferido los cambias tú en el portal, después de
                    verificarte; el nombre, el NIT y las direcciones, en nuestra oficina.
                </li>
                <li>Pedir que eliminemos tus datos, con los límites que impone la ley (ver «Eliminar mis datos»).</li>
                <li>
                    Dejar de recibir avisos por WhatsApp o Telegram: en el portal, en el mismo chat o pidiéndolo a la empresa.
                </li>
            </ul>
            <p>
                Respondemos tus solicitudes en un plazo máximo de {{ PLAZO_RESPUESTA_DIAS }} días calendario. Antes de
                entregar o cambiar datos podemos pedirte que confirmes tu identidad.
            </p>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="9. Cookies y almacenamiento en tu navegador">
            <p>
                El portal usa una cookie de sesión para mantenerte verificado y guarda en tu navegador preferencias como el
                tema claro u oscuro. No usamos cookies de publicidad ni de seguimiento.
            </p>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="10. Menores de edad">
            <p>
                El servicio lo contrata una persona mayor de edad o una empresa. No pedimos datos de menores de edad.
            </p>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="11. Cambios a esta política">
            <p>
                Si cambiamos esta política, publicamos la nueva versión en esta misma dirección con su fecha de vigencia.
            </p>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="12. Contacto">
            <p>
                Para cualquier pregunta o solicitud sobre tus datos, escríbenos o llámanos con los datos de la sección 1 o los
                de nuestra <ULink
                    to="/contacto"
                    class="text-primary underline underline-offset-2"
                >página de contacto</ULink>.
            </p>
        </PoliticaSeccion>
    </PoliticaPagina>
</template>
