import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import Providers from '@/components/Providers';
import NavigationProgress from '@/components/NavigationProgress';

const inter = Inter({ subsets: ['latin', 'cyrillic'] });

export const metadata: Metadata = {
  title: 'INDEXALL',
  description: 'Сервис для сборки спецификаций электрооборудования',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className={inter.className}>
        <Providers>
          <NavigationProgress />
          {children}
          <Toaster position="bottom-right" toastOptions={{ duration: 2500 }} />
        </Providers>
      </body>
    </html>
  );
}
