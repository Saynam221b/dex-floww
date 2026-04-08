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
  title: "D3xTRverse Flow — SQL Pipeline Visualizer",
  description:
    "Instantly visualize and decode complex SQL pipelines into interactive DAG flowcharts with AI-powered explanations.",
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
    title: "D3xTRverse Flow — SQL Pipeline Visualizer",
    description:
      "Turn chaotic SQL into clear, interactive DAG flowcharts. Powered by AST parsing & AI explanations.",
    siteName: "D3xTRverse Flow",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "D3xTRverse Flow",
    description:
      "Turn chaotic SQL into clear, interactive DAG flowcharts. Powered by AST parsing & AI explanations.",
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
