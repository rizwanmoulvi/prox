import type { Metadata, Viewport } from 'next'
import { Bodoni_Moda, Geist_Mono, Mulish } from 'next/font/google'
import { Providers } from '@/components/providers'
import './globals.css'

// The Umbra type set: Bodoni Moda for display, Mulish for the interface, Geist Mono for figures.
const bodoni = Bodoni_Moda({ variable: '--font-bodoni', subsets: ['latin'], style: ['normal', 'italic'] })
const mulish = Mulish({ variable: '--font-mulish', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'], weight: ['400', '500'] })

export const metadata: Metadata = {
  title: 'ProX',
  description: 'Temporary downside protection for tokenized stocks held on Backpack',
}

export const viewport: Viewport = { themeColor: '#ECE5D3' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bodoni.variable} ${mulish.variable} ${geistMono.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
