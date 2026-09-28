import SwiftUI

struct NotesListView: View {
    @EnvironmentObject var auth: AuthManager
    @State private var notes: [FieldNote] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""

    private let sand   = Color(red: 245/255, green: 240/255, blue: 232/255)
    private let border = Color(red: 232/255, green: 226/255, blue: 214/255)
    private let muted  = Color(red: 138/255, green: 132/255, blue: 126/255)

    var filtered: [FieldNote] {
        guard !searchText.isEmpty else { return notes }
        return notes.filter { $0.title.localizedCaseInsensitiveContains(searchText) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(sand)
                } else if let msg = errorMessage {
                    ContentUnavailableView(msg, systemImage: "exclamationmark.triangle")
                } else if filtered.isEmpty {
                    ContentUnavailableView(
                        searchText.isEmpty ? "No field notes yet" : "No results",
                        systemImage: "map",
                        description: Text(searchText.isEmpty
                            ? "Promote trips from the GPX Inbox at bigmiles.app."
                            : "Try a different search term.")
                    )
                    .background(sand)
                } else {
                    List(filtered) { note in
                        NavigationLink(value: note) {
                            NoteRow(note: note)
                        }
                        .listRowBackground(sand)
                        .listRowSeparatorTint(border)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(sand)
                }
            }
            .navigationTitle("Field Notes")
            .navigationDestination(for: FieldNote.self) { note in
                NoteDetailView(note: note)
            }
            .searchable(text: $searchText, prompt: "Search")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Sign out") { auth.logout() }
                        .foregroundColor(muted)
                        .font(.system(size: 14))
                }
            }
            .background(sand.ignoresSafeArea())
            .refreshable { await loadNotes() }
        }
        .task { await loadNotes() }
    }

    private func loadNotes() async {
        if notes.isEmpty { isLoading = true }
        errorMessage = nil
        do {
            notes = try await API.get("/api/field-notes?sortOrder=recent")
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - Row

struct NoteRow: View {
    let note: FieldNote

    private let ink    = Color(red: 26/255,  green: 24/255,  blue: 21/255)
    private let muted  = Color(red: 138/255, green: 132/255, blue: 126/255)
    private let border = Color(red: 232/255, green: 226/255, blue: 214/255)

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Type badges
            HStack(spacing: 5) {
                ForEach(note.tripType.prefix(2), id: \.self) { type in
                    Text(type.capitalized)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(muted)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(border)
                        .cornerRadius(4)
                }
            }

            Text(note.title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(ink)

            HStack(spacing: 6) {
                Text(note.formattedDate)
                if let dist = note.distance {
                    Text("·"); Text(String(format: "%.1f mi", dist))
                }
                if let elev = note.elevationGain {
                    Text("·"); Text("\(Int(elev)) ft")
                }
            }
            .font(.system(size: 12))
            .foregroundColor(muted)
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    NotesListView().environmentObject(AuthManager.shared)
}
