export default function MessageHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4 border-b font-bold flex items-center gap-2 min-w-0 shrink-0">
      {children}
    </div>
  );
}
