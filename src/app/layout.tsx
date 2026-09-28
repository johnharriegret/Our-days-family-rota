import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Our Days · Family rota",
  description: "Family calendar, shifts and time together",
  applicationName: "Our Days",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Our Days",
  },
  icons: {
    icon: [
      { url: "/icons/our-days-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/our-days-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#6a63d1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Script id="our-days-pwa-bootstrap" strategy="beforeInteractive">{`
          window.__ourDaysInstallPrompt = null;
          window.addEventListener("beforeinstallprompt", function (event) {
            event.preventDefault();
            window.__ourDaysInstallPrompt = event;
            window.dispatchEvent(new Event("ourdaysinstallready"));
          });
          if ("serviceWorker" in navigator) {
            window.addEventListener("load", function () {
              navigator.serviceWorker.register("/sw.js").catch(function () {});
            });
          }
        `}</Script>
        {children}
      </body>
    </html>
  );
}
