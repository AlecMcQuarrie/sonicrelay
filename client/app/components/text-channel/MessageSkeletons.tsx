import { Skeleton } from "~/components/ui/skeleton";

export default function MessageSkeletons() {
  // Generate varied skeleton rows to mimic a realistic chat
  const rows = [
    { nameW: "w-20", hasBody: true, bodyW: "w-3/4" },
    { nameW: "w-24", hasBody: true, bodyW: "w-1/2" },
    { nameW: "w-16", hasBody: true, bodyW: "w-2/3" },
    { nameW: "w-20", hasBody: true, bodyW: "w-5/6" },
    { nameW: "w-28", hasBody: true, bodyW: "w-1/3" },
    { nameW: "w-20", hasBody: true, bodyW: "w-3/5" },
    { nameW: "w-24", hasBody: true, bodyW: "w-2/5" },
    { nameW: "w-16", hasBody: true, bodyW: "w-4/5" },
    { nameW: "w-20", hasBody: true, bodyW: "w-1/2" },
    { nameW: "w-28", hasBody: true, bodyW: "w-3/4" },
    { nameW: "w-20", hasBody: true, bodyW: "w-2/3" },
    { nameW: "w-24", hasBody: true, bodyW: "w-1/4" },
  ];

  return (
    <div className="space-y-4 p-4">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2 items-start">
          <Skeleton className="w-8 h-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className={`h-4 ${row.nameW}`} />
            {row.hasBody && <Skeleton className={`h-4 ${row.bodyW}`} />}
          </div>
        </div>
      ))}
    </div>
  );
}
