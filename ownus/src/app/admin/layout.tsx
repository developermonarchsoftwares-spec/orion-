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
    <div className="min-h-screen h-screen w-full bg-gray-50 dark:bg-black text-gray-900 dark:text-gray-100 overflow-hidden flex flex-col">
      {children}
    </div>
  );
}
