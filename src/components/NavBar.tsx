"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrendingUp, BookOpen, Target, BarChart2 } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "실시간 분석", icon: TrendingUp },
  { href: "/journal", label: "저널/복기", icon: BookOpen },
  { href: "/align", label: "Align 학습", icon: Target },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <BarChart2 className="w-5 h-5 text-primary" />
          <span>TradersEyes</span>
        </Link>
        <nav className="flex gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
