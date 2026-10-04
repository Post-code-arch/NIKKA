import { MainNav } from "@/components/main-nav";

export default function ViewsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-6 border-b px-4">
        <span className="font-mono text-sm font-semibold tracking-widest text-primary">NIKKA</span>
        <MainNav />
      </header>
      <main className="flex min-h-0 flex-1">{children}</main>
    </div>
  );
}
