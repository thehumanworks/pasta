import { closeMainWindow, Clipboard, PopToRootType, showHUD } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { runPasta } from "./pasta";

export default async function main() {
  try {
    const text = await runPasta(["paste"]);
    await closeMainWindow({ popToRootType: PopToRootType.Suspended });
    await Clipboard.paste(text);
    await showHUD("Pasted from Pasta store");
  } catch (error) {
    await showFailureToast(error, { title: "Could not paste from Pasta store" });
  }
}
