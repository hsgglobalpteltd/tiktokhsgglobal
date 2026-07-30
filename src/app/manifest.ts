import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'iB - HSG Global Internal Bridge',
    short_name: 'iB Bridge',
    description: 'Internal operator console and dashboard for HSG Global',
    start_url: '/orders',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0b57d0',
    icons: [
      {
        src: '/globe.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  }
}
