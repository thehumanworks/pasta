import PastaCore
import SwiftUI

struct PastaRootView: View {
    @EnvironmentObject private var model: PastaAppModel

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
                                Task { await model.deleteHistoryEntry(entry) }
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
                    Button {
                        model.seedLocalClip()
                    } label: {
                        Label("Add Local Keyboard Clip", systemImage: "keyboard.badge.ellipsis")
                    }
                }
            }
            .navigationTitle("Pasta")
            .toolbar {
                ToolbarItem(placement: .bottomBar) {
                    Text(model.status)
                        .font(.footnote)
                        .lineLimit(2)
                }
            }
        }
    }
}
