'use client';
import { Toaster } from 'react-hot-toast';

export default function ToasterClient() {
  return <Toaster position="bottom-right" toastOptions={{ duration: 2500 }} />;
}
