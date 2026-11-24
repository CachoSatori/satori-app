// Íconos de línea: Tabler Icons (@tabler/icons-react, MIT). SPEC-caja-estandar §3.6.
// La lista vive acá: se importan por nombre y solo los usados, para que el empaquetado descarte el resto.
// Uso: tamaño 20, trazo 1,5, color heredado del texto; `aria-hidden` cuando acompañan un texto y
// `aria-label` en el botón cuando van solos. Para eso está `PROPS_ICONO`.
export {
  IconPlus,
  IconCheck,
  IconChevronRight,
  IconChevronDown,
  IconCalendar,
  IconDownload,
  IconPencil,
  IconTrash,
  IconArrowBackUp,
  IconSearch,
} from '@tabler/icons-react'

export const PROPS_ICONO = { size: 20, stroke: 1.5, 'aria-hidden': true, className: 'est-ico' } as const
