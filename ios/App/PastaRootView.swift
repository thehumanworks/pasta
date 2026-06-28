import PastaCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct PastaRootView: View {
    @EnvironmentObject private var model: PastaAppModel
    @State private var isImportingFile = false
    @State private var pendingDelete: PastaHistoryEntry?

    var body: some View {
        NavigationStack {
            List {
                Section("Pairing") {
                    if let configuration = model.configuration {
                        LabeledContent("Device", value: configuration.deviceName)
                        LabeledContent("Account", value: configuration.accountId)
                        LabeledContent("Endpoint", value: configuration.endpoint.absoluteString)
                    } else {
                        TextEditor(text: $model.joinToken)
                            .font(.system(.footnote, design: .monospaced))
                            .frame(minHeight: 94)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button {
                            Task { await model.join() }
                        } label: {
                            Label("Join with Token", systemImage: "link.badge.plus")
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(model.joinToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isBusy)
                    }
                    if model.isBusy {
                        ProgressView(model.status)
                    } else {
                        Text(model.status)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Publish") {
                    TextEditor(text: $model.publishText)
                        .frame(minHeight: 92)
                    HStack {
                        Button {
                            model.importClipboardText()
                        } label: {
                            Label("Import Clipboard", systemImage: "doc.on.clipboard")
                        }
                        Spacer()
                        Button {
                            Task { await model.publishCurrentText() }
                        } label: {
                            Label("Publish", systemImage: "arrow.up.circle")
                        }
                        .disabled(model.publishText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isBusy)
                    }
                }

                Section("Files") {
                    Button {
                        isImportingFile = true
                    } label: {
                        Label("Import File", systemImage: "doc.badge.plus")
                    }
                    .disabled(model.configuration == nil || model.isBusy)

                    if model.historyEntries.contains(where: \.isExportable) {
                        ForEach(model.historyEntries.filter(\.isExportable)) { entry in
                            HStack(alignment: .firstTextBaseline, spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(entry.title)
                                        .font(.headline)
                                        .lineLimit(1)
                                    Text("\(entry.payloadKind) - \(entry.mime) - \(entry.byteLen) bytes")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                                Button {
                                    Task { await model.prepareExport(entry) }
                                } label: {
                                    Label("Export", systemImage: "square.and.arrow.up")
                                        .labelStyle(.iconOnly)
                                }
                                .disabled(model.isBusy)
                            }
                        }
                    } else {
                        Text("No remote file clips.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("History") {
                    HStack {
                        Button {
                            Task { await model.refreshHistory() }
                        } label: {
                            Label("Refresh", systemImage: "arrow.clockwise")
                        }
                        .disabled(model.configuration == nil || model.isBusy)
                        Spacer()
                        Button {
                            model.copyLatestToClipboard()
                        } label: {
                            Label("Copy Latest", systemImage: "doc.on.doc")
                        }
                        .disabled(model.clips.isEmpty)
                    }
                    if model.historyEntries.isEmpty {
                        Text("Refresh after pairing to show remote history.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(model.historyEntries) { entry in
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(entry.title)
                                    .font(.headline)
                                Text(entry.preview)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                                Text("#\(entry.sequence) - \(entry.kindLabel) - \(entry.mime)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 8)
                            Button(role: .destructive) {
                                pendingDelete = entry
                            } label: {
                                if model.deletingClipId == entry.clipId {
                                    ProgressView()
                                        .controlSize(.small)
                                } else {
                                    Label("Delete", systemImage: "trash")
                                        .labelStyle(.iconOnly)
                                }
                            }
                            .disabled(model.isBusy || model.configuration == nil)
                            .accessibilityLabel("Delete history entry \(entry.sequence)")
                        }
                    }
                    #if DEBUG
                    Button {
                        model.seedLocalClip()
                    } label: {
                        Label("Add Local Keyboard Clip", systemImage: "keyboard.badge.ellipsis")
                    }
                    #endif
                }
            }
            .navigationTitle("Pasta")
            .fileImporter(
                isPresented: $isImportingFile,
                allowedContentTypes: [.item],
                allowsMultipleSelection: false
            ) { result in
                guard case .success(let urls) = result, let url = urls.first else { return }
                Task { await model.publishSelectedFile(url) }
            }
            .sheet(item: $model.preparedExport, onDismiss: {
                model.cleanupPreparedExport()
            }) { export in
                PastaShareSheet(activityItems: [export.url])
                    .ignoresSafeArea()
            }
            .confirmationDialog("Delete Pasta history entry?", isPresented: deleteDialogPresented, titleVisibility: .visible) {
                if let entry = pendingDelete {
                    Button("Delete Clip \(entry.sequence)", role: .destructive) {
                        pendingDelete = nil
                        Task { await model.deleteHistoryEntry(entry) }
                    }
                }
                Button("Cancel", role: .cancel) {
                    pendingDelete = nil
                }
            } message: {
                if let entry = pendingDelete {
                    Text("This removes clip \(entry.sequence) from remote Pasta history on all paired devices.")
                }
            }
            .toolbar {
                ToolbarItem(placement: .bottomBar) {
                    Text(model.status)
                        .font(.footnote)
                        .lineLimit(2)
                }
            }
        }
    }

    private var deleteDialogPresented: Binding<Bool> {
        Binding(
            get: { pendingDelete != nil },
            set: { isPresented in
                if !isPresented {
                    pendingDelete = nil
                }
            }
        )
    }
}

private struct PastaShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
