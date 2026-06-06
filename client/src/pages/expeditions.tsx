import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, Globe, Lock } from "lucide-react";
import type { Expedition } from "@shared/schema";

export default function Expeditions() {
  const { data: expeditions = [], isLoading } = useQuery<Expedition[]>({
    queryKey: ["/api/expeditions"],
    queryFn: () => fetch("/api/expeditions").then(r => r.json()),
  });

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-serif text-2xl text-stone-800">Expeditions</h1>
        <Link href="/expeditions/new">
          <button className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-stone-100 text-sm font-mono rounded hover:bg-stone-700 transition-colors">
            <Plus size={14} /> New expedition
          </button>
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-stone-100 rounded animate-pulse" />
          ))}
        </div>
      ) : expeditions.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-stone-400 font-mono text-sm mb-4">No expeditions yet</p>
          <p className="text-stone-400 text-sm max-w-xs mx-auto">
            Group your field notes into a named expedition to create a shareable trip page.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {expeditions.map(exp => (
            <Link key={exp.id} href={`/expeditions/${exp.id}/edit`}>
              <div className="flex items-center justify-between px-4 py-4 border border-stone-200 rounded-lg hover:border-stone-400 hover:bg-stone-50 transition-colors cursor-pointer">
                <div className="min-w-0">
                  <h2 className="font-serif text-stone-800 truncate">{exp.title}</h2>
                  {exp.description && (
                    <p className="text-sm text-stone-400 truncate mt-0.5">{exp.description}</p>
                  )}
                  <p className="text-xs font-mono text-stone-400 mt-1">
                    {new Date(exp.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
                <div className="shrink-0 ml-4">
                  {exp.isPublished ? (
                    <span className="flex items-center gap-1 text-xs font-mono text-green-600">
                      <Globe size={11} /> Published
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-mono text-stone-400">
                      <Lock size={11} /> Draft
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
