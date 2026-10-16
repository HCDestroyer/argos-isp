import type { ComponentProps } from 'react'
import { LogoArgos } from '../LogoArgos'
import { IRIS_ONDAS } from '../geometria'

/** Variante descartada: iris circular con ondas de radio a ambos lados. */
export function LogoIrisOndas(props: Omit<ComponentProps<typeof LogoArgos>, 'definicion'>) {
    return <LogoArgos {...props} definicion={IRIS_ONDAS} />
}
