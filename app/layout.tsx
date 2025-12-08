import type { Metadata } from "next";
import { Geist_Mono, Cairo } from "next/font/google";
import "./globals.css";

const cairo = Cairo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-cairo",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Compression Demo",
  description: "Experiment with custom image codec and visualization",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${cairo.variable} ${geistMono.variable} font-sans antialiased bg-gradient-to-br from-white via-blue-50 to-purple-50 text-slate-800`}>
        {children}
      </body>
    </html>
  );
}
