import { closeMainWindow, getSelectedText, PopToRootType, showHUD } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { runPasta } from "./pasta";

export default async function main() {
  try {
    await closeMainWindow({ popToRootType: PopToRootType.Suspended });
    const selectedText = await getSelectedText();
    if (!selectedText.trim()) {
      throw new Error("Text must be selected to copy to Pasta store.");
    }

    await runPasta(["copy"], { input: selectedText });
    await showHUD("Copied to Pasta store");
  } catch (error) {
    await showFailureToast(error, { title: "Could not copy to Pasta store" });
  }
}
