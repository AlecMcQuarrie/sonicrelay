export default function RoleBadge({ role }: { role: 'superadmin' | 'admin' }) {
  if (role === 'superadmin') {
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-500 shrink-0">
        OWNER
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">
      ADMIN
    </span>
  );
}
