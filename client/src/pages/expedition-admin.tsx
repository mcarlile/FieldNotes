import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, X, GripVertical } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import PublishButton from "@/components/publish-button";
import type { FieldNote, Expedition } from "@shared/schema";

interface ExpeditionWithFieldNotes extends Expedition {
  fieldNotes: Array<FieldNote & { position: number }>;
}

export default function ExpeditionAdmin() {
  const { id } = useParams<{ id?: string }>();
  const isEditing = !!id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data: existing } = useQuery<ExpeditionWithFieldNotes>({
    queryKey: ["/api/expeditions", id],
    queryFn: () => fetch(`/api/expeditions/${id}`).then(r => r.json()),
    enabled: isEditing,
  });

  const { data: allNotes = [] } = useQuery<FieldNote[]>({
    queryKey: ["/api/field-notes"],
    queryFn: () => fetch("/api/field-notes").then(r => r.json()),
  });

  useEffect(() => {
    if (existing) {
      setTitle(existing.title);
      setDescription(existing.description ?? "");
      setSelectedIds(
        [...existing.fieldNotes]
          .sort((a, b) => a.position - b.position)
          .map(fn => fn.id)
      );
    }
  }, [existing]);

  const saveMutation = useMutation({
    mutationFn: (data: { title: string; description: string; fieldNoteIds: string[] }) =>
      isEditing
        ? apiRequest(`/api/expeditions/${id}`, "PUT", data)
        : apiRequest("/api/expeditions", "POST", data),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["/api/expeditions"] });
      toast({ title: isEditing ? "Saved" : "Expedition created", variant: "success" });
      if (!isEditing) setLocation(`/expeditions/${res.id}/edit`);
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest(`/api/expeditions/${id}`, "DELETE"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/expeditions"] });
      setLocation("/expeditions");
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  function toggleNote(noteId: string) {
    setSelectedIds(prev =>
      prev.includes(noteId) ? prev.filter(x => x !== noteId) : [...prev, noteId]
    );
  }

  function moveUp(index: number) {
    if (index === 0) return;
    setSelectedIds(prev => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveDown(index: number) {
    setSelectedIds(prev => {
      if (index === prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  const selectedNotes = selectedIds
    .map(sid => allNotes.find(n => n.id === sid))
    .filter((n): n is FieldNote => !!n);

  const unselectedNotes = allNotes.filter(n => !selectedIds.includes(n.id));

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <Link href="/expeditions">
          <button className="flex items-center gap-2 text-sm text-stone-500 hover:text-stone-800 font-mono">
            <ArrowLeft size={14} /> Expeditions
          </button>
        </Link>

        {isEditing && existing && (
          <PublishButton
            id={existing.id}
            isPublished={existing.isPublished}
            slug={existing.slug}
            publishPath="/trips"
            apiPath="/api/expeditions"
            queryKey={["/api/expeditions", id]}
          />
        )}
      </div>

      <h1 className="font-serif text-2xl text-stone-800 mb-6">
        {isEditing ? "Edit expedition" : "New expedition"}
      </h1>

      <div className="space-y-6">
        <div>
          <label className="block text-xs font-mono text-stone-500 uppercase tracking-wider mb-1">Title</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Wyoming Wind Rivers 2024"
            className="w-full px-3 py-2 border border-stone-200 rounded text-stone-800 bg-white focus:outline-none focus:border-stone-400"
          />
        </div>

        <div>
          <label className="block text-xs font-mono text-stone-500 uppercase tracking-wider mb-1">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            placeholder="A brief overview of the trip..."
            className="w-full px-3 py-2 border border-stone-200 rounded text-stone-800 bg-white focus:outline-none focus:border-stone-400 resize-none"
          />
        </div>

        {/* Selected field notes in order */}
        <div>
          <label className="block text-xs font-mono text-stone-500 uppercase tracking-wider mb-2">
            Days / segments ({selectedNotes.length})
          </label>
          {selectedNotes.length === 0 ? (
            <p className="text-sm text-stone-400 italic py-4 border border-dashed border-stone-200 rounded text-center">
              No field notes added yet
            </p>
          ) : (
            <div className="space-y-1">
              {selectedNotes.map((note, i) => (
                <div key={note.id} className="flex items-center gap-2 px-3 py-2 bg-stone-50 border border-stone-200 rounded">
                  <span className="text-xs font-mono text-stone-400 w-5 shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-stone-800 truncate block">{note.title}</span>
                    <span className="text-xs text-stone-400 font-mono">
                      {new Date(note.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => moveUp(i)} disabled={i === 0} className="p-1 text-stone-300 hover:text-stone-600 disabled:opacity-0">
                      ↑
                    </button>
                    <button onClick={() => moveDown(i)} disabled={i === selectedNotes.length - 1} className="p-1 text-stone-300 hover:text-stone-600 disabled:opacity-0">
                      ↓
                    </button>
                    <button onClick={() => toggleNote(note.id)} className="p-1 text-stone-300 hover:text-red-500">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add field notes */}
        {unselectedNotes.length > 0 && (
          <div>
            <label className="block text-xs font-mono text-stone-500 uppercase tracking-wider mb-2">
              Add field notes
            </label>
            <div className="space-y-1 max-h-64 overflow-y-auto border border-stone-200 rounded p-2">
              {unselectedNotes.map(note => (
                <button
                  key={note.id}
                  onClick={() => toggleNote(note.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-50 rounded transition-colors"
                >
                  <Plus size={14} className="text-stone-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-stone-800 truncate block">{note.title}</span>
                    <span className="text-xs text-stone-400 font-mono">
                      {new Date(note.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-stone-100">
          <div>
            {isEditing && (
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="text-sm text-red-500 hover:text-red-700 font-mono"
              >
                Delete expedition
              </button>
            )}
          </div>
          <button
            onClick={() => saveMutation.mutate({ title, description, fieldNoteIds: selectedIds })}
            disabled={!title.trim() || saveMutation.isPending}
            className="px-5 py-2 bg-stone-800 text-stone-100 text-sm font-mono rounded hover:bg-stone-700 disabled:opacity-50 transition-colors"
          >
            {saveMutation.isPending ? "Saving…" : isEditing ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
