import { TopBar } from "@/components/shell/top-bar";

export default function ViewsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dot-grid relative flex h-screen flex-col overflow-hidden">
      <TopBar />
      <main className="relative flex min-h-0 flex-1">{children}</main>
    </div>
  );
}
