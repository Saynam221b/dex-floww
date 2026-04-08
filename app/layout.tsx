import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "D3xTRverse Flow | SQL Lineage Visualizer",
  description: "Transform complex SQL into interactive DAGs",
  keywords: [
    "SQL visualizer",
    "DAG",
    "SQL pipeline",
    "query visualization",
    "AST parser",
    "D3xTRverse",
    "SQL flowchart",
  ],
  authors: [{ name: "Saynam", url: "https://saynam-portfolio-19qy.vercel.app/" }],
  creator: "Saynam — D3xTRverse",
  manifest: "/manifest.json",
  other: {
    "theme-color": "#4f46e5",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
  openGraph: {
    title: "D3xTRverse Flow | SQL Lineage Visualizer",
    description: "Transform complex SQL into interactive DAGs",
    siteName: "D3xTRverse Flow",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "D3xTRverse Flow | SQL Lineage Visualizer",
    description: "Transform complex SQL into interactive DAGs",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="noise-overlay min-h-full flex flex-col" suppressHydrationWarning>{children}</body>
    </html>
  );
}
