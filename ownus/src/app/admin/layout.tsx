import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Orion Admin Console | Enterprise Control Plane',
  description: 'Administrative control plane for Orion platform data, ingestion, and users.',
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen w-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden flex flex-col">
      {children}
    </div>
  );
}
