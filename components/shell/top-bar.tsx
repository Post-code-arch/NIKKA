"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, EllipsisVertical, Menu, Play, Wallet, X } from "lucide-react";
import { IconPill, Island, Pill, pillClass } from "@/components/ui/pill";
import { Logo } from "./logo";

const VIEWS = [
  { href: "/brief", label: "Brief" },
  { href: "/canvas", label: "Canvas" },
  { href: "/storyboard", label: "Storyboard" },
] as const;

export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="pointer-events-none relative z-20 grid shrink-0 grid-cols-[1fr_auto_1fr] items-start gap-4 px-4 pt-4">
      {/* Left: logo + views */}
      <div className="pointer-events-auto flex items-center gap-3">
        <Link href="/brief" className="grid size-10 place-items-center">
          <Logo />
        </Link>
        <Island>
          {VIEWS.map((v) => (
            <Link key={v.href} href={v.href} className={pillClass(pathname.startsWith(v.href))}>
              {v.label}
            </Link>
          ))}
        </Island>
      </div>

      {/* Center: project switcher + context */}
      <div className="pointer-events-auto flex flex-col items-center gap-3">
        <div className="flex items-center gap-2">
          <IconPill aria-label="Projet précédent" disabled>
            <ChevronLeft />
          </IconPill>
          <Island className="pr-1.5">
            <span className="px-3 text-xs">Sans titre</span>
            <IconPill aria-label="Fermer le projet" className="size-6 rounded-md bg-transparent" disabled>
              <X />
            </IconPill>
          </Island>
          <IconPill aria-label="Projet suivant" disabled>
            <ChevronRight />
          </IconPill>
        </div>
        <span className="text-[11px] text-muted-foreground">Aucune séquence</span>
      </div>

      {/* Right: jobs queue + project cost */}
      <div className="pointer-events-auto flex flex-col items-end gap-3">
        <div className="flex items-center gap-2">
          <IconPill aria-label="Plus">
            <EllipsisVertical />
          </IconPill>
          <Island>
            <Pill className="bg-transparent text-foreground">
              <Play className="fill-current" />
              File d&apos;attente
            </Pill>
            <span className="grid h-8 min-w-8 place-items-center rounded-[10px] bg-surface-2 px-2 font-mono text-xs">0</span>
          </Island>
          <IconPill aria-label="Menu">
            <Menu />
          </IconPill>
        </div>
        <Island className="px-3 py-1.5 text-xs">
          <Wallet className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Projet</span>
          <span className="font-mono">$0.00</span>
        </Island>
      </div>
    </header>
  );
}
