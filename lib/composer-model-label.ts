// Display only. Keep the provider/model ID intact for requests and selection.
export function composerModelLabel(name: string): string {
  const label = name.replace(/(?:\s*\((?:minimal|low|medium|high|xhigh|max)\)|[\s_-]+(?:minimal|low|medium|high|xhigh|max))$/i, "").trim();
  // A restored session can supply its ID before the catalog's friendly name.
  const gemini = /^gemini-(\d+(?:\.\d+)*)(-flash|-pro)$/i.exec(label);
  return gemini ? `Gemini ${gemini[1]} ${gemini[2].slice(1).toLowerCase() === "flash" ? "Flash" : "Pro"}` : label;
}
