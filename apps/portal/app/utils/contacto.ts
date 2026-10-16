import type { Schema } from '@argosisp/contracts'

/** Formas de contacto de la empresa (`EmpresaPublica`) como enlaces para `UButton`. */

export interface EnlaceContacto {
    tipo: 'telefono' | 'whatsapp' | 'correo'
    label: string
    valor: string
    icon: string
    to: string
}

type Contacto = Pick<Schema<'EmpresaPublica'>, 'telefono' | 'telefono_alterno' | 'whatsapp' | 'correo'>

function digitos(numero: string): string {
    return numero.replace(/\D/g, '')
}

/** Número de WhatsApp internacional: un número de 8 dígitos se toma como de Guatemala (+502). */
export function numeroWhatsapp(numero: string): string {
    const solo = digitos(numero)
    return solo.length === 8 ? `502${solo}` : solo
}

export function enlacesContacto(empresa: Contacto | null): EnlaceContacto[] {
    if (!empresa) {
        return []
    }
    const enlaces: EnlaceContacto[] = []
    for (const telefono of [empresa.telefono, empresa.telefono_alterno]) {
        if (telefono) {
            enlaces.push({
                tipo: 'telefono',
                label: `Llamar al ${telefono}`,
                valor: telefono,
                icon: 'i-lucide-phone',
                to: `tel:${telefono.replace(/[^\d+]/g, '')}`,
            })
        }
    }
    if (empresa.whatsapp) {
        enlaces.push({
            tipo: 'whatsapp',
            label: `WhatsApp ${empresa.whatsapp}`,
            valor: empresa.whatsapp,
            icon: 'i-lucide-message-circle',
            to: `https://wa.me/${numeroWhatsapp(empresa.whatsapp)}`,
        })
    }
    if (empresa.correo) {
        enlaces.push({
            tipo: 'correo',
            label: `Escribir a ${empresa.correo}`,
            valor: empresa.correo,
            icon: 'i-lucide-mail',
            to: `mailto:${empresa.correo}`,
        })
    }
    return enlaces
}
