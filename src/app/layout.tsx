import type { Metadata } from "next";
import { Geist_Mono, Google_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// Self-hosted by next/font at build time (no request to Google when the page loads).
// Variable font: weights 400-700 plus the optical-size and grade axes.
const googleSans = Google_Sans({
  variable: "--font-google-sans",
  subsets: ["latin"],
  axes: ["GRAD", "opsz"],
  display: "swap",
  adjustFontFallback: false, // size-adjust metrics are not published for this font yet
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Job Search OS",
  description: "Track jobs, tailor applications and manage your job search in one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${googleSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
