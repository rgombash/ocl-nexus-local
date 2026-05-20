import type { Metadata } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { MARKETING_DOMAIN } from "@/lib/config/nexus";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  metadataBase: new URL(`https://${MARKETING_DOMAIN}`),
  title: {
    default: "OCL Nexus Local | Frictionless Agentic Compute",
    template: "%s | OCL Nexus Local",
  },
  description:
    "Local-first agentic compute fabric. Provision isolated Ubuntu sandboxes with native MCP support on your own hardware via Docker Compose.",
  keywords: [
    "OCL Nexus",
    "agentic compute",
    "MCP sandboxes",
    "AI infrastructure",
    "Model Context Protocol",
    "EU AI hosting",
    "BYOK LLM",
    "K3s workloads",
  ],
  authors: [{ name: "OCL Nexus", url: `https://${MARKETING_DOMAIN}` }],
  creator: "OCL Nexus",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: `https://${MARKETING_DOMAIN}`,
    siteName: "OCL Nexus Local",
    title: "OCL Nexus Local | Frictionless Agentic Compute",
    description:
      "Local-first agentic compute fabric. Provision isolated Ubuntu sandboxes with native MCP support on your own hardware via Docker Compose.",
  },
  twitter: {
    card: "summary_large_image",
    title: "OCL Nexus Local | Frictionless Agentic Compute",
    description:
      "Local-first agentic compute fabric. Provision isolated Ubuntu sandboxes with native MCP support on your own hardware via Docker Compose.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light'){document.documentElement.classList.remove('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}
