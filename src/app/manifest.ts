import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tiktok Fulfillment Platform',
    short_name: 'Tiktok Fulfillment Platform',
    description: 'Tiktok Fulfillment Platform - HSG Global Internal Bridge',
    start_url: '/orders',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0b57d0',
    icons: [
      {
        src: '/icon.png',
        sizes: 'any',
        type: 'image/png',
      },
    ],
  }
}
