import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SkyLink Self Check-in',
  description: 'SkyLink passenger self check-in demo'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
