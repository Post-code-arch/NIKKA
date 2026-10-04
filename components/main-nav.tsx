"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/brief", label: "Brief" },
  { href: "/canvas", label: "Canvas" },
  { href: "/storyboard", label: "Storyboard" },
] as const;

export function MainNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm transition-colors",
            pathname.startsWith(t.href)
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
