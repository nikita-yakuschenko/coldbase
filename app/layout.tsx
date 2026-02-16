import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin", "cyrillic"], variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "coldbase",
  description: "Загрузка холодной базы в AmoCRM",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning className={manrope.variable}>
      <body suppressHydrationWarning className={manrope.className}>
        {children}
      </body>
    </html>
  );
}
