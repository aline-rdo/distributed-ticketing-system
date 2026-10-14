"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Ticket } from "lucide-react";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function RootLayout({ children }) {
  const queryClient = new QueryClient();

  return (
    <html lang="en">
      <QueryClientProvider client={queryClient}>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-50 text-zinc-900`}
        >
          {/* Header */}
          <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-zinc-200">
            <div className="max-w-7xl mx-auto px-6 lg:px-8 h-20 flex justify-between items-center">
              {/* Brand */}
              <div className="flex items-center gap-3">
                <div className="bg-black text-white p-1.5 rounded-lg">
                  <Ticket className="w-5 h-5" />
                </div>
                <Link
                  href="/"
                  className="text-xl font-bold tracking-tighter uppercase"
                >
                  TML::OFFICIAL
                </Link>
              </div>

              {/* Right Nav */}
              <div className="flex items-center gap-6">
                <div className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-500">
                  <span className="hover:text-black cursor-pointer transition-colors">
                    Line-up
                  </span>
                  <span className="hover:text-black cursor-pointer transition-colors">
                    Experience
                  </span>
                  <span className="hover:text-black cursor-pointer transition-colors">
                    Support
                  </span>
                </div>

                <div className="w-px h-6 bg-zinc-200 hidden md:block" />

                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full overflow-hidden border border-zinc-200 relative">
                    <Image
                      src="/goat.jpg"
                      alt="avatar"
                      fill
                      className="object-cover"
                    />
                  </div>
                </div>
              </div>
            </div>
          </header>

          <main className="max-w-7xl mx-auto px-6 lg:px-8 py-12">
            {children}
          </main>
        </body>
      </QueryClientProvider>
    </html>
  );
}
